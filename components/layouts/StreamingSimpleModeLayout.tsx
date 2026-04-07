/**
 * STREAMING SIMPLE MODE LAYOUT
 *
 * Нова потокова архітектура для SIMPLE режиму.
 * Замість блоків - один безперервний потік тексту як субтитри.
 *
 * THREE-ZONE LAYOUT:
 * ┌─────────────────────────────────────────────────────────────┐
 * │  🧊 FROZEN ZONE (scrollable, white)                          │
 * │                                                              │
 * │  Стабільний текст LLM перекладу що вже не зміниться...      │
 * │  Плавно скролиться вгору при додаванні нового frozen...     │
 * │                                                              │
 * ├─────────────────────────────────────────────────────────────┤
 * │  🔥 ACTIVE ZONE (fixed height, pale yellow)                  │
 * │                                                              │
 * │  Активний текст Ghost що ще не заморожений LLM...           │
 * │                                                              │
 * ├─────────────────────────────────────────────────────────────┤
 * │  💬 INTERIM ZONE (fixed height, red)                         │
 * │                                                              │
 * │  Реальний час - слова що ще не фіналізовані...              │
 * │                                                              │
 * └─────────────────────────────────────────────────────────────┘
 */

import React, { useEffect, useRef } from 'react';
import { localTranslator } from '../../services/localTranslator';

interface StreamingSimpleModeLayoutProps {
    // Накопичений стан
    accumulatedOriginal: string;      // Весь оригінальний текст
    accumulatedGhostTranslation: string;  // Ghost переклад (миттєвий)
    accumulatedLLMTranslation: string;    // LLM переклад (якісний)

    // FROZEN ZONE: Already translated by LLM, won't change
    frozenTranslation?: string;
    frozenWordCount?: number;
    frozenTranslationWordCount?: number; // Actual word count in translated text

    // Interim (real-time, not finalized yet)
    interimText?: string;             // Interim original text
    interimGhostTranslation?: string; // Interim ghost translation

    // Стан запису
    isListening: boolean;
    isProcessingLLM: boolean;

    // LLM Toggle - controls whether to display LLM translation
    llmTranslationEnabled?: boolean;

    // Налаштування
    showOriginal?: boolean;
    showGhost?: boolean;              // Показувати Ghost або LLM
    preferLLM?: boolean;              // Пріоритет LLM над Ghost

