/**
 * GOOGLE CLOUD TRANSLATION NMT SERVICE
 *
 * Dedicated Neural Machine Translation — NOT LLM-based.
 * 50-200ms latency for a sentence, significantly faster than any LLM.
 *
 * API: Google Cloud Translation v2 (Basic)
 * Endpoint: https://translation.googleapis.com/language/translate/v2
 * Free tier: 500,000 characters/month
 *
 * Used as Level 2 in the translation pipeline:
 *   Level 1: Chrome Translator API (0-50ms, on-device)
 *   Level 2: Google Cloud NMT (50-200ms, cloud)     ← THIS
 *   Level 3: Opus WASM model (300-2000ms, on-device fallback)
 */

import { debugLogger } from './debugLogger';

// BCP-47 language codes for Google Cloud Translation
const LANG_MAP: Record<string, string> = {
    'Norwegian': 'no',
    'Ukrainian': 'uk',
    'English': 'en',
    'German': 'de',
    'Spanish': 'es',
    'French': 'fr',
    'Russian': 'ru',
    'Polish': 'pl',
};

class GoogleTranslateNMT {
    private apiKey: string = '';
    private sourceLang: string = 'no';
    private targetLang: string = 'uk';
    private available: boolean = false;

    private static readonly ENDPOINT = 'https://translation.googleapis.com/language/translate/v2';

    /** Set API key (from env var or UI input) */
    setApiKey(key: string): void {
        this.apiKey = key.trim();
        this.available = this.apiKey.length > 10;
        if (this.available) {
            console.log('🌐 [Google NMT] API key configured');
        }
    }

    /** Set translation languages */
    setLanguages(source: string, target: string): void {
        this.sourceLang = LANG_MAP[source] || 'no';
        this.targetLang = LANG_MAP[target] || 'uk';
    }

    /** Check if service is available (has API key) */
    isAvailable(): boolean {
        return this.available;
    }

    /** Translate text using Google Cloud NMT */
    async translate(text: string): Promise<string | null> {
        if (!this.available || !text.trim()) return null;

        const startTime = performance.now();

        try {
            const response = await fetch(
                `${GoogleTranslateNMT.ENDPOINT}?key=${this.apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        q: text,
                        source: this.sourceLang,
                        target: this.targetLang,
                        format: 'text'
                    })
                }
            );

            if (!response.ok) {
                const errBody = await response.text().catch(() => '');
                console.error(`🌐 [Google NMT] API error ${response.status}:`, errBody);
                debugLogger.log('GNMT_ERR', `HTTP ${response.status}: ${errBody.substring(0, 80)}`);

                // Disable on auth errors to avoid repeated failures
                if (response.status === 401 || response.status === 403) {
                    console.error('🌐 [Google NMT] Invalid API key — disabling');
                    this.available = false;
                }
                return null;
            }

            const data = await response.json();
            const translation = data?.data?.translations?.[0]?.translatedText;

            if (!translation) {
                debugLogger.log('GNMT_ERR', 'Empty translation in response');
                return null;
            }

            const latency = performance.now() - startTime;
            debugLogger.log('GNMT', `${text.substring(0, 30)} → ${translation.substring(0, 30)}`, latency, text.split(/\s+/).length);

            return translation;
        } catch (e: any) {
            const latency = performance.now() - startTime;
            debugLogger.log('GNMT_ERR', `${e?.message || e}`, latency);
            return null;
        }
    }

    /** Get status for diagnostics */
    getStatus(): { available: boolean; sourceLang: string; targetLang: string } {
        return {
            available: this.available,
            sourceLang: this.sourceLang,
            targetLang: this.targetLang,
        };
    }
}

export const googleTranslateNMT = new GoogleTranslateNMT();
