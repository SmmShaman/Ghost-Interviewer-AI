// Phone/tablet detection and small mobile-only helpers.

/** True on phones and tablets (Android, iPhone, iPad incl. iPadOS that reports itself as a Mac). */
export const isMobileDevice = (): boolean => {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
    return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
};

export const isIOS = (): boolean => {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
};

/** Running as an installed app (home-screen icon), not in a browser tab. */
export const isStandalone = (): boolean => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
};

/**
 * Keeps the screen on while a session is listening (otherwise the phone locks
 * mid-interview and the recognizer dies). The browser drops the lock when the
 * page is hidden, so it is re-acquired when the page becomes visible again.
 */
export class ScreenWakeLock {
    private lock: any = null;
    private wanted = false;

    constructor() {
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', () => {
                if (this.wanted && document.visibilityState === 'visible') void this.acquire();
            });
        }
    }

    async enable(): Promise<void> {
        this.wanted = true;
        await this.acquire();
    }

    disable(): void {
        this.wanted = false;
        const lock = this.lock;
        this.lock = null;
        lock?.release?.().catch(() => { /* already released */ });
    }

    private async acquire(): Promise<void> {
        const api = (navigator as any).wakeLock;
        if (!api || (this.lock && !this.lock.released)) return;
        try {
            this.lock = await api.request('screen');
            if (!this.wanted) this.disable();
        } catch { /* not allowed (battery saver, iframe): the session still works */ }
    }
}

export const screenWakeLock = new ScreenWakeLock();