    // Статистика
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
    showGhost = true,
    preferLLM = true,
    wordCount,
    sessionDuration = 0
}) => {
    // THREE-ZONE DISPLAY ARCHITECTURE
    //
    // Zone 1 (Frozen): Stable LLM-translated text - white, scrollable
    // Zone 2 (Active): Ghost text not yet frozen by LLM - pale yellow, fixed height
    // Zone 3 (Interim): Real-time speech recognition - red, fixed height
    //
    // This prevents visual jumping by keeping each zone independent

    const hasLLMContent = llmTranslationEnabled && accumulatedLLMTranslation && accumulatedLLMTranslation.trim().length > 0;
    const hasFrozenContent = frozenTranslation && frozenTranslation.trim().length > 0;

    // Helper: strip placeholder tokens from ghost text
    const stripPlaceholders = (text: string): string => {
        return text
            .replace(/⏳\.{0,3}/g, '')
            .replace(/[❌⚠️]/g, '')
            .trim();
    };

    // ZONE 1: Frozen translation (stable, from LLM)
    const frozenZoneText = hasFrozenContent ? stripPlaceholders(frozenTranslation) : '';

    // ZONE 2: Active translation (Ghost text not yet frozen by LLM)
    let activeZoneText = '';
    let translationType: 'llm' | 'ghost' | 'hybrid';

    if (!llmTranslationEnabled) {
        // LLM disabled - all Ghost goes to active zone
        activeZoneText = stripPlaceholders(accumulatedGhostTranslation);
        translationType = 'ghost';
    } else if (hasFrozenContent) {
        // LLM enabled with frozen - calculate active zone from Ghost
        const ghostText = stripPlaceholders(accumulatedGhostTranslation);

        // Use frozenTranslationWordCount (translated words) to cut Ghost text
        // This matches Ghost word count to translated word count, not original word count
        let wordCountSoFar = 0;
        let cutPosition = 0;
        const wordRegex = /\S+/g;
        let match;

        while ((match = wordRegex.exec(ghostText)) !== null) {
            wordCountSoFar++;
            if (wordCountSoFar >= frozenTranslationWordCount) {
                cutPosition = match.index + match[0].length;
                break;
            }
        }

        // Get active text (words after frozen zone)
        activeZoneText = ghostText.substring(cutPosition).trim();
        translationType = 'hybrid';
    } else if (hasLLMContent) {
        // LLM enabled but not frozen yet - show LLM in active zone temporarily
        activeZoneText = accumulatedLLMTranslation;
        translationType = 'llm';
    } else {
        // LLM enabled but no content - Ghost fallback
        activeZoneText = stripPlaceholders(accumulatedGhostTranslation);
        translationType = 'ghost';
    }

    // Get translation method for indicator
    const getTranslationMethodLabel = (): { label: string; bgClass: string; textClass: string } => {
        // Hybrid mode - frozen LLM + active Ghost
        if (translationType === 'hybrid') {
            return { label: `LLM+Ghost (${frozenWordCount} замор.)`, bgClass: 'bg-emerald-500', textClass: 'text-emerald-400' };
        }

        // Pure LLM
        if (translationType === 'llm') {
            return { label: 'LLM (якісний)', bgClass: 'bg-purple-500', textClass: 'text-purple-400' };
        }

        // Ghost mode - show underlying method
        const status = localTranslator.getStatus();
        if (status.useChromeAPI) {
            return { label: 'Chrome API', bgClass: 'bg-blue-400', textClass: 'text-blue-400' };
        }
        if (status.pivotReady && status.usePivot) {
            return { label: 'Pivot NO→EN→UK', bgClass: 'bg-purple-400', textClass: 'text-purple-400' };
        }
        return { label: 'Ghost (швидкий)', bgClass: 'bg-cyan-400', textClass: 'text-cyan-400' };
    };
    const methodInfo = getTranslationMethodLabel();

    // Original text (for display at bottom)
    const fullOriginalWithInterim = interimText
        ? `${accumulatedOriginal} ${interimText}`.trim()
        : accumulatedOriginal;

    // Scroll container ref for frozen zone auto-scroll
    const frozenContainerRef = useRef<HTMLDivElement>(null);

    // Auto-scroll frozen zone to bottom when new content added
    useEffect(() => {
        if (frozenContainerRef.current && frozenZoneText) {
            frozenContainerRef.current.scrollTop = frozenContainerRef.current.scrollHeight;
        }
    }, [frozenZoneText]);

    // Format duration
    const formatDuration = (ms: number): string => {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    };

    return (
        <div className="max-w-[90%] mx-auto h-full flex flex-col">
            {/* THREE-ZONE TRANSLATION VIEW */}
            <div className="flex-1 border-l-4 border-emerald-500 bg-emerald-900/10 rounded-lg shadow-xl flex flex-col overflow-hidden" style={{ minHeight: '400px', maxHeight: 'calc(100vh - 16rem)' }}>

                {/* Header */}
                <div className="px-4 py-2.5 bg-emerald-950/30 border-b border-emerald-500/10 flex items-center justify-between sticky top-0 backdrop-blur z-10">
                    <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full bg-emerald-400 ${isListening ? 'animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]' : ''}`}></span>
                        <span className="text-[10px] font-black text-emerald-300 uppercase tracking-widest">
                            {translationType === 'hybrid' ? 'LLM + Ghost (3-зони)' : translationType === 'llm' ? 'LLM Переклад' : 'Миттєвий переклад'}
                        </span>
                    </div>
                    <div className="flex items-center gap-3">
                        {isProcessingLLM && (
                            <div className="flex gap-0.5">
                                <div className="w-1 h-3 bg-emerald-400 rounded-full animate-pulse" style={{animationDelay: '0ms'}}></div>
                                <div className="w-1 h-3 bg-emerald-400 rounded-full animate-pulse" style={{animationDelay: '100ms'}}></div>
                                <div className="w-1 h-3 bg-emerald-400 rounded-full animate-pulse" style={{animationDelay: '200ms'}}></div>
                            </div>
                        )}
                        {wordCount > 0 && (
                            <span className="text-[10px] font-mono text-emerald-300 bg-black/20 px-2 py-0.5 rounded">
                                {wordCount} слів
                            </span>
                        )}
                    </div>
                </div>

                {/* ZONE 1: FROZEN (scrollable, white text) */}
                <div
                    ref={frozenContainerRef}
                    className="flex-1 overflow-y-auto p-4 md:p-6 scroll-smooth"
                    style={{ overflowAnchor: 'auto' }}
                >
                    {frozenZoneText ? (
                        <div
                            className="text-lg md:text-xl lg:text-2xl leading-relaxed font-medium text-emerald-100"
                            style={{ whiteSpace: 'pre-line' }}
                        >
                            {frozenZoneText}
                        </div>
                    ) : (
                        /* Empty state for frozen zone */
                        <div className="flex items-center justify-center h-full text-gray-500 text-sm italic">
                            {llmTranslationEnabled
                                ? 'Очікую на LLM переклад...'
                                : 'LLM вимкнено'
                            }
                        </div>
                    )}
                </div>

                {/* ZONE 2: ACTIVE (fixed height, pale yellow) - Ghost text not yet frozen */}
                {(activeZoneText || (llmTranslationEnabled && !hasFrozenContent)) && (
                    <div
                        className="shrink-0 border-t border-yellow-500/30 bg-yellow-900/10 px-4 py-3"
                        style={{
                            minHeight: '5rem',
                            maxHeight: '8rem',
                            overflow: 'auto'
                        }}
                    >
                        <div className="flex items-center gap-2 mb-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse"></span>
                            <span className="text-[9px] text-yellow-400/80 uppercase tracking-wider font-semibold">
                                Активний (ще не заморожено)
                            </span>
                            {activeZoneText && (
                                <span className="text-[9px] text-yellow-400/60">
                                    ({activeZoneText.split(/\s+/).filter(w => w).length} слів)
                                </span>
                            )}
                        </div>
                        <div
                            className="text-base md:text-lg leading-relaxed font-medium text-yellow-200/90"
                            style={{ whiteSpace: 'pre-line' }}
                        >
                            {activeZoneText || (
                                <span className="text-yellow-400/50 italic">очікую Ghost переклад...</span>
                            )}
                        </div>
                    </div>
                )}

                {/* ZONE 3: INTERIM (fixed height, red) - Real-time speech */}
                <div
                    className="shrink-0 border-t border-red-500/30 bg-red-900/10 px-4 py-3"
                    style={{
                        minHeight: '4.5rem',
                        maxHeight: '6.5rem'
                    }}
                >
                    <div className="flex items-center gap-2 mb-1">
                        <span className={`w-1.5 h-1.5 rounded-full bg-red-400 ${isListening ? 'animate-pulse' : ''}`}></span>
                        <span className="text-[9px] text-red-400/80 uppercase tracking-wider font-semibold">
                            Interim (реальний час)
                        </span>
                    </div>
                    <div className="text-base md:text-lg leading-relaxed font-medium overflow-auto">
                        {interimGhostTranslation ? (
                            <span
                                className="text-red-400 italic"
                                style={{
                                    background: 'linear-gradient(90deg, rgba(248,113,113,0.9) 0%, rgba(248,113,113,0.5) 100%)',
                                    WebkitBackgroundClip: 'text',
                                    WebkitTextFillColor: 'transparent'
                                }}
                            >
                                {interimGhostTranslation}
                            </span>
                        ) : interimText ? (
                            /* Show original interim if no translation yet */
                            <span className="text-red-300/50 italic">{interimText}</span>
                        ) : isListening ? (
                            <span className="text-gray-600 italic">очікую...</span>
                        ) : (
                            <span className="text-gray-700 italic">мікрофон вимкнено</span>
                        )}
                        {isListening && (
                            <span className="inline-block ml-1 text-red-400 animate-pulse">▊</span>
                        )}
                    </div>
                </div>

                {/* Original text (small, at the bottom) */}
                {showOriginal && fullOriginalWithInterim && (
                    <div className="shrink-0 px-4 py-2 bg-gray-900/50 border-t border-gray-800">
                        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
                            Оригінал
                        </div>
                        <div className="text-xs text-gray-400/70 italic leading-relaxed" style={{ whiteSpace: 'pre-line' }}>
                            {fullOriginalWithInterim}
                        </div>
                    </div>
                )}
            </div>

            {/* Bottom Stats Bar */}
            <div className="mt-4 px-4 py-3 bg-gray-900/50 rounded-lg border border-gray-800 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    {/* Word count */}
                    <div className="flex items-center gap-2">
                        <span className="text-gray-500 text-xs">Слів:</span>
                        <span className="text-white font-mono text-sm">{wordCount}</span>
                    </div>

                    {/* Frozen word count */}
                    {frozenWordCount > 0 && (
                        <div className="flex items-center gap-2">
                            <span className="text-emerald-500 text-xs">🧊</span>
                            <span className="text-emerald-400 font-mono text-sm">{frozenWordCount}</span>
                        </div>
                    )}

                    {/* Duration */}
                    {sessionDuration > 0 && (
                        <div className="flex items-center gap-2">
                            <span className="text-gray-500 text-xs">Час:</span>
                            <span className="text-white font-mono text-sm">{formatDuration(sessionDuration)}</span>
                        </div>
                    )}

                    {/* Translation method indicator */}
                    <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${methodInfo.bgClass}`}></span>
                        <span className={`text-xs ${methodInfo.textClass}`}>
                            {methodInfo.label}
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {/* LLM processing indicator */}
                    {isProcessingLLM && (
                        <div className="flex items-center gap-2 text-orange-400 text-xs">
                            <div className="w-2 h-2 rounded-full bg-orange-400 animate-pulse"></div>
                            <span>LLM обробляє...</span>
                        </div>
                    )}

                    {/* Listening indicator */}
                    {isListening && (
                        <div className="flex items-center gap-2 text-red-400 text-xs">
                            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
                            <span>Запис</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default StreamingSimpleModeLayout;
