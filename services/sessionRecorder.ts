/**
 * SESSION RECORDER: a test log of every listening session, kept on the device.
 *
 * Records what the recognizer heard (each changing interim hypothesis and every
 * final), how the phrases were cut, when the machine draft and the LLM
 * translation arrived (and with which engine/model), detected questions and
 * answers, and recognizer restarts/errors.
 *
 * Every event is uploaded to the Worker (`POST /api/logs`, D1) every few
 * seconds while signed in, and the full readable text when the session stops.
 * Uploads are idempotent (events carry a sequence number), and whatever could
 * not be sent yet (offline, signed out, app killed) stays in localStorage and
 * is sent on the next opportunity, also after a restart of the app.
 *
 * It only observes: App feeds it speech events and LiveState snapshots.
 */

import type { LiveState } from '../hooks/useLiveSession';
import { apiClient } from './apiClient';

const API_BASE = import.meta.env.VITE_API_URL || 'https://ghost.vitalii.no';
const UPLOAD_INTERVAL_MS = 3000;
const UPLOAD_BATCH = 400;

const STORAGE_KEY = 'ghost_test_logs_v1';
const MAX_SESSIONS = 6;
const MAX_EVENTS = 20000;
const SAVE_DEBOUNCE_MS = 1500;

type Base = { t: number; seq?: number };

export type RecEvent =
    | Base & { k: 'interim'; text: string }
    | Base & { k: 'final'; text: string }
    | Base & { k: 'debug'; text: string }
    | Base & { k: 'pause'; on: boolean }
    | Base & { k: 'segment'; id: number; text: string; boundary: string }
    | Base & { k: 'draft'; id: number; text: string; engine: string; afterMs: number }
    | Base & { k: 'translation'; id: number; text: string; status: string; model: string; firstTokenMs?: number; totalMs: number }
    | Base & { k: 'question'; id: number; question: string; native: string; manual: boolean }
    | Base & { k: 'answer'; id: number; status: string; answer: string; native: string; strategy: string; analysis: string; totalMs: number };

export interface RecordedSession {
    id: string;
    startedAt: number;
    endedAt: number | null;
    meta: Record<string, string>;
    events: RecEvent[];
    /** Next sequence number to assign. */
    nextSeq?: number;
    /** Events with seq below this are on the server. */
    uploadedSeq?: number;
    /** The final readable text is on the server. */
    textUploaded?: boolean;
}

class SessionRecorder {
    private current: RecordedSession | null = null;
    private lastInterim = '';
    private seenSegments = new Map<number, { draft: boolean; done: boolean }>();
    private seenQA = new Map<number, boolean>();
    private wasPaused = false;
    private saveTimer: ReturnType<typeof setTimeout> | null = null;
    private uploading = false;
    /** After a failed upload: no new attempt before this time (offline, old Worker without /api/logs). */
    private retryAt = 0;

    constructor() {
        if (typeof window !== 'undefined') {
            // Phones kill background pages without warning: save and upload whenever the app is hidden.
            const flush = () => { this.saveNow(); void this.upload(); };
            window.addEventListener('pagehide', flush);
            document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
            window.addEventListener('online', () => { this.retryAt = 0; void this.upload(); });
            // Also sends what an earlier run of the app could not.
            setInterval(() => void this.upload(), UPLOAD_INTERVAL_MS);
        }
    }

    start(meta: Record<string, string>, state: LiveState): void {
        if (this.current) this.stop();
        const now = Date.now();
        this.current = { id: String(now), startedAt: now, endedAt: null, meta, events: [], nextSeq: 0, uploadedSeq: 0 };
        this.lastInterim = '';
        this.wasPaused = state.isPaused;
        // Segments and answers already on screen (session resumed) are not re-logged.
        this.seenSegments = new Map(state.segments.map(s => [s.id, { draft: true, done: true }]));
        this.seenQA = new Map(state.qa.map(q => [q.id, true]));
        this.scheduleSave();
    }

