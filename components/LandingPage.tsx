import React, { useEffect } from 'react';
import { InterviewContext, ViewMode, AudioPresetId, SpeedPresetId, SPEED_PRESETS } from '../types';
import { MicIcon } from './Icons';
import GearMenu from './GearMenu';
import SetupPanel from './SetupPanel';
import { useAudioDevices } from '../hooks/useAudioDevices';
import type { GoogleUser } from '../services/apiClient.ts';

// Tooltip component — hover over ? to see explanation
const Tip: React.FC<{ text: string; color?: string }> = ({ text, color = 'gray' }) => (
    <span className="relative group inline-flex ml-1.5 cursor-help">
        <span className={`w-4 h-4 rounded-full border border-${color}-500/40 text-${color}-400 text-[9px] flex items-center justify-center`}>?</span>
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-200 leading-relaxed opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 shadow-xl pointer-events-none">
            {text}
        </span>
    </span>
);

interface LandingPageProps {
    context: InterviewContext;
    setContext: (context: InterviewContext) => void;
    isModelReady: boolean;
    modelError: boolean;
    modelProgress: number;
    uiLang: 'en' | 'uk';
    t: {
        modelDownload: string;
        selectMode: string;
        modes: {
            simple: string;
            simpleDesc: string;
            focus: string;
            focusDesc: string;
            full: string;
            fullDesc: string;
        };
        pressMic: string;
    };
    isSetupOpen: boolean;
    setIsSetupOpen: (open: boolean) => void;
    startSessionWithMode: (mode: ViewMode) => void;
    // Google Auth (optional)
    googleUser: GoogleUser | null;
    isAuthLoading: boolean;
    onSignOut: () => void;
    renderGoogleButton: (elementId: string) => void;
}

