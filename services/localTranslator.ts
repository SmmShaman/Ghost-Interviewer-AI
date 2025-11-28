

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

class LocalTranslator {
    private translator: any = null;
    
    // PRIMARY: Use the custom OPUS model (56MB)
    // NOTE: This model now uses quantized weights (encoder_model_quantized.onnx)
    private opusModelId = 'goldcc/opus-mt-no-uk-int8';
    
    // SECONDARY: Fallback to NLLB if Opus fails (600MB+)
    private nllbModelId = 'Xenova/nllb-200-distilled-600M';
    
    private activeModelId = '';
    
    private currentModelType: 'opus' | 'nllb' = 'opus';

    private sourceLang: string = "nob_Latn"; 
    private targetLang: string = "ukr_Cyrl"; 
    
    private isLoading = false;
    private progressCallback: ((progress: number) => void) | null = null;

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
        // Opus models handle this implicitly usually, but we keep state for NLLB fallback
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

        this.sourceLang = codeMap[source] || 'eng_Latn';
        this.targetLang = codeMap[target] || 'eng_Latn';
    }

    async translatePhrase(text: string): Promise<TranslatedWord[]> {
        // Removed heavy console logging for performance
    
        if (!text || !text.trim()) {
            return [];
        }

        // If not loaded yet, show loading indicator
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
            
            // Handle differences between NLLB and Opus arguments
            if (this.activeModelId.includes('nllb')) {
                 output = await this.translator(text, {
                    src_lang: this.sourceLang,
                    tgt_lang: this.targetLang
                });
            } else {
                // Opus models usually auto-detect or don't need lang args if mono-directional
                output = await this.translator(text);
            }
            
            // Parse output (Handling different formats: array of objects or single object)
            const result = Array.isArray(output) ? output[0] : output;
            let translatedText = result?.translation_text || result?.generated_text || "";

            // If empty, fallback to error indicator
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
        return { isLoading: this.isLoading, isReady: !!this.translator };
    }
}

export const localTranslator = new LocalTranslator();