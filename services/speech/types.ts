/**
 * SPEECH SOURCE CONTRACT
 *
 * Everything downstream (segmenter, translation, answers) depends only on this
 * interface, so the recognizer can be swapped (Web Speech today; a cloud
 * streaming STT such as Deepgram / Soniox / Gemini Live later) without touching
 * the rest of the pipeline.
 */

export type SpeechSourceState = 'idle' | 'listening' | 'restarting' | 'error';

export interface SpeechSourceEvents {
    /**
     * Current not-yet-final hypothesis of the utterance in progress.
     * Each call REPLACES the previous interim text. Empty string clears it.
     */
    onInterim(text: string): void;
    /**
     * Recognizer-final text of one utterance. Append-only: a final is never
     * revised and never repeats words of an earlier final.
     */
    onFinal(text: string): void;
    onState(state: SpeechSourceState, detail?: string): void;
    /** Human-readable diagnostics for the on-screen debug overlay. */
    onDebug?(message: string): void;
}

export interface SpeechSourceConfig {
    /** BCP-47 language tag, e.g. "nb-NO". */
    lang: string;
    /** Audio input device id; empty/undefined = system default microphone. */
    deviceId?: string;
}

export interface SpeechSource {
    /** True when the browser supports this source at all. */
    readonly isSupported: boolean;
    readonly isActive: boolean;
    start(config: SpeechSourceConfig): Promise<void>;
    stop(): void;
    /** Switch input device (restarts recognition if active). */
    setDevice(deviceId: string): void;
    /** Switch recognition language (restarts recognition if active). */
    setLang(lang: string): void;
}
