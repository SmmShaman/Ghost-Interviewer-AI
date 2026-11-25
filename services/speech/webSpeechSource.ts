/**
 * WEB SPEECH SOURCE
 *
 * SpeechSource implementation over the browser Web Speech API (Chrome/Edge).
 * Emits recognizer-final utterances via onFinal and the in-progress hypothesis
 * via onInterim. Keeps Chrome's recognizer alive for a whole interview:
 * auto-restart on onend with back-off, watchdog for silent hangs, fresh
 * MediaStreamTrack on every restart (Chrome 135+ start(track) overload).
 */

import { debugLogger } from '../debugLogger';
import { isMobileDevice } from '../device';
import { DISPLAY_AUDIO_DEVICE_ID } from './types';
import type { SpeechSource, SpeechSourceConfig, SpeechSourceEvents, SpeechSourceState } from './types';

const WATCHDOG_TICK_MS = 3000;
const WATCHDOG_SILENCE_MS = 6000;
const WATCHDOG_FALLBACK_MS = 3000;
// A fresh run needs up to ~6 s before its first words (measured on desktop Chrome);
// restarting it earlier only adds another deaf start-up period.
const WATCHDOG_STARTUP_MS = 12000;
// Chrome on Android stops listening after the end of an utterance but neither
// finalizes the result nor ends the session until stop() is called: the
// recognizer stays deaf until the watchdog fires. Once a run has produced
// words, a much shorter silence is therefore enough to restart it there.
const MOBILE_WATCHDOG_TICK_MS = 500;
const MOBILE_AFTER_SPEECH_SILENCE_MS = 2500;
const RESTART_GUARD_RELEASE_MS = 500;
const MAX_AUDIO_CAPTURE_RETRIES = 3;
const GET_USER_MEDIA_TIMEOUT_MS = 8000;
/** Errors that will not go away by restarting: report and stop. */
const FATAL_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'language-not-supported']);

// Raw capture: Chrome's processing (AEC/AGC/NS) mangles loopback audio (VB-Cable) and hurts recognition.
const audioConstraints = (deviceId: string): MediaStreamConstraints => ({
    audio: { deviceId: { exact: deviceId }, echoCancellation: false, autoGainControl: false, noiseSuppression: false },
});

