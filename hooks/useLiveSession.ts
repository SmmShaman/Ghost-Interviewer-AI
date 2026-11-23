/**
 * LIVE SESSION
 *
 * One pipeline for all three modes:
 *
 *   speech events -> Segmenter -> Segment
 *        Segment -> instant draft (on-device / NMT)      shown at once, grey
 *        Segment -> streamed LLM translation with context replaces the draft
 *        (FOCUS / FULL) LLM flags a finished question -> grounded answer
 *
 * SIMPLE shows the translation only, FOCUS adds answers, FULL adds
 * strategy + analysis to each answer. The modes differ in depth, not in code path.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Briefing, InterviewContext, QAItem, Segment } from '../types';
import { Segmenter, RawSegment } from '../services/segmenter';
import { localTranslator } from '../services/localTranslator';
import { debugLogger } from '../services/debugLogger';
import { LLMError, generateAnswer, isLLMAvailable, translateSegment } from '../services/claudeService';
import { CandidateDocs, questionSimilarity } from '../services/prompts';

export type LLMStatus = 'ok' | 'offline' | 'auth' | 'error';

export interface LiveState {
    isListening: boolean;
    /** Candidate is speaking: incoming speech is ignored. */
    isPaused: boolean;
    segments: Segment[];
    /** Words of the phrase in progress (not a segment yet). */
    interim: string;
    interimDraft: string;
    qa: QAItem[];
    llmStatus: LLMStatus;
    llmError: string;
    startedAt: number;
}

const INITIAL: LiveState = {
    isListening: false,
    isPaused: false,
    segments: [],
    interim: '',
    interimDraft: '',
    qa: [],
    llmStatus: 'ok',
    llmError: '',
    startedAt: 0,
};

const CONTEXT_SEGMENTS = 3;       // previous segments sent with each translation
const MERGE_MAX_WORDS = 45;       // catch-up: merge queued segments up to this size
const MERGE_MIN_WORDS = 8;        // …but stop at the end of an utterance once this long
const INTERIM_DRAFT_WORDS = 14;   // translate only the tail of a long interim
const INTERIM_DEBOUNCE_MS = 120;
const TICK_MS = 100;
const DUPLICATE_QUESTION = 0.7;

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

interface Options {
    briefing: Briefing | null;
    /** Backend rejected the session (401): ask the user to sign in again. */
    onAuthExpired?: () => void;
}

