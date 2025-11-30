import React from 'react';
import { InterviewContext, ViewMode } from '../types';
import { MicIcon } from './Icons';
import GearMenu from './GearMenu';
import SetupPanel from './SetupPanel';

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
    startSessionWithMode
}) => {
    return (
        <div className="h-screen w-screen bg-gray-950 flex flex-col items-center justify-center animate-fade-in-up">
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
                        </div>
                        <div className="text-gray-300 text-sm leading-relaxed">{t.modes.fullDesc}</div>
                        <div className="mt-6 flex items-center gap-2 text-emerald-500/70 text-xs font-mono">
                            <MicIcon className="w-4 h-4" />
                            <span>Click to start</span>
                        </div>
                    </div>
                </button>
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