const getRecognitionCtor = (): any =>
    typeof window === 'undefined' ? undefined : (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

export class WebSpeechSource implements SpeechSource {
    readonly isSupported: boolean = !!getRecognitionCtor();

    private readonly events: SpeechSourceEvents;
    private recognition: any = null;
    private stream: MediaStream | null = null;
    /** Tab/system audio shared by the user (kept for the whole session; each run gets a clone of its track). */
    private displayStream: MediaStream | null = null;
    private displayClone: MediaStreamTrack | null = null;
    private runStartedAt = 0;
    private lang = 'en-US';
    private deviceId = '';

    private active = false;
    /** Bumped on every start()/stop(); async continuations from an older session bail out. */
    private generation = 0;
    /** True between a successful recognition.start() and its onend. */
    private running = false;
    /** Set by stop(): drop trailing results/onend of the run we just stopped (Chrome stop() is async). */
    private ignoreUntilEnd = false;
    /** Double-restart guard, released 500 ms after a launch completes. */
    private isRestarting = false;
    private launchCount = 0;
    private state: SpeechSourceState = 'idle';

    private emittedFinals = 0;
    private lastInterim = '';
    private noSpeechCount = 0;
    private audioCaptureErrors = 0;
    private lastEventTime = 0;
    /** The current recognizer run has delivered at least one result. */
    private heardInRun = false;

    private restartTimer: ReturnType<typeof setTimeout> | null = null;
    private releaseTimer: ReturnType<typeof setTimeout> | null = null;
    private watchdogTimer: ReturnType<typeof setInterval> | null = null;
    private watchdogFallbackTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(events: SpeechSourceEvents) {
        this.events = events;
    }

    get isActive(): boolean {
        return this.active;
    }

    async start(config: SpeechSourceConfig): Promise<void> {
        if (this.active) return;
        if (!this.isSupported) {
            this.setState('error', 'unsupported');
            return;
        }
        this.lang = config.lang || 'en-US';
        this.deviceId = config.deviceId || '';
        this.ensureRecognition();
        this.active = true;
        this.generation++;
        this.noSpeechCount = 0;
        this.audioCaptureErrors = 0;
        this.lastInterim = '';
        this.debug(`🎙️ START: device=${this.deviceId ? this.deviceId.slice(0, 12) + '...' : 'default'} lang=${this.lang}`);
        this.startWatchdog();
        await this.launch('start');
    }

    stop(): void {
        if (!this.active) return;
        this.teardown();
        if (this.lastInterim) {
            this.lastInterim = '';
            this.events.onInterim('');
        }
        this.setState('idle');
    }

    setDevice(deviceId: string): void {
        const next = deviceId || '';
        if (next === this.deviceId) return;
        this.deviceId = next;
        if (!this.active) return;
        this.debug(`🔄 device changed: ${next ? next.slice(0, 12) + '...' : 'default'}`);
        this.restartForConfigChange();
    }

    setLang(lang: string): void {
        if (!lang || lang === this.lang) return;
        this.lang = lang;
        if (this.recognition) this.recognition.lang = lang;
        if (!this.active) return;
        this.debug(`🔄 lang changed: ${lang}`);
        this.restartForConfigChange();
    }

    // ------------------------------------------------------------------ internals

    private ensureRecognition(): void {
        if (this.recognition) return;
        const Ctor = getRecognitionCtor();
        const rec = new Ctor();
        rec.continuous = true;
        rec.interimResults = true; // CRITICAL for latency
        rec.lang = this.lang;
        rec.onresult = (e: any) => this.handleResult(e);
        rec.onerror = (e: any) => this.handleError(e);
        rec.onend = () => this.handleEnd();
        this.recognition = rec;
    }

    private handleResult(event: any): void {
        // Chrome's stop() is async: results can trail in after stop(); drop them.
        if (!this.active || this.ignoreUntilEnd) return;
        this.lastEventTime = Date.now();
        if (!this.heardInRun) this.debug(`👂 first result ${Date.now() - this.runStartedAt} ms after start`);
        this.heardInRun = true;
        this.noSpeechCount = 0;
        this.audioCaptureErrors = 0;

        const results = event.results;
        let i = this.emittedFinals;
        while (i < results.length && results[i].isFinal) {
            const text = String(results[i][0]?.transcript ?? '').trim();
            if (text) this.events.onFinal(text);
            i++;
        }
        this.emittedFinals = i;

        // Remaining entries are the utterance in progress (replaces lastInterim, so no double flush).
        let interim = '';
        for (let j = this.emittedFinals; j < results.length; j++) {
            interim += results[j][0]?.transcript ?? '';
        }
        this.setInterim(interim.trim());
    }

    private handleError(event: any): void {
        const err: string = event?.error ?? 'unknown';
        if (err === 'no-speech') {
            this.noSpeechCount++;
            debugLogger.log('RECOG', `no-speech #${this.noSpeechCount}`);
            if (this.noSpeechCount <= 3) this.debug(`⚠️ no-speech #${this.noSpeechCount}`);
            else if (this.noSpeechCount === 4) this.debug(`⚠️ no-speech #4 — will recreate stream`);
            return; // onend restarts
        }
        if (err === 'network') {
            debugLogger.log('RECOG', 'network error');
            this.debug('❌ network error — will restart');
            return; // onend restarts
        }
        debugLogger.log('RECOG', `error: ${err}`);
        this.debug(`❌ Speech error: ${err}`);
        if (!this.active || err === 'aborted') return;

        if (FATAL_ERRORS.has(err)) {
            this.fail(err);
        } else if (err === 'audio-capture' && ++this.audioCaptureErrors > MAX_AUDIO_CAPTURE_RETRIES) {
            this.fail(err);
        }
        // Everything else: Chrome always follows onerror with onend, which restarts.
    }

    private handleEnd(): void {
        this.running = false;
        debugLogger.log('RECOG', `onend noSpeech=${this.noSpeechCount}`);
        this.debug(`🔚 onend — active=${this.active} noSpeech=${this.noSpeechCount}`);
        if (this.ignoreUntilEnd) {
            this.ignoreUntilEnd = false;
            if (!this.active) return;
            // start() was called again before the old run ended: fall through and restart.
        }
        if (!this.active) return;
        // Never lose words: an interim that Chrome never finalized becomes a final.
        this.flushInterim();
        // Back-off: repeated no-speech means a dead/quiet input — don't hammer Chrome.
        let delay = 300;
        if (this.noSpeechCount >= 4) {
            delay = 2000;
            this.noSpeechCount = 0; // launch() always recreates the stream anyway
        } else if (this.noSpeechCount >= 2) {
            delay = 1000;
        }
        this.scheduleRestart(delay);
    }

    /** Device/lang changed mid-session: end the current run; onend (or the pending launch) picks up the new config. */
    private restartForConfigChange(): void {
        if (this.running) {
            // stop() (not abort) so Chrome delivers final results of the current utterance first.
            try { this.recognition.stop(); } catch { /* ignore */ }
        } else if (!this.restartTimer && !this.isRestarting) {
            this.scheduleRestart(0);
        }
        // If a launch is in flight, it re-checks deviceId after getUserMedia.
    }

    private scheduleRestart(delayMs: number): void {
        if (!this.active) return;
        if (this.restartTimer) clearTimeout(this.restartTimer);
        this.setState('restarting');
        const gen = this.generation;
        this.restartTimer = setTimeout(() => {
            this.restartTimer = null;
            if (!this.active || gen !== this.generation) return;
            void this.launch('restart');
        }, delayMs);
    }

    /** Acquire a fresh track and start recognition. Used for the first start and every restart. */
    private async launch(reason: string): Promise<void> {
        if (!this.active) return;
        if (this.isRestarting) {
            // Another launch is in flight; retry once the guard is released instead of dropping it.
            this.scheduleRestart(RESTART_GUARD_RELEASE_MS);
            return;
        }
        const gen = this.generation;
        this.isRestarting = true;
        this.launchCount++;
        this.lastEventTime = Date.now(); // reset watchdog
        let retryDelay = -1; // >= 0 → schedule another launch after this one
        try {
            this.flushInterim();
            const requestedDevice = this.deviceId;
            const track = await this.acquireTrack(requestedDevice);
            if (!this.active || gen !== this.generation) {
                // stop() happened while awaiting getUserMedia: release what we just opened.
                track?.stop();
                if (track && this.stream?.getAudioTracks()[0] === track) this.stream = null;
                return;
            }
            if (requestedDevice !== this.deviceId) {
                // Device changed while we were acquiring: start over with the new one.
                retryDelay = 0;
                return;
            }

            // A new run starts with a fresh event.results list.
            debugLogger.log('RECOG', `${reason} (reset ${this.emittedFinals} finals)`);
            this.emittedFinals = 0;
            this.heardInRun = false;
            this.recognition.lang = this.lang;

            if (track && track.readyState === 'live') {
                try {
                    this.recognition.start(track); // Chrome 135+ MediaStreamTrack overload
                    this.debug(`▶️ ${reason} with: ${track.label.slice(0, 30)}`);
                } catch (e: any) {
                    if (e?.name === 'InvalidStateError') throw e;
                    this.debug(`⚠️ start(track) failed: ${e?.message} — using default mic`);
                    this.recognition.start();
                }
            } else {
                this.recognition.start();
                this.debug(`▶️ ${reason} with default mic`);
            }
            this.running = true;
            this.runStartedAt = Date.now();
            this.lastEventTime = this.runStartedAt; // the watchdog counts from the real start, not from the share dialog
            this.setState('listening');
        } catch (e: any) {
            if (e?.name === 'InvalidStateError' || e?.message?.includes('already started')) {
                // Chrome still considers the previous run alive: its onend (or the watchdog) restarts us.
                this.running = true;
                this.setState('restarting');
                this.debug(`▶️ ${reason}: already started — waiting for onend`);
            } else {
                this.debug(`▶️ ${reason} error: ${e?.message}`);
                retryDelay = 1000;
            }
        } finally {
            if (gen === this.generation) {
                if (retryDelay >= 0) {
                    this.isRestarting = false;
                    this.scheduleRestart(retryDelay);
                } else {
                    if (this.releaseTimer) clearTimeout(this.releaseTimer);
                    this.releaseTimer = setTimeout(() => {
                        this.releaseTimer = null;
                        this.isRestarting = false;
                    }, RESTART_GUARD_RELEASE_MS);
                }
            }
        }
    }

    /**
     * ALWAYS recreate the track from the device: Chrome invalidates the track
     * passed to start(track) once recognition stops. Empty deviceId = default mic.
     */
    private async acquireTrack(deviceId: string): Promise<MediaStreamTrack | undefined> {
        if (deviceId === DISPLAY_AUDIO_DEVICE_ID) {
            try {
                return await this.acquireDisplayTrack();
            } catch (e: any) {
                // Cancelled dialog or no audio shared: retrying would only reopen the dialog.
                const detail = e?.message === 'display-audio-missing' ? 'display-audio-missing' : 'display-audio-denied';
                this.debug(`❌ tab audio: ${e?.name || ''} ${e?.message || ''}`);
                if (this.active && e?.message !== 'stopped') this.fail(detail);
                return undefined;
            }
        }
        this.releaseDisplay();
        if (!deviceId) {
            this.releaseStream();
            return undefined;
        }
        const previous = this.stream;
        try {
            previous?.getTracks().forEach(t => t.stop());
            // Bounded wait: a hung getUserMedia would otherwise block restarts (and the watchdog) forever.
            const pending = navigator.mediaDevices.getUserMedia(audioConstraints(deviceId));
            let timer: ReturnType<typeof setTimeout> | undefined;
            const timeout = new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('getUserMedia timeout')), GET_USER_MEDIA_TIMEOUT_MS);
            });
            let stream: MediaStream;
            try {
                stream = await Promise.race([pending, timeout]);
            } catch (e) {
                pending.then(s => s.getTracks().forEach(t => t.stop())).catch(() => { /* ignore */ });
                throw e;
            } finally {
                clearTimeout(timer);
            }
            this.stream = stream;
            return stream.getAudioTracks()[0];
        } catch (e) {
            this.debug(`▶️ track recreate failed (device=${deviceId.slice(0, 8)}): ${(e as Error).message}`);
            // Fall back to the old track if it somehow survived, else default mic.
            const old = previous?.getAudioTracks()[0];
            return old?.readyState === 'live' ? old : undefined;
        }
    }

    /**
     * Audio of a tab / the system instead of a microphone. The share dialog is shown
     * once per session; Chrome invalidates the track given to start(track) when the
     * run ends, so every run gets a clone and the shared track itself stays alive.
     */
    private async acquireDisplayTrack(): Promise<MediaStreamTrack> {
        if (this.stream) {
            this.stream.getTracks().forEach(t => t.stop());
            this.stream = null;
        }
        this.displayClone?.stop();
        this.displayClone = null;

        let master = this.displayStream?.getAudioTracks()[0];
        if (!master || master.readyState !== 'live') {
            this.releaseDisplay();
            const options: any = {
                video: { frameRate: 1 }, // Chrome refuses audio-only capture; the picture is not used
                audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
                systemAudio: 'include',
            };
            try {
                // Keep this tab in front: by default Chrome jumps to the shared tab.
                const Controller = (window as any).CaptureController;
                if (Controller) {
                    const controller = new Controller();
                    controller.setFocusBehavior?.('no-focus-change');
                    options.controller = controller;
                }
            } catch { /* older Chrome: focus moves to the shared tab */ }
            const gen = this.generation;
            const stream: MediaStream = await (navigator.mediaDevices as any).getDisplayMedia(options);
            if (!this.active || gen !== this.generation) {
                stream.getTracks().forEach(t => t.stop());
                throw new Error('stopped');
            }
            master = stream.getAudioTracks()[0];
            if (!master) {
                stream.getTracks().forEach(t => t.stop());
                throw new Error('display-audio-missing');
            }
            this.displayStream = stream;
            this.debug(`🖥️ tab audio: ${master.label.slice(0, 40) || 'shared audio'}`);
            master.addEventListener('ended', () => {
                if (this.displayStream !== stream) return;
                this.debug('🖥️ tab audio: sharing stopped');
                if (this.active && this.deviceId === DISPLAY_AUDIO_DEVICE_ID) this.fail('display-audio-ended');
            });
        }
        this.displayClone = master.clone();
        return this.displayClone;
    }

    private releaseDisplay(): void {
        this.displayClone?.stop();
        this.displayClone = null;
        const stream = this.displayStream;
        this.displayStream = null; // before stop(): the 'ended' listener must not report it
        stream?.getTracks().forEach(t => t.stop());
    }

    /** Backstop for Chrome's silent hangs: no events for >6 s → stop; if onend never restarts → direct restart. */
    private startWatchdog(): void {
        this.clearWatchdog();
        this.lastEventTime = Date.now();
        const mobile = isMobileDevice();
        this.watchdogTimer = setInterval(() => {
            if (!this.active) return;
            if (this.isRestarting || this.restartTimer || this.watchdogFallbackTimer) return;
            const silenceMs = Date.now() - this.lastEventTime;
            const limit = mobile
                ? (this.heardInRun ? MOBILE_AFTER_SPEECH_SILENCE_MS : WATCHDOG_SILENCE_MS)
                : (this.heardInRun ? WATCHDOG_SILENCE_MS : WATCHDOG_STARTUP_MS);
            if (silenceMs <= limit) return;

            debugLogger.log('RECOG', `WATCHDOG ${Math.round(silenceMs / 1000)}s silence`);
            this.debug(`🐕 WATCHDOG: no events ${Math.round(silenceMs / 1000)}s — force restart`);
            this.lastEventTime = Date.now();
            const marker = this.launchCount;
            try { this.recognition.stop(); } catch { /* ignore */ }

            this.watchdogFallbackTimer = setTimeout(() => {
                this.watchdogFallbackTimer = null;
                if (!this.active || this.launchCount !== marker || this.isRestarting || this.restartTimer) return;
                // onend never came: force the recognizer down and restart directly.
                debugLogger.log('RECOG', 'WATCHDOG fallback — direct restart');
                this.debug('🐕 WATCHDOG: onend failed, direct restart');
                try { this.recognition.abort(); } catch { /* ignore */ }
                this.running = false;
                this.scheduleRestart(0);
            }, WATCHDOG_FALLBACK_MS);
        }, mobile ? MOBILE_WATCHDOG_TICK_MS : WATCHDOG_TICK_MS);
    }

    private clearWatchdog(): void {
        if (this.watchdogTimer) { clearInterval(this.watchdogTimer); this.watchdogTimer = null; }
        if (this.watchdogFallbackTimer) { clearTimeout(this.watchdogFallbackTimer); this.watchdogFallbackTimer = null; }
    }

    /** Fatal error: flush what we heard, shut everything down, report. */
    private fail(detail: string): void {
        this.flushInterim();
        this.teardown();
        this.setState('error', detail);
    }

    private teardown(): void {
        this.active = false;
        this.generation++;
        this.clearWatchdog();
        if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
        if (this.releaseTimer) { clearTimeout(this.releaseTimer); this.releaseTimer = null; }
        this.isRestarting = false;
        if (this.running) this.ignoreUntilEnd = true;
        try { this.recognition?.stop(); } catch { /* ignore */ }
        this.releaseStream();
        this.releaseDisplay();
        this.emittedFinals = 0;
    }

    private releaseStream(): void {
        if (this.stream) {
            this.stream.getTracks().forEach(t => t.stop());
            this.stream = null;
        }
    }

    private flushInterim(): void {
        if (!this.lastInterim) return;
        const text = this.lastInterim;
        this.lastInterim = '';
        this.events.onFinal(text);
        this.events.onInterim('');
    }

    private setInterim(text: string): void {
        if (text === this.lastInterim) return;
        this.lastInterim = text;
        this.events.onInterim(text);
    }

    private setState(state: SpeechSourceState, detail?: string): void {
        if (state === this.state && state !== 'error') return;
        this.state = state;
        this.events.onState(state, detail);
    }

    private debug(msg: string): void {
        this.events.onDebug?.(msg);
    }
}