export function useLiveSession(context: InterviewContext, options: Options) {
    const [state, setState] = useState<LiveState>(INITIAL);

    // Mutable mirrors: async work must never read stale React state.
    const contextRef = useRef(context);
    const optionsRef = useRef(options);
    useEffect(() => { contextRef.current = context; }, [context]);
    useEffect(() => { optionsRef.current = options; }, [options]);

    const segmenterRef = useRef(new Segmenter());
    const segmentsRef = useRef<Segment[]>([]);
    const qaRef = useRef<QAItem[]>([]);
    const nextIdRef = useRef(1);
    const queueRef = useRef<number[]>([]);          // segment ids waiting for the LLM
    const translatingRef = useRef(false);
    const listeningRef = useRef(false);
    const pausedRef = useRef(false);
    const hadLLMRef = useRef(false);                // an LLM call succeeded in this page session
    const soloRef = useRef(new Set<number>());      // retried segments: never merged into a batch
    const utteranceOpenWhilePausedRef = useRef(false);
    const skipUntilFinalRef = useRef(false);
    const abortRef = useRef(new AbortController());
    const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const interimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const interimBusyRef = useRef(false);
    const interimWantedRef = useRef('');

    // ---- state helpers -----------------------------------------------------

    const patchSegment = useCallback((id: number, patch: Partial<Segment>) => {
        segmentsRef.current = segmentsRef.current.map(s => (s.id === id ? { ...s, ...patch } : s));
        setState(prev => ({ ...prev, segments: segmentsRef.current }));
    }, []);

    const patchQA = useCallback((id: number, patch: Partial<QAItem>) => {
        qaRef.current = qaRef.current.map(q => (q.id === id ? { ...q, ...patch } : q));
        setState(prev => ({ ...prev, qa: qaRef.current }));
    }, []);

    const setLLM = useCallback((llmStatus: LLMStatus, llmError = '') => {
        setState(prev => (prev.llmStatus === llmStatus && prev.llmError === llmError ? prev : { ...prev, llmStatus, llmError }));
    }, []);

    const handleLLMError = useCallback((e: unknown): 'auth' | 'abort' | 'other' => {
        if ((e as Error)?.name === 'AbortError') return 'abort';
        if (e instanceof LLMError && e.isAuth) {
            setLLM('auth');
            optionsRef.current.onAuthExpired?.();
            return 'auth';
        }
        setLLM('error', (e as Error)?.message || 'LLM error');
        return 'other';
    }, [setLLM]);

    const docsOf = (ctx: InterviewContext): CandidateDocs => ({
        resume: ctx.resume,
        knowledgeBase: ctx.knowledgeBase,
        applicationLetter: ctx.applicationLetter,
        companyDescription: ctx.companyDescription,
        jobDescription: ctx.jobDescription,
    });

    // ---- answers -----------------------------------------------------------

    const startAnswer = useCallback(async (question: string, questionTranslation: string, manual: boolean) => {
        const ctx = contextRef.current;
        if (ctx.viewMode === 'SIMPLE') return;
        if (!isLLMAvailable()) { setLLM('offline'); return; }

        // The same question is often flagged again when the interviewer rephrases it.
        if (!manual && qaRef.current.slice(-6).some(q => questionSimilarity(q.question, question) >= DUPLICATE_QUESTION)) {
            debugLogger.log('QUESTION', `duplicate skipped: ${question.slice(0, 60)}`);
            return;
        }

        const item: QAItem = {
            id: nextIdRef.current++,
            question, questionTranslation,
            strategy: '', analysis: '', answer: '', answerTranslation: '',
            status: 'generating', manual, timestamp: Date.now(),
        };
        qaRef.current = [...qaRef.current, item];
        setState(prev => ({ ...prev, qa: qaRef.current }));
        debugLogger.log('QUESTION', question.slice(0, 80));

        const started = performance.now();
        let firstToken = 0;
        try {
            await generateAnswer({
                mode: ctx.viewMode,
                sourceLang: ctx.targetLanguage,
                nativeLang: ctx.nativeLanguage,
                question,
                transcriptTail: segmentsRef.current.slice(-8).map(s => s.source),
                previous: qaRef.current.filter(q => q.status === 'done' && q.id !== item.id).map(q => ({ question: q.question, answer: q.answer })),
                docs: docsOf(ctx),
                settings: {
                    sourceLang: ctx.targetLanguage,
                    nativeLang: ctx.nativeLanguage,
                    proficiencyLevel: ctx.proficiencyLevel,
                    tone: ctx.tone,
                    personalInstructions: ctx.systemInstruction,
                    briefing: optionsRef.current.briefing?.text || '',
                },
            }, partial => {
                if (!firstToken) {
                    firstToken = performance.now();
                    debugLogger.log('ANSWER_TTFT', '', firstToken - started);
                }
                patchQA(item.id, partial);
            }, abortRef.current.signal);
            patchQA(item.id, { status: 'done' });
            debugLogger.log('ANSWER', '', performance.now() - started);
            setLLM('ok');
        } catch (e) {
            const kind = handleLLMError(e);
            patchQA(item.id, { status: kind === 'abort' ? 'aborted' : 'error' });
        }
    }, [patchQA, setLLM, handleLLMError]);

    // ---- translation queue -------------------------------------------------

    /** Merge everything waiting in the queue into one segment (catch-up after a slow call). */
    const takeNextBatch = (): Segment | null => {
        const ids = queueRef.current;
        if (ids.length === 0) return null;
        const byId = new Map<number, Segment>(segmentsRef.current.map((s): [number, Segment] => [s.id, s]));
        const first = byId.get(ids[0]);
        if (!first) { ids.shift(); return takeNextBatch(); }

        const merged: Segment[] = [first];
        let words = wordCount(first.source);
        if (soloRef.current.delete(first.id)) { ids.shift(); return first; }
        // A batch normally ends where an utterance ends: batches aligned to whole
        // utterances translate better and keep question detection reliable.
        // When we are falling behind, catching up matters more.
        const behind = ids.length > 2;
        const endsUtterance = (s: Segment) => !behind && s.boundary !== 'length' && words >= MERGE_MIN_WORDS;
        const order = segmentsRef.current;
        for (let i = 1; i < ids.length && !endsUtterance(merged[merged.length - 1]); i++) {
            const next = byId.get(ids[i]);
            if (!next || soloRef.current.has(next.id)) break;
            // Only merge neighbours on screen: anything else would reorder the transcript.
            const lastIndex = order.findIndex(s => s.id === merged[merged.length - 1].id);
            if (order[lastIndex + 1]?.id !== next.id) break;
            if (words + wordCount(next.source) > MERGE_MAX_WORDS) break;
            merged.push(next);
            words += wordCount(next.source);
        }
        queueRef.current = ids.filter(id => !merged.some(m => m.id === id));
        if (merged.length === 1) return first;

        const last = merged[merged.length - 1];
        const combined: Segment = {
            ...first,
            source: merged.map(m => m.source).join(' '),
            draft: merged.map(m => m.draft).filter(Boolean).join(' '),
            boundary: last.boundary,
        };
        const dropped = new Set(merged.slice(1).map(m => m.id));
        segmentsRef.current = segmentsRef.current.filter(s => !dropped.has(s.id)).map(s => (s.id === first.id ? combined : s));
        setState(prev => ({ ...prev, segments: segmentsRef.current }));
        return combined;
    };

    const pumpTranslations = useCallback(async () => {
        if (translatingRef.current) return;
        translatingRef.current = true;
        try {
            for (;;) {
                const seg = takeNextBatch();
                if (!seg) break;
                if (!isLLMAvailable()) {
                    patchSegment(seg.id, { status: 'draft-only' });
                    // Worked before and stopped: the session expired, say so.
                    if (hadLLMRef.current) { setLLM('auth'); optionsRef.current.onAuthExpired?.(); }
                    else setLLM('offline');
                    continue;
                }

                const ctx = contextRef.current;
                const done = segmentsRef.current.filter(s => s.id < seg.id && (s.translation || s.draft));
                const request = {
                    sourceLang: ctx.targetLanguage,
                    nativeLang: ctx.nativeLanguage,
                    context: done.slice(-CONTEXT_SEGMENTS).map(s => ({ source: s.source, translation: s.translation || s.draft })),
                    fragment: seg.source,
                    speakerContinues: seg.boundary === 'length',
                    detectQuestions: ctx.viewMode !== 'SIMPLE',
                    handledQuestions: qaRef.current.map(q => q.question),
                    keyterms: optionsRef.current.briefing?.keyterms || [],
                };

                let attempt = 0;
                for (;;) {
                    attempt++;
                    let gotFirst = false;
                    try {
                        const result = await translateSegment(request, partial => {
                            if (!partial.translation) return;
                            if (!gotFirst) {
                                gotFirst = true;
                                const latencyMs = Date.now() - seg.timestamp;
                                debugLogger.log('SEG_TTFT', seg.source.slice(0, 40), latencyMs, wordCount(seg.source));
                                patchSegment(seg.id, { status: 'translating', translation: partial.translation, latencyMs });
                            } else {
                                patchSegment(seg.id, { translation: partial.translation });
                            }
                        }, abortRef.current.signal);
                        patchSegment(seg.id, { status: 'done', translation: result.translation });
                        hadLLMRef.current = true;
                        setLLM('ok');
                        if (result.question) {
                            // Not awaited: the next segment must not wait for the answer.
                            void startAnswer(result.question.source, result.question.native, false);
                        }
                        break;
                    } catch (e) {
                        const kind = handleLLMError(e);
                        // One quick retry for transient failures; never retry what already streamed.
                        if (kind === 'other' && attempt === 1 && !gotFirst) {
                            await new Promise(r => setTimeout(r, 300));
                            continue;
                        }
                        // Keep whatever we have on screen: the draft, or the partial translation.
                        const current = segmentsRef.current.find(s => s.id === seg.id);
                        patchSegment(seg.id, { status: current?.translation ? 'done' : 'draft-only' });
                        break;
                    }
                }
            }
        } finally {
            translatingRef.current = false;
        }
    }, [patchSegment, setLLM, handleLLMError, startAnswer]);

    const addSegments = useCallback((raw: RawSegment[]) => {
        if (raw.length === 0) return;
        const now = Date.now();
        const created: Segment[] = raw.filter(r => r.text.trim()).map(r => ({
            id: nextIdRef.current++,
            source: r.text.trim(),
            draft: '',
            translation: '',
            status: 'draft' as const,
            boundary: r.boundary,
            timestamp: now,
        }));
        if (created.length === 0) return;

        segmentsRef.current = [...segmentsRef.current, ...created];
        setState(prev => ({ ...prev, segments: segmentsRef.current }));

        const sameLanguage = contextRef.current.targetLanguage === contextRef.current.nativeLanguage;
        for (const seg of created) {
            debugLogger.log('SEGMENT', `${seg.boundary}: ${seg.source.slice(0, 60)}`, undefined, wordCount(seg.source));
            if (sameLanguage) { patchSegment(seg.id, { status: 'done', translation: seg.source }); continue; }
            queueRef.current.push(seg.id);
            // Instant draft; ignored if the LLM translation got there first.
            localTranslator.translateDraft(seg.source).then(draft => {
                if (!draft) return;
                const current = segmentsRef.current.find(s => s.id === seg.id);
                if (current && !current.translation) patchSegment(seg.id, { draft });
            });
        }
        void pumpTranslations();
    }, [patchSegment, pumpTranslations]);

    // ---- interim (phrase in progress) --------------------------------------

    const refreshInterim = useCallback(() => {
        const pending = segmenterRef.current.pendingText;
        setState(prev => (prev.interim === pending ? prev : { ...prev, interim: pending, interimDraft: pending ? prev.interimDraft : '' }));

        const ctx = contextRef.current;
        if (!pending || ctx.targetLanguage === ctx.nativeLanguage) return;
        const words = pending.split(/\s+/);
        interimWantedRef.current = words.length > INTERIM_DRAFT_WORDS
            ? '… ' + words.slice(-INTERIM_DRAFT_WORDS).join(' ')
            : pending;

        if (interimTimerRef.current) clearTimeout(interimTimerRef.current);
        interimTimerRef.current = setTimeout(async () => {
            if (interimBusyRef.current) return;      // coalesce: the running call re-checks below
            interimBusyRef.current = true;
            try {
                for (;;) {
                    const wanted = interimWantedRef.current;
                    const ellipsis = wanted.startsWith('… ');
                    const draft = await localTranslator.translateDraft(ellipsis ? wanted.slice(2) : wanted);
                    // Phrase already became a segment: do not paint a stale draft.
                    if (!segmenterRef.current.pendingText) break;
                    if (draft) setState(prev => ({ ...prev, interimDraft: (ellipsis ? '… ' : '') + draft }));
                    if (interimWantedRef.current === wanted) break;
                }
            } finally {
                interimBusyRef.current = false;
            }
        }, INTERIM_DEBOUNCE_MS);
    }, []);

    // ---- speech source callbacks -------------------------------------------

    const handleInterim = useCallback((text: string) => {
        if (!listeningRef.current) return;
        if (pausedRef.current) { if (text.trim()) utteranceOpenWhilePausedRef.current = true; return; }
        if (skipUntilFinalRef.current) {
            // The recognizer dropped the candidate's utterance without finalizing it.
            if (!text.trim()) { skipUntilFinalRef.current = false; segmenterRef.current.reset(); }
            return;
        }
        addSegments(segmenterRef.current.pushInterim(text, Date.now()));
        refreshInterim();
    }, [addSegments, refreshInterim]);

    const handleFinal = useCallback((text: string) => {
        if (!listeningRef.current) return;
        if (pausedRef.current) {
            // Whatever was open is closed now; the next utterance starts clean.
            utteranceOpenWhilePausedRef.current = false;
            segmenterRef.current.reset();
            return;
        }
        if (skipUntilFinalRef.current) { skipUntilFinalRef.current = false; segmenterRef.current.reset(); return; }
        addSegments(segmenterRef.current.pushFinal(text, Date.now()));
        refreshInterim();
    }, [addSegments, refreshInterim]);

    // ---- public controls ---------------------------------------------------

    const start = useCallback(() => {
        segmenterRef.current.reset();
        listeningRef.current = true;
        pausedRef.current = false;
        skipUntilFinalRef.current = false;
        utteranceOpenWhilePausedRef.current = false;
        debugLogger.startSession();
        setState(prev => ({
            ...prev,
            isListening: true,
            isPaused: false,
            interim: '', interimDraft: '',
            llmStatus: isLLMAvailable() ? 'ok' : 'offline', llmError: '',
            startedAt: prev.startedAt || Date.now(),
        }));
        if (tickTimerRef.current) clearInterval(tickTimerRef.current);
        let lastTick = Date.now();
        tickTimerRef.current = setInterval(() => {
            const now = Date.now();
            const late = now - lastTick > TICK_MS * 4;
            lastTick = now;
            // The main thread was stalled (heavy render, on-device model): recognizer
            // events are still queued behind us, so "no new words" proves nothing yet.
            if (late) return;
            if (!listeningRef.current || pausedRef.current) return;
            const out = segmenterRef.current.tick(now);
            if (out.length) { addSegments(out); refreshInterim(); }
        }, TICK_MS);
    }, [addSegments, refreshInterim]);

    const stop = useCallback(() => {
        if (tickTimerRef.current) { clearInterval(tickTimerRef.current); tickTimerRef.current = null; }
        if (interimTimerRef.current) { clearTimeout(interimTimerRef.current); interimTimerRef.current = null; }
        // The unfinished phrase still gets translated (running translations/answers finish too).
        if (listeningRef.current && !pausedRef.current) addSegments(segmenterRef.current.flush());
        segmenterRef.current.reset();
        listeningRef.current = false;
        pausedRef.current = false;
        debugLogger.stopSession();
        setState(prev => ({ ...prev, isListening: false, isPaused: false, interim: '', interimDraft: '' }));
    }, [addSegments]);

    /** Candidate starts/stops speaking: while paused, recognized speech is ignored. */
    const setPaused = useCallback((paused: boolean) => {
        if (!listeningRef.current || pausedRef.current === paused) return;
        if (paused) {
            // The interviewer's last words must not be lost. The utterance stays
            // open in the segmenter so its later final cannot repeat them.
            addSegments(segmenterRef.current.flushPending());
            utteranceOpenWhilePausedRef.current = false;
        } else {
            // Speech recognized during the pause belongs to the candidate: drop it
            // until the recognizer closes that utterance.
            skipUntilFinalRef.current = utteranceOpenWhilePausedRef.current;
        }
        pausedRef.current = paused;
        setState(prev => ({ ...prev, isPaused: paused, interim: '', interimDraft: '' }));
    }, [addSegments]);

    /** Manual trigger: answer what the interviewer said last (when auto-detection missed it). */
    const answerLast = useCallback(() => {
        const answered = qaRef.current.length ? qaRef.current[qaRef.current.length - 1].timestamp : 0;
        let recent = segmentsRef.current.filter(s => s.timestamp > answered).slice(-3);
        if (recent.length === 0) recent = segmentsRef.current.slice(-2);
        if (recent.length === 0) return;
        void startAnswer(
            recent.map(s => s.source).join(' '),
            recent.map(s => s.translation || s.draft).filter(Boolean).join(' '),
            true,
        );
    }, [startAnswer]);

    const reset = useCallback(() => {
        abortRef.current.abort();
        abortRef.current = new AbortController();
        queueRef.current = [];
        soloRef.current.clear();
        segmentsRef.current = [];
        qaRef.current = [];
        segmenterRef.current.reset();
        setState(prev => ({
            ...INITIAL,
            isListening: prev.isListening,
            isPaused: prev.isPaused,
            llmStatus: isLLMAvailable() ? 'ok' : 'offline',
            startedAt: prev.isListening ? Date.now() : 0,
        }));
    }, []);

    /** After a new sign-in: translate what was left as draft-only meanwhile. */
    const retryDrafts = useCallback(() => {
        if (!isLLMAvailable()) return;
        setLLM('ok');
        const pending = segmentsRef.current.filter(s => s.status === 'draft-only').slice(-6);
        if (pending.length === 0) return;
        for (const s of pending) { patchSegment(s.id, { status: 'draft' }); soloRef.current.add(s.id); }
        queueRef.current.push(...pending.map(s => s.id));
        void pumpTranslations();
    }, [patchSegment, pumpTranslations, setLLM]);

    useEffect(() => {
        // A fresh controller per mount: React StrictMode mounts twice in dev, and
        // an aborted controller left over from the first unmount would silently
        // cancel every LLM call of the real session.
        abortRef.current = new AbortController();
        return () => {
            if (tickTimerRef.current) clearInterval(tickTimerRef.current);
            if (interimTimerRef.current) clearTimeout(interimTimerRef.current);
            abortRef.current.abort();
        };
    }, []);

    return { state, start, stop, reset, setPaused, answerLast, retryDrafts, handleInterim, handleFinal };
}
