/**
 * CLOUD LLM (Claude via the Cloudflare Worker proxy)
 *
 * The browser never holds LLM credentials: every call goes to the Worker with
 * the app session token. Everything here streams — the live translation and
 * the answers are rendered token by token.
 *
 * Prompt texts and parsers live in ./prompts.ts (pure, testable).
 */

import type { ViewMode } from '../types';
import { apiClient } from './apiClient';
import {
    AnswerRequest, AnswerSettings, CandidateDocs, ParsedAnswer, ParsedTranslation, TranslationRequest,
    buildAnswerSystem, buildAnswerUser, buildBriefingSystem, buildBriefingUser,
    buildTranslationSystem, buildTranslationUser, parseAnswer, parseBriefing, parseTranslation,
} from './prompts';

type Effort = 'low' | 'medium' | 'high';

const API_BASE = import.meta.env.VITE_API_URL || 'https://ghost.vitalii.no';
// Main model: answers and the briefing (quality first).
const MODEL_MAIN = import.meta.env.VITE_CLAUDE_MODEL || 'claude-opus-5';
// Live translation. Chosen by a side-by-side test on Norwegian interview speech
// (tests/prompt-check.ts, 2026-11-23): Sonnet 5.5 was the only one of
// Haiku 4.5 / Haiku 5.5 / Sonnet 5.5 without grammatical-person mistakes,
// calques or meta commentary, at the same speed as the Haiku models.
const MODEL_TRANSLATE = import.meta.env.VITE_CLAUDE_MODEL_FAST || 'claude-sonnet-5-5';
// Known to work on the Worker's subscription token; used if the preferred
// translation model is rejected.
const MODEL_TRANSLATE_FALLBACK = 'claude-haiku-4-5';
let translationModel = MODEL_TRANSLATE;

export class LLMError extends Error {
    constructor(public status: number, message: string) {
        super(message);
        this.name = 'LLMError';
    }
    /** Session expired / not signed in: the user must sign in again. */
    get isAuth(): boolean { return this.status === 401; }
}

/** True when cloud LLM calls can be made right now (signed in, token alive). */
export const isLLMAvailable = (): boolean => !!apiClient.getIdToken();

interface StreamOptions {
    model: string;
    system: string;
    prompt: string;
    maxOutputTokens: number;
    effort?: Effort;
    /** false = no extended thinking (first token as early as possible). */
    thinking?: boolean;
    cacheSystem?: boolean;
    signal?: AbortSignal;
    /** Abort when nothing arrives for this long (also bounds the wait for the first token). */
    idleTimeoutMs: number;
}

/**
 * Stream text deltas from the Worker (`data: {"text": "..."}` SSE lines).
 * Throws LLMError on HTTP/stream errors and AbortError when aborted — callers
 * must not treat a failed call as an empty answer.
 */
async function* streamText(opts: StreamOptions): AsyncGenerator<string> {
    const token = apiClient.getIdToken();
    if (!token) throw new LLMError(401, 'Not signed in');

    // A stalled connection must not freeze the pipeline: one hung stream would
    // block every later segment. Abort on idle; the caller decides about a retry.
    const controller = new AbortController();
    let timedOut = false;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const armIdle = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => { timedOut = true; controller.abort(); }, opts.idleTimeoutMs);
    };
    const onOuterAbort = () => controller.abort();
    if (opts.signal?.aborted) controller.abort();
    opts.signal?.addEventListener('abort', onOuterAbort);
    armIdle();

    try {
        yield* readStream(opts, token, controller.signal, armIdle);
    } catch (e) {
        if (timedOut) throw new LLMError(504, 'LLM timeout');
        throw e;
    } finally {
        clearTimeout(idleTimer);
        opts.signal?.removeEventListener('abort', onOuterAbort);
    }
}

async function* readStream(opts: StreamOptions, token: string, signal: AbortSignal, onActivity: () => void): AsyncGenerator<string> {
    const response = await fetch(`${API_BASE}/api/ai/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
            model: opts.model,
            prompt: opts.prompt,
            systemInstruction: opts.system,
            cacheSystem: opts.cacheSystem || undefined,
            config: { maxOutputTokens: opts.maxOutputTokens, effort: opts.effort, thinking: opts.thinking },
        }),
        signal,
    });
    onActivity();

    if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({})) as { error?: string; details?: string };
        throw new LLMError(response.status, body.details || body.error || `HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        onActivity();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6).trim();
            if (!payload || payload === '[DONE]') continue;
            let parsed: { text?: string; error?: string };
            try { parsed = JSON.parse(payload); } catch { continue; }
            if (parsed.error) throw new LLMError(502, parsed.error);
            if (parsed.text) yield parsed.text;
        }
    }
}

