/**
 * STREAMING FOCUS MODE LAYOUT
 *
 * Потокова архітектура для FOCUS режиму.
 * Показує переклад + відповідь (коли виявлено питання).
 *
 * LAYOUT:
 * ┌────────────────────────────────┬──────────────────────────────┐
 * │     ПЕРЕКЛАД (streaming)       │         ВІДПОВІДЬ            │
 * │                                │                              │
 * │  Безперервний потік тексту     │  Генерована відповідь        │
 * │  з Ghost + LLM перекладом      │  (тільки коли є питання)     │
 * │                                │                              │
 * └────────────────────────────────┴──────────────────────────────┘
 */

import React, { useEffect, useRef } from 'react';
import { localTranslator } from '../../services/localTranslator';

interface StreamingFocusModeLayoutProps {
    // Накопичений стан перекладу
    accumulatedOriginal: string;
    accumulatedGhostTranslation: string;
    accumulatedLLMTranslation: string;

    // FROZEN ZONE: Already translated by LLM, won't change
    frozenTranslation?: string;
    frozenWordCount?: number;

    // Interim (real-time, not finalized yet)
    interimText?: string;
    interimGhostTranslation?: string;

    // Стан запису
    isListening: boolean;
    isProcessingLLM: boolean;

    // Intent classification
    containsQuestion: boolean;
    questionConfidence: number;
    speechType: 'QUESTION' | 'INFO' | 'STORY' | 'SMALL_TALK' | 'UNKNOWN';

    // Відповідь (якщо є питання)
    generatedAnswer?: string;
    answerTranslation?: string;
    isGeneratingAnswer?: boolean;

    // Статистика
    wordCount: number;
    sessionDuration?: number;
}

/**
 * Render text with paragraph-aware coloring
 * Questions (ending with ?) are highlighted in amber
 * Statements are rendered in cyan/white
 */
const renderColoredParagraphs = (text: string, interimText: string = '') => {
    if (!text && !interimText) return null;

    // Split by paragraph markers
    const paragraphs = text.split('\n\n').filter(p => p.trim());

    return (
        <>
            {paragraphs.map((paragraph, index) => {
                const isQuestion = paragraph.trim().endsWith('?');
                const colorClass = isQuestion ? 'text-amber-300' : 'text-cyan-100';

                return (
                    <React.Fragment key={index}>
                        <span className={colorClass}>{paragraph}</span>
                        {index < paragraphs.length - 1 && (<><br /><br /></>)}
                    </React.Fragment>
                );
            })}
            {/* Interim text - grey, italic */}
            {interimText && (
                <span className="text-gray-400 italic ml-1">{interimText}</span>
            )}
        </>
    );
};

