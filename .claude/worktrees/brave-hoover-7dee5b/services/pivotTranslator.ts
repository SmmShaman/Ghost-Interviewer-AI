/**
 * PIVOT TRANSLATOR SERVICE
 *
 * Двоетапний переклад NO → EN → UK для кращої якості.
 *
 * АРХІТЕКТУРА:
 * ┌─────────┐    ┌─────────┐    ┌─────────┐
 * │ NO text │ -> │ EN text │ -> │ UK text │
 * └─────────┘    └─────────┘    └─────────┘
 *       NLLB         opus-mt-en-uk
 *
 * ПЕРЕВАГИ:
 * - Краща якість через англійську (більше training data)
 * - EN→UK моделі краще ніж NO→UK
 * - Можливість кешування EN проміжного результату
 *
 * FALLBACK:
 * - Якщо pivot не працює → використовує direct NO→UK
 */

import { pipeline, env } from '@huggingface/transformers';

// Configure for browser caching
env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;

interface PivotResult {
    originalText: string;
    englishText: string;      // Intermediate EN translation
    ukrainianText: string;    // Final UK translation
    method: 'pivot' | 'direct' | 'fallback';
    timings?: {
        noToEn: number;
        enToUk: number;
        total: number;
    };
}

class PivotTranslator {
    // Step 1: NO → EN using NLLB (multilingual)
    private noToEnPipeline: any = null;
    private noToEnModelId = 'Xenova/nllb-200-distilled-600M';

    // Step 2: EN → UK using dedicated opus model
    private enToUkPipeline: any = null;
    private enToUkModelId = 'Xenova/opus-mt-en-uk';

    // Loading state
    private isLoadingNoToEn = false;
    private isLoadingEnToUk = false;
    private initPromise: Promise<void> | null = null;

    // Cache for intermediate EN translations
    private enCache: Map<string, string> = new Map();
    private static readonly MAX_CACHE_SIZE = 200;

    // Progress callback
    private progressCallback: ((stage: string, progress: number) => void) | null = null;

    /**
     * Initialize both translation pipelines
     */
    async initialize(onProgress?: (stage: string, progress: number) => void): Promise<boolean> {
        // Prevent multiple simultaneous initializations
        if (this.initPromise) {
            await this.initPromise;
            return this.isReady();
        }

        this.progressCallback = onProgress || null;

        this.initPromise = this.doInitialize();
        await this.initPromise;
        this.initPromise = null;

        return this.isReady();
    }

    private async doInitialize(): Promise<void> {
        const results = await Promise.allSettled([
            this.initNoToEn(),
            this.initEnToUk()
        ]);

        // Log results
        if (results[0].status === 'fulfilled') {
            console.log('✅ [Pivot] NO→EN pipeline ready');
        } else {
            console.error('❌ [Pivot] NO→EN pipeline failed:', results[0].reason);
        }

        if (results[1].status === 'fulfilled') {
            console.log('✅ [Pivot] EN→UK pipeline ready');
        } else {
            console.error('❌ [Pivot] EN→UK pipeline failed:', results[1].reason);
        }
    }

    /**
     * Initialize NO → EN pipeline (NLLB)
     */
    private async initNoToEn(): Promise<void> {
        if (this.noToEnPipeline || this.isLoadingNoToEn) return;

        this.isLoadingNoToEn = true;

        try {
            console.log('📥 [Pivot] Loading NO→EN model (NLLB)...');

            this.noToEnPipeline = await pipeline('translation', this.noToEnModelId, {
                progress_callback: (data: any) => {
                    if (data.status === 'progress' && this.progressCallback) {
                        this.progressCallback('NO→EN', data.progress || 0);
                    }
                }
            });

            console.log('✅ [Pivot] NO→EN model loaded');
        } catch (e) {
            console.error('❌ [Pivot] Failed to load NO→EN model:', e);
            throw e;
        } finally {
            this.isLoadingNoToEn = false;
        }
    }

    /**
     * Initialize EN → UK pipeline (Opus)
     */
    private async initEnToUk(): Promise<void> {
        if (this.enToUkPipeline || this.isLoadingEnToUk) return;

        this.isLoadingEnToUk = true;

        try {
            console.log('📥 [Pivot] Loading EN→UK model (Opus)...');

            this.enToUkPipeline = await pipeline('translation', this.enToUkModelId, {
                progress_callback: (data: any) => {
                    if (data.status === 'progress' && this.progressCallback) {
                        this.progressCallback('EN→UK', data.progress || 0);
                    }
                }
            });

            console.log('✅ [Pivot] EN→UK model loaded');
        } catch (e) {
            console.error('❌ [Pivot] Failed to load EN→UK model:', e);
            throw e;
        } finally {
            this.isLoadingEnToUk = false;
        }
    }

    /**
     * Check if pivot translation is ready
     */
    isReady(): boolean {
        return this.noToEnPipeline !== null && this.enToUkPipeline !== null;
    }

    /**
     * Check if partially ready (at least one pipeline)
     */
    isPartiallyReady(): boolean {
        return this.noToEnPipeline !== null || this.enToUkPipeline !== null;
    }

