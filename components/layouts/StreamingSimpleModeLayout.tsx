/**
 * STREAMING SIMPLE MODE LAYOUT — Topics + Literary Translation + Raw Words
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │  MAIN: Three columns aligned by chunks                              │
 * │  ┌──────────────────┬──────────────────────┬───────────────────┐    │
 * │  │ 📌 **Тема 1**    │ Literary rewrite     │ raw raw words...  │    │
 * │  │ Structured topics│ flowing prose         │ (exact original)  │    │
 * │  ├──────────────────┼──────────────────────┼───────────────────┤    │
 * │  │ 📌 **Тема 2**    │ More literary text   │ more raw words    │    │
 * │  └──────────────────┴──────────────────────┴───────────────────┘    │
 * ├──────────────────────────────────────────────────────────────────────┤
 * │  RAW LOG: continuous raw text                                       │
 * └──────────────────────────────────────────────────────────────────────┘
 */

import React, { useEffect, useRef } from 'react';

interface TopicChunk {
    rawText: string;
    topics: string;
}

interface LiteraryChunk {
    rawText: string;
    topics: string;
    literary: string;
}

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
    topicChunks?: TopicChunk[];
    isProcessingTopics?: boolean;
    literaryChunks?: LiteraryChunk[];
    isProcessingLiterary?: boolean;
}

const StreamingSimpleModeLayout: React.FC<StreamingSimpleModeLayoutProps> = ({
    accumulatedOriginal,
    interimText = '',
    isListening,
    wordCount,
    sessionDuration = 0,
    literaryChunks = [],
    isProcessingLiterary = false
}) => {
    const mainScrollRef = useRef<HTMLDivElement>(null);
    const logScrollRef = useRef<HTMLDivElement>(null);

    const originalText = accumulatedOriginal || '';

    // Auto-scroll main area
    useEffect(() => {
        if (mainScrollRef.current && literaryChunks.length > 0) {
            mainScrollRef.current.scrollTo({
                top: mainScrollRef.current.scrollHeight,
                behavior: 'smooth'
            });
        }
    }, [literaryChunks]);

    // Auto-scroll raw log
    useEffect(() => {
        if (logScrollRef.current) {
            logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight;
        }
    }, [originalText, interimText]);

    const formatDuration = (ms: number): string => {
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        return `${m}:${(s % 60).toString().padStart(2, '0')}`;
    };

    const hasContent = literaryChunks.length > 0;

    return (
        <div className="w-full h-full flex flex-col" style={{ maxHeight: 'calc(100vh - 8rem)' }}>

            {/* MAIN: Literary translation + Raw words */}
            <div className="flex-1 min-h-0 rounded-2xl bg-gray-900/50 border border-gray-800/30 overflow-hidden flex flex-col shadow-2xl relative">
                {isProcessingLiterary && (
                    <span className="absolute top-2 right-3 w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse z-10" />
                )}

                {/* Column headers */}
                <div className="px-4 py-2 border-b border-gray-800/30 flex gap-3 shrink-0">
                    <div className="w-[70%] shrink-0">
                        <span className="text-[9px] text-amber-400/60 uppercase tracking-wider font-bold">Літературний переклад</span>
                    </div>
                    <div className="flex-1">
                        <span className="text-[9px] text-gray-600 uppercase tracking-wider font-bold">Оригінал</span>
                    </div>
                </div>

                <div ref={mainScrollRef} className="flex-1 overflow-y-auto scroll-smooth px-4 py-4">
                    {literaryChunks.length > 0 ? (
                        <div className="space-y-1">
                            {literaryChunks.map((chunk, chunkIdx) => (
                                    <div
                                        key={chunkIdx}
                                        className="flex gap-3 border-b border-gray-800/20 last:border-b-0 py-2 animate-fade-in-up"
                                    >
                                        {/* LEFT: Literary translation (primary) */}
                                        <div className="w-[70%] shrink-0">
                                            <p className="text-base text-amber-200/90 leading-relaxed">
                                                {chunk.literary}
                                            </p>
                                        </div>

                                        {/* RIGHT: Raw words */}
                                        <div className="flex-1 flex items-start">
                                            <p className="text-xs text-gray-600 leading-relaxed font-mono">
                                                {chunk.rawText}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                        </div>
                    ) : (
                        <div className="flex items-center justify-center h-full">
                            <p className="text-gray-700 text-sm italic">
                                {isListening ? 'Слухаю...' : 'Натисніть Start'}
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* RAW LOG: continuous raw text */}
            <div className="h-[20%] shrink-0 mt-2 rounded-xl bg-gray-950/60 border border-gray-800/30 overflow-hidden flex flex-col">
                <div className="px-3 py-1 border-b border-gray-800/20 shrink-0">
                    <span className="text-[9px] text-gray-600 uppercase tracking-wider font-bold">Log</span>
                </div>
                <div ref={logScrollRef} className="flex-1 overflow-y-auto px-3 py-2">
                    {(originalText || interimText) ? (
                        <p className="text-xs leading-relaxed font-mono">
                            <span className="text-gray-500">{originalText}</span>
                            {interimText && (
                                <span className="text-gray-600 italic">{originalText ? ' ' : ''}{interimText}</span>
                            )}
                            {isListening && <span className="text-emerald-400 animate-pulse ml-1">▊</span>}
                        </p>
                    ) : (
                        <p className="text-gray-700 text-xs italic">
                            {isListening ? 'Слухаю...' : ''}
                        </p>
                    )}
                </div>
            </div>

            {/* Status bar */}
            <div className="mt-2 px-4 py-2 bg-gray-900/50 rounded-xl border border-gray-800/50 flex items-center justify-between text-xs">
                <div className="flex items-center gap-4">
                    {wordCount > 0 && <span className="text-gray-400 font-mono">{wordCount} слів</span>}
                    {sessionDuration > 0 && <span className="text-gray-500 font-mono">{formatDuration(sessionDuration)}</span>}
                </div>
                <div className="flex items-center gap-3">
                    {isProcessingLiterary && (
                        <span className="text-amber-400 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                            LIT
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
