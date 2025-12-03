/**
 * STREAMING SIMPLE MODE LAYOUT
 *
 * Нова потокова архітектура для SIMPLE режиму.
 * Замість блоків - один безперервний потік тексту як субтитри.
 *
 * LAYOUT:
 * ┌─────────────────────────────────────────────────────────────┐
 * │                   ПЕРЕКЛАД (великий)                        │
 * │                                                              │
 * │  Текст перекладу що росте вниз як субтитри...               │
 * │  Нові слова з'являються плавно...▊                          │
 * │                                                              │
 * │  ─────────────────────────────────────────────────          │
 * │  оригінал: Det ønsker sikkert ikke å vite...                │
 * │                                                              │
 * └─────────────────────────────────────────────────────────────┘
 */

import React, { useEffect, useRef, useState } from 'react';
import { Message } from '../../types';
import StreamingTextView from '../StreamingTextView';
import { localTranslator } from '../../services/localTranslator';

interface StreamingSimpleModeLayoutProps {
    // Накопичений стан
    accumulatedOriginal: string;      // Весь оригінальний текст
    accumulatedGhostTranslation: string;  // Ghost переклад (миттєвий)
    accumulatedLLMTranslation: string;    // LLM переклад (якісний)

    // FROZEN ZONE: Already translated by LLM, won't change
    frozenTranslation?: string;
    frozenWordCount?: number;

    // Interim (real-time, not finalized yet)
    interimText?: string;             // Interim original text
    interimGhostTranslation?: string; // Interim ghost translation

    // Стан запису
    isListening: boolean;
    isProcessingLLM: boolean;

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
    interimText = '',
    interimGhostTranslation = '',
    isListening,
    isProcessingLLM,
    showOriginal = true,
    showGhost = true,
    preferLLM = true,
    wordCount,
    sessionDuration = 0
}) => {
    // SINGLE SOURCE OF TRUTH: Ghost translation only (no switching!)
    // LLM is used for intent detection, NOT for display
    // This eliminates race condition and "jumping" text

    // Display ONLY Ghost translation - consistent, no flickering
    const displayTranslation = accumulatedGhostTranslation;

    // Always show as Ghost (since we only display Ghost now)
    const translationType = 'ghost';

    // Get translation method for indicator
    const getTranslationMethodLabel = (): { label: string; bgClass: string; textClass: string } => {
        const status = localTranslator.getStatus();
        if (status.useChromeAPI) {
            return { label: 'Chrome API', bgClass: 'bg-blue-400', textClass: 'text-blue-400' };
        }
        if (status.pivotReady && status.usePivot) {
            return { label: 'Pivot NO→EN→UK', bgClass: 'bg-purple-400', textClass: 'text-purple-400' };
        }
        return { label: 'Direct', bgClass: 'bg-cyan-400', textClass: 'text-cyan-400' };
    };
    const methodInfo = getTranslationMethodLabel();

    // Combine finalized + interim for smooth display
    const fullOriginalWithInterim = interimText
        ? `${accumulatedOriginal} ${interimText}`.trim()
        : accumulatedOriginal;

    const fullTranslationWithInterim = interimGhostTranslation
        ? `${displayTranslation} ${interimGhostTranslation}`.trim()
        : displayTranslation;

    // Format duration
    const formatDuration = (ms: number): string => {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    };

    return (
        <div className="max-w-[90%] mx-auto h-full flex flex-col">
            {/* Main Translation View */}
            <div className="flex-1">
                <StreamingTextView
                    translationText={fullTranslationWithInterim}
                    originalText={showOriginal ? fullOriginalWithInterim : ''}
                    interimTranslation={interimGhostTranslation}
                    interimOriginal={interimText}
                    isActive={isListening}
                    isProcessing={isProcessingLLM}
                    variant={translationType === 'llm' ? 'llm' : 'ghost'}
                    showOriginal={showOriginal}
                    showCursor={isListening}
                    isHoldingWords={!!interimText}
                    accentColor={translationType === 'llm' ? 'emerald' : 'cyan'}
                    title={translationType === 'llm' ? 'LLM Переклад' : 'Миттєвий переклад'}
                    minHeight="400px"
                    maxHeight="calc(100vh - 16rem)"
                />
            </div>

            {/* Bottom Stats Bar */}
            <div className="mt-4 px-4 py-3 bg-gray-900/50 rounded-lg border border-gray-800 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    {/* Word count */}
                    <div className="flex items-center gap-2">
                        <span className="text-gray-500 text-xs">Слів:</span>
                        <span className="text-white font-mono text-sm">{wordCount}</span>
                    </div>

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

            {/* Dual Translation View (optional - show both Ghost and LLM) */}
            {showGhost && accumulatedGhostTranslation && accumulatedLLMTranslation && (
                <div className="mt-4 grid grid-cols-2 gap-4">
                    {/* Ghost (instant) */}
                    <div className="bg-cyan-900/10 border border-cyan-500/30 rounded-lg p-4">
                        <div className="text-[10px] text-cyan-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
                            Ghost (миттєвий)
                        </div>
                        <div className="text-sm text-cyan-100/80 leading-relaxed">
                            {accumulatedGhostTranslation}
                        </div>
                    </div>

                    {/* LLM (quality) */}
                    <div className="bg-emerald-900/10 border border-emerald-500/30 rounded-lg p-4">
                        <div className="text-[10px] text-emerald-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                            LLM (якісний)
                        </div>
                        <div className="text-sm text-emerald-100/80 leading-relaxed">
                            {accumulatedLLMTranslation}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default StreamingSimpleModeLayout;
