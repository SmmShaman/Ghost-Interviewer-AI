/**
 * SEGMENTER
 *
 * Turns the recognizer's interim/final stream into translation units
 * ("segments") that are as close to whole sentences as live speech allows.
 *
 * Why not fixed word counts: Norwegian puts negation and verbs where a
 * fixed-size cut regularly separates them from the clause they belong to,
 * and a fragment translated on its own reads wrong in Ukrainian.
 *
 * A segment ends, in order of preference:
 *   1. 'final'  — the recognizer finished an utterance (speaker paused);
 *   2. 'pause'  — the interim text stopped changing for PAUSE_MS
 *                 (faster than waiting for the recognizer's own final);
 *   3. 'length' — the speaker keeps going: cut at sentence punctuation or
 *                 before a clause-opening conjunction once the uncommitted
 *                 text is long enough, always holding back the last words
 *                 because the recognizer still revises them.
 *
 * Pure logic, no timers and no DOM: the caller feeds events plus a clock,
 * which keeps it unit-testable (tests/segmenter.test.ts).
 */

export type SegmentBoundary = 'final' | 'pause' | 'length';

export interface RawSegment {
    text: string;
    boundary: SegmentBoundary;
}

export interface SegmenterConfig {
    /** Interim unchanged this long => treat as end of phrase. */
    pauseMs: number;
    /**
     * A pause after fewer words than this is more likely hesitation
     * ("så bra, jeg … heter Kari") than the end of a phrase: wait twice as long.
     */
    shortPhraseWords: number;
    /** Start looking for a clause boundary once this many words are uncommitted. */
    softMaxWords: number;
    /** Cut even without a good boundary at this many uncommitted words. */
    hardMaxWords: number;
    /** Never cut a segment shorter than this on a 'length' boundary. */
    minWords: number;
    /** Trailing interim words never committed on a 'length' cut (still unstable). */
    holdWords: number;
}

export const DEFAULT_SEGMENTER_CONFIG: SegmenterConfig = {
    pauseMs: 900,
    shortPhraseWords: 5,
    softMaxWords: 12,
    hardMaxWords: 22,
    minWords: 5,
    holdWords: 3,
};

// Words that reliably OPEN a new clause in Norwegian/English/German speech.
// A 'length' cut is placed right before one of them.
// Deliberately absent: "så" ("så viktig" = so important) and "selv" ("deg selv").
const CLAUSE_OPENERS = new Set([
    // Norwegian
    'men', 'fordi', 'siden', 'mens', 'hvis', 'dersom', 'når', 'derfor', 'samtidig', 'likevel', 'dessuten',
    // English
    'but', 'because', 'while', 'if', 'when', 'although', 'however',
    // German
    'aber', 'weil', 'wenn', 'obwohl',
]);

// "og"/"eller" join nouns ("react og typescript") far more often than clauses,
// so they only count as a boundary when a subject follows ("og vi jobber").
const COORDINATORS = new Set(['og', 'eller', 'and', 'or', 'und', 'oder']);
const SUBJECTS = new Set([
    'jeg', 'du', 'vi', 'de', 'dere', 'han', 'hun', 'det', 'den', 'man', 'dette', 'så', 'da',
    'i', 'you', 'we', 'they', 'he', 'she', 'it', 'this', 'then',
    'ich', 'wir', 'sie', 'er', 'es', 'ihr', 'dann',
]);

