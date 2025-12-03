/**
 * GLOSSARY PROCESSOR SERVICE
 *
 * Обробляє IT-термінологію в перекладеному тексті.
 * Замінює неправильно перекладені терміни на правильні форми з глосарію.
 *
 * ОСОБЛИВОСТІ:
 * - Морфологічний аналіз: визначення потрібного відмінка з контексту
 * - Post-processing: застосування після основного перекладу
 * - Кешування для швидкодії
 */

import glossaryData from '../data/it-glossary.json';

interface GlossaryTerm {
    term: string;
    uk: string;
    category: string;
    inflections?: {
        nominative: string;
        genitive: string;
        dative: string;
        accusative: string;
        instrumental: string;
        locative: string;
    };
}

interface GlossaryData {
    meta: {
        version: string;
        description: string;
        categories: string[];
    };
    terms: GlossaryTerm[];
    prepositionCases: Record<string, string>;
}

type Case = 'nominative' | 'genitive' | 'dative' | 'accusative' | 'instrumental' | 'locative';

class GlossaryProcessor {
    private terms: Map<string, GlossaryTerm> = new Map();
    private prepositionCases: Map<string, Case> = new Map();
    private processedCache: Map<string, string> = new Map();
    private readonly CACHE_MAX_SIZE = 500;

    constructor() {
        this.loadGlossary();
    }

    /**
     * Load glossary data into memory
     */
    private loadGlossary(): void {
        const data = glossaryData as GlossaryData;

        // Index terms by lowercase for case-insensitive matching
        for (const term of data.terms) {
            this.terms.set(term.term.toLowerCase(), term);
        }

        // Load preposition → case mappings
        for (const [prep, caseType] of Object.entries(data.prepositionCases)) {
            this.prepositionCases.set(prep.toLowerCase(), caseType as Case);
        }

        console.log(`📚 [Glossary] Loaded ${this.terms.size} terms`);
    }

    /**
     * Process translated text, replacing terms with correct forms
     */
    processTranslation(text: string): string {
        if (!text.trim()) return text;

        // Check cache first
        const cacheKey = text.substring(0, 100); // Use first 100 chars as key
        if (this.processedCache.has(cacheKey)) {
            return this.processedCache.get(cacheKey)!;
        }

        let result = text;

        // Process each term in the glossary
        for (const [termKey, termData] of this.terms) {
            // Skip if term not in text (case-insensitive check)
            if (!result.toLowerCase().includes(termKey) &&
                !result.toLowerCase().includes(termData.uk.toLowerCase())) {
                continue;
            }

            // Find and replace English terms with Ukrainian equivalents
            const englishPattern = new RegExp(`\\b${this.escapeRegex(termData.term)}\\b`, 'gi');
            result = result.replace(englishPattern, (match) => {
                // Preserve original case pattern if possible
                if (match === match.toUpperCase()) {
                    return termData.uk.toUpperCase();
                }
                return termData.uk;
            });

            // If term has inflections, try to fix incorrect forms
            if (termData.inflections) {
                result = this.fixInflections(result, termData);
            }
        }

        // Cache result
        if (this.processedCache.size >= this.CACHE_MAX_SIZE) {
            // Clear oldest entries (simple FIFO)
            const firstKey = this.processedCache.keys().next().value;
            if (firstKey) this.processedCache.delete(firstKey);
        }
        this.processedCache.set(cacheKey, result);

        return result;
    }

    /**
     * Fix inflections based on context (prepositions)
     */
    private fixInflections(text: string, termData: GlossaryTerm): string {
        if (!termData.inflections) return text;

        const ukTerm = termData.uk.toLowerCase();
        const words = text.split(/\s+/);
        const result: string[] = [];

        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            const wordLower = word.toLowerCase().replace(/[.,!?;:]/g, '');

            // Check if this word is a form of the term
            const isTermForm = this.isFormOfTerm(wordLower, termData);

            if (isTermForm && i > 0) {
                // Get previous word (potential preposition)
                const prevWord = words[i - 1].toLowerCase().replace(/[.,!?;:]/g, '');
                const requiredCase = this.prepositionCases.get(prevWord);

                if (requiredCase && termData.inflections[requiredCase]) {
                    // Replace with correct form
                    const correctForm = termData.inflections[requiredCase];
                    const punctuation = word.match(/[.,!?;:]+$/)?.[0] || '';

                    // Preserve original capitalization
                    const finalForm = word[0] === word[0].toUpperCase()
                        ? correctForm.charAt(0).toUpperCase() + correctForm.slice(1)
                        : correctForm;

                    result.push(finalForm + punctuation);
                    continue;
                }
            }

            result.push(word);
        }

        return result.join(' ');
    }

    /**
     * Check if a word is a form of the given term
     */
    private isFormOfTerm(word: string, termData: GlossaryTerm): boolean {
        if (word === termData.uk.toLowerCase()) return true;

        if (termData.inflections) {
            for (const form of Object.values(termData.inflections)) {
                if (word === form.toLowerCase()) return true;
            }
        }

        // Fuzzy match: check if word starts with term stem (first 4+ chars)
        const stem = termData.uk.toLowerCase().substring(0, Math.min(4, termData.uk.length));
        return word.startsWith(stem) && word.length <= termData.uk.length + 3;
    }

    /**
     * Escape special regex characters
     */
    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Get all terms for a category
     */
    getTermsByCategory(category: string): GlossaryTerm[] {
        const result: GlossaryTerm[] = [];
        for (const term of this.terms.values()) {
            if (term.category === category) {
                result.push(term);
            }
        }
        return result;
    }

    /**
     * Get glossary statistics
     */
    getStats(): { totalTerms: number; categories: string[]; cacheSize: number } {
        const categories = new Set<string>();
        for (const term of this.terms.values()) {
            categories.add(term.category);
        }

        return {
            totalTerms: this.terms.size,
            categories: Array.from(categories),
            cacheSize: this.processedCache.size
        };
    }

    /**
     * Clear the processing cache
     */
    clearCache(): void {
        this.processedCache.clear();
    }

    /**
     * Add a custom term at runtime
     */
    addTerm(term: GlossaryTerm): void {
        this.terms.set(term.term.toLowerCase(), term);
    }

    /**
     * Check if a term exists in glossary
     */
    hasTerm(term: string): boolean {
        return this.terms.has(term.toLowerCase());
    }

    /**
     * Get Ukrainian translation for a term
     */
    getTranslation(term: string): string | null {
        const termData = this.terms.get(term.toLowerCase());
        return termData ? termData.uk : null;
    }
}

// Singleton instance
export const glossaryProcessor = new GlossaryProcessor();
