// Instant "draft" translator: shown in grey while the cloud LLM produces the real translation.
// Fallback chain: Chrome on-device Translator API -> Google Cloud NMT -> in-browser Opus model.
// Never blocks the session: translateDraft() returns null instead of waiting or throwing.

import { pipeline, env, AutoModelForSeq2SeqLM, AutoTokenizer } from '@huggingface/transformers';
import { glossaryProcessor } from './glossaryProcessor';
import { debugLogger } from './debugLogger';
import { googleTranslateNMT } from './googleTranslateNMT';

// Load models from Hugging Face CDN with browser caching
env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;
env.useCustomCache = false;

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

export type DraftMethod = 'chrome' | 'nmt' | 'opus' | 'none';

class LocalTranslator {
    private translator: any = null; // Opus pipeline

    // Chrome Native Translator (Chrome 138+)
    private chromeTranslator: ChromeTranslator | null = null;
    private chromeTranslatorAvailable: boolean | null = null; // null = not checked yet
    private chromeInitPromise: Promise<boolean> | null = null; // Lock for init

    // Offline fallback: custom Opus no->uk model (56MB)
    private readonly opusModelId = 'goldcc/opus-mt-no-uk-int8';

    // BCP-47 codes
    private sourceLanguageName: string = "no";
    private targetLanguageName: string = "uk";

    private isLoading = false;
    private opusFailed = false;
    private initPromise: Promise<void> | null = null;
    private progressCallback: ((progress: number) => void) | null = null;
    private activeDevice: 'webgpu' | 'wasm' | null = null;
    private lastProgress = 0;

    // LRU cache keyed by exact input text
    private draftCache: Map<string, string> = new Map();
    private static readonly MAX_CACHE_SIZE = 200;

    // ========== CHROME TRANSLATOR API (Chrome 138+) ==========

    // Chrome's Translator.availability()/canTranslate() can hang forever when the
    // on-device translation component is missing (headless Chromium, some VMs).
    // Without a timeout the app would stay on "Downloading model 0%" with all
    // mode buttons disabled. Fall back to the local model instead.
    private static readonly CHROME_CHECK_TIMEOUT_MS = 5000;