const StreamingFocusModeLayout: React.FC<StreamingFocusModeLayoutProps> = ({
    accumulatedOriginal,
    accumulatedGhostTranslation,
    accumulatedLLMTranslation,
    frozenTranslation = '',
    frozenWordCount = 0,
    interimText = '',
    interimGhostTranslation = '',
    isListening,
    isProcessingLLM,
    containsQuestion,
    questionConfidence,
    speechType,
    generatedAnswer = '',
    answerTranslation = '',
    isGeneratingAnswer = false,
    wordCount,
    sessionDuration = 0
}) => {
    const containerRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom
    useEffect(() => {
        if (containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
    }, [accumulatedGhostTranslation, interimGhostTranslation]);

    // Display ONLY Ghost translation - consistent, no flickering
    const displayTranslation = accumulatedGhostTranslation;

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

    // Format duration
    const formatDuration = (ms: number): string => {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    };

    // Speech type label
    const getSpeechTypeLabel = () => {
        switch (speechType) {
            case 'QUESTION': return '❓ Питання';
            case 'INFO': return 'ℹ️ Інформація';
            case 'STORY': return '📖 Розповідь';
            case 'SMALL_TALK': return '💬 Small Talk';
            default: return '🎤 Мовлення';
        }
    };

    // Count questions in text
    const questionCount = (displayTranslation.match(/\?/g) || []).length;

    return (
        <div className="max-w-[1600px] mx-auto h-full flex flex-col">
            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                {/* COLUMN 1: Translation (Streaming) with paragraph-aware coloring */}
                <div className="flex flex-col h-full">
                    <div className="border-l-4 border-cyan-500 bg-cyan-900/10 rounded-lg shadow-xl flex flex-col overflow-hidden" style={{ minHeight: '400px', maxHeight: 'calc(100vh - 14rem)' }}>
                        {/* Header */}
                        <div className="px-4 py-2.5 bg-cyan-950/30 border-b border-cyan-500/10 flex items-center justify-between sticky top-0 backdrop-blur z-10">
                            <div className="flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full bg-cyan-400 ${isListening ? 'animate-pulse shadow-[0_0_8px_rgba(34,211,238,0.8)]' : ''}`}></span>
                                <span className="text-[10px] font-black text-cyan-300 uppercase tracking-widest">
                                    Переклад
                                </span>
                                {questionCount > 0 && (
                                    <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded">
                                        {questionCount} питань
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-3">
                                {isProcessingLLM && (
                                    <div className="flex gap-0.5">
                                        <div className="w-1 h-3 bg-cyan-400 rounded-full animate-pulse" style={{animationDelay: '0ms'}}></div>
                                        <div className="w-1 h-3 bg-cyan-400 rounded-full animate-pulse" style={{animationDelay: '100ms'}}></div>
                                        <div className="w-1 h-3 bg-cyan-400 rounded-full animate-pulse" style={{animationDelay: '200ms'}}></div>
                                    </div>
                                )}
                                {wordCount > 0 && (
                                    <span className="text-[10px] font-mono text-cyan-300 bg-black/20 px-2 py-0.5 rounded">
                                        {wordCount} слів
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Main Content - Custom paragraph rendering */}
                        <div
                            ref={containerRef}
                            className="flex-1 overflow-y-auto p-4 md:p-6"
                        >
                            {(displayTranslation || interimGhostTranslation) ? (
                                <div className="text-lg md:text-xl lg:text-2xl leading-relaxed font-medium" style={{ whiteSpace: 'pre-line' }}>
                                    {renderColoredParagraphs(displayTranslation, interimGhostTranslation)}
                                    {isListening && !interimGhostTranslation && (
                                        <span className="inline-block ml-1 text-cyan-400 animate-pulse">▊</span>
                                    )}
                                </div>
                            ) : (
                                /* Empty State */
                                <div className="h-full flex flex-col items-center justify-center text-center py-12">
                                    <div className="w-16 h-16 rounded-full bg-cyan-900/10 border border-cyan-500 flex items-center justify-center mb-4">
                                        <svg className="w-8 h-8 text-cyan-300 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                                        </svg>
                                    </div>
                                    <div className="text-sm text-cyan-300 opacity-70 mb-2">
                                        {isListening ? 'Слухаю...' : 'Очікую запис'}
                                    </div>
                                    <div className="text-xs text-gray-500">
                                        {isListening
                                            ? 'Текст з\'явиться тут миттєво'
                                            : 'Натисніть мікрофон щоб почати'
                                        }
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Legend */}
                        {displayTranslation && (
                            <div className="px-4 py-2 bg-cyan-950/30 border-t border-cyan-500/10 flex items-center gap-4 text-[10px]">
                                <div className="flex items-center gap-1.5">
                                    <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
                                    <span className="text-cyan-400">Розповідь</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                                    <span className="text-amber-400">Питання</span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* COLUMN 2: Answer (Sticky) */}
                <div className="sticky top-4 h-fit">
                    <div className="border-l-4 border-emerald-500 bg-emerald-900/10 min-h-[400px] max-h-[calc(100vh-10rem)] overflow-y-auto rounded-lg shadow-xl">
                        {/* Header */}
                        <div className="px-4 py-2.5 bg-emerald-950/30 border-b border-emerald-500/10 flex items-center justify-between sticky top-0 backdrop-blur z-10">
                            <div className="flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full bg-emerald-400 ${isGeneratingAnswer ? 'animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]' : ''}`}></span>
                                <span className="text-[10px] font-black text-emerald-300 uppercase tracking-widest">
                                    Відповідь
                                </span>
                            </div>
                            {isGeneratingAnswer && (
                                <div className="flex gap-0.5">
                                    <div className="w-1 h-3 bg-emerald-400 rounded-full animate-pulse" style={{animationDelay: '0ms'}}></div>
                                    <div className="w-1 h-3 bg-emerald-400 rounded-full animate-pulse" style={{animationDelay: '100ms'}}></div>
                                    <div className="w-1 h-3 bg-emerald-400 rounded-full animate-pulse" style={{animationDelay: '200ms'}}></div>
                                </div>
                            )}
                        </div>

                        {/* Content */}
                        <div className="p-4">
                            {generatedAnswer ? (
                                <div className="space-y-4">
                                    {/* Answer in target language */}
                                    <div className="text-lg md:text-xl font-bold text-emerald-300 leading-relaxed">
                                        "{generatedAnswer}"
                                    </div>
                                    {/* Translation to native */}
                                    {answerTranslation && (
                                        <div className="text-sm text-gray-400 italic border-t border-emerald-800/30 pt-3">
                                            {answerTranslation}
                                        </div>
                                    )}
                                </div>
                            ) : containsQuestion ? (
                                /* Generating state */
                                <div className="space-y-3">
                                    {isGeneratingAnswer ? (
                                        <>
                                            <div className="animate-pulse bg-emerald-700/20 rounded h-6 w-full"></div>
                                            <div className="animate-pulse bg-emerald-700/20 rounded h-6 w-2/3"></div>
                                            <div className="text-[10px] text-emerald-500/50 mt-4">
                                                Генерую відповідь на питання...
                                            </div>
                                        </>
                                    ) : (
                                        <div className="text-center py-8">
                                            <div className="w-12 h-12 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center mx-auto mb-3">
                                                <span className="text-2xl">❓</span>
                                            </div>
                                            <div className="text-sm text-amber-300 mb-2">Виявлено питання</div>
                                            <div className="text-xs text-gray-500">
                                                Відповідь буде згенерована після паузи
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                /* Empty state - waiting for question */
                                <div className="text-center py-12">
                                    <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-4">
                                        <svg className="w-8 h-8 text-emerald-400 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                    </div>
                                    <div className="text-sm text-emerald-400/70 mb-2">
                                        Очікую питання...
                                    </div>
                                    <div className="text-xs text-gray-500 max-w-xs mx-auto">
                                        Відповідь з'явиться автоматично коли інтерв'юер поставить питання
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
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

                    {/* Speech type */}
                    <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            speechType === 'QUESTION' ? 'bg-amber-500/20 text-amber-300' :
                            speechType === 'INFO' ? 'bg-blue-500/20 text-blue-300' :
                            speechType === 'SMALL_TALK' ? 'bg-purple-500/20 text-purple-300' :
                            'bg-gray-500/20 text-gray-300'
                        }`}>
                            {getSpeechTypeLabel()}
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {/* Translation method indicator */}
                    <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${methodInfo.bgClass}`}></span>
                        <span className={`text-xs ${methodInfo.textClass}`}>
                            {methodInfo.label}
                        </span>
                    </div>

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

export default StreamingFocusModeLayout;
