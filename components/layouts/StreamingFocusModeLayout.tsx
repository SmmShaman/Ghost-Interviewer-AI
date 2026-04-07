/**
 * STREAMING FOCUS MODE LAYOUT
 *
 * Interview mode: Translation + Answer generation
 * Inherits SIMPLE mode improvements: NMT speed, stable text, no flickering
 *
 * ┌────────────────────────────┬────────────────────────────┐
 * │  Переклад (NMT, 200мс)    │  Відповідь + Topic Structure│
 * │  стабільний, block-based   │  (Gemini Flash/Flash-Lite)  │
 * │  word-by-word animation    │                             │
 * └────────────────────────────┴────────────────────────────┘
 */

import React, { useEffect, useRef, useState } from 'react';
import { localTranslator } from '../../services/localTranslator';

interface StreamingFocusModeLayoutProps {
    accumulatedOriginal: string;
    accumulatedGhostTranslation: string;
    accumulatedLLMTranslation: string;

    frozenTranslation?: string;
    frozenWordCount?: number;

    interimText?: string;
    interimGhostTranslation?: string;

    isListening: boolean;
    isProcessingLLM: boolean;

    containsQuestion: boolean;
    questionConfidence: number;
    speechType: 'QUESTION' | 'INFO' | 'STORY' | 'SMALL_TALK' | 'UNKNOWN';

    generatedAnswer?: string;
    answerTranslation?: string;
    isGeneratingAnswer?: boolean;

    wordCount: number;
    sessionDuration?: number;

    topicSummary?: string;
    isProcessingTopics?: boolean;
}