// ---------------------------------------------------------------------------
// 1. Live translation of one segment
// ---------------------------------------------------------------------------

export async function translateSegment(
    req: TranslationRequest,
    onUpdate: (partial: ParsedTranslation) => void,
    signal?: AbortSignal,
): Promise<ParsedTranslation> {
    // A sentence of translation plus, at most, one question line. The floor
    // leaves room in case an older Worker still runs the model with thinking.
    const maxOutputTokens = Math.min(1200, 400 + req.fragment.split(/\s+/).length * 10);
    const run = async (model: string): Promise<string> => {
        let text = '';
        for await (const delta of streamText({
            model,
            system: buildTranslationSystem(req),
            prompt: buildTranslationUser(req),
            maxOutputTokens,
            effort: 'low',
            thinking: false,
            signal,
            idleTimeoutMs: 8_000,
        })) {
            text += delta;
            onUpdate(parseTranslation(text, false));
        }
        return text;
    };

    let raw: string;
    try {
        raw = await run(translationModel);
    } catch (e) {
        // The preferred model is not served for this account/token: switch to the
        // known-good one for the rest of the session instead of failing every segment.
        const rejected = e instanceof LLMError && [400, 403, 404].includes(e.status);
        if (!rejected || translationModel === MODEL_TRANSLATE_FALLBACK) throw e;
        console.warn(`[LLM] ${translationModel} rejected (${e.status}: ${e.message}); falling back to ${MODEL_TRANSLATE_FALLBACK}`);
        translationModel = MODEL_TRANSLATE_FALLBACK;
        raw = await run(translationModel);
    }
    const final = parseTranslation(raw, true);
    if (!final.translation) throw new LLMError(502, 'Empty translation');
    return final;
}

// ---------------------------------------------------------------------------
// 2. Grounded answer to an interviewer question
// ---------------------------------------------------------------------------

export interface AnswerInput extends Omit<AnswerRequest, 'mode'> {
    mode: ViewMode;
    docs: CandidateDocs;
    settings: AnswerSettings;
}

export async function generateAnswer(
    input: AnswerInput,
    onUpdate: (partial: ParsedAnswer) => void,
    signal?: AbortSignal,
): Promise<ParsedAnswer> {
    let raw = '';
    let lastEmit = 0;
    for await (const delta of streamText({
        model: MODEL_MAIN,
        // Identical for every question of the session -> prompt cache hit.
        system: buildAnswerSystem(input.docs, input.settings),
        cacheSystem: true,
        prompt: buildAnswerUser(input),
        // Headroom on purpose: the main model's adaptive thinking is billed
        // against the same limit, and a truncated answer is worse than none.
        maxOutputTokens: input.mode === 'FULL' ? 2400 : 1800,
        effort: 'low',
        signal,
        // The main model may think before its first token.
        idleTimeoutMs: 30_000,
    })) {
        raw += delta;
        const now = performance.now();
        if (now - lastEmit > 80) {   // batch UI updates
            lastEmit = now;
            onUpdate(parseAnswer(raw));
        }
    }
    const final = parseAnswer(raw);
    if (!final.answer) throw new LLMError(502, 'Empty answer');
    onUpdate(final);
    return final;
}

// ---------------------------------------------------------------------------
// 3. Pre-interview briefing
// ---------------------------------------------------------------------------

export async function generateBriefing(
    docs: CandidateDocs,
    sourceLang: string,
    nativeLang: string,
    onUpdate: (partialText: string) => void,
    signal?: AbortSignal,
): Promise<{ text: string; keyterms: string[] }> {
    let raw = '';
    for await (const delta of streamText({
        model: MODEL_MAIN,
        system: buildBriefingSystem(sourceLang, nativeLang),
        prompt: buildBriefingUser(docs),
        maxOutputTokens: 6000,
        // No latency pressure here: this runs once, before the interview.
        effort: 'high',
        signal,
        idleTimeoutMs: 120_000,
    })) {
        raw += delta;
        onUpdate(parseBriefing(raw).text);
    }
    const result = parseBriefing(raw);
    if (result.text.length < 200) throw new LLMError(502, 'Briefing came back empty');
    return result;
}
