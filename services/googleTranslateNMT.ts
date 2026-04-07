/**
 * GOOGLE CLOUD TRANSLATION NMT SERVICE
 *
 * Dedicated Neural Machine Translation — NOT LLM-based.
 * 50-200ms latency for a sentence, significantly faster than any LLM.
 *
 * TWO MODES:
 * 1. Proxy mode (production): Browser → ghost.vitalii.no/api/translate → Google API
 *    API key stays on server, requires Google auth token
 * 2. Direct mode (dev/fallback): Browser → Google API directly
 *    Uses VITE_GOOGLE_TRANSLATE_KEY from .env.local
 *
 * Used as Level 2 in the translation pipeline:
 *   Level 1: Chrome Translator API (0-50ms, on-device)
 *   Level 2: Google Cloud NMT (50-300ms, cloud)     ← THIS
 *   Level 3: Opus WASM model (300-2000ms, on-device fallback)
 */

import { debugLogger } from './debugLogger';

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
    private directApiKey: string = '';
    private proxyUrl: string = '';
    private authToken: string = '';  // Google ID token for proxy auth
    private sourceLang: string = 'no';
    private targetLang: string = 'uk';
    private available: boolean = false;
    private useProxy: boolean = false;

    private static readonly DIRECT_ENDPOINT = 'https://translation.googleapis.com/language/translate/v2';

    /** Configure direct mode (dev): API key in frontend */
    setApiKey(key: string): void {
        this.directApiKey = key.trim();
        if (this.directApiKey.length > 10) {
            this.available = true;
            this.useProxy = false;
            console.log('🌐 [Google NMT] Direct mode (API key in frontend)');
        }
    }

    /** Configure proxy mode (production): requests go through Worker */
    setProxy(url: string, authToken: string): void {
        this.proxyUrl = url.replace(/\/$/, '');
        this.authToken = authToken;
        if (this.proxyUrl && this.authToken) {
            this.available = true;
            this.useProxy = true;
            console.log('🌐 [Google NMT] Proxy mode (via Worker)');
        }
    }

    /** Update auth token (when user re-authenticates) */
    setAuthToken(token: string): void {
        this.authToken = token;
        // If we have a proxy URL, re-enable proxy mode
        if (this.proxyUrl && this.authToken) {
            this.available = true;
            this.useProxy = true;
        }
    }

    setLanguages(source: string, target: string): void {
        this.sourceLang = LANG_MAP[source] || 'no';
        this.targetLang = LANG_MAP[target] || 'uk';
    }

    isAvailable(): boolean {
        return this.available;
    }

    /** Translate text — routes to proxy or direct based on config */
    async translate(text: string): Promise<string | null> {
        if (!this.available || !text.trim()) return null;

        return this.useProxy
            ? this.translateViaProxy(text)
            : this.translateDirect(text);
    }

    /** Direct translation (dev mode) */
    private async translateDirect(text: string): Promise<string | null> {
        const startTime = performance.now();
        try {
            const response = await fetch(
                `${GoogleTranslateNMT.DIRECT_ENDPOINT}?key=${this.directApiKey}`,
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
                if (response.status === 401 || response.status === 403) {
                    this.available = false;
                }
                return null;
            }

            const data = await response.json();
            const translation = data?.data?.translations?.[0]?.translatedText;
            if (!translation) return null;

            debugLogger.log('GNMT', `${text.substring(0, 30)} → ${translation.substring(0, 30)}`, performance.now() - startTime, text.split(/\s+/).length);
            return translation;
        } catch {
            return null;
        }
    }

    /** Proxy translation (production mode) */
    private async translateViaProxy(text: string): Promise<string | null> {
        const startTime = performance.now();
        try {
            const response = await fetch(`${this.proxyUrl}/api/translate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.authToken}`
                },
                body: JSON.stringify({
                    q: text,
                    source: this.sourceLang,
                    target: this.targetLang,
                })
            });

            if (!response.ok) {
                const errBody = await response.text().catch(() => '');
                debugLogger.log('GNMT_ERR', `Proxy ${response.status}: ${errBody.substring(0, 60)}`);
                if (response.status === 401) {
                    // Auth expired — don't disable, user may re-auth
                    console.warn('🌐 [Google NMT] Auth token expired');
                }
                return null;
            }

            const data = await response.json() as { translatedText?: string };
            const translation = data?.translatedText;
            if (!translation) return null;

            debugLogger.log('GNMT', `${text.substring(0, 30)} → ${translation.substring(0, 30)}`, performance.now() - startTime, text.split(/\s+/).length);
            return translation;
        } catch {
            return null;
        }
    }

    getStatus(): { available: boolean; useProxy: boolean; sourceLang: string; targetLang: string } {
        return {
            available: this.available,
            useProxy: this.useProxy,
            sourceLang: this.sourceLang,
            targetLang: this.targetLang,
        };
    }
}

export const googleTranslateNMT = new GoogleTranslateNMT();
