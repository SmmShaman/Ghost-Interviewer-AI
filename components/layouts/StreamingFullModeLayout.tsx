/**
 * STREAMING FULL MODE LAYOUT
 *
 * Full interview assistance: Translation + Analysis + Strategy + Answer
 * Inherits SIMPLE mode improvements: NMT speed, stable text, no flickering
 *
 * ┌──────────────────┬──────────────────┬──────────────────┐
 * │  Переклад        │  Аналіз          │  Стратегія       │
 * │  (NMT, stable)   │  (Flash-Lite)    │  (Flash-Lite)    │
 * ├──────────────────┴──────────────────┴──────────────────┤
 * │  Рекомендована відповідь (Gemini Flash)                │
 * └───────────────────────────────────────────────────────┘
 */

import React, { useEffect, useRef, useState } from 'react';
import { localTranslator } from '../../services/localTranslator';

interface StreamingFullModeLayoutProps {
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

    analysis?: string;
    strategy?: string;
    isAnalyzing?: boolean;

    generatedAnswer?: string;
    answerTranslation?: string;
    isGeneratingAnswer?: boolean;

    wordCount: number;
    sessionDuration?: number;

    topicSummary?: string;
    isProcessingTopics?: boolean;
}

const StreamingFullModeLayout: React.FC<StreamingFullModeLayoutProps> = ({
    accumulatedGhostTranslation,
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
    sessionDuration = 0,
    topicSummary = '',
    isProcessingTopics = false
}) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [displayedText, setDisplayedText] = useState('');
    const targetTextRef = useRef('');

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

    // Render blocks with alternating colors
    const renderBlocks = () => {
        if (!displayedText) return null;
        return displayedText.split('｜').map((block, i) => {
            const trimmed = block.trim();
            if (!trimmed) return null;
            const isEven = i % 2 === 0;
            return (
                <div key={i} className={`text-sm md:text-base leading-relaxed font-medium py-1 ${
                    isEven ? 'text-gray-100' : 'text-sky-200 pl-2 border-l-2 border-sky-800/40'
                }`}>
                    {trimmed}
                </div>
            );
        });
    };

    return (
        <div className="w-full h-full flex flex-col" style={{ maxHeight: 'calc(100dvh - 5rem)' }}>
            {/* Top row: Translation + Analysis + Strategy */}
            <div className="flex-1 flex flex-col sm:flex-row gap-2 min-h-0">

                {/* COL 1: Translation (stable, block-based) */}
                <div className="flex-1 basis-0 rounded-xl bg-gray-950/80 border border-gray-800/50 shadow-xl overflow-hidden">
                    <div
                        ref={scrollRef}
                        className="h-full overflow-y-auto scroll-smooth px-4 py-4"
                    >
                        {displayedText ? (
                            <div className="space-y-2">
                                {renderBlocks()}
                                {isListening && <div className="text-emerald-400 animate-pulse">▊</div>}
                            </div>
                        ) : (
                            <div className="flex items-center justify-center h-full">
                                <p className="text-gray-600 text-sm">{isListening ? 'Слухаю...' : 'Start'}</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* COL 2: Analysis */}
                <div className="flex-1 basis-0 rounded-xl bg-purple-950/30 border border-purple-800/30 overflow-hidden flex flex-col">
                    <div className="px-4 py-2 border-b border-purple-800/20 flex items-center justify-between shrink-0">
                        <span className="text-[10px] text-purple-400 uppercase tracking-wider font-bold">Аналіз</span>
                        {isAnalyzing && (
                            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                        )}
                    </div>
                    <div className="flex-1 overflow-y-auto px-4 py-3">
                        {analysis ? (
                            <div className="text-sm text-purple-200 leading-relaxed">{analysis}</div>
                        ) : (
                            <p className="text-purple-700 text-xs italic">
                                {containsQuestion ? 'Аналізую питання...' : 'Аналіз з\'явиться при питанні'}
                            </p>
                        )}
                    </div>
                </div>

                {/* COL 3: Strategy */}
                <div className="flex-1 basis-0 rounded-xl bg-blue-950/30 border border-blue-800/30 overflow-hidden flex flex-col">
                    <div className="px-4 py-2 border-b border-blue-800/20 flex items-center justify-between shrink-0">
                        <span className="text-[10px] text-blue-400 uppercase tracking-wider font-bold">Стратегія</span>
                        {isAnalyzing && (
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                        )}
                    </div>
                    <div className="flex-1 overflow-y-auto px-4 py-3">
                        {strategy ? (
                            <div className="text-sm text-blue-200 leading-relaxed">{strategy}</div>
                        ) : (
                            <p className="text-blue-700 text-xs italic">
                                {containsQuestion ? 'Формую стратегію...' : 'Стратегія з\'явиться при питанні'}
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {/* Bottom row: Answer */}
            <div className="mt-2 rounded-xl bg-emerald-950/30 border border-emerald-800/30 px-5 py-3"
                 style={{ minHeight: '5rem', maxHeight: '10rem', overflowY: 'auto' }}
            >
                <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] text-emerald-400 uppercase tracking-wider font-bold">Відповідь</span>
                    {isGeneratingAnswer && (
                        <span className="flex items-center gap-1 text-[9px] text-emerald-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            AI
                        </span>
                    )}
                </div>
                {generatedAnswer ? (
                    <div className="space-y-1">
                        <div className="text-base font-semibold text-emerald-300 leading-relaxed">{generatedAnswer}</div>
                        {answerTranslation && (
                            <div className="text-sm text-gray-400 italic">{answerTranslation}</div>
                        )}
                    </div>
                ) : isGeneratingAnswer ? (
                    <div className="flex gap-2">
                        <div className="animate-pulse bg-emerald-700/20 rounded h-4 flex-1" />
                        <div className="animate-pulse bg-emerald-700/20 rounded h-4 w-1/3" />
                    </div>
                ) : (
                    <p className="text-emerald-700 text-xs italic">
                        {containsQuestion ? `Питання (${questionConfidence}%) — генерую...` : 'Очікую питання'}
                    </p>
                )}
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
                        {speechType}
                    </span>
                </div>
                <div className="flex items-center gap-3">
                    {isProcessingTopics && (
                        <span className="text-purple-400 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                            Flash-Lite
                        </span>
                    )}
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

export default StreamingFullModeLayout;
