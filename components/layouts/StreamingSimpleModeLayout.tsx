/**
 * STREAMING SIMPLE MODE LAYOUT
 *
 * Unified subtitle view — one continuous text stream.
 * Ghost translation (Google NMT / Chrome API) appears instantly.
 * Interim words shown inline as faded text.
 *
 * ┌──────────────────────────────────────────────────┐
 * │                                                  │
 * │  Перекладений текст що скролиться вгору...       │
 * │  Нові слова з'являються внизу.                   │
 * │  Проміжні слова показані напівпрозорими ▊        │
 * │                                                  │
 * └──────────────────────────────────────────────────┘
 */

import React, { useEffect, useRef } from 'react';
import { localTranslator } from '../../services/localTranslator';

interface StreamingSimpleModeLayoutProps {
    accumulatedOriginal: string;
    accumulatedGhostTranslation: string;
    accumulatedLLMTranslation: string;

    frozenTranslation?: string;
    frozenWordCount?: number;
    frozenTranslationWordCount?: number;

    interimText?: string;
    interimGhostTranslation?: string;

    isListening: boolean;
    isProcessingLLM: boolean;

    llmTranslationEnabled?: boolean;

    showOriginal?: boolean;
    showGhost?: boolean;
    preferLLM?: boolean;

    wordCount: number;
    sessionDuration?: number;
}

const StreamingSimpleModeLayout: React.FC<StreamingSimpleModeLayoutProps> = ({
    accumulatedOriginal,
    accumulatedGhostTranslation,
    accumulatedLLMTranslation,
    frozenTranslation = '',
    frozenWordCount = 0,
    frozenTranslationWordCount = 0,
    interimText = '',
    interimGhostTranslation = '',
    isListening,
    isProcessingLLM,
    llmTranslationEnabled = false,
    showOriginal = true,
    wordCount,
    sessionDuration = 0
}) => {
    const scrollRef = useRef<HTMLDivElement>(null);

    // Strip placeholder tokens
    const strip = (text: string): string =>
        text.replace(/⏳\.{0,3}/g, '').replace(/[❌⚠️]/g, '').trim();

    // Main translation text — single stream
    // Priority: Ghost (NMT/Chrome) which is already fast and good quality
    const mainText = strip(accumulatedGhostTranslation);

    // Interim text — words being spoken right now (not yet finalized)
    const interimDisplay = interimGhostTranslation || interimText || '';

    // Auto-scroll only when finalized text grows (not on interim changes)
    useEffect(() => {
        if (scrollRef.current && mainText) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [mainText]);

    // Translation method indicator
    const getMethodLabel = (): { label: string; color: string } => {
        const status = localTranslator.getStatus();
        if (status.useChromeAPI) return { label: 'Chrome API', color: 'text-blue-400' };
        if (status.useGoogleNMT) return { label: 'Google NMT', color: 'text-green-400' };
        return { label: 'Opus', color: 'text-cyan-400' };
    };
    const method = getMethodLabel();

    // Format duration
    const formatDuration = (ms: number): string => {
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        return `${m}:${(s % 60).toString().padStart(2, '0')}`;
    };

    return (
        <div className="max-w-4xl mx-auto h-full flex flex-col">
            {/* Main subtitle area — finalized text only, never jumps */}
            <div
                ref={scrollRef}
                className="flex-1 rounded-t-2xl bg-gray-950/80 border border-b-0 border-gray-800/50 shadow-2xl overflow-y-auto scroll-smooth px-6 py-5 md:px-10 md:py-8"
                style={{ minHeight: '300px', maxHeight: 'calc(100vh - 16rem)' }}
            >
                {mainText ? (
                    <div className="text-xl md:text-2xl lg:text-3xl leading-relaxed font-medium tracking-wide text-gray-100" style={{ whiteSpace: 'pre-line' }}>
                        {mainText}
                        {isListening && (
                            <span className="inline-block ml-0.5 text-emerald-400 animate-pulse">▊</span>
                        )}
                    </div>
                ) : (
                    <div className="flex items-center justify-center h-full">
                        <div className="text-center space-y-3">
                            <div className="text-4xl opacity-20">🎧</div>
                            <p className="text-gray-600 text-sm">
                                {isListening ? 'Слухаю...' : 'Натисніть Start для початку'}
                            </p>
                        </div>
                    </div>
                )}
            </div>

            {/* Interim zone — fixed height, separate from main text */}
            <div className="shrink-0 rounded-b-2xl bg-gray-900/60 border border-t-0 border-gray-800/50 px-6 py-3 md:px-10"
                 style={{ minHeight: '3.5rem', maxHeight: '4.5rem' }}
            >
                {interimDisplay ? (
                    <div className="text-lg md:text-xl text-gray-500 italic leading-relaxed truncate">
                        {interimDisplay}
                    </div>
                ) : isListening ? (
                    <div className="text-gray-700 italic text-sm">слухаю...</div>
                ) : null}
            </div>

            {/* Compact status bar */}
            <div className="mt-3 px-4 py-2.5 bg-gray-900/50 rounded-xl border border-gray-800/50 flex items-center justify-between text-xs">
                <div className="flex items-center gap-4">
                    {wordCount > 0 && (
                        <span className="text-gray-400 font-mono">{wordCount} слів</span>
                    )}
                    {sessionDuration > 0 && (
                        <span className="text-gray-500 font-mono">{formatDuration(sessionDuration)}</span>
                    )}
                    <span className={method.color}>{method.label}</span>
                </div>
                <div className="flex items-center gap-3">
                    {isProcessingLLM && (
                        <span className="text-orange-400 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse"></span>
                            LLM
                        </span>
                    )}
                    {isListening && (
                        <span className="text-red-400 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
                            REC
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
};

export default StreamingSimpleModeLayout;