    stop(): void {
        if (!this.current) return;
        this.current.endedAt = Date.now();
        this.saveNow();
        this.current = null;
        void this.upload();
    }

    get isRecording(): boolean { return !!this.current; }

    interim(text: string): void {
        if (!this.current || text === this.lastInterim) return;
        this.lastInterim = text;
        if (text) this.push({ t: 0, k: 'interim', text });
    }

    final(text: string): void {
        if (!this.current) return;
        this.lastInterim = '';
        this.push({ t: 0, k: 'final', text });
    }

    debug(text: string): void {
        if (this.current) this.push({ t: 0, k: 'debug', text });
    }

    /** Diff a LiveState snapshot against what was already logged. */
    observe(state: LiveState, draftEngine: string, model: string): void {
        if (!this.current) return;
        const now = Date.now();
        if (state.isPaused !== this.wasPaused) {
            this.wasPaused = state.isPaused;
            this.push({ t: 0, k: 'pause', on: state.isPaused });
        }
        for (const s of state.segments) {
            let seen = this.seenSegments.get(s.id);
            if (!seen) {
                seen = { draft: false, done: false };
                this.seenSegments.set(s.id, seen);
                this.push({ t: 0, k: 'segment', id: s.id, text: s.source, boundary: s.boundary });
            }
            if (!seen.draft && s.draft) {
                seen.draft = true;
                this.push({ t: 0, k: 'draft', id: s.id, text: s.draft, engine: draftEngine, afterMs: now - s.timestamp });
            }
            if (!seen.done && (s.status === 'done' || s.status === 'draft-only')) {
                seen.done = true;
                this.push({ t: 0, k: 'translation', id: s.id, text: s.translation, status: s.status, model, firstTokenMs: s.latencyMs, totalMs: now - s.timestamp });
            }
        }
        for (const q of state.qa) {
            const done = this.seenQA.get(q.id);
            if (done === undefined) {
                this.seenQA.set(q.id, false);
                this.push({ t: 0, k: 'question', id: q.id, question: q.question, native: q.questionTranslation, manual: q.manual });
            }
            if (!this.seenQA.get(q.id) && q.status !== 'generating') {
                this.seenQA.set(q.id, true);
                this.push({ t: 0, k: 'answer', id: q.id, status: q.status, answer: q.answer, native: q.answerTranslation, strategy: q.strategy, analysis: q.analysis, totalMs: now - q.timestamp });
            }
        }
    }

    private push(e: RecEvent): void {
        const cur = this.current!;
        if (cur.events.length >= MAX_EVENTS) {
            // Interim hypotheses are the bulk; drop the oldest of them first.
            const i = cur.events.findIndex(x => x.k === 'interim');
            cur.events.splice(i >= 0 ? i : 0, 1);
        }
        const seq = cur.nextSeq ?? cur.events.length;
        cur.nextSeq = seq + 1;
        cur.events.push({ ...e, t: Date.now() - cur.startedAt, seq } as RecEvent);
        this.scheduleSave();
    }

    // ---- storage ---------------------------------------------------------

    private scheduleSave(): void {
        if (this.saveTimer) return;
        this.saveTimer = setTimeout(() => { this.saveTimer = null; this.saveNow(); }, SAVE_DEBOUNCE_MS);
    }

