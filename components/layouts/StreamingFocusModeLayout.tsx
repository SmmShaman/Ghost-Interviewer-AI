/**
 * STREAMING FOCUS MODE LAYOUT — Literary Translation + Conversation Log
 *
 * ┌────────────────────────────┬────────────────────────────┐
 * │  Літературний переклад     │  📌 Про компанію           │
 * │  (70%) + Оригінал (30%)   │  📌 Умови роботи           │
 * │                            │  ❓ Розкажи про себе       │
 * │                            │  💡 Відповідь: "Я маю..."  │
 * ├────────────────────────────┴────────────────────────────┤
 * │  Log: continuous raw text                               │
 * └─────────────────────────────────────────────────────────┘
 */

import React, { useEffect, useRef } from 'react';

interface LiteraryChunk {
    rawText: string;
    topics: string;
    literary: string;
}

interface StreamingFocusModeLayoutProps {
    accumulatedOriginal: string;
    accumulatedGhostTranslation: string;
    accumulatedLLMTranslation: string;

    interimText?: string;

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

    literaryChunks?: LiteraryChunk[];
    isProcessingLiterary?: boolean;
}

const StreamingFocusModeLayout: React.FC<StreamingFocusModeLayoutProps> = ({
    accumulatedOriginal,
    interimText = '',
    isListening,
    isGeneratingAnswer = false,
    wordCount,
    sessionDuration = 0,
    conversationLog = '',
    isProcessingConversation = false,
    answeredQuestions = [],
    literaryChunks = [],
    isProcessingLiterary = false
}) => {
    const literaryScrollRef = useRef<HTMLDivElement>(null);
    const logScrollRef = useRef<HTMLDivElement>(null);
    const conversationScrollRef = useRef<HTMLDivElement>(null);

    const originalText = accumulatedOriginal || '';

    // Auto-scroll literary
    useEffect(() => {
        if (literaryScrollRef.current && literaryChunks.length > 0) {
            literaryScrollRef.current.scrollTo({
                top: literaryScrollRef.current.scrollHeight,
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

    // Auto-scroll conversation log
    useEffect(() => {
        if (conversationScrollRef.current) {
            conversationScrollRef.current.scrollTop = conversationScrollRef.current.scrollHeight;
        }
    }, [conversationLog, answeredQuestions]);

    const formatDuration = (ms: number): string => {
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        return `${m}:${(s % 60).toString().padStart(2, '0')}`;
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

            {/* TOP: Two columns — Literary + Conversation */}
            <div className="flex-1 flex gap-3 min-h-0">

                {/* LEFT: Literary translation + Original */}
                <div className="flex-1 basis-0 rounded-2xl bg-gray-900/50 border border-gray-800/30 overflow-hidden flex flex-col shadow-2xl relative">
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

                    <div ref={literaryScrollRef} className="flex-1 overflow-y-auto scroll-smooth px-4 py-4">
                        {literaryChunks.length > 0 ? (
                            <div className="space-y-1">
                                {literaryChunks.map((chunk, chunkIdx) => (
                                    <div
                                        key={chunkIdx}
                                        className="flex gap-3 border-b border-gray-800/20 last:border-b-0 py-2 animate-fade-in-up"
                                    >
                                        {/* Literary translation */}
                                        <div className="w-[70%] shrink-0">
                                            <p className="text-base text-amber-200/90 leading-relaxed">
                                                {chunk.literary}
                                            </p>
                                        </div>

                                        {/* Raw words */}
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

                    <div ref={conversationScrollRef} className="flex-1 overflow-y-auto px-4 py-4">
                        {conversationLog ? (
                            (() => { try { return renderConversationLog(); } catch (e) { return <p className="text-red-400 text-xs">Render error: {String(e)}</p>; } })()
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

            {/* RAW LOG: continuous raw text */}
            <div className="h-[15%] shrink-0 mt-2 rounded-xl bg-gray-950/60 border border-gray-800/30 overflow-hidden flex flex-col">
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

export default StreamingFocusModeLayout;
