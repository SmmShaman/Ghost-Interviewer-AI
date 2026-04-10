/**
 * STREAMING SIMPLE MODE LAYOUT — Original + Structure
 *
 * ┌──────────────────────────────┬──────────────────────────────┐
 * │  🔴 Оригінал                 │  📌 Структура               │
 * │  hele oppvarming som vi...   │  📌 **Тема 1**              │
 * │  (сірий, mono, auto-scroll) │  Опис теми...               │
 * │                              │  📌 **Тема 2**              │
 * │                              │  Опис теми...               │
 * └──────────────────────────────┴──────────────────────────────┘
 */

import React, { useEffect, useRef } from 'react';

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
    topicSummary?: string;
    isProcessingTopics?: boolean;
}

const StreamingSimpleModeLayout: React.FC<StreamingSimpleModeLayoutProps> = ({
    accumulatedOriginal,
    isListening,
    wordCount,
    sessionDuration = 0,
    topicSummary = '',
    isProcessingTopics = false
}) => {
    const originalScrollRef = useRef<HTMLDivElement>(null);
    const topicScrollRef = useRef<HTMLDivElement>(null);

    const originalText = accumulatedOriginal || '';

    // Auto-scroll original text
    useEffect(() => {
        if (originalScrollRef.current) {
            originalScrollRef.current.scrollTop = originalScrollRef.current.scrollHeight;
        }
    }, [originalText]);

    // Auto-scroll topics — smooth animation
    useEffect(() => {
        if (topicScrollRef.current && topicSummary) {
            topicScrollRef.current.scrollTo({
                top: topicScrollRef.current.scrollHeight,
                behavior: 'smooth'
            });
        }
    }, [topicSummary]);

    const formatDuration = (ms: number): string => {
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        return `${m}:${(s % 60).toString().padStart(2, '0')}`;
    };

    // Render topics: 📌 heading + body underneath
    const renderTopics = () => {
        if (!topicSummary) return null;
        const blocks = topicSummary.split(/(?=📌)/).filter(b => b.trim());
        return blocks.map((block, i) => {
            const lines = block.trim().split('\n').filter(l => l.trim());
            const title = lines[0] || '';
            const body = lines.slice(1).join(' ').trim();
            return (
                <div key={i} className="mb-3 last:mb-0 animate-fade-in-up">
                    <div className="text-sm font-semibold text-gray-200 leading-snug">{title}</div>
                    {body && <div className="text-sm text-gray-400 leading-relaxed mt-0.5">{body}</div>}
                </div>
            );
        });
    };

    return (
        <div className="w-full h-full flex flex-col" style={{ maxHeight: 'calc(100vh - 8rem)' }}>
            <div className="flex-1 flex gap-3 min-h-0">

                {/* LEFT: Original text */}
                <div className="w-[35%] shrink-0 rounded-2xl bg-gray-950/60 border border-gray-800/30 overflow-hidden flex flex-col">
                    <div className="px-3 py-1.5 border-b border-gray-800/20 shrink-0">
                        <span className="text-[10px] text-gray-600 uppercase tracking-wider font-bold">Оригінал</span>
                    </div>
                    <div ref={originalScrollRef} className="flex-1 overflow-y-auto scroll-smooth px-4 py-3">
                        {originalText ? (
                            <p className="text-sm text-gray-400 leading-relaxed font-mono">
                                {originalText}
                                {isListening && <span className="text-emerald-400 animate-pulse ml-1">▊</span>}
                            </p>
                        ) : (
                            <p className="text-gray-700 text-sm italic">
                                {isListening ? 'Слухаю...' : 'Натисніть Start'}
                            </p>
                        )}
                    </div>
                </div>

                {/* RIGHT: Clean flowing text — no headers, just content */}
                <div className="flex-1 rounded-2xl bg-gray-900/50 border border-gray-800/30 overflow-hidden flex flex-col shadow-2xl relative">
                    {isProcessingTopics && (
                        <span className="absolute top-2 right-3 w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse z-10" />
                    )}
                    <div ref={topicScrollRef} className="flex-1 overflow-y-auto scroll-smooth px-6 py-5">
                        {topicSummary ? (
                            <div>{renderTopics()}</div>
                        ) : (
                            <div className="flex items-center justify-center h-full">
                                <p className="text-gray-700 text-sm italic">
                                    {isListening ? 'Слухаю...' : 'Натисніть Start'}
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Status bar */}
            <div className="mt-2 px-4 py-2 bg-gray-900/50 rounded-xl border border-gray-800/50 flex items-center justify-between text-xs">
                <div className="flex items-center gap-4">
                    {wordCount > 0 && <span className="text-gray-400 font-mono">{wordCount} слів</span>}
                    {sessionDuration > 0 && <span className="text-gray-500 font-mono">{formatDuration(sessionDuration)}</span>}
                </div>
                <div className="flex items-center gap-3">
                    {isProcessingTopics && (
                        <span className="text-purple-400 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                            AI
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

export default StreamingSimpleModeLayout;
