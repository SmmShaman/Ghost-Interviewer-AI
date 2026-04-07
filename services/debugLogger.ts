/**
 * DEBUG LOGGER SERVICE
 *
 * Structured log collector for translation pipeline analysis.
 * Stores timestamped events in a circular buffer.
 * Auto-flushes to Vite dev server → debug-logs.txt file.
 *
 * USAGE (browser console):
 *   __logs()          — copy last 200 events to clipboard as text
 *   __logsJson()      — copy as JSON (for detailed analysis)
 *   __logsClear()     — clear buffer + file
 *   __logsLive()      — toggle live console output
 *   __logsFlush()     — force flush to file now
 */

export interface LogEvent {
    t: number;        // timestamp (ms since session start)
    type: string;     // event type
    ms?: number;      // latency in ms (for translation events)
    words?: number;   // word count
    detail?: string;  // short detail (truncated)
}

class DebugLogger {
    private events: LogEvent[] = [];
    private sessionStart: number = 0;
    private readonly MAX_EVENTS = 500;
    private liveMode: boolean = false;

    // File sync: batch events and flush periodically
    private pendingLines: string[] = [];
    private flushTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly FLUSH_INTERVAL_MS = 2000;
    private readonly API_URL = '/api/debug-logs';
    private fileAvailable: boolean = true; // assume dev server is running

    constructor() {
        this.expose();
    }

    /** Start a new session (resets timer) */
    startSession(): void {
        this.events = [];
        this.pendingLines = [];
        this.sessionStart = Date.now();
        this.log('SESSION', 'started');

        // Clear file and write header
        this.sendToFile('flush', this.buildHeader());
        this.startAutoFlush();
    }

    /** Stop session — flush everything to file */
    stopSession(): void {
        this.log('SESSION', 'stopped');
        this.stopAutoFlush();

        // Final flush: write complete report to file
        this.sendToFile('flush', this.toText());
    }

    /** Log a translation pipeline event */
    log(type: string, detail?: string, latencyMs?: number, wordCount?: number): void {
        if (this.sessionStart === 0) this.sessionStart = Date.now();

        const event: LogEvent = {
            t: Date.now() - this.sessionStart,
            type,
            ...(latencyMs !== undefined && { ms: Math.round(latencyMs) }),
            ...(wordCount !== undefined && { words: wordCount }),
            ...(detail && { detail: detail.substring(0, 80) })
        };

        this.events.push(event);
        if (this.events.length > this.MAX_EVENTS) {
            this.events.shift();
        }

        // Queue line for file
        this.pendingLines.push(this.formatEventLine(event));

        if (this.liveMode) {
            const parts = [
                `[${this.formatTime(event.t)}]`,
                event.type.padEnd(12),
                event.ms !== undefined ? `${event.ms}ms` : '',
                event.words !== undefined ? `${event.words}w` : '',
                event.detail || ''
            ].filter(Boolean);
            console.log(`🔍 ${parts.join(' | ')}`);
        }
    }

    /** Format a single event as a table row */
    private formatEventLine(e: LogEvent): string {
        return [
            this.formatTime(e.t).padEnd(10),
            e.type.padEnd(12),
            (e.ms !== undefined ? `${e.ms}ms` : '').padEnd(7),
            (e.words !== undefined ? `${e.words}` : '').padEnd(5),
            e.detail || ''
        ].join(' | ');
    }

    /** Build file header */
    private buildHeader(): string {
        return [
            `=== Ghost Interviewer Debug Log ===`,
            `Session: ${new Date(this.sessionStart).toISOString()}`,
            ``,
            `TIME       | TYPE         | LATENCY | WORDS | DETAIL`,
            `-----------|--------------|---------|-------|-------`,
            ''
        ].join('\n');
    }