    private saveNow(): void {
        if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
        if (!this.current) return;
        const all = this.list().filter(s => s.id !== this.current!.id);
        all.unshift(this.current);
        let keep = all.slice(0, MAX_SESSIONS);
        // Storage full: drop the oldest sessions until it fits.
        while (keep.length) {
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(keep)); return; }
            catch { keep = keep.slice(0, -1); }
        }
    }

    /**
     * Send unsent events (and, for finished sessions, the readable text) to the
     * server. Runs on a timer; a failure simply leaves them for the next run.
     */
    async upload(): Promise<void> {
        if (this.uploading || Date.now() < this.retryAt) return;
        const token = apiClient.getIdToken();
        if (!token) return;
        this.uploading = true;
        try {
            this.saveNow();
            for (const s of this.list()) {
                for (let guard = 0; guard < 20; guard++) {
                    const from = s.uploadedSeq ?? 0;
                    const pending = s.events.filter(e => (e.seq ?? -1) >= from).slice(0, UPLOAD_BATCH);
                    // The text goes with the batch that carries the last remaining events.
                    const sendText = !!s.endedAt && !s.textUploaded && pending.length < UPLOAD_BATCH;
                    if (!pending.length && !sendText) break;
                    const body = JSON.stringify({
                        session: { id: s.id, startedAt: s.startedAt, endedAt: s.endedAt, meta: s.meta },
                        events: pending,
                        fullText: sendText ? sessionToText(s) : undefined,
                    });
                    const res = await fetch(`${API_BASE}/api/logs`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                        body,
                        // keepalive survives the page being closed, but browsers cap it at 64 KB.
                        keepalive: body.length < 60_000,
                    });
                    if (!res.ok) {
                        // Kept locally; 404/503 = the Worker has no logs storage yet, so wait longer.
                        this.retryAt = Date.now() + (res.status === 404 || res.status === 503 ? 60_000 : 10_000);
                        return;
                    }
                    const uploadedSeq = pending.length ? (pending[pending.length - 1].seq ?? from) + 1 : from;
                    this.markUploaded(s.id, uploadedSeq, sendText);
                    s.uploadedSeq = uploadedSeq;
                    if (sendText) s.textUploaded = true;
                }
            }
        } catch { this.retryAt = Date.now() + 10_000; /* offline: retried later */ }
        finally { this.uploading = false; }
    }

    private markUploaded(id: string, uploadedSeq: number, textUploaded: boolean): void {
        if (this.current?.id === id) {
            this.current.uploadedSeq = Math.max(this.current.uploadedSeq ?? 0, uploadedSeq);
            if (textUploaded) this.current.textUploaded = true;
            this.scheduleSave();
            return;
        }
        const all = this.list();
        const s = all.find(x => x.id === id);
        if (!s) return;
        s.uploadedSeq = Math.max(s.uploadedSeq ?? 0, uploadedSeq);
        if (textUploaded) s.textUploaded = true;
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(all)); } catch { /* full: kept as is */ }
    }

    /** How many events of all stored sessions are not on the server yet. */
    pendingCount(): number {
        return this.list().reduce((n, s) => n + s.events.filter(e => (e.seq ?? -1) >= (s.uploadedSeq ?? 0)).length, 0);
    }

    list(): RecordedSession[] {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch { return []; }
    }

    clearAll(): void {
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
}

export const sessionRecorder = new SessionRecorder();

// ---- export as readable text ----------------------------------------------

