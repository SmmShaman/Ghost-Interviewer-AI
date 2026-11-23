import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { QAItem, Segment, ViewMode } from '../types';
import type { LiveState } from '../hooks/useLiveSession';

/**
 * LIVE VIEW — one screen for all three modes.
 *   SIMPLE: translation feed.
 *   FOCUS:  feed + suggested answers.
 *   FULL:   feed + answers with strategy and analysis.
 */

interface LiveViewProps {
    mode: ViewMode;
    state: LiveState;
    uiLang: 'en' | 'uk';
    draftMethod: 'chrome' | 'nmt' | 'opus' | 'none';
    onAnswerLast: () => void;
    /** Rendered inside the "LLM off / session expired" banner (sign-in button). */
    signInSlot?: React.ReactNode;
}

const TEXT = {
    uk: {
        listening: 'Слухаю…',
        pressStart: 'Натисніть мікрофон, щоб почати',
        paused: 'Пауза: ви говорите — мовлення не обробляється',
        draft: 'чернетка',
        answers: 'Відповіді',
        answerLast: 'Відповісти на останню репліку',
        answerLastHint: 'Enter',
        noQuestions: 'Коли інтерв’юер поставить питання, тут з’явиться підказка відповіді.',
        question: 'Питання',
        strategy: 'На що спертися',
        answer: 'Відповідь',
        analysis: 'Що насправді питають',
        generating: 'готую відповідь…',
        failed: 'Не вдалося отримати відповідь',
        aborted: 'перервано',
        manual: 'вручну',
        llmOffline: 'LLM вимкнено: увійдіть через Google. Показую лише машинну чернетку.',
        llmAuth: 'Сесія Google закінчилась — увійдіть знову. Показую лише машинну чернетку.',
        llmError: 'Помилка LLM',
        segments: 'фраз',
        latency: 'до перекладу',
        draftEngine: 'чернетка',
        none: 'немає',
    },
    en: {
        listening: 'Listening…',
        pressStart: 'Press the microphone to start',
        paused: 'Paused: you are speaking — speech is not processed',
        draft: 'draft',
        answers: 'Answers',
        answerLast: 'Answer the last remark',
        answerLastHint: 'Enter',
        noQuestions: 'When the interviewer asks a question, a suggested answer appears here.',
        question: 'Question',
        strategy: 'What to lean on',
        answer: 'Answer',
        analysis: 'What they are really asking',
        generating: 'preparing the answer…',
        failed: 'Could not get an answer',
        aborted: 'interrupted',
        manual: 'manual',
        llmOffline: 'LLM is off: sign in with Google. Showing the machine draft only.',
        llmAuth: 'Google session expired — sign in again. Showing the machine draft only.',
        llmError: 'LLM error',
        segments: 'phrases',
        latency: 'to translation',
        draftEngine: 'draft',
        none: 'none',
    },
};

/** Keep a scroll container pinned to the bottom unless the user scrolled up. */
function useStickToBottom(dep: unknown) {
    // Element kept in state (callback ref): the container can mount later, e.g.
    // the answers column when switching SIMPLE -> FOCUS mid-session.
    const [el, setEl] = useState<HTMLDivElement | null>(null);
    const pinnedRef = useRef(true);
    useEffect(() => {
        if (!el) return;
        pinnedRef.current = true;
        const onScroll = () => { pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; };
        el.addEventListener('scroll', onScroll, { passive: true });
        return () => el.removeEventListener('scroll', onScroll);
    }, [el]);
    useEffect(() => {
        if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
    }, [dep, el]);
    return setEl;
}

const SegmentRow: React.FC<{ seg: Segment; draftLabel: string }> = React.memo(({ seg, draftLabel }) => {
    const hasLLM = !!seg.translation;
    const text = seg.translation || seg.draft;
    return (
        <div className="py-2 border-b border-gray-800/40 last:border-b-0">
            <p className={`text-lg md:text-xl leading-snug ${hasLLM ? 'text-gray-100' : 'text-gray-400 italic'}`}>
                {text || <span className="text-gray-600">…</span>}
                {seg.status === 'translating' && <span className="text-emerald-400 animate-pulse ml-0.5">▍</span>}
                {seg.status === 'draft-only' && text && (
                    <span className="ml-2 align-middle text-[9px] not-italic uppercase tracking-wider text-amber-500/80 border border-amber-500/30 rounded px-1 py-px">{draftLabel}</span>
                )}
            </p>
            <p className="mt-0.5 text-xs text-gray-500 font-mono leading-snug">{seg.source}</p>
        </div>
    );
});