    /** Format events as readable text */
    toText(last?: number): string {
        const events = last ? this.events.slice(-last) : this.events;
        const lines = [
            this.buildHeader()
        ];

        for (const e of events) {
            lines.push(this.formatEventLine(e));
        }

        // Summary
        const ghostEvents = events.filter(e => e.type === 'GHOST' && e.ms !== undefined);
        const llmEvents = events.filter(e => e.type === 'LLM' && e.ms !== undefined);
        const interimEvents = events.filter(e => e.type === 'INTERIM' && e.ms !== undefined);

        lines.push('');
        lines.push(`=== SUMMARY (${events.length} events) ===`);
        if (ghostEvents.length > 0) {
            const avg = Math.round(ghostEvents.reduce((s, e) => s + (e.ms || 0), 0) / ghostEvents.length);
            const max = Math.max(...ghostEvents.map(e => e.ms || 0));
            const min = Math.min(...ghostEvents.map(e => e.ms || 0));
            lines.push(`Ghost:   ${ghostEvents.length} calls | avg ${avg}ms | min ${min}ms | max ${max}ms`);
        }
        if (llmEvents.length > 0) {
            const avg = Math.round(llmEvents.reduce((s, e) => s + (e.ms || 0), 0) / llmEvents.length);
            const max = Math.max(...llmEvents.map(e => e.ms || 0));
            const min = Math.min(...llmEvents.map(e => e.ms || 0));
            lines.push(`LLM:     ${llmEvents.length} calls | avg ${avg}ms | min ${min}ms | max ${max}ms`);
        }
        if (interimEvents.length > 0) {
            const avg = Math.round(interimEvents.reduce((s, e) => s + (e.ms || 0), 0) / interimEvents.length);
            lines.push(`Interim: ${interimEvents.length} calls | avg ${avg}ms`);
        }

        const wordEvents = events.filter(e => e.type === 'WORDS_IN');
        const totalWords = wordEvents.reduce((s, e) => s + (e.words || 0), 0);
        lines.push(`Words received: ${totalWords}`);

        const freezeEvents = events.filter(e => e.type === 'FREEZE');
        if (freezeEvents.length > 0) {
            const totalFrozen = freezeEvents.reduce((s, e) => s + (e.words || 0), 0);
            lines.push(`Freeze events: ${freezeEvents.length} | total frozen words: ${totalFrozen}`);
        }

        return lines.join('\n');
    }

    /** Get events as JSON */
    toJson(): string {
        return JSON.stringify({
            sessionStart: new Date(this.sessionStart).toISOString(),
            eventCount: this.events.length,
            events: this.events
        }, null, 2);
    }

    /** Clear all events + file */
    clear(): void {
        this.events = [];
        this.pendingLines = [];
        this.sendToFile('clear', '');
        console.log('🧹 Debug log cleared');
    }

    /** Toggle live mode */
    toggleLive(): boolean {
        this.liveMode = !this.liveMode;
        console.log(`🔍 Live mode: ${this.liveMode ? 'ON' : 'OFF'}`);
        return this.liveMode;
    }

    // === FILE SYNC ===

    private startAutoFlush(): void {
        this.stopAutoFlush();
        this.flushTimer = setInterval(() => this.flushToFile(), this.FLUSH_INTERVAL_MS);
    }

    private stopAutoFlush(): void {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
        }
    }

    /** Flush pending lines to file */
    private flushToFile(): void {
        if (this.pendingLines.length === 0 || !this.fileAvailable) return;

        const data = this.pendingLines.join('\n');
        this.pendingLines = [];
        this.sendToFile('append', data);
    }

    /** Send data to Vite dev server endpoint */
    private sendToFile(action: 'append' | 'flush' | 'clear', data: string): void {
        if (!this.fileAvailable) return;

        fetch(this.API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, data })
        }).catch(() => {
            // Dev server not running (production) — disable file sync silently
            this.fileAvailable = false;
        });
    }

    /** Force flush to file now (callable from console) */
    forceFlush(): void {
        // Write complete report
        this.sendToFile('flush', this.toText());
        console.log(`📁 Flushed ${this.events.length} events to debug-logs.txt`);
    }

    // === FORMATTING ===

    private formatTime(ms: number): string {
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        const remainder = ms % 1000;
        return `${m}:${(s % 60).toString().padStart(2, '0')}.${remainder.toString().padStart(3, '0')}`;
    }

    /** Expose global helpers for browser console */
    private expose(): void {
        if (typeof window !== 'undefined') {
            (window as any).__logs = (last = 200) => {
                const text = this.toText(last);
                navigator.clipboard.writeText(text).then(() => {
                    console.log(`📋 ${this.events.length} events copied to clipboard`);
                }).catch(() => {
                    console.log(text);
                });
                return text;
            };
            (window as any).__logsJson = () => {
                const json = this.toJson();
                navigator.clipboard.writeText(json).then(() => {
                    console.log(`📋 JSON copied to clipboard`);
                }).catch(() => {
                    console.log(json);
                });
                return json;
            };
            (window as any).__logsClear = () => this.clear();
            (window as any).__logsLive = () => this.toggleLive();
            (window as any).__logsFlush = () => this.forceFlush();
        }
    }
}

export const debugLogger = new DebugLogger();
