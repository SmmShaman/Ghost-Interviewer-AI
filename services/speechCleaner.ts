/**
 * SPEECH CLEANER SERVICE
 *
 * Cleans raw speech recognition output before translation:
 * 1. Removes filler words (eh, øh, altså, liksom, etc.)
 * 2. Removes consecutive duplicate words ("vektere vektere" → "vektere")
 * 3. Removes truncated fragments (single letters, incomplete words)
 *
 * Applied BEFORE translation to avoid garbage-in-garbage-out.
 */

// Norwegian filler words and hesitation sounds
const NORWEGIAN_FILLERS = new Set([
    // Hesitation sounds
    'eh', 'øh', 'uh', 'uhm', 'hm', 'hmm', 'mm', 'mmm', 'em', 'um', 'ah',
    // Filler words
    'altså', 'liksom', 'lissom', 'sant', 'da', 'ba',
    // English fillers (often mixed in Norwegian speech)
    'like', 'well', 'uh', 'um', 'er',
]);

// Single characters that are likely speech recognition artifacts (not real words)
// Keep: 'i' (in/I), 'å' (to), 'ø' (island), 'og' is 2 chars so not affected
const VALID_SINGLE_CHARS = new Set(['i', 'å', 'ø', 'a', 'o']);

/**
 * Clean speech text: remove fillers, duplicates, and fragments.
 * @param text Raw speech recognition output
 * @returns Cleaned text
 */
export function cleanSpeechText(text: string): string {
    if (!text || !text.trim()) return '';

    const words = text.trim().split(/\s+/);
    const cleaned: string[] = [];

    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const lower = word.toLowerCase();

        // Skip filler words
        if (NORWEGIAN_FILLERS.has(lower)) continue;

        // Skip single-character fragments (likely artifacts)
        if (word.length === 1 && !VALID_SINGLE_CHARS.has(lower)) continue;

        // Skip consecutive duplicates ("vektere vektere" → "vektere")
        if (cleaned.length > 0 && cleaned[cleaned.length - 1].toLowerCase() === lower) continue;

        // Skip triple+ duplicates with one word gap ("det det er det" → "det er det")
        // Only remove if same word appears 3+ times in last 4 words
        if (cleaned.length >= 3) {
            const lastFour = cleaned.slice(-3).map(w => w.toLowerCase());
            const count = lastFour.filter(w => w === lower).length;
            if (count >= 2) continue;
        }

        cleaned.push(word);
    }

    return cleaned.join(' ');
}