const sec = (ms: number | undefined) => (ms === undefined ? '—' : `${(ms / 1000).toFixed(1)} с`);
const stamp = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${String(Math.floor((ms % 1000) / 100))}`;
};

export function sessionFileName(s: RecordedSession): string {
    const d = new Date(s.startedAt);
    const p = (n: number) => String(n).padStart(2, '0');
    return `ghost-log-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}.txt`;
}

export function sessionToText(s: RecordedSession): string {
    const out: string[] = [];
    const dur = (s.endedAt ?? (s.events.at(-1)?.t ?? 0) + s.startedAt) - s.startedAt;
    out.push(`GHOST INTERVIEWER — ЛОГ ТЕСТУ`);
    out.push(`Початок: ${new Date(s.startedAt).toLocaleString()}   Тривалість: ${sec(dur)}${s.endedAt ? '' : ' (сесію не зупинено кнопкою)'}`);
    for (const [k, v] of Object.entries(s.meta)) out.push(`${k}: ${v}`);

    // 1. Per phrase: what was recognized -> draft -> LLM translation.
    const segs = new Map<number, { seg?: Extract<RecEvent, { k: 'segment' }>; draft?: Extract<RecEvent, { k: 'draft' }>; tr?: Extract<RecEvent, { k: 'translation' }> }>();
    for (const e of s.events) {
        if (e.k === 'segment') segs.set(e.id, { ...segs.get(e.id), seg: e });
        if (e.k === 'draft') segs.set(e.id, { ...segs.get(e.id), draft: e });
        if (e.k === 'translation') segs.set(e.id, { ...segs.get(e.id), tr: e });
    }
    const trs = [...segs.values()].map(v => v.tr?.firstTokenMs).filter((x): x is number => typeof x === 'number');
    out.push('');
    out.push(`=== ФРАЗИ: розпізнано → чернетка → переклад LLM (${segs.size} фраз${trs.length ? `, середній час до першого токена ${sec(trs.reduce((a, b) => a + b, 0) / trs.length)}` : ''}) ===`);
    let n = 0;
    for (const [id, v] of segs) {
        n++;
        out.push('');
        out.push(`#${n} [${v.seg ? stamp(v.seg.t) : '?'}] межа: ${v.seg?.boundary ?? '?'} (id ${id})`);
        out.push(`  РОЗПІЗНАНО: ${v.seg?.text ?? ''}`);
        out.push(v.draft ? `  ЧЕРНЕТКА (${v.draft.engine}, +${sec(v.draft.afterMs)}): ${v.draft.text}` : `  ЧЕРНЕТКА: —`);
        if (v.tr) {
            out.push(v.tr.status === 'draft-only'
                ? `  LLM: не отримано (лишилась чернетка), +${sec(v.tr.totalMs)}`
                : `  LLM (${v.tr.model}, перший токен +${sec(v.tr.firstTokenMs)}, повністю +${sec(v.tr.totalMs)}): ${v.tr.text}`);
        } else {
            out.push(`  LLM: — (не завершено)`);
        }
    }

    // 2. Questions and answers.
    const qa = s.events.filter(e => e.k === 'question' || e.k === 'answer');
    if (qa.length) {
        out.push('');
        out.push('=== ПИТАННЯ І ВІДПОВІДІ ===');
        for (const e of qa) {
            if (e.k === 'question') {
                out.push('');
                out.push(`[${stamp(e.t)}] ПИТАННЯ${e.manual ? ' (вручну)' : ''}: ${e.native || ''}`);
                out.push(`  оригінал: ${e.question}`);
            } else {
                out.push(`[${stamp(e.t)}] ВІДПОВІДЬ (${e.status}, +${sec(e.totalMs)}):`);
                if (e.strategy) out.push(`  стратегія: ${e.strategy.replace(/\n/g, ' ')}`);
                out.push(`  ${e.answer}`);
                if (e.native) out.push(`  переклад: ${e.native}`);
                if (e.analysis) out.push(`  аналіз: ${e.analysis}`);
            }
        }
    }

    // 3. Raw recognizer timeline: how each phrase was heard while it was spoken.
    out.push('');
    out.push('=== РОЗПІЗНАВАННЯ ПО ЧАСУ (~ гіпотеза, що змінюється; ✔ фінал; ▶ фраза відрізана; ⚙ розпізнавач) ===');
    for (const e of s.events) {
        if (e.k === 'interim') out.push(`${stamp(e.t)}  ~ ${e.text}`);
        else if (e.k === 'final') out.push(`${stamp(e.t)}  ✔ ${e.text}`);
        else if (e.k === 'segment') out.push(`${stamp(e.t)}  ▶ [${e.boundary}] ${e.text}`);
        else if (e.k === 'debug') out.push(`${stamp(e.t)}  ⚙ ${e.text}`);
        else if (e.k === 'pause') out.push(`${stamp(e.t)}  ${e.on ? '⏸ «Я говорю»' : '▶ слухаю знову'}`);
    }
    return out.join('\n');
}
