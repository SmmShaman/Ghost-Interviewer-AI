import React, { useEffect, useState } from 'react';
import { isIOS, isMobileDevice, isStandalone } from '../services/device';

// "Install the app" on phones. Android/Chrome: the browser's own install prompt
// (beforeinstallprompt). iOS Safari has no prompt API: show the manual steps.

let deferredPrompt: any = null;
if (typeof window !== 'undefined') {
    // Captured at module load: the event can fire before the landing page mounts.
    window.addEventListener('beforeinstallprompt', (e: Event) => {
        e.preventDefault();
        deferredPrompt = e;
        window.dispatchEvent(new Event('ghost-install-available'));
    });
    window.addEventListener('appinstalled', () => { deferredPrompt = null; });
}

const InstallAppButton: React.FC<{ uiLang: 'en' | 'uk' }> = ({ uiLang }) => {
    const [canPrompt, setCanPrompt] = useState(!!deferredPrompt);
    const [showIosHelp, setShowIosHelp] = useState(false);
    const [installed, setInstalled] = useState(isStandalone());

    useEffect(() => {
        const onAvailable = () => setCanPrompt(true);
        const onInstalled = () => { setInstalled(true); setCanPrompt(false); };
        window.addEventListener('ghost-install-available', onAvailable);
        window.addEventListener('appinstalled', onInstalled);
        return () => {
            window.removeEventListener('ghost-install-available', onAvailable);
            window.removeEventListener('appinstalled', onInstalled);
        };
    }, []);

    if (installed || !isMobileDevice()) return null;
    const ios = isIOS();
    if (!canPrompt && !ios) return null;

    const uk = uiLang === 'uk';
    const install = async () => {
        if (ios) { setShowIosHelp(v => !v); return; }
        const prompt = deferredPrompt;
        if (!prompt) return;
        deferredPrompt = null;
        setCanPrompt(false);
        prompt.prompt();
        try {
            const choice = await prompt.userChoice;
            if (choice?.outcome === 'accepted') setInstalled(true);
        } catch { /* dismissed */ }
    };

    return (
        <div className="w-full max-w-5xl shrink-0">
            <button
                onClick={install}
                className="w-full min-h-[48px] rounded-xl border border-cyan-500/50 bg-cyan-500/10 text-cyan-200 text-sm font-bold active:bg-cyan-500/20"
            >
                📲 {uk ? 'Встановити застосунок на телефон' : 'Install the app on this phone'}
            </button>
            {ios && showIosHelp && (
                <p className="mt-2 px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-xs text-gray-300 leading-relaxed">
                    {uk
                        ? 'У Safari натисніть «Поділитися» (квадрат зі стрілкою вгору) → «На початковий екран» → «Додати».'
                        : 'In Safari tap Share (square with an arrow) → "Add to Home Screen" → "Add".'}
                </p>
            )}
        </div>
    );
};

export default InstallAppButton;
