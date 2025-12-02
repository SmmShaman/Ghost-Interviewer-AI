/**
 * STREAMING FULL MODE LAYOUT
 *
 * Потокова архітектура для FULL режиму.
 * Показує: Переклад + Аналіз + Стратегія + Відповідь
 *
 * LAYOUT:
 * ┌──────────────────┬────────────┬────────────┐
 * │   ПЕРЕКЛАД       │  АНАЛІЗ    │ СТРАТЕГІЯ  │
 * │   (streaming)    │            │            │
 * └──────────────────┴────────────┴────────────┘
 * ┌────────────────────────────────────────────┐
 * │              ГОТОВА ВІДПОВІДЬ              │
 * └────────────────────────────────────────────┘
 */

import React from 'react';
import StreamingTextView from '../StreamingTextView';

interface StreamingFullModeLayoutProps {
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

    // Аналіз та стратегія (якщо є питання)
    analysis?: string;
    strategy?: string;
    isAnalyzing?: boolean;

    // Відповідь (якщо є питання)
    generatedAnswer?: string;
    answerTranslation?: string;
    isGeneratingAnswer?: boolean;

    // Статистика
    wordCount: number;
    sessionDuration?: number;
}

const StreamingFullModeLayout: React.FC<StreamingFullModeLayoutProps> = ({
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
    analysis = '',
    strategy = '',
    isAnalyzing = false,
    generatedAnswer = '',
    answerTranslation = '',
    isGeneratingAnswer = false,
    wordCount,
    sessionDuration = 0
}) => {
    // SINGLE SOURCE OF TRUTH: Ghost translation only (no switching!)
    // LLM is used for intent detection, analysis, strategy, NOT for display
    // This eliminates race condition and "jumping" text

    // Display ONLY Ghost translation - consistent, no flickering
    const displayTranslation = accumulatedGhostTranslation;

    // Always show as Ghost (since we only display Ghost now)
    const translationType = 'ghost';

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

    return (
        <div className="max-w-[1800px] mx-auto h-full flex flex-col gap-4">
            {/* TOP ROW: Translation + Analysis + Strategy */}
            <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
                {/* COLUMN 1: Translation (Streaming) */}
                <div className="flex flex-col h-full">
                    <StreamingTextView
                        translationText={displayTranslation}
                        originalText={accumulatedOriginal}
                        interimTranslation={interimGhostTranslation}
                        interimOriginal={interimText}
                        isActive={isListening}
                        isProcessing={isProcessingLLM}
                        variant={translationType === 'llm' ? 'llm' : 'ghost'}
                        showOriginal={false}
                        showCursor={isListening}
                        accentColor={containsQuestion ? 'amber' : 'cyan'}
                        title={getSpeechTypeLabel()}
                        minHeight="300px"
                        maxHeight="calc(50vh - 4rem)"
                    />
                </div>

                {/* COLUMN 2: Analysis */}
                <div className="sticky top-4 h-fit">
                    <div className="border-l-4 border-purple-500 bg-purple-900/10 min-h-[300px] max-h-[calc(50vh-4rem)] overflow-y-auto rounded-lg shadow-xl">
                        {/* Header */}
                        <div className="px-4 py-2.5 bg-purple-950/30 border-b border-purple-500/10 flex items-center justify-between sticky top-0 backdrop-blur z-10">
                            <div className="flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full bg-purple-400 ${isAnalyzing ? 'animate-pulse' : ''}`}></span>
                                <span className="text-[10px] font-black text-purple-300 uppercase tracking-widest">
                                    Аналіз
                                </span>
                            </div>
                            {isAnalyzing && (
                                <div className="flex gap-0.5">
                                    <div className="w-1 h-3 bg-purple-400 rounded-full animate-pulse" style={{animationDelay: '0ms'}}></div>
                                    <div className="w-1 h-3 bg-purple-400 rounded-full animate-pulse" style={{animationDelay: '100ms'}}></div>
                                    <div className="w-1 h-3 bg-purple-400 rounded-full animate-pulse" style={{animationDelay: '200ms'}}></div>
                                </div>
                            )}
                        </div>

                        {/* Content */}
                        <div className="p-4">
                            {analysis ? (
                                <div className="text-sm text-purple-200/90 leading-relaxed whitespace-pre-line">
                                    {analysis}
                                </div>
                            ) : containsQuestion ? (
                                isAnalyzing ? (
                                    <div className="space-y-2">
                                        <div className="animate-pulse bg-purple-700/20 rounded h-4 w-full"></div>
                                        <div className="animate-pulse bg-purple-700/20 rounded h-4 w-3/4"></div>
                                        <div className="animate-pulse bg-purple-700/20 rounded h-4 w-5/6"></div>
                                    </div>
                                ) : (
                                    <div className="text-xs text-purple-400/50 italic text-center py-4">
                                        Аналіз буде тут...
                                    </div>
                                )
                            ) : (
                                <div className="text-center py-8">
                                    <div className="w-12 h-12 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mx-auto mb-3">
                                        <svg className="w-6 h-6 text-purple-400 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                        </svg>
                                    </div>
                                    <div className="text-xs text-purple-500/50">
                                        Очікую питання для аналізу
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* COLUMN 3: Strategy */}
                <div className="sticky top-4 h-fit">
                    <div className="border-l-4 border-blue-500 bg-blue-900/10 min-h-[300px] max-h-[calc(50vh-4rem)] overflow-y-auto rounded-lg shadow-xl">
                        {/* Header */}
                        <div className="px-4 py-2.5 bg-blue-950/30 border-b border-blue-500/10 flex items-center justify-between sticky top-0 backdrop-blur z-10">
                            <div className="flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full bg-blue-400 ${isAnalyzing ? 'animate-pulse' : ''}`}></span>
                                <span className="text-[10px] font-black text-blue-300 uppercase tracking-widest">
                                    Стратегія
                                </span>
                            </div>
                        </div>

                        {/* Content */}
                        <div className="p-4">
                            {strategy ? (
                                <div className="text-sm text-blue-200/90 leading-relaxed whitespace-pre-line font-medium">
                                    {strategy}
                                </div>
                            ) : containsQuestion ? (
                                isAnalyzing ? (
                                    <div className="space-y-2">
                                        <div className="animate-pulse bg-blue-700/20 rounded h-4 w-full"></div>
                                        <div className="animate-pulse bg-blue-700/20 rounded h-4 w-2/3"></div>
                                    </div>
                                ) : (
                                    <div className="text-xs text-blue-400/50 italic text-center py-4">
                                        Стратегія буде тут...
                                    </div>
                                )
                            ) : (
                                <div className="text-center py-8">
                                    <div className="w-12 h-12 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mx-auto mb-3">
                                        <svg className="w-6 h-6 text-blue-400 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                                        </svg>
                                    </div>
                                    <div className="text-xs text-blue-500/50">
                                        Очікую питання для стратегії
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* BOTTOM ROW: Answer */}
            <div className="border-l-4 border-emerald-500 bg-emerald-900/10 rounded-lg shadow-xl">
                {/* Header */}
                <div className="px-4 py-2.5 bg-emerald-950/30 border-b border-emerald-500/10 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full bg-emerald-400 ${isGeneratingAnswer ? 'animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]' : ''}`}></span>
                        <span className="text-[10px] font-black text-emerald-300 uppercase tracking-widest">
                            Готова відповідь
                        </span>
                    </div>
                    <div className="flex items-center gap-3">
                        {isGeneratingAnswer && (
                            <div className="flex gap-0.5">
                                <div className="w-1 h-3 bg-emerald-400 rounded-full animate-pulse" style={{animationDelay: '0ms'}}></div>
                                <div className="w-1 h-3 bg-emerald-400 rounded-full animate-pulse" style={{animationDelay: '100ms'}}></div>
                                <div className="w-1 h-3 bg-emerald-400 rounded-full animate-pulse" style={{animationDelay: '200ms'}}></div>
                            </div>
                        )}
                        {/* Stats */}
                        <div className="flex items-center gap-3 text-xs">
                            <span className="text-gray-500">{wordCount} слів</span>
                            {sessionDuration > 0 && (
                                <span className="text-gray-500">{formatDuration(sessionDuration)}</span>
                            )}
                            {isListening && (
                                <div className="flex items-center gap-1 text-red-400">
                                    <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></div>
                                    <span>REC</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Content */}
                <div className="p-4">
                    {generatedAnswer ? (
                        <div className="space-y-3">
                            {/* Answer in target language */}
                            <div className="text-xl md:text-2xl font-bold text-emerald-300 leading-relaxed">
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
                        isGeneratingAnswer ? (
                            <div className="space-y-3 py-4">
                                <div className="animate-pulse bg-emerald-700/20 rounded h-8 w-full"></div>
                                <div className="animate-pulse bg-emerald-700/20 rounded h-8 w-2/3"></div>
                                <div className="text-[10px] text-emerald-500/50 mt-2">
                                    Генерую відповідь...
                                </div>
                            </div>
                        ) : (
                            <div className="text-center py-6">
                                <div className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500/20 border border-amber-500/30 rounded-lg">
                                    <span className="text-amber-400">❓</span>
                                    <span className="text-sm text-amber-300">Виявлено питання ({questionConfidence}%)</span>
                                </div>
                                <div className="text-xs text-gray-500 mt-2">
                                    Відповідь буде згенерована після паузи
                                </div>
                            </div>
                        )
                    ) : (
                        <div className="text-center py-8">
                            <div className="text-sm text-emerald-400/50 mb-2">
                                {speechType === 'INFO' ? 'Інтерв\'юер розповідає про компанію' :
                                 speechType === 'SMALL_TALK' ? 'Неформальна бесіда' :
                                 'Очікую питання...'}
                            </div>
                            <div className="text-xs text-gray-500">
                                Відповідь з'явиться коли інтерв'юер поставить питання
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default StreamingFullModeLayout;