const LandingPage: React.FC<LandingPageProps> = ({
    context,
    setContext,
    isModelReady,
    modelError,
    modelProgress,
    uiLang,
    t,
    isSetupOpen,
    setIsSetupOpen,
    startSessionWithMode,
    googleUser,
    isAuthLoading,
    onSignOut,
    renderGoogleButton
}) => {
    const audioDevices = useAudioDevices();
    const presets = audioDevices.getPresets();

    const selectPreset = (presetId: AudioPresetId, deviceId: string) => {
        setContext({ ...context, audioDeviceId: deviceId, activeAudioPreset: presetId });
    };

    // Render Google Sign-In button when not signed in
    useEffect(() => {
        if (!googleUser && !isAuthLoading) {
            const timer = setTimeout(() => renderGoogleButton('google-signin-landing'), 300);
            return () => clearTimeout(timer);
        }
    }, [googleUser, isAuthLoading, renderGoogleButton]);

    return (
        <div className="h-screen w-screen bg-gray-950 flex flex-col items-center justify-center animate-fade-in-up">
            {/* Google Auth: top-right corner */}
            <div className="absolute top-4 right-4 z-50">
                {isAuthLoading ? (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-800/80 border border-gray-700">
                        <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                        <span className="text-xs text-gray-400">Signing in...</span>
                    </div>
                ) : googleUser ? (
                    <div className="flex items-center gap-2">
                        {googleUser.picture && (
                            <img src={googleUser.picture} alt="" className="w-8 h-8 rounded-full border border-gray-600" />
                        )}
                        <span className="text-xs text-gray-300 max-w-[120px] truncate">{googleUser.name || googleUser.email}</span>
                        <button
                            onClick={onSignOut}
                            className="text-xs text-gray-500 hover:text-gray-300 transition-colors ml-1"
                            title="Sign out"
                        >
                            ✕
                        </button>
                    </div>
                ) : (
                    <div id="google-signin-landing" />
                )}
            </div>

            {/* Model loading indicator */}
            {!isModelReady && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50">
                    <div className={`flex items-center gap-3 px-4 py-2 rounded-full ${modelError ? 'bg-red-900/80 border-red-500' : 'bg-blue-900/80 border-blue-500/30'} border backdrop-blur-md`}>
                        <span className={`text-[10px] font-bold uppercase tracking-widest ${modelError ? 'text-white' : 'text-blue-200 animate-pulse'}`}>
                            {modelError ? "MODEL ERROR" : `${t.modelDownload} ${modelProgress}%`}
                        </span>
                        {!modelError && (
                            <div className="w-20 h-1.5 bg-blue-950 rounded-full overflow-hidden">
                                <div className="h-full bg-blue-400 transition-all duration-300" style={{ width: `${modelProgress}%` }} />
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Title */}
            <div className="text-center space-y-3 mb-12">
                <h1 className="text-5xl md:text-6xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-cyan-400 to-blue-500">
                    Ghost Interviewer
                </h1>
                <p className="text-gray-400 font-mono text-sm tracking-[0.3em] uppercase">{t.selectMode}</p>
            </div>

            {/* Mode Selection Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-5xl px-6 mb-12">
                {/* SIMPLE Mode */}
                <button
                    onClick={() => startSessionWithMode('SIMPLE')}
                    disabled={!isModelReady}
                    className={`group p-8 rounded-2xl border-2 border-amber-500/30 bg-gradient-to-b from-amber-950/20 to-gray-900/50
                        hover:border-amber-400 hover:from-amber-900/30 hover:shadow-[0_0_40px_rgba(245,158,11,0.2)]
                        transition-all duration-300 text-left relative overflow-hidden
                        ${!isModelReady ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                    <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 rounded-full blur-3xl group-hover:bg-amber-500/20 transition-all"></div>
                    <div className="relative">
                        <div className="text-amber-400 font-black mb-3 tracking-widest text-sm uppercase flex items-center gap-2">
                            <span className="w-2 h-2 bg-amber-400 rounded-full"></span>
                            {t.modes.simple}
                            <Tip color="amber" text="Режим субтитрів. Миттєвий переклад (Google NMT, ~200мс). Ліва панель — переклад з кольоровими блоками. Права — структура тем (AI). Для YouTube, підкастів, лекцій. LLM вимкнений — текст стабільний." />
                        </div>
                        <div className="text-gray-300 text-sm leading-relaxed">{t.modes.simpleDesc}</div>
                        <div className="mt-6 flex items-center gap-2 text-amber-500/70 text-xs font-mono">
                            <MicIcon className="w-4 h-4" />
                            <span>Click to start</span>
                        </div>
                    </div>
                </button>

                {/* FOCUS Mode */}
                <button
                    onClick={() => startSessionWithMode('FOCUS')}
                    disabled={!isModelReady}
                    className={`group p-8 rounded-2xl border-2 border-blue-500/30 bg-gradient-to-b from-blue-950/20 to-gray-900/50
                        hover:border-blue-400 hover:from-blue-900/30 hover:shadow-[0_0_40px_rgba(59,130,246,0.2)]
                        transition-all duration-300 text-left relative overflow-hidden
                        ${!isModelReady ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                    <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl group-hover:bg-blue-500/20 transition-all"></div>
                    <div className="relative">
                        <div className="text-blue-400 font-black mb-3 tracking-widest text-sm uppercase flex items-center gap-2">
                            <span className="w-2 h-2 bg-blue-400 rounded-full"></span>
                            {t.modes.focus}
                            <Tip color="blue" text="Переклад + відповідь. Миттєвий переклад зліва, AI-відповідь + теми справа. Коли інтерв'юер ставить питання — AI генерує рекомендовану відповідь. Для співбесід де потрібна швидка підказка." />
                        </div>
                        <div className="text-gray-300 text-sm leading-relaxed">{t.modes.focusDesc}</div>
                        <div className="mt-6 flex items-center gap-2 text-blue-500/70 text-xs font-mono">
                            <MicIcon className="w-4 h-4" />
                            <span>Click to start</span>
                        </div>
                    </div>
                </button>

                {/* FULL Mode */}
                <button
                    onClick={() => startSessionWithMode('FULL')}
                    disabled={!isModelReady}
                    className={`group p-8 rounded-2xl border-2 border-emerald-500/30 bg-gradient-to-b from-emerald-950/20 to-gray-900/50
                        hover:border-emerald-400 hover:from-emerald-900/30 hover:shadow-[0_0_40px_rgba(16,185,129,0.2)]
                        transition-all duration-300 text-left relative overflow-hidden
                        ${!isModelReady ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                    <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-3xl group-hover:bg-emerald-500/20 transition-all"></div>
                    <div className="relative">
                        <div className="text-emerald-400 font-black mb-3 tracking-widest text-sm uppercase flex items-center gap-2">
                            <span className="w-2 h-2 bg-emerald-400 rounded-full"></span>
                            {t.modes.full}
                            <Tip color="emerald" text="Повний аналіз. 3 колонки: переклад + аналіз питання + стратегія відповіді. Внизу — готова відповідь. Для важливих співбесід де потрібна глибока AI-підготовка. Найбільше навантаження на AI." />
                        </div>
                        <div className="text-gray-300 text-sm leading-relaxed">{t.modes.fullDesc}</div>
                        <div className="mt-6 flex items-center gap-2 text-emerald-500/70 text-xs font-mono">
                            <MicIcon className="w-4 h-4" />
                            <span>Click to start</span>
                        </div>
                    </div>
                </button>
            </div>

            {/* Audio Preset Buttons */}
            <div className="w-full max-w-5xl px-6 mb-8">
                <p className="text-[10px] text-gray-500 font-mono tracking-[0.2em] uppercase text-center mb-4">
                    {uiLang === 'uk' ? 'РЕЖИМ АУДІО' : 'AUDIO MODE'}
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {presets.map(preset => {
                        const active = context.activeAudioPreset === preset.id;
                        const meta: Record<string, { icon: string; label: string; labelUk: string }> = {
                            'headphones-youtube': { icon: '🎧', label: 'Headphones + Video', labelUk: 'Навушники + Відео' },
                            'speakers': { icon: '🔊', label: 'Speakers', labelUk: 'Колонки' },
                            'monitor-speakers': { icon: '🖥️', label: 'Monitor', labelUk: 'Монітор' },
                            'headphones-interview': { icon: '🎙️', label: 'Interview Call', labelUk: 'Співбесіда' },
                        };
                        const m = meta[preset.id] || { icon: '?', label: preset.id, labelUk: preset.id };

                        return (
                            <button
                                key={preset.id}
                                onClick={() => {
                                    if (preset.available) {
                                        selectPreset(preset.id as AudioPresetId, preset.matchedDeviceId);
                                    }
                                }}
                                className={`group relative p-4 rounded-xl border-2 transition-all duration-300 text-center
                                    ${active
                                        ? 'border-cyan-400 bg-cyan-500/10 shadow-[0_0_20px_rgba(34,211,238,0.15)]'
                                        : preset.available
                                            ? 'border-gray-700 bg-gray-900/50 hover:border-gray-500 hover:bg-gray-800/50'
                                            : 'border-gray-800/50 bg-gray-900/20 opacity-40 cursor-not-allowed'
                                    }`}
                                disabled={!preset.available}
                                title={!preset.available
                                    ? (uiLang === 'uk' ? 'Потрібен VB-Cable (vb-audio.com/Cable/)' : 'Requires VB-Cable (vb-audio.com/Cable/)')
                                    : preset.matchedDeviceLabel}
                            >
                                <div className="text-2xl mb-2">{m.icon}</div>
                                <div className={`text-[10px] font-bold uppercase tracking-wider ${active ? 'text-cyan-300' : 'text-gray-400'}`}>
                                    {uiLang === 'uk' ? m.labelUk : m.label}
                                </div>
                                {active && (
                                    <div className="absolute -top-1 -right-1 w-3 h-3 bg-cyan-400 rounded-full border-2 border-gray-950" />
                                )}
                                {!preset.available && (
                                    <div className="text-[8px] text-amber-500/70 mt-1">VB-Cable</div>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Speed Preset Buttons */}
            <div className="w-full max-w-5xl px-6 mb-8">
                <p className="text-[10px] text-gray-500 font-mono tracking-[0.2em] uppercase text-center mb-4">
                    {uiLang === 'uk' ? 'ШВИДКІСТЬ ПЕРЕКЛАДУ' : 'TRANSLATION SPEED'}
                </p>
                <div className="grid grid-cols-3 gap-3">
                    {(Object.entries(SPEED_PRESETS) as [SpeedPresetId, typeof SPEED_PRESETS[SpeedPresetId]][]).map(([id, preset]) => {
                        const active = (context.speedPreset || 'interview') === id;
                        const icons: Record<SpeedPresetId, string> = {
                            youtube: '📺',
                            interview: '🎙️',
                            custom: '⚙️',
                        };
                        const tips: Record<SpeedPresetId, string> = {
                            youtube: 'Тільки Ghost-переклад (Google NMT, ~200мс). LLM вимкнений — без затримок. Текст тече безперервно як субтитри. Затримка від мовлення до тексту: 3-5с. Ідеально для відео та підкастів.',
                            interview: 'Ghost + LLM для відповідей. Максимальна швидкість перекладу (~200мс) + AI генерує відповіді на питання інтерв\'юера. Менші блоки, швидші тригери. Для живих співбесід.',
                            custom: 'Ручне налаштування: debounce перекладу, Hold-N (приховування нестабільних слів), тригери LLM, розмір активного вікна. Для досвідчених користувачів.',
                        };
                        return (
                            <button
                                key={id}
                                onClick={() => setContext({ ...context, speedPreset: id })}
                                className={`group/btn relative p-4 rounded-xl border-2 transition-all duration-300 text-center
                                    ${active
                                        ? 'border-amber-400 bg-amber-500/10 shadow-[0_0_20px_rgba(245,158,11,0.15)]'
                                        : 'border-gray-700 bg-gray-900/50 hover:border-gray-500 hover:bg-gray-800/50'
                                    }`}
                            >
                                <div className="text-2xl mb-2">{icons[id]}</div>
                                <div className={`text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1 ${active ? 'text-amber-300' : 'text-gray-400'}`}>
                                    {preset.label}
                                    <Tip color="amber" text={tips[id]} />
                                </div>
                                <div className="text-[8px] text-gray-500 mt-1">
                                    {preset.description}
                                </div>
                                {active && (
                                    <div className="absolute -top-1 -right-1 w-3 h-3 bg-amber-400 rounded-full border-2 border-gray-950" />
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Footer hint */}
            <div className="text-center space-y-4">
                <p className="text-xs text-gray-500 font-mono">{t.pressMic}</p>
                {/* Animated Gear Menu on Landing Page */}
                <div className="flex justify-center">
                    <GearMenu
                        context={context}
                        onContextChange={setContext}
                        uiLang={uiLang}
                        onOpenFullSettings={() => setIsSetupOpen(true)}
                    />
                </div>
            </div>

            {/* Settings Panel (available from landing) */}
            <SetupPanel isOpen={isSetupOpen} toggleOpen={() => setIsSetupOpen(!isSetupOpen)} context={context} onContextChange={setContext} uiLang={uiLang} />
        </div>
    );
};

export default LandingPage;
