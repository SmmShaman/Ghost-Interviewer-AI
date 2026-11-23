/**
 * SIMULATED SPEECH SOURCE (development only)
 *
 * Replays a scripted interview the way Chrome's recognizer delivers Norwegian
 * speech: lower-case text without punctuation, an interim hypothesis that grows
 * word by word, and a final shortly after each pause. Lets the whole pipeline
 * (segmentation -> translation -> question detection -> answers) be exercised
 * and demoed without a microphone or a second person.
 *
 * Enabled with `?sim` in the URL on the dev server (see App.tsx). A custom
 * script can be injected through `window.__ghostSimScript`.
 */

import type { SpeechSource, SpeechSourceConfig, SpeechSourceEvents } from './types';

export interface SimUtterance {
    text: string;
    /** Silence after the utterance, ms. */
    pauseAfterMs?: number;
}

const WORD_MS = 350;          // ~2.8 words per second, normal interview pace
const FINAL_DELAY_MS = 600;   // recognizer finalizes this long after the last word

export const DEFAULT_SIM_SCRIPT: SimUtterance[] = [
    { text: 'hei og velkommen til intervjuet hører du meg bra', pauseAfterMs: 2500 },
    { text: 'så bra jeg heter kari og jeg er teamleder for utviklingsavdelingen hos oss i nordlys digital', pauseAfterMs: 1200 },
    { text: 'vi er et lite selskap med rundt tjue ansatte og vi lager bookingløsninger for norske kommuner og vi jobber mest med react og typescript på frontend men vi har også en del eldre kode i php som vi holder på å skrive om', pauseAfterMs: 1500 },
    { text: 'kan du begynne med å fortelle litt om deg selv og hva du har jobbet med de siste årene', pauseAfterMs: 9000 },
    { text: 'spennende du nevnte et prosjekt som du har bygget alene kan du si litt mer om hvilke tekniske valg du tok der og hvorfor', pauseAfterMs: 9000 },
    { text: 'hos oss er det ikke så viktig at du kan alt fra før men det er viktig at du tør å spørre når du står fast', pauseAfterMs: 1200 },
    { text: 'har du erfaring med kubernetes og drift av tjenester i sky', pauseAfterMs: 9000 },
    { text: 'til slutt hva er dine forventninger til lønn', pauseAfterMs: 6000 },
];

export class SimulatedSpeechSource implements SpeechSource {
    readonly isSupported = true;
    private active = false;
    private run = 0;

    constructor(private events: SpeechSourceEvents) {}

    get isActive(): boolean { return this.active; }

    async start(_config: SpeechSourceConfig): Promise<void> {
        if (this.active) return;
        this.active = true;
        const run = ++this.run;
        this.events.onState('listening');
        this.events.onDebug?.('🎬 simulated speech source');
        const script: SimUtterance[] = (window as any).__ghostSimScript || DEFAULT_SIM_SCRIPT;
        const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
        const alive = () => this.active && this.run === run;

        await sleep(800);
        for (const utterance of script) {
            const words = utterance.text.split(/\s+/);
            for (let i = 1; i <= words.length; i++) {
                if (!alive()) return;
                this.events.onInterim(words.slice(0, i).join(' '));
                await sleep(WORD_MS);
            }
            await sleep(FINAL_DELAY_MS);
            if (!alive()) return;
            this.events.onFinal(utterance.text);
            this.events.onInterim('');
            await sleep(utterance.pauseAfterMs ?? 1000);
        }
        this.events.onDebug?.('🎬 script finished');
    }

    stop(): void {
        this.active = false;
        this.run++;
        this.events.onState('idle');
    }

    setDevice(): void { /* not applicable */ }
    setLang(): void { /* not applicable */ }
}