    /**
     * Get loading status
     */
    getStatus(): {
        noToEnReady: boolean;
        enToUkReady: boolean;
        isLoading: boolean;
        cacheSize: number;
    } {
        return {
            noToEnReady: this.noToEnPipeline !== null,
            enToUkReady: this.enToUkPipeline !== null,
            isLoading: this.isLoadingNoToEn || this.isLoadingEnToUk,
            cacheSize: this.enCache.size
        };
    }

    /**
     * Translate Norwegian text to English (Step 1)
     */
    async translateNoToEn(text: string): Promise<string> {
        if (!text.trim()) return '';

        // Check cache first
        const cacheKey = `no:${text}`;
        if (this.enCache.has(cacheKey)) {
            return this.enCache.get(cacheKey)!;
        }

        if (!this.noToEnPipeline) {
            throw new Error('NO→EN pipeline not initialized');
        }

        try {
            // NLLB requires language codes
            const output = await this.noToEnPipeline(text, {
                src_lang: 'nob_Latn',  // Norwegian Bokmål
                tgt_lang: 'eng_Latn'   // English
            });

            const result = Array.isArray(output) ? output[0] : output;
            const translation = result?.translation_text || '';

            // Cache result
            this.cacheEnglish(cacheKey, translation);

            return translation;
        } catch (e) {
            console.error('❌ [Pivot] NO→EN translation failed:', e);
            throw e;
        }
    }

    /**
     * Translate English text to Ukrainian (Step 2)
     */
    async translateEnToUk(text: string): Promise<string> {
        if (!text.trim()) return '';

        if (!this.enToUkPipeline) {
            throw new Error('EN→UK pipeline not initialized');
        }

        try {
            // Opus models don't need language codes (dedicated model)
            const output = await this.enToUkPipeline(text);

            const result = Array.isArray(output) ? output[0] : output;
            return result?.translation_text || '';
        } catch (e) {
            console.error('❌ [Pivot] EN→UK translation failed:', e);
            throw e;
        }
    }

    /**
     * Full pivot translation: NO → EN → UK
     */
    async translate(norwegianText: string): Promise<PivotResult> {
        const startTime = performance.now();

        if (!norwegianText.trim()) {
            return {
                originalText: norwegianText,
                englishText: '',
                ukrainianText: '',
                method: 'pivot'
            };
        }

        // Check if ready
        if (!this.isReady()) {
            // Try to initialize
            if (!this.initPromise) {
                console.log('⏳ [Pivot] Not ready, initializing...');
                await this.initialize();
            } else {
                await this.initPromise;
            }

            if (!this.isReady()) {
                throw new Error('Pivot translator not ready');
            }
        }

        try {
            // Step 1: NO → EN
            const step1Start = performance.now();
            const englishText = await this.translateNoToEn(norwegianText);
            const step1Time = performance.now() - step1Start;

            // Step 2: EN → UK
            const step2Start = performance.now();
            const ukrainianText = await this.translateEnToUk(englishText);
            const step2Time = performance.now() - step2Start;

            const totalTime = performance.now() - startTime;

            console.log(`🔄 [Pivot] "${norwegianText.substring(0, 30)}..." → EN (${step1Time.toFixed(0)}ms) → UK (${step2Time.toFixed(0)}ms) = ${totalTime.toFixed(0)}ms total`);

            return {
                originalText: norwegianText,
                englishText,
                ukrainianText,
                method: 'pivot',
                timings: {
                    noToEn: step1Time,
                    enToUk: step2Time,
                    total: totalTime
                }
            };
        } catch (e) {
            console.error('❌ [Pivot] Translation failed:', e);
            throw e;
        }
    }

    /**
     * Translate with fallback to direct method
     */
    async translateWithFallback(
        norwegianText: string,
        directTranslateFn: (text: string) => Promise<string>
    ): Promise<PivotResult> {
        try {
            // Try pivot first
            if (this.isReady()) {
                return await this.translate(norwegianText);
            }

            // Pivot not ready - use direct
            console.log('⚠️ [Pivot] Not ready, using direct translation');
            const ukrainianText = await directTranslateFn(norwegianText);

            return {
                originalText: norwegianText,
                englishText: '', // Not available in direct mode
                ukrainianText,
                method: 'direct'
            };
        } catch (e) {
            // Pivot failed - fallback to direct
            console.warn('⚠️ [Pivot] Failed, falling back to direct:', e);

            try {
                const ukrainianText = await directTranslateFn(norwegianText);
                return {
                    originalText: norwegianText,
                    englishText: '',
                    ukrainianText,
                    method: 'fallback'
                };
            } catch (fallbackError) {
                console.error('❌ [Pivot] Fallback also failed:', fallbackError);
                throw fallbackError;
            }
        }
    }

    /**
     * Cache English translation
     */
    private cacheEnglish(key: string, value: string): void {
        // Limit cache size
        if (this.enCache.size >= PivotTranslator.MAX_CACHE_SIZE) {
            const firstKey = this.enCache.keys().next().value;
            if (firstKey) this.enCache.delete(firstKey);
        }

        this.enCache.set(key, value);
    }

    /**
     * Clear caches
     */
    clearCache(): void {
        this.enCache.clear();
    }

    /**
     * Get cached English translation (for debugging/display)
     */
    getCachedEnglish(norwegianText: string): string | null {
        return this.enCache.get(`no:${norwegianText}`) || null;
    }
}

// Singleton instance
export const pivotTranslator = new PivotTranslator();
