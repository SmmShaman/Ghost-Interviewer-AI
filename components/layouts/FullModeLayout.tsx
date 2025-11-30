import React from 'react';
import { Message } from '../../types';
import { PendingLLMBlock, LLM_CONFIG } from '../../config/constants';
import CandidateRow from '../CandidateRow';

interface FullModeLayoutProps {
    messages: Message[];
    interimTranscript: string;
    liveTranslation: string;
    isUserSpeaking: boolean;
    currentCollectingText: string;
    currentCollectingTranslation: string;
    pendingBlocks: PendingLLMBlock[];
    messagesEndRef: React.RefObject<HTMLDivElement>;
}

const FullModeLayout: React.FC<FullModeLayoutProps> = ({
    messages,
    interimTranscript,
    liveTranslation,
    isUserSpeaking,
    currentCollectingText,
    currentCollectingTranslation,
    pendingBlocks,
    messagesEndRef
}) => {
    return (
        <div className="max-w-[1800px] mx-auto grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
            {/* COLUMN 1: Question + Translation (Scrollable) */}
            <div className="space-y-4">
                {/* Interviewer blocks with translations */}
                {messages.filter(m => m.role === 'interviewer').map((msg, idx) => (
                    <div key={msg.id} className="border-l-4 border-red-500 bg-red-900/10 rounded-lg shadow-xl animate-fade-in-up">
                        <div className="px-4 py-2 bg-red-950/30 border-b border-red-500/10 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-red-400"></span>
                                <span className="text-[10px] font-black text-red-300 uppercase tracking-widest">Питання</span>
                            </div>
                            <span className="text-[10px] font-mono text-red-400/50">#{idx + 1}</span>
                        </div>
                        <div className="p-4 space-y-3">
                            {/* Original text */}
                            <div className="text-base text-red-200 leading-relaxed font-medium">
                                {msg.text}
                            </div>
                            {/* Ghost translation (instant) */}
                            {msg.ghostTranslation && msg.ghostTranslation !== '...' && (
                                <div className="pt-2 border-t border-red-800/30">
                                    <div className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Ghost</div>
                                    <div className="text-sm text-gray-400 italic leading-relaxed">
                                        {msg.ghostTranslation}
                                    </div>
                                </div>
                            )}
                            {/* LLM translation (artistic) */}
                            {msg.aiTranslation && msg.aiTranslation !== '...' && (
                                <div className="pt-2 border-t border-blue-800/30">
                                    <div className="text-[9px] text-blue-500/70 uppercase tracking-wider mb-1">LLM переклад</div>
                                    <div className="text-sm text-blue-200 leading-relaxed font-medium">
                                        {msg.aiTranslation}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                ))}

                {/* Collecting block - LIVE text being accumulated */}
                {currentCollectingText && (
                    <div className="border-l-4 border-cyan-500 bg-cyan-900/10 rounded-lg shadow-xl animate-fade-in-up">
                        <div className="px-4 py-2 bg-cyan-950/30 border-b border-cyan-500/10 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
                                <span className="text-[10px] font-black text-cyan-300 uppercase tracking-widest">⚡ Записую...</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] font-mono text-cyan-400">
                                    {currentCollectingText.split(/\s+/).length} / {LLM_CONFIG.MAX_WORDS_FOR_LLM}
                                </span>
                                <div className="w-16 h-1.5 bg-cyan-900/50 rounded-full overflow-hidden">
                                    <div className="h-full bg-cyan-400 transition-all duration-300" style={{ width: `${Math.min(100, (currentCollectingText.split(/\s+/).length / LLM_CONFIG.MAX_WORDS_FOR_LLM) * 100)}%` }} />
                                </div>
                            </div>
                        </div>
                        <div className="p-4 space-y-2">
                            <div className="text-sm text-cyan-100/80">{currentCollectingText}</div>
                            {currentCollectingTranslation && (
                                <div className="text-sm text-cyan-300/70 italic border-t border-cyan-800/30 pt-2">
                                    {currentCollectingTranslation}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Live interim transcript */}
                {interimTranscript && !isUserSpeaking && !currentCollectingText && (
                    <div className="border-l-4 border-red-500/50 bg-red-900/5 rounded-lg p-4 animate-pulse">
                        <div className="text-sm text-red-300/70 italic">{interimTranscript}</div>
                        {liveTranslation && (
                            <div className="text-xs text-gray-500 mt-2">{liveTranslation}</div>
                        )}
                    </div>
                )}

                {interimTranscript && isUserSpeaking && (
                    <CandidateRow isLive={true} message={{ id: 'live-candidate', role: 'candidate', text: interimTranscript, timestamp: Date.now() }} liveTranslation={liveTranslation} />
                )}

                <div ref={messagesEndRef} />
            </div>

            {/* COLUMN 2: Strategy/Analysis (Sticky) */}
            <div className="sticky top-8 h-fit">
                <div className="border-l-4 border-purple-500 bg-purple-900/10 min-h-[400px] max-h-[calc(100vh-6rem)] overflow-y-auto rounded-lg shadow-xl">
                    <div className="px-4 py-2 bg-purple-950/30 border-b border-purple-500/10 flex items-center justify-between sticky top-0 bg-purple-950/80 backdrop-blur">
                        <div className="flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
                            <span className="text-[10px] font-black text-purple-300 uppercase tracking-widest">Стратегія</span>
                        </div>
                    </div>
                    <div className="p-4 space-y-4">
                        {messages.filter(m => m.role === 'assistant').map((msg) => (
                            <div key={msg.id} className="pb-4 border-b border-purple-500/10 last:border-b-0 animate-fade-in-up">
                                {(msg.analysis || msg.strategy) ? (
                                    <div className="space-y-3">
                                        {/* Analysis */}
                                        {msg.analysis && (
                                            <div>
                                                <div className="text-[9px] text-purple-500/70 uppercase tracking-wider mb-1">Аналіз</div>
                                                <div className="text-xs text-purple-200/70 italic leading-relaxed border-l-2 border-purple-500/30 pl-2">
                                                    {msg.analysis}
                                                </div>
                                            </div>
                                        )}
                                        {/* Strategy */}
                                        {msg.strategy && (
                                            <div>
                                                <div className="text-[9px] text-purple-500/70 uppercase tracking-wider mb-1">Стратегія</div>
                                                <div className="text-sm text-purple-100 font-medium leading-relaxed whitespace-pre-line">
                                                    {msg.strategy}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        <div className="animate-pulse bg-purple-700/20 rounded h-4 w-3/4"></div>
                                        <div className="animate-pulse bg-purple-700/20 rounded h-4 w-full"></div>
                                        <div className="animate-pulse bg-purple-700/20 rounded h-4 w-5/6"></div>
                                    </div>
                                )}
                            </div>
                        ))}
                        {messages.filter(m => m.role === 'assistant').length === 0 && (
                            <div className="text-[10px] text-purple-500/50 italic text-center py-8">
                                Стратегія з'явиться тут...
                            </div>
                        )}
                        {/* Processing indicator */}
                        {pendingBlocks.length > 0 && (
                            <div className="pt-4 border-t border-purple-500/10 animate-pulse">
                                <div className="flex items-center gap-2 text-[10px] text-orange-400">
                                    <div className="w-2 h-2 rounded-full bg-orange-400 animate-ping"></div>
                                    <span>Аналізую питання...</span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* COLUMN 3: Answer (Sticky) */}
            <div className="sticky top-8 h-fit">
                <div className="border-l-4 border-emerald-500 bg-emerald-900/10 min-h-[400px] max-h-[calc(100vh-6rem)] overflow-y-auto rounded-lg shadow-xl">
                    <div className="px-4 py-2 bg-emerald-950/30 border-b border-emerald-500/10 flex items-center justify-between sticky top-0 bg-emerald-950/80 backdrop-blur">
                        <div className="flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]"></span>
                            <span className="text-[10px] font-black text-emerald-300 uppercase tracking-widest">Відповідь</span>
                        </div>
                        {messages.filter(m => m.role === 'assistant' && m.text).length > 0 && (
                            <span className="text-[10px] font-mono text-emerald-400 bg-emerald-900/30 px-2 py-0.5 rounded">
                                {messages.filter(m => m.role === 'assistant' && m.text).length} відп.
                            </span>
                        )}
                    </div>
                    <div className="p-4 space-y-4">
                        {messages.filter(m => m.role === 'assistant').map((msg) => (
                            <div key={msg.id} className="pb-4 border-b border-emerald-500/10 last:border-b-0 animate-fade-in-up">
                                {msg.text ? (
                                    <>
                                        {/* Answer in target language */}
                                        <div className="text-lg md:text-xl font-bold text-emerald-300 leading-relaxed mb-3">
                                            "{msg.text}"
                                        </div>
                                        {/* Translation to native */}
                                        {msg.answerTranslation && (
                                            <div className="text-sm text-gray-400 italic border-t border-emerald-800/30 pt-3">
                                                {msg.answerTranslation}
                                            </div>
                                        )}
                                        {msg.latency && (
                                            <div className="text-[10px] text-emerald-500/40 mt-2">{msg.latency}ms</div>
                                        )}
                                    </>
                                ) : (
                                    <div className="space-y-3">
                                        <div className="animate-pulse bg-emerald-700/20 rounded h-6 w-full"></div>
                                        <div className="animate-pulse bg-emerald-700/20 rounded h-6 w-2/3"></div>
                                    </div>
                                )}
                            </div>
                        ))}
                        {messages.filter(m => m.role === 'assistant').length === 0 && (
                            <div className="text-[10px] text-emerald-500/50 italic text-center py-8">
                                Відповіді з'являться тут...
                            </div>
                        )}
                        {/* Processing indicator */}
                        {pendingBlocks.length > 0 && (
                            <div className="pt-4 border-t border-emerald-500/10 animate-pulse">
                                <div className="flex items-center gap-2 text-[10px] text-orange-400">
                                    <div className="w-2 h-2 rounded-full bg-orange-400 animate-ping"></div>
                                    <span>Генерую відповідь...</span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default FullModeLayout;