const QACard: React.FC<{ item: QAItem; mode: ViewMode; t: typeof TEXT.uk }> = React.memo(({ item, mode, t }) => {
    const generating = item.status === 'generating';
    return (
        <div className="rounded-xl border border-emerald-500/20 bg-gray-900/70 p-3 space-y-2">
            <div>
                <div className="flex items-center gap-2 text-[9px] uppercase tracking-wider font-bold text-red-400/80">
                    <span>{t.question}</span>
                    {item.manual && <span className="text-gray-500 normal-case tracking-normal">· {t.manual}</span>}
                </div>
                {item.questionTranslation && <p className="text-sm text-gray-200 leading-snug">{item.questionTranslation}</p>}
                <p className="text-xs text-gray-500 font-mono leading-snug">{item.question}</p>
            </div>

            {mode === 'FULL' && item.strategy && (
                <div>
                    <div className="text-[9px] uppercase tracking-wider font-bold text-purple-400/80">{t.strategy}</div>
                    <p className="text-sm text-purple-100 leading-snug whitespace-pre-line">{item.strategy}</p>
                </div>
            )}

            <div>
                <div className="text-[9px] uppercase tracking-wider font-bold text-emerald-400/80">{t.answer}</div>
                {item.answer ? (
                    <p className="text-lg text-emerald-100 leading-snug font-medium">
                        {item.answer}
                        {generating && <span className="text-emerald-400 animate-pulse ml-0.5">▍</span>}
                    </p>
                ) : (
                    <p className="text-sm text-gray-500 italic">
                        {generating ? t.generating : item.status === 'aborted' ? t.aborted : t.failed}
                    </p>
                )}
                {item.answerTranslation && <p className="mt-1 text-sm text-gray-400 leading-snug">{item.answerTranslation}</p>}
                {item.status === 'error' && item.answer && <p className="text-xs text-red-400">{t.failed}</p>}
            </div>

            {mode === 'FULL' && item.analysis && (
                <div>
                    <div className="text-[9px] uppercase tracking-wider font-bold text-blue-400/80">{t.analysis}</div>
                    <p className="text-sm text-blue-100/90 leading-snug">{item.analysis}</p>
                </div>
            )}
        </div>
    );
});

