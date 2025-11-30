import React from 'react';
import { Message } from '../../types';
import { PendingLLMBlock, LLM_CONFIG } from '../../config/constants';
import BrickRow from '../BrickRow';
import CandidateRow from '../CandidateRow';

interface SimpleModeLayoutProps {
    messages: Message[];
    interimTranscript: string;
    liveTranslation: string;
    isUserSpeaking: boolean;
    currentCollectingText: string;
    currentCollectingTranslation: string;
    pendingBlocks: PendingLLMBlock[];
    completedBlocks: PendingLLMBlock[];
    messagesEndRef: React.RefObject<HTMLDivElement>;
    renderMessages: () => React.ReactNode[];
}

const SimpleModeLayout: React.FC<SimpleModeLayoutProps> = ({
    messages,
    interimTranscript,
    liveTranslation,
    isUserSpeaking,
    currentCollectingText,
    currentCollectingTranslation,
    pendingBlocks,
    completedBlocks,
    messagesEndRef,
    renderMessages
}) => {
    return (
        <div className="max-w-[1800px] mx-auto grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
            {/* COLUMN 1: Scrollable Ghost blocks */}
            <div className="space-y-6">
                {renderMessages()}

                {interimTranscript && !isUserSpeaking && (
                    <BrickRow
                        isLive={true}
                        interviewerMessage={{ id: 'live', role: 'interviewer', text: interimTranscript, timestamp: Date.now() }}
                        liveTranslation={liveTranslation}
                        viewMode="SIMPLE"
                    />
                )}

                {interimTranscript && isUserSpeaking && (
                    <CandidateRow isLive={true} message={{ id: 'live-candidate', role: 'candidate', text: interimTranscript, timestamp: Date.now() }} liveTranslation={liveTranslation} />
                )}

                <div ref={messagesEndRef} />
            </div>

            {/* COLUMN 2: Visual Queue - Collecting + Processing Blocks */}
            <div className="sticky top-8 h-fit space-y-4 max-h-[calc(100vh-6rem)] overflow-y-auto">
                {/* COLLECTING BLOCK - LIVE Chrome translation of accumulating text */}
                {currentCollectingText && (
                    <div className="border-l-4 border-cyan-500 bg-cyan-900/10 rounded-lg shadow-xl animate-fade-in-up">
                        <div className="px-4 py-2 bg-cyan-950/30 border-b border-cyan-500/10 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
                                <span className="text-[10px] font-black text-cyan-300 uppercase tracking-widest">⚡ Live переклад</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] font-mono text-cyan-400">
                                    {currentCollectingText.split(/\s+/).length} / {LLM_CONFIG.MAX_WORDS_FOR_LLM}
                                </span>
                                <div className="w-16 h-1.5 bg-cyan-900/50 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-cyan-400 transition-all duration-300"
                                        style={{ width: `${Math.min(100, (currentCollectingText.split(/\s+/).length / LLM_CONFIG.MAX_WORDS_FOR_LLM) * 100)}%` }}
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="p-4">
                            {/* Show CHROME TRANSLATION (Ukrainian), not original (Norwegian) */}
                            <div className="text-sm text-cyan-100 leading-relaxed font-medium">
                                {currentCollectingTranslation || <span className="text-cyan-400/50 italic">Перекладаю...</span>}
                            </div>
                        </div>
                    </div>
                )}

                {/* PROCESSING BLOCKS - Show Chrome preview while LLM processes */}
                {pendingBlocks.map((block) => (
                    <div key={block.id} className="border-l-4 border-orange-500 bg-orange-900/10 rounded-lg shadow-xl animate-fade-in-up">
                        <div className="px-4 py-2 bg-orange-950/30 border-b border-orange-500/10 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-orange-400 animate-ping"></div>
                                <span className="text-[10px] font-black text-orange-300 uppercase tracking-widest">
                                    LLM обробляє... {block.wordCount} слів
                                </span>
                            </div>
                            <div className="flex gap-1">
                                <div className="w-1 h-3 bg-orange-400 rounded-full animate-pulse" style={{animationDelay: '0ms'}}></div>
                                <div className="w-1 h-3 bg-orange-400 rounded-full animate-pulse" style={{animationDelay: '150ms'}}></div>
                                <div className="w-1 h-3 bg-orange-400 rounded-full animate-pulse" style={{animationDelay: '300ms'}}></div>
                            </div>
                        </div>
                        <div className="p-4">
                            {/* Show Chrome preview (Ukrainian) while LLM processes */}
                            <div className="text-sm text-orange-100/90 leading-relaxed">
                                {block.chromePreview || <span className="text-orange-400/50 italic">{block.text}</span>}
                            </div>
                        </div>
                    </div>
                ))}

                {/* Empty state */}
                {!currentCollectingText && pendingBlocks.length === 0 && (
                    <div className="border-l-4 border-gray-600 bg-gray-900/10 rounded-lg shadow-xl">
                        <div className="px-4 py-2 bg-gray-950/30 border-b border-gray-600/10 flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-500"></span>
                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Черга LLM</span>
                        </div>
                        <div className="p-6 flex flex-col items-center justify-center min-h-[100px] text-center">
                            <div className="text-gray-500 text-xs">
                                Слова з'являться тут під час запису...
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* COLUMN 3: Completed Translations */}
            <div className="sticky top-8 h-fit">
                <div className="border-l-4 border-emerald-500 bg-emerald-900/10 min-h-[400px] max-h-[calc(100vh-6rem)] overflow-y-auto rounded-lg shadow-xl">
                    <div className="px-4 py-2 bg-emerald-950/30 border-b border-emerald-500/10 flex items-center justify-between sticky top-0 bg-emerald-950/80 backdrop-blur">
                        <div className="flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                            <span className="text-[10px] font-black text-emerald-300 uppercase tracking-widest">Готові переклади</span>
                        </div>
                        {completedBlocks.length > 0 && (
                            <span className="text-[10px] font-mono text-emerald-400 bg-emerald-900/30 px-2 py-0.5 rounded">
                                {completedBlocks.length} блоків
                            </span>
                        )}
                    </div>
                    <div className="p-4 space-y-4">
                        {completedBlocks.length > 0 ? (
                            completedBlocks.map((block, idx) => (
                                <div key={block.id} className="pb-3 border-b border-emerald-500/10 last:border-b-0 animate-fade-in-up">
                                    <div className="text-[10px] text-emerald-500/50 mb-1 flex items-center gap-2">
                                        <span>Блок {idx + 1}</span>
                                        <span className="text-emerald-600">•</span>
                                        <span>{block.wordCount} слів</span>
                                    </div>
                                    {/* LLM Artistic Translation (primary) */}
                                    <div className="text-base md:text-lg text-emerald-200 leading-relaxed font-medium">
                                        {block.translation}
                                    </div>
                                    {/* Chrome Preview (secondary, for comparison) */}
                                    {block.chromePreview && block.translation !== block.chromePreview && (
                                        <div className="mt-2 pt-2 border-t border-emerald-800/30">
                                            <div className="text-[9px] text-cyan-500/50 uppercase tracking-wider mb-1">⚡ Chrome</div>
                                            <div className="text-xs text-cyan-300/60 leading-relaxed">
                                                {block.chromePreview}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))
                        ) : (
                            <div className="text-[10px] text-emerald-500/50 italic text-center py-8">
                                Готові переклади з'являться тут...
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SimpleModeLayout;
