

import { pipeline, env, AutoModelForSeq2SeqLM, AutoTokenizer } from '@huggingface/transformers';

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

    // PERFORMANCE OPTIMIZATION: Chunk translation cache
    private chunkCache: Map<string, string> = new Map();
    private static readonly CHUNK_SIZE = 4;
    private static readonly MAX_CACHE_SIZE = 100;

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
        if (this.chromeTranslator) return true;

        if (!await this.checkChromeTranslator()) return false;

        try {
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
        const isQuantized = this.currentModelType === 'opus'; // Only Opus is int8 quantized in this setup

        try {
            if (this.progressCallback) this.progressCallback(0);
            console.log(`👻 Ghost Translator: Loading ${this.currentModelType.toUpperCase()} Model '${targetModelId}'...`);
            
            this.activeModelId = targetModelId;
            
            let model, tokenizer;

            if (isQuantized) {
                // EXPLICIT LOADING: Force the library to use standard filenames (e.g. encoder_model_quantized.onnx)
                // even though the model is int8. Setting quantized: true enables the "_quantized" suffix lookup.
                model = await AutoModelForSeq2SeqLM.from_pretrained(targetModelId, {
                    quantized: true, 
                    progress_callback: (data: any) => this.handleProgress(data),
                } as any);

                tokenizer = await AutoTokenizer.from_pretrained(targetModelId, {
                    progress_callback: (data: any) => this.handleProgress(data),
                });
            }

            // Init pipeline
            // If model/tokenizer are created manually (for quantized), pass them.
            // If not (for NLLB standard), pass just model ID.
            if (isQuantized && model && tokenizer) {
                 this.translator = await pipeline('translation', targetModelId, {
                    model: model,
                    tokenizer: tokenizer,
                    progress_callback: (data: any) => this.handleProgress(data),
                } as any);
            } else {
                // Standard loading (NLLB or non-quantized fallback)
                this.translator = await pipeline('translation', targetModelId, {
                    progress_callback: (data: any) => this.handleProgress(data),
                });
            }
            
            this.finishInit();
            return;

        } catch (e: any) {
            console.error(`❌ FAILED to load ${this.currentModelType} Model.`, e);
            this.isLoading = false;
            throw new Error(`Failed to load ${this.currentModelType} model.`);
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
        console.log(`👻 Ghost Translator: Ready using ${this.activeModelId}`);
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
    async translatePhraseChunked(text: string, forceFullTranslate = false): Promise<TranslatedWord[]> {
        if (!text || !text.trim()) {
            return [];
        }

        // === PRIORITY 1: Try Chrome Translator API (instant, native) ===
        const chromeResult = await this.translateWithChrome(text);
        if (chromeResult !== null) {
            return [{
                original: text,
                ghostTranslation: chromeResult,
                status: 'ghost'
            }];
        }

        // === PRIORITY 2: Fallback to Transformers.js ===
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

        for (const chunk of chunks) {
            // Check cache first
            if (!forceFullTranslate && this.chunkCache.has(chunk)) {
                translations.push(this.chunkCache.get(chunk)!);
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
            }
        }

        const fullTranslation = translations.join(' ');

        return [{
            original: text,
            ghostTranslation: fullTranslation,
            status: 'ghost'
        }];
    }

    // Full phrase translation (used for finalized blocks)
    // Priority: 1. Chrome API (instant) → 2. Transformers.js (WASM/WebGPU)
    async translatePhrase(text: string): Promise<TranslatedWord[]> {
        if (!text || !text.trim()) {
            return [];
        }

        // === PRIORITY 1: Try Chrome Translator API (instant, native) ===
        const chromeResult = await this.translateWithChrome(text);
        if (chromeResult !== null) {
            return [{
                original: text,
                ghostTranslation: chromeResult,
                status: 'ghost'
            }];
        }

        // === PRIORITY 2: Fallback to Transformers.js ===
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

            return [{
                original: text,
                ghostTranslation: translatedText,
                status: 'ghost'
            }];

        } catch (e) {
            console.error("❌ [GHOST] Translation error", e);
            return [{ original: text, ghostTranslation: "❌", status: 'ghost' }];
        }
    }

    public getStatus() {
        return {
            isLoading: this.isLoading,
            isReady: !!this.translator || !!this.chromeTranslator,
            useChromeAPI: this.chromeTranslatorAvailable === true,
            chromeChecked: this.chromeTranslatorAvailable !== null
        };
    }

    // Check if using native Chrome API (for UI display)
    public isUsingChromeAPI(): boolean {
        return this.chromeTranslatorAvailable === true;
    }
}

export const localTranslator = new LocalTranslator();