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

import React from 'react';
import StreamingTextView from '../StreamingTextView';

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
    // SLIDING WINDOW DISPLAY: Frozen zone + Active zone
    // Frozen zone: LLM-translated text that won't change
    // Active zone: Latest text that may still be updated by Ghost/LLM

    // Get active part of LLM translation (words after frozen)
    const llmWords = accumulatedLLMTranslation ? accumulatedLLMTranslation.split(/\s+/) : [];
    const frozenWords = frozenTranslation ? frozenTranslation.split(/\s+/) : [];
    const activeLLMTranslation = llmWords.slice(frozenWords.length).join(' ');

    // Get active part of Ghost translation
    const ghostWords = accumulatedGhostTranslation ? accumulatedGhostTranslation.split(/\s+/) : [];
    const activeGhostTranslation = ghostWords.slice(frozenWords.length).join(' ');

    // Display: Frozen + (LLM active || Ghost active)
    const activeTranslation = activeLLMTranslation || activeGhostTranslation;
    const displayTranslation = frozenTranslation
        ? `${frozenTranslation} ${activeTranslation}`.trim()
        : (accumulatedLLMTranslation || accumulatedGhostTranslation);

    const translationType = accumulatedLLMTranslation ? 'llm' : 'ghost';

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
        <div className="max-w-[1600px] mx-auto h-full flex flex-col">
            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
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
                        minHeight="400px"
                        maxHeight="calc(100vh - 14rem)"
                    />

                    {/* Question detection indicator */}
                    {containsQuestion && questionConfidence > 50 && (
                        <div className="mt-2 px-4 py-2 bg-amber-900/30 border border-amber-500/30 rounded-lg flex items-center gap-3">
                            <div className="w-3 h-3 rounded-full bg-amber-400 animate-pulse shadow-[0_0_8px_rgba(251,191,36,0.8)]"></div>
                            <span className="text-sm text-amber-300 font-medium">
                                Виявлено питання ({questionConfidence}% впевненість)
                            </span>
                        </div>
                    )}
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
                    {/* Translation source indicator */}
                    <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${translationType === 'llm' ? 'bg-emerald-400' : 'bg-cyan-400'}`}></span>
                        <span className={`text-xs ${translationType === 'llm' ? 'text-emerald-400' : 'text-cyan-400'}`}>
                            {translationType === 'llm' ? 'LLM' : 'Ghost'}
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
