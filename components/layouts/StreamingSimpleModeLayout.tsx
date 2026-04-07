/**
 * STREAMING SIMPLE MODE LAYOUT — Dual Panel
 *
 * ┌────────────────────────────┬────────────────────────────┐
 * │                            │                            │
 * │  Переклад (субтитри)      │  📌 Структура тем          │
 * │  слово за словом           │  (Flash-Lite, з оригіналу) │
 * │  плавна поява        ▊     │                            │
 * │                            │                            │
 * ├────────────────────────────┤                            │
 * │  interim...                │                            │
 * └────────────────────────────┴────────────────────────────┘
 *
 * Left (50%): Live NMT subtitles with smooth word-by-word animation
 * Right (50%): Structured topics from Gemini Flash-Lite
 */

import React, { useEffect, useRef, useState } from 'react';
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

    topicSummary?: string;
    isProcessingTopics?: boolean;
}

const StreamingSimpleModeLayout: React.FC<StreamingSimpleModeLayoutProps> = ({
    accumulatedGhostTranslation,
    interimText = '',
    interimGhostTranslation = '',
    isListening,
    isProcessingLLM,
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
    const interimDisplay = interimGhostTranslation || interimText || '';

    // Smooth word-by-word animation
    useEffect(() => {
        targetTextRef.current = mainText;

        // Always start animation when target changes
        const interval = setInterval(() => {
            setDisplayedText(prev => {
                const target = targetTextRef.current;
                if (!target) return '';
                if (prev.length >= target.length) return target;
                // Find next word boundary
                const nextSpace = target.indexOf(' ', prev.length + 1);
                return target.substring(0, nextSpace === -1 ? target.length : nextSpace);
            });
        }, 60);

        return () => clearInterval(interval);
    }, [mainText]);

    // Auto-scroll subtitles
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

    // Parse topic summary into styled blocks
    const renderTopics = () => {
        if (!topicSummary) return null;
        const blocks = topicSummary.split(/(?=📌)/).filter(b => b.trim());
        return blocks.map((block, i) => {
            const lines = block.trim().split('\n').filter(l => l.trim());
            const title = lines[0] || '';
            const body = lines.slice(1).join(' ').trim();
            return (
                <div key={i} className="mb-4 last:mb-0">
                    <div className="text-base font-semibold text-gray-200 leading-snug">
                        {title}
                    </div>
                    {body && (
                        <div className="text-base text-gray-400 leading-relaxed mt-1">
                            {body}
                        </div>
                    )}
                </div>
            );
        });
    };

    return (
        <div className="w-full h-full flex flex-col" style={{ maxHeight: 'calc(100vh - 8rem)' }}>
            <div className="flex-1 flex gap-3 min-h-0">

                {/* LEFT PANEL: Live subtitles */}
                <div className="w-1/2 rounded-2xl bg-gray-950/80 border border-gray-800/50 shadow-2xl overflow-hidden flex flex-col">
                    <div
                        ref={scrollRef}
                        className="flex-1 overflow-y-auto scroll-smooth px-6 py-5"
                    >
                        {displayedText ? (
                            <div className="text-base md:text-lg leading-relaxed font-medium text-gray-100" style={{ whiteSpace: 'pre-line' }}>
                                {displayedText}
                                {isListening && (
                                    <span className="inline-block ml-0.5 text-emerald-400 animate-pulse">▊</span>
                                )}
                            </div>
                        ) : (
                            <div className="flex items-center justify-center h-full">
                                <div className="text-center space-y-3">
                                    <div className="text-4xl opacity-20">🎧</div>
                                    <p className="text-gray-600 text-sm">
                                        {isListening ? 'Слухаю...' : 'Натисніть Start'}
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Interim */}
                    <div className="shrink-0 border-t border-gray-800/30 bg-gray-900/40 px-6 py-2"
                         style={{ minHeight: '2.5rem', maxHeight: '3rem' }}
                    >
                        {interimDisplay ? (
                            <div className="text-sm text-gray-500 italic truncate">{interimDisplay}</div>
                        ) : isListening ? (
                            <div className="text-gray-700 italic text-xs">слухаю...</div>
                        ) : null}
                    </div>
                </div>

                {/* RIGHT PANEL: Structured topics */}
                <div className="w-1/2 rounded-2xl bg-gray-900/50 border border-gray-800/30 overflow-hidden flex flex-col">
                    <div className="flex items-center justify-between px-6 py-3 shrink-0 border-b border-gray-800/20">
                        <span className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">
                            Структура
                        </span>
                        {isProcessingTopics && (
                            <span className="flex items-center gap-1 text-[9px] text-purple-400">
                                <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                                AI
                            </span>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto px-6 py-4">
                        {topicSummary ? (
                            renderTopics()
                        ) : (
                            <div className="flex items-center justify-center h-full">
                                <p className="text-gray-700 text-sm italic">
                                    {wordCount > 0 ? 'Аналізую...' : 'Теми з\'являться тут'}
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
                    <span className={method.color}>{method.label}</span>
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

export default StreamingSimpleModeLayout;