const SENTENCE_END = /[.!?…]["')\]]?$/;

const splitWords = (text: string): string[] => text.trim().split(/\s+/).filter(Boolean);

export class Segmenter {
    private config: SegmenterConfig;
    /** Words of the current utterance already emitted from interim text. */
    private consumed = 0;
    private interimWords: string[] = [];
    private lastInterimChange = 0;

    constructor(config: Partial<SegmenterConfig> = {}) {
        this.config = { ...DEFAULT_SEGMENTER_CONFIG, ...config };
    }

    reset(): void {
        this.consumed = 0;
        this.interimWords = [];
        this.lastInterimChange = 0;
    }

    /** Words of the current utterance that are not part of any segment yet. */
    get pendingText(): string {
        return this.interimWords.slice(this.consumed).join(' ');
    }

    /**
     * Emit the pending words now but keep the utterance open, so that a later
     * interim/final of the same utterance does not repeat them.
     */
    flushPending(): RawSegment[] {
        const text = this.pendingText;
        if (!text) return [];
        this.consumed = this.interimWords.length;
        return [{ text, boundary: 'pause' }];
    }

    /** New interim hypothesis (replaces the previous one). */
    pushInterim(text: string, now: number): RawSegment[] {
        const words = splitWords(text);
        if (words.join(' ') !== this.interimWords.join(' ')) {
            this.lastInterimChange = now;
        }
        this.interimWords = words;
        // An empty hypothesis ends the utterance. A hypothesis that merely shrank
        // below what we already emitted keeps `consumed`: clamping it would
        // re-emit the same words when the hypothesis grows back.
        if (words.length === 0) this.consumed = 0;

        const out: RawSegment[] = [];
        // Long uninterrupted speech: peel off complete clauses from the front.
        for (;;) {
            const cut = this.findLengthCut();
            if (cut === -1) break;
            out.push({ text: this.interimWords.slice(this.consumed, cut).join(' '), boundary: 'length' });
            this.consumed = cut;
        }
        return out;
    }

    /** The recognizer finalized the current utterance. */
    pushFinal(text: string, _now: number): RawSegment[] {
        const words = splitWords(text);
        // Skip what was already emitted from interim text. Word-count based:
        // the final may differ slightly from the interim, an exact diff is not
        // possible, and losing/duplicating a word here is cheaper than waiting.
        const rest = words.slice(Math.min(this.consumed, words.length));
        // The interim may have spanned several recognizer results; when only the
        // first of them is finalized here, the words we already emitted beyond
        // it belong to the next result and must not be emitted again.
        this.consumed = Math.max(0, this.consumed - words.length);
        this.interimWords = [];
        if (rest.length === 0) return [];
        return this.splitLong(rest).map(chunk => ({ text: chunk.join(' '), boundary: 'final' as const }));
    }

    /** Call periodically (e.g. every 100 ms) to detect a speech pause. */
    tick(now: number): RawSegment[] {
        const pending = this.interimWords.length - this.consumed;
        if (pending <= 0) return [];
        const wait = pending < this.config.shortPhraseWords ? this.config.pauseMs * 2 : this.config.pauseMs;
        if (now - this.lastInterimChange < wait) return [];
        return this.flushPending();
    }

    /** Session stop: emit whatever is left. */
    flush(): RawSegment[] {
        const text = this.pendingText;
        this.consumed = 0;
        this.interimWords = [];
        return text ? [{ text, boundary: 'final' }] : [];
    }

    /**
     * Index (exclusive, in interimWords) where a 'length' segment should end,
     * or -1 when the uncommitted text should keep growing.
     */
    private findLengthCut(): number {
        const { softMaxWords, hardMaxWords, minWords, holdWords } = this.config;
        const total = this.interimWords.length;
        const pending = total - this.consumed;
        if (pending < softMaxWords) return -1;   // also covers a shrunken hypothesis (pending < 0)

        const lastAllowed = total - holdWords;           // exclusive upper bound for the cut
        const firstAllowed = this.consumed + minWords;   // inclusive lower bound
        if (lastAllowed < firstAllowed) return -1;

        // 1) Latest sentence punctuation inside the stable part.
        for (let i = lastAllowed; i >= firstAllowed; i--) {
            if (SENTENCE_END.test(this.interimWords[i - 1])) return i;
        }
        // 2) Latest clause opener: cut right before it, keeping minWords on both sides
        //    where possible so we do not produce a dangling two-word tail.
        for (let i = lastAllowed; i >= firstAllowed; i--) {
            if (!this.isBoundary(this.interimWords, i)) continue;
            // "og så", "men når": keep the opener pair together in the next segment.
            let cut = i;
            while (cut - 1 >= firstAllowed && this.isBoundary(this.interimWords, cut - 1)) cut--;
            return cut;
        }
        // 3) Comma is a weaker but still natural break.
        for (let i = lastAllowed; i >= firstAllowed; i--) {
            if (/[,;:]$/.test(this.interimWords[i - 1])) return i;
        }
        // 4) No natural break: wait until the hard limit, then cut before the held words.
        if (pending >= hardMaxWords) return lastAllowed;
        return -1;
    }

    /** True when a new clause starts at words[i]. */
    private isBoundary(words: string[], i: number): boolean {
        const norm = (w: string | undefined) => (w || '').toLowerCase().replace(/[^\p{L}]/gu, '');
        const word = norm(words[i]);
        if (!word) return false;
        if (CLAUSE_OPENERS.has(word)) return true;
        // The following word must already be there: a coordinator at the very
        // end of the hypothesis is undecidable.
        return COORDINATORS.has(word) && SUBJECTS.has(norm(words[i + 1]));
    }

    /** Split an over-long final utterance at clause boundaries. */
    private splitLong(words: string[]): string[][] {
        const { hardMaxWords, minWords } = this.config;
        const chunks: string[][] = [];
        let start = 0;
        while (words.length - start > hardMaxWords) {
            let cut = -1;
            const upper = start + hardMaxWords;
            for (let i = upper; i >= start + minWords; i--) {
                if (SENTENCE_END.test(words[i - 1])) { cut = i; break; }
            }
            if (cut === -1) {
                for (let i = upper; i >= start + minWords; i--) {
                    if (!this.isBoundary(words, i)) continue;
                    cut = i;
                    while (cut - 1 >= start + minWords && this.isBoundary(words, cut - 1)) cut--;
                    break;
                }
            }
            if (cut === -1) cut = upper;
            // Avoid leaving a tail shorter than minWords.
            if (words.length - cut < minWords) break;
            chunks.push(words.slice(start, cut));
            start = cut;
        }
        chunks.push(words.slice(start));
        return chunks;
    }
}
