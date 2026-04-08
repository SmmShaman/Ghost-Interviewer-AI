/**
 * STREAMING FOCUS MODE LAYOUT — Interview Assistant
 *
 * Left panel: identical to SIMPLE (NMT subtitles, stable, block-based)
 * Right panel: chronological conversation log
 *   - 📌 INFO entries (company, conditions, requirements)
 *   - ❓ QUESTION entries (detected questions to candidate)
 *   - 💡 ANSWER entries (generated from candidate profile)
 *
 * ┌────────────────────────────┬────────────────────────────┐
 * │  Субтитри (NMT, 200мс)    │  📌 Про компанію           │
 * │  стабільні, block-based    │  📌 Умови роботи           │
 * │                            │  ❓ Розкажи про себе       │
 * │                            │  💡 Відповідь: "Я маю..."  │
 * └────────────────────────────┴────────────────────────────┘
 */

import React, { useEffect, useRef, useState } from 'react';
import { localTranslator } from '../../services/localTranslator';

interface StreamingFocusModeLayoutProps {
    accumulatedOriginal: string;
    accumulatedGhostTranslation: string;
    accumulatedLLMTranslation: string;

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

    conversationLog?: string;
    lastDetectedQuestion?: string;
    isProcessingConversation?: boolean;
    answeredQuestions?: Array<{ question: string; answer: string; translation: string }>;
}

const StreamingFocusModeLayout: React.FC<StreamingFocusModeLayoutProps> = ({
    accumulatedGhostTranslation,
    isListening,
    isProcessingLLM,
    generatedAnswer = '',
    answerTranslation = '',
    isGeneratingAnswer = false,
    wordCount,
    sessionDuration = 0,
    conversationLog = '',
    lastDetectedQuestion = '',
    isProcessingConversation = false,
    answeredQuestions = []
}) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const logScrollRef = useRef<HTMLDivElement>(null);
    const [displayedText, setDisplayedText] = useState('');
    const targetTextRef = useRef('');

    const strip = (text: string): string =>
        text.replace(/⏳\.{0,3}/g, '').replace(/[❌⚠️]/g, '').trim();

    const mainText = strip(accumulatedGhostTranslation);

    // Smooth word-by-word animation (from SIMPLE)
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

    // Auto-scroll subtitles
    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [displayedText]);

    // Auto-scroll conversation log (new entries at bottom)
    useEffect(() => {
        if (logScrollRef.current) logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight;
    }, [conversationLog]);

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

    // Render blocks with alternating colors (from SIMPLE)
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

    // Render conversation log entries with answers inserted after questions
    const renderConversationLog = () => {
        if (!conversationLog || typeof conversationLog !== 'string') return null;

        let entries: string[];
        try {
            entries = conversationLog.split(/(?=📌|❓)/).filter(e => e.trim());
        } catch {
            return null;
        }
        if (entries.length === 0) return null;
        let questionIndex = 0;
        const result: React.ReactNode[] = [];

        entries.forEach((entry, i) => {
            const isQuestion = entry.startsWith('❓');
            const lines = entry.trim().split('\n').filter(l => l.trim());
            const title = lines[0] || '';
            const body = lines.slice(1).join('\n').trim();

            const bgClass = isQuestion ? 'bg-amber-900/20' : 'bg-gray-800/30';
            const borderClass = isQuestion ? 'border-amber-500/30' : 'border-gray-700/30';
            const titleColor = isQuestion ? 'text-amber-300' : 'text-gray-200';

            result.push(
                <div key={`entry-${i}`} className={`mb-3 rounded-lg ${bgClass} border ${borderClass} px-4 py-3`}>
                    <div className={`text-sm font-semibold ${titleColor} leading-snug`}>{title}</div>
                    {body && (
                        <div className="text-sm text-gray-300 leading-relaxed mt-1" style={{ whiteSpace: 'pre-line' }}>
                            {body}
                        </div>
                    )}
                </div>
            );

            // Insert answer after question (if available)
            if (isQuestion) {
                const answer = answeredQuestions[questionIndex];
                if (answer) {
                    result.push(
                        <div key={`answer-${questionIndex}`} className="mb-3 rounded-lg bg-emerald-900/20 border border-emerald-500/30 px-4 py-3">
                            <div className="text-sm font-semibold text-emerald-300 leading-snug">💡 Рекомендована відповідь</div>
                            <div className="text-sm text-emerald-200 leading-relaxed mt-1">{answer.answer}</div>
                            {answer.translation && (
                                <div className="text-sm text-gray-400 italic leading-relaxed mt-2 pt-2 border-t border-emerald-800/30">
                                    {answer.translation}
                                </div>
                            )}
                        </div>
                    );
                } else if (isGeneratingAnswer && questionIndex === answeredQuestions.length) {
                    result.push(
                        <div key={`generating-${questionIndex}`} className="mb-3 rounded-lg bg-emerald-900/10 border border-emerald-500/20 px-4 py-3">
                            <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                                <span className="text-sm text-emerald-400">Генерую відповідь...</span>
                            </div>
                        </div>
                    );
                }
                questionIndex++;
            }
        });

        return result;
    };

    return (
        <div className="w-full h-full flex flex-col" style={{ maxHeight: 'calc(100vh - 8rem)' }}>
            <div className="flex-1 flex gap-3 min-h-0">

                {/* LEFT: Subtitles (identical to SIMPLE) */}
                <div className="flex-1 basis-0 rounded-2xl bg-gray-950/80 border border-gray-800/50 shadow-2xl overflow-hidden">
                    <div ref={scrollRef} className="h-full overflow-y-auto scroll-smooth px-6 py-5">
                        {displayedText ? (
                            <div className="space-y-3">
                                {renderBlocks()}
                                {isListening && <div className="mt-2 text-emerald-400 animate-pulse text-lg">▊</div>}
                            </div>
                        ) : (
                            <div className="flex items-center justify-center h-full">
                                <p className="text-gray-600 text-sm">{isListening ? 'Слухаю інтерв\'юера...' : 'Натисніть Start'}</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* RIGHT: Conversation Log */}
                <div className="flex-1 basis-0 rounded-2xl bg-gray-900/50 border border-gray-800/30 overflow-hidden flex flex-col">
                    <div className="flex items-center justify-between px-5 py-3 shrink-0 border-b border-gray-800/20">
                        <span className="text-[10px] text-gray-400 uppercase tracking-wider font-bold">Хід розмови</span>
                        <div className="flex items-center gap-2">
                            {isProcessingConversation && (
                                <span className="flex items-center gap-1 text-[9px] text-purple-400">
                                    <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                                    AI
                                </span>
                            )}
                            {isGeneratingAnswer && (
                                <span className="flex items-center gap-1 text-[9px] text-emerald-400">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                    Відповідь
                                </span>
                            )}
                        </div>
                    </div>

                    <div ref={logScrollRef} className="flex-1 overflow-y-auto px-4 py-4">
                        {conversationLog ? (
                            renderConversationLog()
                        ) : (
                            <div className="flex items-center justify-center h-full">
                                <div className="text-center space-y-2">
                                    <p className="text-gray-600 text-sm">
                                        {wordCount > 0 ? 'Аналізую розмову...' : 'Тут з\'явиться хід розмови'}
                                    </p>
                                    <p className="text-gray-700 text-xs">
                                        📌 інфо · ❓ питання · 💡 відповідь
                                    </p>
                                </div>
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