const StreamingFocusModeLayout: React.FC<StreamingFocusModeLayoutProps> = ({
    accumulatedGhostTranslation,
    isListening,
    isProcessingLLM,
    containsQuestion,
    questionConfidence,
    speechType,
    generatedAnswer = '',
    answerTranslation = '',
    isGeneratingAnswer = false,
    wordCount,
    sessionDuration = 0,
    topicSummary = '',
    isProcessingTopics = false
}) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [displayedText, setDisplayedText] = useState('');
    const targetTextRef = useRef('');

    // Strip placeholder tokens (from SIMPLE mode)
    const strip = (text: string): string =>
        text.replace(/⏳\.{0,3}/g, '').replace(/[❌⚠️]/g, '').trim();

    const mainText = strip(accumulatedGhostTranslation);

    // Smooth word-by-word animation (from SIMPLE mode)
    useEffect(() => {
        targetTextRef.current = mainText;
        const interval = setInterval(() => {
            setDisplayedText(prev => {
                const target = targetTextRef.current;
                if (!target) return '';
                if (prev.length >= target.length) return target;
                const nextSpace = target.indexOf(' ', prev.length + 1);
                return target.substring(0, nextSpace === -1 ? target.length : nextSpace);
            });
        }, 200);
        return () => clearInterval(interval);
    }, [mainText]);

    // Auto-scroll translation
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [displayedText]);

    const getMethodLabel = (): { label: string; color: string } => {
        const status = localTranslator.getStatus();
        if (status.useChromeAPI) return { label: 'Chrome', color: 'text-blue-400' };
        if (status.useGoogleNMT) return { label: 'NMT', color: 'text-green-400' };
        return { label: 'Opus', color: 'text-cyan-400' };
    };
    const method = getMethodLabel();

    const formatDuration = (ms: number): string => {
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        return `${m}:${(s % 60).toString().padStart(2, '0')}`;
    };

    // Render blocks with alternating colors (from SIMPLE mode)
    const renderBlocks = () => {
        if (!displayedText) return null;
        return displayedText.split('｜').map((block, i) => {
            const trimmed = block.trim();
            if (!trimmed) return null;
            const isEven = i % 2 === 0;
            return (
                <div key={i} className={`text-base md:text-lg leading-relaxed font-medium py-1 ${
                    isEven ? 'text-gray-100' : 'text-sky-200 pl-3 border-l-2 border-sky-800/40'
                }`}>
                    {trimmed}
                </div>
            );
        });
    };

    // Parse topic summary
    const renderTopics = () => {
        if (!topicSummary) return null;
        return topicSummary.split(/(?=📌)/).filter(b => b.trim()).map((block, i) => {
            const lines = block.trim().split('\n').filter(l => l.trim());
            const title = lines[0] || '';
            const body = lines.slice(1).join(' ').trim();
            return (
                <div key={i} className="mb-3 last:mb-0">
                    <div className="text-sm font-semibold text-gray-200 leading-snug">{title}</div>
                    {body && <div className="text-xs text-gray-400 leading-relaxed mt-0.5">{body}</div>}
                </div>
            );
        });
    };

    return (
        <div className="w-full h-full flex flex-col" style={{ maxHeight: 'calc(100vh - 8rem)' }}>
            <div className="flex-1 flex gap-3 min-h-0">

                {/* LEFT: Translation (stable, block-based) */}
                <div className="flex-1 basis-0 rounded-2xl bg-gray-950/80 border border-gray-800/50 shadow-2xl overflow-hidden flex flex-col">
                    <div
                        ref={scrollRef}
                        className="flex-1 overflow-y-auto scroll-smooth px-6 py-5"
                    >
                        {displayedText ? (
                            <div className="space-y-3">
                                {renderBlocks()}
                                {isListening && (
                                    <div className="mt-2 text-emerald-400 animate-pulse text-lg">▊</div>
                                )}
                            </div>
                        ) : (
                            <div className="flex items-center justify-center h-full">
                                <p className="text-gray-600 text-sm">
                                    {isListening ? 'Слухаю інтерв\'юера...' : 'Натисніть Start'}
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                {/* RIGHT: Answer + Topics */}
                <div className="flex-1 basis-0 rounded-2xl bg-gray-900/50 border border-gray-800/30 overflow-hidden flex flex-col">
                    {/* Answer section */}
                    <div className="shrink-0 border-b border-gray-800/30 px-5 py-4">
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-[10px] text-emerald-400 uppercase tracking-wider font-bold">Відповідь</span>
                            {isGeneratingAnswer && (
                                <span className="flex items-center gap-1 text-[9px] text-emerald-400">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                    AI
                                </span>
                            )}
                        </div>

                        {generatedAnswer ? (
                            <div className="space-y-2">
                                <div className="text-base font-semibold text-emerald-300 leading-relaxed">
                                    {generatedAnswer}
                                </div>
                                {answerTranslation && (
                                    <div className="text-sm text-gray-400 italic">{answerTranslation}</div>
                                )}
                            </div>
                        ) : isGeneratingAnswer ? (
                            <div className="space-y-2">
                                <div className="animate-pulse bg-emerald-700/20 rounded h-5 w-full" />
                                <div className="animate-pulse bg-emerald-700/20 rounded h-5 w-2/3" />
                                <p className="text-[10px] text-emerald-500/50 mt-2">Генерую відповідь...</p>
                            </div>
                        ) : containsQuestion ? (
                            <div className="text-sm text-amber-300">
                                Виявлено питання ({questionConfidence}%) — відповідь після паузи
                            </div>
                        ) : (
                            <div className="text-sm text-gray-600 italic">Очікую питання...</div>
                        )}
                    </div>

                    {/* Topics section */}
                    <div className="flex-1 overflow-y-auto px-5 py-4">
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">Структура</span>
                            {isProcessingTopics && (
                                <span className="flex items-center gap-1 text-[9px] text-purple-400">
                                    <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                                    AI
                                </span>
                            )}
                        </div>
                        {topicSummary ? renderTopics() : (
                            <p className="text-gray-700 text-xs italic">
                                {wordCount > 0 ? 'Аналізую...' : 'Теми з\'являться тут'}
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {/* Status bar */}
            <div className="mt-2 px-4 py-2 bg-gray-900/50 rounded-xl border border-gray-800/50 flex items-center justify-between text-xs">
                <div className="flex items-center gap-4">
                    {wordCount > 0 && <span className="text-gray-400 font-mono">{wordCount} слів</span>}
                    {sessionDuration > 0 && <span className="text-gray-500 font-mono">{formatDuration(sessionDuration)}</span>}
                    <span className={method.color}>{method.label}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                        speechType === 'QUESTION' ? 'bg-amber-500/20 text-amber-300' :
                        speechType === 'INFO' ? 'bg-blue-500/20 text-blue-300' :
                        'bg-gray-500/20 text-gray-400'
                    }`}>
                        {speechType === 'QUESTION' ? '❓' : speechType === 'INFO' ? 'ℹ️' : '🎤'} {speechType}
                    </span>
                </div>
                <div className="flex items-center gap-3">
                    {isListening && (
                        <span className="text-red-400 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                            REC
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
};

export default StreamingFocusModeLayout;
