/**
 * CONFIDENCE FILTER SERVICE
 *
 * Since translation models don't provide confidence scores,
 * we use heuristics to estimate translation quality.
 *
 * HEURISTICS:
 * 1. Length ratio - translation should be ~0.8-1.5x original length
 * 2. Empty detection - skip empty or placeholder translations
 * 3. Error markers - detect ❌, ⚠️, ⏳ markers
 * 4. Repetition detection - same word repeated many times
 * 5. Language detection - check for expected characters
 */

export interface ConfidenceResult {
    confidence: number;      // 0-100
    isAcceptable: boolean;   // Above threshold
    reasons: string[];       // Why confidence is low
}

// Configuration
const CONFIG = {
    MIN_CONFIDENCE_THRESHOLD: 50,  // Below this = low quality
    OPTIMAL_LENGTH_RATIO_MIN: 0.6,
    OPTIMAL_LENGTH_RATIO_MAX: 1.8,
    MAX_REPETITION_RATIO: 0.5,     // Max % of same word
};

/**
 * Calculate confidence score for a translation
 */
export function calculateConfidence(
    original: string,
    translation: string
): ConfidenceResult {
    const reasons: string[] = [];
    let confidence = 100;

    // Skip empty translations
    if (!translation || !translation.trim()) {
        return {
            confidence: 0,
            isAcceptable: false,
            reasons: ['Empty translation']
        };
    }

    // Skip error markers
    if (/[❌⚠️⏳]/.test(translation)) {
        return {
            confidence: 10,
            isAcceptable: false,
            reasons: ['Contains error marker']
        };
    }

    // 1. Length ratio check
    const originalLength = original.trim().length;
    const translationLength = translation.trim().length;

    if (originalLength > 0) {
        const lengthRatio = translationLength / originalLength;

        if (lengthRatio < CONFIG.OPTIMAL_LENGTH_RATIO_MIN) {
            const penalty = Math.round((CONFIG.OPTIMAL_LENGTH_RATIO_MIN - lengthRatio) * 50);
            confidence -= penalty;
            reasons.push(`Too short (ratio: ${lengthRatio.toFixed(2)})`);
        } else if (lengthRatio > CONFIG.OPTIMAL_LENGTH_RATIO_MAX) {
            const penalty = Math.round((lengthRatio - CONFIG.OPTIMAL_LENGTH_RATIO_MAX) * 30);
            confidence -= penalty;
            reasons.push(`Too long (ratio: ${lengthRatio.toFixed(2)})`);
        }
    }

    // 2. Word count ratio check
    const originalWords = original.trim().split(/\s+/).filter(w => w.length > 0);
    const translationWords = translation.trim().split(/\s+/).filter(w => w.length > 0);

    if (originalWords.length > 2) {
        const wordRatio = translationWords.length / originalWords.length;

        if (wordRatio < 0.3) {
            confidence -= 30;
            reasons.push(`Very few words translated (${translationWords.length}/${originalWords.length})`);
        } else if (wordRatio > 2.5) {
            confidence -= 20;
            reasons.push(`Too many words (${translationWords.length}/${originalWords.length})`);
        }
    }

    // 3. Repetition detection
    if (translationWords.length >= 3) {
        const wordCounts = new Map<string, number>();
        for (const word of translationWords) {
            const lower = word.toLowerCase();
            wordCounts.set(lower, (wordCounts.get(lower) || 0) + 1);
        }

        const maxCount = Math.max(...wordCounts.values());
        const repetitionRatio = maxCount / translationWords.length;

        if (repetitionRatio > CONFIG.MAX_REPETITION_RATIO) {
            confidence -= 25;
            reasons.push(`High repetition (${Math.round(repetitionRatio * 100)}%)`);
        }
    }

    // 4. Ukrainian character check (for UK translations)
    const ukCharPattern = /[іїєґІЇЄҐа-яА-Я]/;
    const hasUkrainian = ukCharPattern.test(translation);

    if (!hasUkrainian && translation.length > 10) {
        confidence -= 40;
        reasons.push('No Ukrainian characters detected');
    }

    // 5. Suspicious patterns
    if (/^\s*\.+\s*$/.test(translation)) {
        confidence -= 50;
        reasons.push('Only dots');
    }

    if (/^(.)\1{5,}$/.test(translation.replace(/\s/g, ''))) {
        confidence -= 50;
        reasons.push('Repeated single character');
    }

    // Ensure confidence is in range
    confidence = Math.max(0, Math.min(100, confidence));

    return {
        confidence,
        isAcceptable: confidence >= CONFIG.MIN_CONFIDENCE_THRESHOLD,
        reasons
    };
}

/**
 * Filter translation - return original if confidence is too low
 */
export function filterTranslation(
    original: string,
    translation: string,
    fallbackText: string = '...'
): { text: string; wasFiltered: boolean; confidence: number } {
    const result = calculateConfidence(original, translation);

    if (!result.isAcceptable) {
        console.log(`⚠️ [Confidence] Low quality (${result.confidence}%): ${result.reasons.join(', ')}`);
        return {
            text: fallbackText,
            wasFiltered: true,
            confidence: result.confidence
        };
    }

    return {
        text: translation,
        wasFiltered: false,
        confidence: result.confidence
    };
}

/**
 * Estimate translation quality without filtering
 */
export function estimateQuality(original: string, translation: string): number {
    return calculateConfidence(original, translation).confidence;
}

// Export singleton-like functions
export const confidenceFilter = {
    calculate: calculateConfidence,
    filter: filterTranslation,
    estimate: estimateQuality
};