const LiveView: React.FC<LiveViewProps> = ({ mode, state, uiLang, draftMethod, onAnswerLast, signInSlot }) => {
    const t = TEXT[uiLang];
    const { segments, interim, interimDraft, qa, isListening, isPaused, llmStatus, llmError } = state;
    const showAnswers = mode !== 'SIMPLE';

    const lastSeg = segments[segments.length - 1];
    const feedRef = useStickToBottom(`${segments.length}|${lastSeg?.translation.length}|${lastSeg?.draft.length}|${interim}|${interimDraft}`);
    const lastQA = qa[qa.length - 1];
    const qaRef = useStickToBottom(`${qa.length}|${lastQA?.answer.length}|${lastQA?.answerTranslation.length}|${lastQA?.analysis.length}`);

    const avgLatency = useMemo(() => {
        const values = segments.map(s => s.latencyMs).filter((v): v is number => typeof v === 'number');
        if (values.length === 0) return null;
        const recent = values.slice(-10);
        return Math.round(recent.reduce((a, b) => a + b, 0) / recent.length / 100) / 10;
    }, [segments]);

    const llmBanner = llmStatus === 'offline' ? t.llmOffline
        : llmStatus === 'auth' ? t.llmAuth
        : llmStatus === 'error' ? `${t.llmError}: ${llmError}`
        : '';

    return (
        <div className="w-full h-full flex flex-col min-h-0">
            {llmBanner && (
                <div className={`shrink-0 mb-2 px-3 py-1.5 rounded-lg border text-xs flex items-center justify-between gap-3 ${llmStatus === 'error' ? 'border-red-500/40 bg-red-500/10 text-red-300' : 'border-amber-500/40 bg-amber-500/10 text-amber-200'}`}>
                    <span>{llmBanner}</span>
                    {llmStatus !== 'error' && signInSlot}
                </div>
            )}
            {isPaused && (
                <div className="shrink-0 mb-2 px-3 py-1.5 rounded-lg border border-blue-500/40 bg-blue-500/10 text-blue-200 text-xs font-bold">
                    {t.paused}
                </div>
            )}

            <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-2">
                {/* TRANSLATION FEED */}
                <div className={`min-h-0 rounded-2xl bg-gray-900/50 border border-gray-800/40 overflow-hidden flex flex-col ${showAnswers ? 'flex-1 lg:flex-[11]' : 'flex-1'}`}>
                    <div ref={feedRef} className="flex-1 overflow-y-auto px-4 py-3">
                        {segments.length === 0 && !interim ? (
                            <div className="h-full flex items-center justify-center">
                                <p className="text-gray-600 text-sm italic">{isListening ? t.listening : t.pressStart}</p>
                            </div>
                        ) : (
                            <>
                                {segments.map(seg => <SegmentRow key={seg.id} seg={seg} draftLabel={t.draft} />)}
                                {interim && (
                                    <div className="py-2">
                                        {interimDraft && <p className="text-lg md:text-xl leading-snug text-gray-500 italic">{interimDraft}</p>}
                                        <p className="mt-0.5 text-xs text-gray-600 font-mono leading-snug">
                                            {interim}<span className="text-emerald-400 animate-pulse ml-1">▊</span>
                                        </p>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>

                {/* ANSWERS */}
                {showAnswers && (
                    <div className="min-h-0 flex-1 lg:flex-[9] rounded-2xl bg-gray-950/70 border border-gray-800/40 overflow-hidden flex flex-col">
                        <div className="shrink-0 px-3 py-2 border-b border-gray-800/40 flex items-center justify-between gap-2">
                            <span className="text-[10px] uppercase tracking-wider font-bold text-emerald-400/70">{t.answers}</span>
                            <button
                                onClick={onAnswerLast}
                                disabled={segments.length === 0 || llmStatus === 'offline' || llmStatus === 'auth'}
                                className="px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-600/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                                ⚡ {t.answerLast} <span className="ml-1 text-[9px] text-emerald-400/60 font-mono">{t.answerLastHint}</span>
                            </button>
                        </div>
                        <div ref={qaRef} className="flex-1 overflow-y-auto p-3 space-y-3">
                            {qa.length === 0 ? (
                                <div className="h-full flex items-center justify-center px-6">
                                    <p className="text-gray-600 text-sm italic text-center">{t.noQuestions}</p>
                                </div>
                            ) : qa.map(item => <QACard key={item.id} item={item} mode={mode} t={t} />)}
                        </div>
                    </div>
                )}
            </div>

            {/* STATUS BAR */}
            <div className="shrink-0 mt-2 px-3 py-1.5 bg-gray-900/50 rounded-xl border border-gray-800/50 flex items-center justify-between text-[11px] text-gray-500 font-mono">
                <div className="flex items-center gap-3">
                    <span>{segments.length} {t.segments}</span>
                    {avgLatency !== null && <span className={avgLatency <= 2 ? 'text-emerald-400/80' : avgLatency <= 4 ? 'text-amber-400/80' : 'text-red-400/80'}>~{avgLatency}s {t.latency}</span>}
                </div>
                <div className="flex items-center gap-3">
                    <span>{t.draftEngine}: {draftMethod === 'none' ? t.none : draftMethod}</span>
                    <span className={llmStatus === 'ok' ? 'text-emerald-400/80' : 'text-amber-400/80'}>LLM {llmStatus}</span>
                    {isListening && (
                        <span className="text-red-400 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />REC
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
};

export default LiveView;
