

import { pipeline, env, AutoModelForSeq2SeqLM, AutoTokenizer } from '@huggingface/transformers';
import { glossaryProcessor } from './glossaryProcessor';
import { pivotTranslator } from './pivotTranslator';
import { confidenceFilter } from './confidenceFilter';

// CRITICAL CONFIGURATION: LOAD FROM HUGGING FACE CDN WITH CACHING
env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;  // Cache models in browser (IndexedDB/Cache API)
env.useCustomCache = false;  // Use default browser caching mechanism

export interface TranslatedWord {
    original: string;
    ghostTranslation: string;
    finalTranslation?: string;
    status: 'ghost' | 'final';
}

// Chrome Translator API types (Chrome 138+)
interface ChromeTranslator {
    translate(text: string): Promise<string>;
    translateStreaming?(text: string): ReadableStream<string>;
}

interface ChromeTranslatorOptions {
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: (m: any) => void;
}

declare global {
    interface Window {
        Translator?: {
            create(options: ChromeTranslatorOptions): Promise<ChromeTranslator>;
            canTranslate?(options: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
        };
    }
}

class LocalTranslator {
    private translator: any = null;

    // Chrome Native Translator (Chrome 138+)
    private chromeTranslator: ChromeTranslator | null = null;
    private chromeTranslatorAvailable: boolean | null = null; // null = not checked yet
    private chromeInitPromise: Promise<boolean> | null = null; // Lock for init

    // PRIMARY: Use the custom OPUS model (56MB)
    private opusModelId = 'goldcc/opus-mt-no-uk-int8';

    // SECONDARY: Fallback to NLLB if Opus fails (600MB+)
    private nllbModelId = 'Xenova/nllb-200-distilled-600M';

    private activeModelId = '';
    private currentModelType: 'opus' | 'nllb' = 'opus';

    private sourceLang: string = "nob_Latn";
    private targetLang: string = "ukr_Cyrl";

    // UI language names for Chrome API
    private sourceLanguageName: string = "no"; // BCP-47 codes for Chrome
    private targetLanguageName: string = "uk";

    private isLoading = false;
    private progressCallback: ((progress: number) => void) | null = null;
    private activeDevice: 'webgpu' | 'wasm' | null = null;

    // PERFORMANCE OPTIMIZATION: Chunk translation cache
    private chunkCache: Map<string, string> = new Map();
    private static readonly CHUNK_SIZE = 2; // Reduced from 4 to 2 for faster progressive updates
    private static readonly MAX_CACHE_SIZE = 100;

    // PIVOT TRANSLATION: NO → EN → UK (better quality)
    private usePivot: boolean = true;  // Enable pivot by default
    private pivotInitialized: boolean = false;

    // CONFIDENCE FILTERING: Reject low-quality translations
    private useConfidenceFilter: boolean = true;
    private lastConfidenceScore: number = 100;

    // ========== CHROME TRANSLATOR API (Chrome 138+) ==========

    async checkChromeTranslator(): Promise<boolean> {
        if (this.chromeTranslatorAvailable !== null) {
            return this.chromeTranslatorAvailable;
        }

        try {
            if (!('Translator' in window) || !window.Translator) {
                console.log('🌐 Chrome Translator API: Not available');
                this.chromeTranslatorAvailable = false;
                return false;
            }

            // Check if translation is supported for our language pair
            if (window.Translator.canTranslate) {
                const support = await window.Translator.canTranslate({
                    sourceLanguage: this.sourceLanguageName,
                    targetLanguage: this.targetLanguageName
                });

                if (support === 'no') {
                    console.log(`🌐 Chrome Translator: Language pair ${this.sourceLanguageName}→${this.targetLanguageName} not supported`);
                    this.chromeTranslatorAvailable = false;
                    return false;
                }
            }

            console.log('🌐 Chrome Translator API: Available! Using native translation.');
            this.chromeTranslatorAvailable = true;
            return true;
        } catch (e) {
            console.log('🌐 Chrome Translator API: Check failed', e);
            this.chromeTranslatorAvailable = false;
            return false;
        }
    }

    async initChromeTranslator(): Promise<boolean> {
        // Already initialized
        if (this.chromeTranslator) return true;

        // Already initializing - wait for existing promise (prevents race condition)
        if (this.chromeInitPromise) {
            console.log('🌐 Chrome Translator: Waiting for ongoing init...');
            return this.chromeInitPromise;
        }

        // Start new initialization with lock
        this.chromeInitPromise = this.doInitChromeTranslator();
        const result = await this.chromeInitPromise;
        this.chromeInitPromise = null; // Clear lock after completion
        return result;
    }

    // Internal init method (called only once due to lock)
    private async doInitChromeTranslator(): Promise<boolean> {
        if (!await this.checkChromeTranslator()) return false;

        try {
            console.log('🌐 Chrome Translator: Initializing...');
            this.chromeTranslator = await window.Translator!.create({
                sourceLanguage: this.sourceLanguageName,
                targetLanguage: this.targetLanguageName,
                monitor: (m: any) => {
                    m.addEventListener?.('downloadprogress', (e: any) => {
                        const progress = e.loaded ? Math.round(e.loaded * 100) : 0;
                        console.log(`🌐 Chrome Translator downloading: ${progress}%`);
                        if (this.progressCallback) this.progressCallback(progress);
                    });
                }
            });
            console.log('🌐 Chrome Translator: Ready!');
            return true;
        } catch (e) {
            console.error('🌐 Chrome Translator: Init failed', e);
            this.chromeTranslatorAvailable = false;
            return false;
        }
    }

    // Pre-initialize Chrome Translator at app startup (call this early!)
    async preInitChrome(): Promise<void> {
        console.log('🌐 Chrome Translator: Pre-initializing...');
        await this.initChromeTranslator();
    }

    async translateWithChrome(text: string): Promise<string | null> {
        if (!this.chromeTranslator) {
            const ok = await this.initChromeTranslator();
            if (!ok) return null;
        }

        try {
            const result = await this.chromeTranslator!.translate(text);
            return result;
        } catch (e) {
            console.error('🌐 Chrome Translator: Translation failed', e);
            return null;
        }
    }

    async switchModel(modelType: 'opus' | 'nllb', onProgress?: (progress: number) => void) {
        if (this.currentModelType === modelType && this.translator) {
            if (onProgress) onProgress(100);
            return; 
        }

        console.log(`Swapping model to ${modelType}...`);
        this.translator = null;
        this.currentModelType = modelType;
        
        await this.initialize(onProgress);
    }

    getCurrentModelType() {
        return this.currentModelType;
    }

    async initialize(onProgress?: (progress: number) => void) {
        // OPTIMIZATION: Skip model loading if Chrome Translator API is available
        const chromeAvailable = await this.checkChromeTranslator();
        if (chromeAvailable) {
            console.log('✅ Chrome Translator API available - skipping model download');
            if (onProgress) onProgress(100);
            this.finishInit();
            return;
        }

        console.log('⚠️ Chrome Translator API not available - loading fallback model');

        if (this.translator) {
             if (onProgress) onProgress(100);
             return;
        }

        if (this.isLoading) {
             this.progressCallback = onProgress || null;
             return;
        }

        this.isLoading = true;
        this.progressCallback = onProgress || null;

        const targetModelId = this.currentModelType === 'opus' ? this.opusModelId : this.nllbModelId;
        const isQuantized = this.currentModelType === 'opus';

        // Proper WebGPU detection: Actually check if adapter is available
        let webgpuAvailable = false;
        if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
            try {
                const adapter = await (navigator as any).gpu.requestAdapter();
                webgpuAvailable = adapter !== null;
                if (!webgpuAvailable) {
                    console.log('🔍 WebGPU API present but no adapter available, using WASM');
                }
            } catch {
                console.log('🔍 WebGPU check failed, using WASM');
            }
        }

        // Only try WebGPU if adapter is actually available
        const devicesToTry: ('webgpu' | 'wasm')[] = webgpuAvailable ? ['webgpu', 'wasm'] : ['wasm'];

        for (const device of devicesToTry) {
            try {
                if (this.progressCallback) this.progressCallback(0);
                console.log(`👻 Ghost Translator: Loading ${this.currentModelType.toUpperCase()} Model '${targetModelId}' (${device.toUpperCase()})...`);

                this.activeModelId = targetModelId;

                // Configure ONNX session options based on device
                // This ensures onnxruntime-web doesn't try WebGPU when we want WASM
                const sessionOptions = device === 'wasm' ? {
                    executionProviders: ['wasm'],
                } : undefined;

                let model, tokenizer;

                if (isQuantized) {
                    model = await AutoModelForSeq2SeqLM.from_pretrained(targetModelId, {
                        quantized: true,
                        device: device,
                        session_options: sessionOptions,
                        progress_callback: (data: any) => this.handleProgress(data),
                    } as any);

                    tokenizer = await AutoTokenizer.from_pretrained(targetModelId, {
                        progress_callback: (data: any) => this.handleProgress(data),
                    });
                }

                if (isQuantized && model && tokenizer) {
                     this.translator = await pipeline('translation', targetModelId, {
                        model: model,
                        tokenizer: tokenizer,
                        device: device,
                        session_options: sessionOptions,
                        progress_callback: (data: any) => this.handleProgress(data),
                    } as any);
                } else {
                    // Standard loading (NLLB)
                    this.translator = await pipeline('translation', targetModelId, {
                        device: device,
                        session_options: sessionOptions,
                        progress_callback: (data: any) => this.handleProgress(data),
                    });
                }

                this.activeDevice = device;
                this.finishInit();
                return;

            } catch (e: any) {
                const errorMsg = e?.message || String(e);
                const errorCode = String(e?.code || e);

                const isWebGPUError = errorMsg.includes('webgpu') ||
                                      errorMsg.includes('GPU') ||
                                      errorMsg.includes('adapter') ||
                                      errorMsg.includes('backend') ||
                                      errorCode.includes('3762476112'); // Known ONNX WebGPU error

                const isCacheCorruption = errorMsg.includes('Corruption') ||
                                          errorMsg.includes('checksum') ||
                                          errorMsg.includes('corrupted');

                // If cache corruption detected, try clearing cache and retry once
                if (isCacheCorruption) {
                    console.warn(`⚠️ Cache corruption detected, clearing cache...`);
                    await this.clearModelCache();
                    // Don't retry automatically - let user trigger reload
                    this.isLoading = false;
                    throw new Error(`Cache corruption detected. Please refresh the page to re-download the model.`);
                }

                // If WebGPU failed and we have WASM fallback, try it
                if (device === 'webgpu' && devicesToTry.includes('wasm') && isWebGPUError) {
                    console.warn(`⚠️ WebGPU failed, falling back to WASM...`, errorMsg);
                    continue; // Try WASM
                }

                // If WASM also failed or it's a different error, throw
                console.error(`❌ FAILED to load ${this.currentModelType} Model with ${device}.`, e);
                this.isLoading = false;
                throw new Error(`Failed to load ${this.currentModelType} model.`);
            }
        }

        // Should not reach here, but just in case
        this.isLoading = false;
        throw new Error(`Failed to load ${this.currentModelType} model - no backends available.`);
    }

    // Clear model cache (IndexedDB for transformers.js)
    private async clearModelCache(): Promise<void> {
        try {
            // Clear Cache API
            if ('caches' in window) {
                const keys = await caches.keys();
                for (const key of keys) {
                    if (key.includes('transformers') || key.includes('onnx')) {
                        await caches.delete(key);
                        console.log(`🗑️ Cleared cache: ${key}`);
                    }
                }
            }

            // Clear IndexedDB for transformers
            const databases = await indexedDB.databases?.() || [];
            for (const db of databases) {
                if (db.name && (db.name.includes('transformers') || db.name.includes('onnx'))) {
                    indexedDB.deleteDatabase(db.name);
                    console.log(`🗑️ Cleared IndexedDB: ${db.name}`);
                }
            }

            console.log('✅ Model cache cleared');
        } catch (e) {
            console.error('Failed to clear cache:', e);
        }
    }

    private handleProgress(data: any) {
        // Log cache status
        if (data.status === 'download') {
            console.log(`📥 Downloading: ${data.file} (not cached)`);
        } else if (data.status === 'cached') {
            console.log(`✅ Loaded from cache: ${data.file}`);
        }

        if (data.status === 'progress' && this.progressCallback) {
            const prog = data.progress || 0;
            this.progressCallback(Math.round(prog));
        }
    }

    private finishInit() {
        this.isLoading = false;
        if (this.progressCallback) this.progressCallback(100);
        console.log(`👻 Ghost Translator: Ready using ${this.activeModelId} (${this.activeDevice?.toUpperCase() || 'unknown'})`);
    }

    // Convert UI language names to Model Codes
    setLanguages(source: string, target: string) {
        // Map common names to NLLB codes (Flores-200 format)
        const codeMap: Record<string, string> = {
            'Norwegian': 'nob_Latn',
            'Ukrainian': 'ukr_Cyrl',
            'English': 'eng_Latn',
            'German': 'deu_Latn',
            'Spanish': 'spa_Latn',
            'French': 'fra_Latn',
            'Russian': 'rus_Cyrl',
            'Polish': 'pol_Latn'
        };

        // BCP-47 codes for Chrome Translator API
        const bcp47Map: Record<string, string> = {
            'Norwegian': 'no',
            'Ukrainian': 'uk',
            'English': 'en',
            'German': 'de',
            'Spanish': 'es',
            'French': 'fr',
            'Russian': 'ru',
            'Polish': 'pl'
        };

        this.sourceLang = codeMap[source] || 'eng_Latn';
        this.targetLang = codeMap[target] || 'eng_Latn';

        // Set BCP-47 codes for Chrome API
        const newSourceLang = bcp47Map[source] || 'en';
        const newTargetLang = bcp47Map[target] || 'en';

        // Reset Chrome translator if languages changed
        if (this.sourceLanguageName !== newSourceLang || this.targetLanguageName !== newTargetLang) {
            this.chromeTranslator = null;
            this.chromeTranslatorAvailable = null; // Re-check availability
            this.chromeInitPromise = null; // Reset init lock
        }

        this.sourceLanguageName = newSourceLang;
        this.targetLanguageName = newTargetLang;
    }

    // Split text into chunks of CHUNK_SIZE words
    private splitIntoChunks(text: string): string[] {
        const words = text.trim().split(/\s+/);
        const chunks: string[] = [];
        for (let i = 0; i < words.length; i += LocalTranslator.CHUNK_SIZE) {
            chunks.push(words.slice(i, i + LocalTranslator.CHUNK_SIZE).join(' '));
        }
        return chunks;
    }

    // Translate a single chunk (internal, no caching logic)
    private async translateSingleChunk(chunk: string): Promise<string> {
        if (!chunk.trim()) return '';

        try {
            let output;
            if (this.activeModelId.includes('nllb')) {
                output = await this.translator(chunk, {
                    src_lang: this.sourceLang,
                    tgt_lang: this.targetLang
                });
            } else {
                output = await this.translator(chunk);
            }

            const result = Array.isArray(output) ? output[0] : output;
            return result?.translation_text || result?.generated_text || "⚠️";
        } catch (e) {
            console.error("❌ [GHOST] Chunk translation error", e);
            return "❌";
        }
    }

    // Clear cache (call when switching languages or models)
    clearCache() {
        this.chunkCache.clear();
    }

    // OPTIMIZED: Translate phrase using chunked approach with caching
    // Priority: 1. Chrome API (instant) → 2. Transformers.js (WASM/WebGPU)
    // onProgress callback: Called after each chunk with partial translation
    async translatePhraseChunked(
        text: string,
        forceFullTranslate = false,
        onProgress?: (partialTranslation: string) => void
    ): Promise<TranslatedWord[]> {
        if (!text || !text.trim()) {
            return [];
        }

        // === PRIORITY 1: Try Chrome Translator API (instant, native) ===
        const chromeResult = await this.translateWithChrome(text);
        if (chromeResult !== null) {
            // POST-PROCESSING: Apply IT glossary
            const processedResult = glossaryProcessor.processTranslation(chromeResult);
            if (onProgress) onProgress(processedResult);
            return [{
                original: text,
                ghostTranslation: processedResult,
                status: 'ghost'
            }];
        }

        // === PRIORITY 2: Try Pivot Translation (NO → EN → UK) ===
        if (this.usePivot && this.sourceLanguageName === 'no' && this.targetLanguageName === 'uk') {
            try {
                // Initialize pivot if not done yet
                if (!this.pivotInitialized) {
                    console.log('🔄 [Pivot] Pre-initializing pivot translator...');
                    pivotTranslator.initialize().then(() => {
                        this.pivotInitialized = true;
                    }).catch(e => {
                        console.warn('⚠️ [Pivot] Init failed, will use direct:', e);
                    });
                }

                // Use pivot if ready
                if (pivotTranslator.isReady()) {
                    const pivotResult = await pivotTranslator.translate(text);
                    const processedResult = glossaryProcessor.processTranslation(pivotResult.ukrainianText);
                    if (onProgress) onProgress(processedResult);
                    return [{
                        original: text,
                        ghostTranslation: processedResult,
                        status: 'ghost'
                    }];
                }
            } catch (e) {
                console.warn('⚠️ [Pivot] Translation failed, falling back to direct:', e);
                // Continue to direct translation
            }
        }

        // === PRIORITY 3: Fallback to Direct Transformers.js ===
        if (!this.translator) {
            if (!this.isLoading) this.initialize();
            return [{
                original: text,
                ghostTranslation: "⏳...",
                status: 'ghost'
            }];
        }

        const chunks = this.splitIntoChunks(text);
        const translations: string[] = [];

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];

            // Check cache first
            if (!forceFullTranslate && this.chunkCache.has(chunk)) {
                translations.push(this.chunkCache.get(chunk)!);

                // PROGRESSIVE UPDATE: Show cached chunks immediately
                if (onProgress) {
                    const partialTranslation = translations.join(' ');
                    onProgress(partialTranslation);
                }
            } else {
                // Translate and cache
                const translated = await this.translateSingleChunk(chunk);
                this.chunkCache.set(chunk, translated);

                // Limit cache size
                if (this.chunkCache.size > LocalTranslator.MAX_CACHE_SIZE) {
                    const firstKey = this.chunkCache.keys().next().value;
                    if (firstKey) this.chunkCache.delete(firstKey);
                }

                translations.push(translated);

                // PROGRESSIVE UPDATE: Call onProgress after EACH translated chunk
                if (onProgress) {
                    const partialTranslation = translations.join(' ');
                    onProgress(partialTranslation);
                }
            }
        }

        const fullTranslation = translations.join(' ');

        // POST-PROCESSING: Apply IT glossary for correct terminology
        const processedTranslation = glossaryProcessor.processTranslation(fullTranslation);

        return [{
            original: text,
            ghostTranslation: processedTranslation,
            status: 'ghost'
        }];
    }

    // Full phrase translation (used for finalized blocks)
    // Priority: 1. Chrome API (instant) → 2. Pivot (NO→EN→UK) → 3. Direct Transformers.js
    async translatePhrase(text: string): Promise<TranslatedWord[]> {
        if (!text || !text.trim()) {
            return [];
        }

        // === PRIORITY 1: Try Chrome Translator API (instant, native) ===
        const chromeResult = await this.translateWithChrome(text);
        if (chromeResult !== null) {
            // POST-PROCESSING: Apply IT glossary + confidence filter
            const processedResult = glossaryProcessor.processTranslation(chromeResult);
            const filteredResult = this.applyConfidenceFilter(text, processedResult);
            return [{
                original: text,
                ghostTranslation: filteredResult,
                status: 'ghost'
            }];
        }

        // === PRIORITY 2: Try Pivot Translation (NO → EN → UK) ===
        if (this.usePivot && this.sourceLanguageName === 'no' && this.targetLanguageName === 'uk') {
            try {
                if (pivotTranslator.isReady()) {
                    const pivotResult = await pivotTranslator.translate(text);
                    // POST-PROCESSING: Apply IT glossary + confidence filter
                    const processedResult = glossaryProcessor.processTranslation(pivotResult.ukrainianText);
                    const filteredResult = this.applyConfidenceFilter(text, processedResult);
                    return [{
                        original: text,
                        ghostTranslation: filteredResult,
                        status: 'ghost'
                    }];
                }
            } catch (e) {
                console.warn('⚠️ [Pivot] Translation failed in translatePhrase:', e);
                // Continue to direct translation
            }
        }

        // === PRIORITY 3: Fallback to Direct Transformers.js ===
        if (!this.translator) {
             if (!this.isLoading) this.initialize();
             return [{
                 original: text,
                 ghostTranslation: "⏳...",
                 status: 'ghost'
             }];
        }

        try {
            let output;

            if (this.activeModelId.includes('nllb')) {
                 output = await this.translator(text, {
                    src_lang: this.sourceLang,
                    tgt_lang: this.targetLang
                });
            } else {
                output = await this.translator(text);
            }

            const result = Array.isArray(output) ? output[0] : output;
            let translatedText = result?.translation_text || result?.generated_text || "";

            if (!translatedText) translatedText = "⚠️";

            // POST-PROCESSING: Apply IT glossary + confidence filter
            const processedText = glossaryProcessor.processTranslation(translatedText);
            const filteredText = this.applyConfidenceFilter(text, processedText);

            return [{
                original: text,
                ghostTranslation: filteredText,
                status: 'ghost'
            }];

        } catch (e) {
            console.error("❌ [GHOST] Translation error", e);
            return [{ original: text, ghostTranslation: "❌", status: 'ghost' }];
        }
    }

    public getStatus() {
        const pivotStatus = pivotTranslator.getStatus();
        return {
            isLoading: this.isLoading,
            isReady: !!this.translator || !!this.chromeTranslator || pivotTranslator.isReady(),
            useChromeAPI: this.chromeTranslatorAvailable === true,
            chromeChecked: this.chromeTranslatorAvailable !== null,
            device: this.activeDevice, // 'webgpu' | 'wasm' | null
            modelType: this.currentModelType,
            // Pivot status
            usePivot: this.usePivot,
            pivotReady: pivotTranslator.isReady(),
            pivotNoToEnReady: pivotStatus.noToEnReady,
            pivotEnToUkReady: pivotStatus.enToUkReady,
            // Confidence status
            useConfidenceFilter: this.useConfidenceFilter,
            lastConfidenceScore: this.lastConfidenceScore
        };
    }

    /**
     * Apply confidence filter to translation result
     * Returns filtered text and updates lastConfidenceScore
     */
    private applyConfidenceFilter(original: string, translation: string): string {
        if (!this.useConfidenceFilter) {
            return translation;
        }

        const result = confidenceFilter.calculate(original, translation);
        this.lastConfidenceScore = result.confidence;

        if (!result.isAcceptable) {
            console.log(`⚠️ [Confidence] Low quality (${result.confidence}%): ${result.reasons.join(', ')}`);
            // Return translation anyway but log warning
            // In future, could show visual indicator or retry
        }

        return translation;
    }

    /**
     * Get last confidence score
     */
    public getLastConfidenceScore(): number {
        return this.lastConfidenceScore;
    }

    /**
     * Enable or disable confidence filtering
     */
    public setConfidenceFilterEnabled(enabled: boolean): void {
        this.useConfidenceFilter = enabled;
        console.log(`📊 [Confidence] Filter ${enabled ? 'Enabled' : 'Disabled'}`);
    }

    // Check if using native Chrome API (for UI display)
    public isUsingChromeAPI(): boolean {
        return this.chromeTranslatorAvailable === true;
    }

    // ========== PIVOT CONTROL ==========

    /**
     * Enable or disable pivot translation
     */
    public setPivotEnabled(enabled: boolean): void {
        this.usePivot = enabled;
        console.log(`🔄 [Pivot] ${enabled ? 'Enabled' : 'Disabled'}`);
    }

    /**
     * Check if pivot is enabled
     */
    public isPivotEnabled(): boolean {
        return this.usePivot;
    }

    /**
     * Check if pivot is ready to use
     */
    public isPivotReady(): boolean {
        return pivotTranslator.isReady();
    }

    /**
     * Initialize pivot translator
     */
    public async initPivot(onProgress?: (stage: string, progress: number) => void): Promise<boolean> {
        const result = await pivotTranslator.initialize(onProgress);
        this.pivotInitialized = result;
        return result;
    }

    // ========== CONTEXT-AWARE TRANSLATION (NEW) ==========

    /**
     * Translate new words with context from previous text.
     * This produces better translations by understanding the sentence structure.
     *
     * @param newWords - New words to translate
     * @param context - Previous words for context (last 30-50 words)
     * @returns Translation of ONLY the new words
     */
    async translateWithContext(newWords: string, context: string): Promise<string> {
        if (!newWords.trim()) return '';

        // Strategy:
        // 1. Translate context + newWords together
        // 2. Translate context alone
        // 3. Return the difference (translation of newWords with context)

        // For Chrome API: Simple approach - translate full, cache context translation
        const chromeAvailable = await this.checkChromeTranslator();
        if (chromeAvailable && this.chromeTranslator) {
            try {
                // If no context, just translate new words
                if (!context.trim()) {
                    const result = await this.chromeTranslator.translate(newWords);
                    return result;
                }

                // Translate full text (context + new)
                const fullText = `${context} ${newWords}`.trim();
                const fullTranslation = await this.chromeTranslator.translate(fullText);

                // Get cached context translation or translate it
                const contextCacheKey = `ctx:${context}`;
                let contextTranslation = this.chunkCache.get(contextCacheKey);

                if (!contextTranslation) {
                    contextTranslation = await this.chromeTranslator.translate(context);
                    this.chunkCache.set(contextCacheKey, contextTranslation);

                    // Limit cache size
                    if (this.chunkCache.size > LocalTranslator.MAX_CACHE_SIZE) {
                        const firstKey = this.chunkCache.keys().next().value;
                        if (firstKey) this.chunkCache.delete(firstKey);
                    }
                }

                // Extract only the new part
                // This is approximate - we remove the context translation from full
                if (fullTranslation.startsWith(contextTranslation)) {
                    return fullTranslation.slice(contextTranslation.length).trim();
                }

                // Fallback: estimate based on word ratio
                const contextWordCount = context.split(/\s+/).length;
                const fullWordCount = fullText.split(/\s+/).length;
                const translationWords = fullTranslation.split(/\s+/);
                const estimatedNewStart = Math.round((contextWordCount / fullWordCount) * translationWords.length);
                return translationWords.slice(estimatedNewStart).join(' ');

            } catch (e) {
                console.error('Context-aware Chrome translation failed:', e);
                // Fallback to simple translation
                const result = await this.translateWithChrome(newWords);
                return result || newWords;
            }
        }

        // For Transformers.js - similar approach but with caching
        if (!this.translator) {
            if (!this.isLoading) this.initialize();
            return '⏳...';
        }

        try {
            if (!context.trim()) {
                const words = await this.translatePhrase(newWords);
                return words[0]?.ghostTranslation || newWords;
            }

            const fullText = `${context} ${newWords}`.trim();

            // Translate full text
            let fullOutput;
            if (this.activeModelId.includes('nllb')) {
                fullOutput = await this.translator(fullText, {
                    src_lang: this.sourceLang,
                    tgt_lang: this.targetLang
                });
            } else {
                fullOutput = await this.translator(fullText);
            }

            const fullResult = Array.isArray(fullOutput) ? fullOutput[0] : fullOutput;
            const fullTranslation = fullResult?.translation_text || fullResult?.generated_text || '';

            // Get or compute context translation
            const contextCacheKey = `ctx:${context}`;
            let contextTranslation = this.chunkCache.get(contextCacheKey);

            if (!contextTranslation) {
                let contextOutput;
                if (this.activeModelId.includes('nllb')) {
                    contextOutput = await this.translator(context, {
                        src_lang: this.sourceLang,
                        tgt_lang: this.targetLang
                    });
                } else {
                    contextOutput = await this.translator(context);
                }
                const contextResult = Array.isArray(contextOutput) ? contextOutput[0] : contextOutput;
                contextTranslation = contextResult?.translation_text || contextResult?.generated_text || '';
                this.chunkCache.set(contextCacheKey, contextTranslation);
            }

            // Extract new part
            if (fullTranslation.startsWith(contextTranslation)) {
                return fullTranslation.slice(contextTranslation.length).trim();
            }

            // Fallback estimation
            const contextWordCount = context.split(/\s+/).length;
            const fullWordCount = fullText.split(/\s+/).length;
            const translationWords = fullTranslation.split(/\s+/);
            const estimatedNewStart = Math.round((contextWordCount / fullWordCount) * translationWords.length);
            return translationWords.slice(estimatedNewStart).join(' ');

        } catch (e) {
            console.error('Context-aware Transformers translation failed:', e);
            const words = await this.translatePhrase(newWords);
            return words[0]?.ghostTranslation || newWords;
        }
    }

    /**
     * Translate full accumulated text incrementally.
     * Returns both the full translation and what's new since last call.
     *
     * @param fullText - Complete accumulated text
     * @param previousTranslation - Previous translation (to compute diff)
     * @returns { full: string, newPart: string }
     */
    async translateAccumulated(fullText: string, previousTranslation: string): Promise<{ full: string; newPart: string }> {
        if (!fullText.trim()) {
            return { full: '', newPart: '' };
        }

        const chromeAvailable = await this.checkChromeTranslator();
        if (chromeAvailable && this.chromeTranslator) {
            try {
                const fullTranslation = await this.chromeTranslator.translate(fullText);

                // Compute new part by removing previous
                let newPart = fullTranslation;
                if (previousTranslation && fullTranslation.startsWith(previousTranslation)) {
                    newPart = fullTranslation.slice(previousTranslation.length).trim();
                } else if (previousTranslation) {
                    // Estimate based on length ratio
                    const prevLen = previousTranslation.length;
                    newPart = fullTranslation.slice(prevLen).trim();
                }

                return { full: fullTranslation, newPart };
            } catch (e) {
                console.error('Accumulated Chrome translation failed:', e);
                return { full: previousTranslation, newPart: '' };
            }
        }

        // Transformers.js fallback
        const words = await this.translatePhrase(fullText);
        const fullTranslation = words.map(w => w.ghostTranslation).join(' ');

        let newPart = fullTranslation;
        if (previousTranslation && fullTranslation.length > previousTranslation.length) {
            newPart = fullTranslation.slice(previousTranslation.length).trim();
        }

        return { full: fullTranslation, newPart };
    }
}

export const localTranslator = new LocalTranslator();