    private withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
            promise.then(
                (v) => { clearTimeout(timer); resolve(v); },
                (e) => { clearTimeout(timer); reject(e); }
            );
        });
    }

    async checkChromeTranslator(): Promise<boolean> {
        if (this.chromeTranslatorAvailable !== null) {
            return this.chromeTranslatorAvailable;
        }

        const T = LocalTranslator.CHROME_CHECK_TIMEOUT_MS;
        try {
            if (!('Translator' in window) || !window.Translator) {
                console.log('🌐 Chrome Translator API: Not available (no Translator object)');
                this.chromeTranslatorAvailable = false;
                return false;
            }

            const pair = { sourceLanguage: this.sourceLanguageName, targetLanguage: this.targetLanguageName };

            // Chrome 141+: use availability() instead of deprecated canTranslate()
            const tr = window.Translator as any;
            if (typeof tr.availability === 'function') {
                const status = await this.withTimeout(tr.availability(pair), T, 'Translator.availability');
                console.log(`🌐 Chrome Translator: availability(${this.sourceLanguageName}→${this.targetLanguageName}) = "${status}"`);
                debugLogger.log('CHROME_CHECK', `availability(${this.sourceLanguageName}→${this.targetLanguageName}) = "${status}"`);

                if (status === 'unavailable') {
                    // Try 'nb' (Bokmål) if 'no' is unavailable
                    if (this.sourceLanguageName === 'no') {
                        const nbStatus = await this.withTimeout(tr.availability({ sourceLanguage: 'nb', targetLanguage: this.targetLanguageName }), T, 'Translator.availability(nb)');
                        console.log(`🌐 Chrome Translator: availability(nb→${this.targetLanguageName}) = "${nbStatus}"`);
                        if (nbStatus !== 'unavailable') {
                            this.sourceLanguageName = 'nb';
                            this.chromeTranslatorAvailable = true;
                            return true;
                        }
                    }
                    this.chromeTranslatorAvailable = false;
                    return false;
                }
                // "available", "downloadable", "downloading" — all mean it can work
                this.chromeTranslatorAvailable = true;
                return true;
            }

            // Fallback: legacy canTranslate() for Chrome 138-140
            if (typeof tr.canTranslate === 'function') {
                const support = await this.withTimeout(tr.canTranslate(pair), T, 'Translator.canTranslate');
                console.log(`🌐 Chrome Translator: canTranslate(${this.sourceLanguageName}→${this.targetLanguageName}) = "${support}"`);
                if (support === 'no') {
                    this.chromeTranslatorAvailable = false;
                    return false;
                }
                this.chromeTranslatorAvailable = true;
                return true;
            }

            // Neither availability() nor canTranslate() — try create() directly
            console.log('🌐 Chrome Translator: No check method, will try create() directly');
            this.chromeTranslatorAvailable = true;
            return true;
        } catch (e) {
            console.error('🌐 Chrome Translator: Check failed', e);
            this.chromeTranslatorAvailable = false;
            return false;
        }
    }

    async initChromeTranslator(): Promise<boolean> {
        if (this.chromeTranslator) return true;

        // Lock to prevent race condition
        if (this.chromeInitPromise) {
            return this.chromeInitPromise;
        }

        this.chromeInitPromise = this.doInitChromeTranslator();
        const result = await this.chromeInitPromise;
        this.chromeInitPromise = null;
        return result;
    }

    private async doInitChromeTranslator(): Promise<boolean> {
        if (!await this.checkChromeTranslator()) return false;

        const tryCreate = async (src: string, tgt: string): Promise<boolean> => {
            try {
                console.log(`🌐 Chrome Translator: Creating ${src}→${tgt}...`);
                this.chromeTranslator = await (window.Translator as any).create({
                    sourceLanguage: src,
                    targetLanguage: tgt,
                    monitor: (m: any) => {
                        m.addEventListener?.('downloadprogress', (e: any) => {
                            const progress = e.loaded ? Math.round(e.loaded * 100) : 0;
                            console.log(`🌐 Chrome Translator downloading: ${progress}%`);
                            if (this.progressCallback) this.progressCallback(progress);
                        });
                    }
                });
                this.sourceLanguageName = src;
                console.log(`🌐 Chrome Translator: Ready! (${src}→${tgt})`);
                debugLogger.log('CHROME_OK', `${src}→${tgt} ready`);
                return true;
            } catch (e: any) {
                console.error(`🌐 Chrome Translator: create(${src}→${tgt}) failed:`, e?.message || e);
                debugLogger.log('CHROME_FAIL', `create(${src}→${tgt}): ${e?.message || e}`);
                return false;
            }
        };

        // Try primary language code, then fallback to 'nb' for Norwegian
        if (await tryCreate(this.sourceLanguageName, this.targetLanguageName)) return true;
        if (this.sourceLanguageName === 'no' && await tryCreate('nb', this.targetLanguageName)) return true;

        this.chromeTranslatorAvailable = false;
        return false;
    }

    /** Destroy current translator instance (call on language change or session stop) */
    destroyChromeTranslator(): void {
        if (this.chromeTranslator) {
            try {
                (this.chromeTranslator as any).destroy?.();
            } catch { /* ignore */ }
            this.chromeTranslator = null;
        }
        this.chromeTranslatorAvailable = null;
        this.chromeInitPromise = null;
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

    /** Configure Google Cloud NMT with a direct key */
    setGoogleNMTKey(key: string): void {
        if (key) {
            googleTranslateNMT.setApiKey(key);
        }
    }

    /** Configure Google NMT proxy mode (production) */
    setGoogleNMTProxy(proxyUrl: string, authToken: string): void {
        googleTranslateNMT.setProxy(proxyUrl, authToken);
    }

    // The Opus model only handles Norwegian -> Ukrainian
    private opusSupportsPair(): boolean {
        return (this.sourceLanguageName === 'no' || this.sourceLanguageName === 'nb') && this.targetLanguageName === 'uk';
    }

    /** Safe to call repeatedly: concurrent calls share one in-flight init. */
    initialize(onProgress?: (progress: number) => void): Promise<void> {
        if (onProgress) this.progressCallback = onProgress;
        if (this.initPromise) return this.initPromise;

        this.initPromise = this.doInitialize(onProgress).finally(() => {
            this.initPromise = null;
        });
        return this.initPromise;
    }

    private async doInitialize(onProgress?: (progress: number) => void): Promise<void> {
        // Initialize Google Cloud NMT if API key available (from env var)
        const nmtKey = (import.meta as any).env?.VITE_GOOGLE_TRANSLATE_KEY || '';
        if (nmtKey) {
            googleTranslateNMT.setApiKey(nmtKey);
        }

        // Skip model download if Chrome Translator API is available
        if (await this.checkChromeTranslator()) {
            console.log('✅ Chrome Translator API available - skipping model download');
            if (onProgress) onProgress(100);
            this.progressCallback = null;
            return;
        }

        // Also skip model download if Google NMT is available
        if (googleTranslateNMT.isAvailable()) {
            console.log('✅ Google Cloud NMT available - skipping model download');
            if (onProgress) onProgress(100);
            this.progressCallback = null;
            return;
        }

        if (this.translator) {
            if (onProgress) onProgress(100);
            return;
        }

        if (!this.opusSupportsPair()) {
            console.log('⚠️ Opus model only supports Norwegian→Ukrainian - skipping download');
            return;
        }

        console.log('⚠️ Chrome Translator API and NMT not available - loading Opus fallback model');
        await this.loadOpus();
    }

    private async loadOpus(): Promise<void> {
        this.isLoading = true;
        this.opusFailed = false;
        const targetModelId = this.opusModelId;

        // Proper WebGPU detection: actually check that an adapter is available
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

        const devicesToTry: ('webgpu' | 'wasm')[] = webgpuAvailable ? ['webgpu', 'wasm'] : ['wasm'];

        for (const device of devicesToTry) {
            try {
                if (this.progressCallback) this.progressCallback(0);
                console.log(`👻 Draft Translator: Loading Opus model '${targetModelId}' (${device.toUpperCase()})...`);

                // Make sure onnxruntime-web doesn't try WebGPU when we want WASM
                const sessionOptions = device === 'wasm' ? { executionProviders: ['wasm'] } : undefined;

                const model = await AutoModelForSeq2SeqLM.from_pretrained(targetModelId, {
                    quantized: true,
                    device: device,
                    session_options: sessionOptions,
                    progress_callback: (data: any) => this.handleProgress(data),
                } as any);

                const tokenizer = await AutoTokenizer.from_pretrained(targetModelId, {
                    progress_callback: (data: any) => this.handleProgress(data),
                });

                this.translator = await pipeline('translation', targetModelId, {
                    model: model,
                    tokenizer: tokenizer,
                    device: device,
                    session_options: sessionOptions,
                    progress_callback: (data: any) => this.handleProgress(data),
                } as any);

                this.activeDevice = device;
                this.isLoading = false;
                if (this.progressCallback) this.progressCallback(100);
                this.lastProgress = 100;
                console.log(`👻 Draft Translator: Ready using ${targetModelId} (${device.toUpperCase()})`);
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

                if (isCacheCorruption) {
                    console.warn(`⚠️ Cache corruption detected, clearing cache...`);
                    await this.clearModelCache();
                    this.isLoading = false;
                    this.opusFailed = true;
                    throw new Error(`Cache corruption detected. Please refresh the page to re-download the model.`);
                }

                if (device === 'webgpu' && devicesToTry.includes('wasm') && isWebGPUError) {
                    console.warn(`⚠️ WebGPU failed, falling back to WASM...`, errorMsg);
                    continue;
                }

                console.error(`❌ FAILED to load Opus model with ${device}.`, e);
                this.isLoading = false;
                this.opusFailed = true;
                throw new Error(`Failed to load Opus model.`);
            }
        }

        this.isLoading = false;
        this.opusFailed = true;
        throw new Error(`Failed to load Opus model - no backends available.`);
    }

    // Clear model cache (Cache API + IndexedDB used by transformers.js)
    private async clearModelCache(): Promise<void> {
        try {
            if ('caches' in window) {
                const keys = await caches.keys();
                for (const key of keys) {
                    if (key.includes('transformers') || key.includes('onnx')) {
                        await caches.delete(key);
                        console.log(`🗑️ Cleared cache: ${key}`);
                    }
                }
            }

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
        if (data.status === 'download') {
            console.log(`📥 Downloading: ${data.file} (not cached)`);
        } else if (data.status === 'cached') {
            console.log(`✅ Loaded from cache: ${data.file}`);
        }

        if (data.status === 'progress') {
            this.lastProgress = Math.round(data.progress || 0);
            if (this.progressCallback) this.progressCallback(this.lastProgress);
        }
    }

    /** Language NAMES like 'Norwegian', 'Ukrainian'. */
    setLanguages(source: string, target: string): void {
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

        const newSourceLang = bcp47Map[source] || 'en';
        const newTargetLang = bcp47Map[target] || 'en';

        // Reset Chrome translator and cache if languages changed
        // ('nb' is the Chrome fallback for 'no', not a real change)
        const sourceChanged = this.sourceLanguageName !== newSourceLang &&
            !(newSourceLang === 'no' && this.sourceLanguageName === 'nb');
        if (sourceChanged || this.targetLanguageName !== newTargetLang) {
            this.destroyChromeTranslator();
            this.draftCache.clear();
            this.sourceLanguageName = newSourceLang;
        }
        this.targetLanguageName = newTargetLang;

        // Sync Google NMT languages
        googleTranslateNMT.setLanguages(source, target);
    }

    clearCache(): void {
        this.draftCache.clear();
    }

    private cacheSet(key: string, value: string) {
        this.draftCache.delete(key);
        this.draftCache.set(key, value);
        if (this.draftCache.size > LocalTranslator.MAX_CACHE_SIZE) {
            const oldest = this.draftCache.keys().next().value;
            if (oldest !== undefined) this.draftCache.delete(oldest);
        }
    }

    private startBackgroundInit() {
        if (this.initPromise || this.isLoading || this.opusFailed) return;
        this.initialize().catch((e) => {
            console.warn('👻 Draft Translator: background init failed', e?.message || e);
        });
    }

    private async translateWithOpus(text: string): Promise<string | null> {
        if (!this.translator || !this.opusSupportsPair()) return null;
        const start = performance.now();
        try {
            const output = await this.translator(text);
            const result = Array.isArray(output) ? output[0] : output;
            const out = result?.translation_text || result?.generated_text || '';
            if (!out) return null;
            debugLogger.log('OPUS_CHUNK', text.substring(0, 30), performance.now() - start, text.split(/\s+/).length);
            return out;
        } catch (e) {
            console.error('❌ [DRAFT] Opus translation error', e);
            return null;
        }
    }

    /**
     * Instant draft translation. Returns glossary-processed text from the first working
     * engine, or null (empty input, nothing ready yet, or all engines failed). Never throws.
     */
    async translateDraft(text: string): Promise<string | null> {
        try {
            if (!text || !text.trim()) return null;

            const cached = this.draftCache.get(text);
            if (cached !== undefined) {
                this.cacheSet(text, cached); // refresh LRU position
                return cached;
            }

            const words = text.split(/\s+/).length;
            let raw: string | null = null;

            // 1. Chrome on-device Translator
            if (this.chromeTranslatorAvailable !== false) {
                const t0 = performance.now();
                raw = await this.translateWithChrome(text);
                if (raw) debugLogger.log('CHROME_API', text.substring(0, 40), performance.now() - t0, words);
            }

            // 2. Google Cloud NMT
            if (!raw && googleTranslateNMT.isAvailable()) {
                const t0 = performance.now();
                raw = await googleTranslateNMT.translate(text);
                if (raw) debugLogger.log('GNMT_OK', text.substring(0, 40), performance.now() - t0, words);
            }

            // 3. In-browser Opus model
            if (!raw) {
                raw = await this.translateWithOpus(text);
            }

            if (!raw) {
                if (!this.translator) this.startBackgroundInit();
                return null;
            }

            const processed = glossaryProcessor.processTranslation(raw);
            if (!processed || !processed.trim()) return null;
            this.cacheSet(text, processed);
            return processed;
        } catch (e) {
            console.error('❌ [DRAFT] translateDraft failed', e);
            return null;
        }
    }

    /** `method` = the engine that would be used right now. */
    getStatus(): { method: DraftMethod; isReady: boolean; isLoading: boolean; progress: number } {
        let method: DraftMethod = 'none';
        if (this.chromeTranslator || this.chromeTranslatorAvailable === true) method = 'chrome';
        else if (googleTranslateNMT.isAvailable()) method = 'nmt';
        else if (this.translator && this.opusSupportsPair()) method = 'opus';

        return {
            method,
            isReady: method !== 'none',
            isLoading: this.isLoading,
            progress: method !== 'none' && !this.isLoading ? 100 : this.lastProgress,
        };
    }
}

export const localTranslator = new LocalTranslator();
