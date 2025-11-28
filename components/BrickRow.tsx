

import React from 'react';
import { Message, ViewMode } from '../types';
import { RefreshIcon } from './Icons';
import LayeredPhrase from './LayeredPhrase';

interface BrickRowProps {
  interviewerMessage: Message;
  assistantMessage?: Message; 
  isLive?: boolean; 
  liveTranslation?: string; 
  onRegenerate?: () => void;
  viewMode?: ViewMode;
}

const BrickRow: React.FC<BrickRowProps> = ({ 
  interviewerMessage, 
  assistantMessage, 
  isLive = false, 
  liveTranslation,
  onRegenerate,
  viewMode = 'FULL'
}) => {
  
  const Skeleton = ({ className }: { className?: string }) => (
    <div className={`animate-pulse bg-gray-700/50 rounded ${className}`}></div>
  );

  // Layout Configurations
  const isSimple = viewMode === 'SIMPLE';
  const isFocus = viewMode === 'FOCUS';
  const isFull = viewMode === 'FULL';

  // Grid CSS classes based on mode
  let gridClass = 'grid-cols-1 md:grid-cols-3'; // Default FULL
  if (isFocus) gridClass = 'grid-cols-1 md:grid-cols-2';
  if (isSimple) gridClass = 'grid-cols-1 md:grid-cols-2';

  // Determine if we have a valid AI translation for the right column
  // It must NOT be live, and isAiTranslated must be true.
  const showAiTranslation = !isLive && interviewerMessage.isAiTranslated;

  return (
    <div className={`w-full grid ${gridClass} gap-0 border-y border-gray-800/50 shadow-xl mb-6 bg-gray-950/50 backdrop-blur-sm group transition-all duration-500 ease-in-out`}>
      
      {/* COLUMN 1: INPUT (Red) - NOW UNIFIED FOR ALL MODES */}
      <div className="flex flex-col border-l-4 border-red-500 bg-red-900/10 min-h-[160px] relative overflow-hidden">
         {/* Standard Layered View (Original + Ghost/Final Translation) */}
         <div className="p-4 flex-1 flex flex-col justify-center h-full">
             <LayeredPhrase 
                originalText={interviewerMessage.text}
                // LEFT COLUMN: STRICTLY GHOST / LOCAL DRAFT
                finalTranslation={isLive ? liveTranslation : interviewerMessage.ghostTranslation}
                textColorClass="text-gray-400 italic opacity-80"
                translationColorClass="text-gray-500"
             />
         </div>

         {isLive && (
             <div className="absolute top-2 right-2 flex items-center gap-1.5 px-2 py-0.5 bg-red-950/80 rounded border border-red-500/30">
                 <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
                 <span className="text-[10px] font-bold text-red-400 tracking-wider">LIVE</span>
             </div>
         )}
      </div>

      {/* COLUMN 2 (Logic varies by mode) */}
      
      {/* SIMPLE MODE: TRANSLATION COLUMN */}
      {isSimple && (
         <div className="flex flex-col border-l-4 md:border-l border-t-4 md:border-t-0 border-amber-500 md:border-amber-500/30 bg-amber-900/10 min-h-[160px]">
              <div className="px-4 py-2 bg-amber-950/30 border-b border-amber-500/10 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                  <span className="text-[10px] font-black text-amber-300 uppercase tracking-widest">Translation (AI)</span>
              </div>
              <div className="p-6 flex-1 flex flex-col justify-center h-full">
                  {showAiTranslation ? (
                      <div className="text-xl md:text-2xl text-amber-400 font-bold leading-relaxed animate-fade-in-up">
                          {interviewerMessage.aiTranslation}
                      </div>
                  ) : (
                      <div className="space-y-3 opacity-50 select-none">
                          <div className="flex items-center gap-2 text-amber-500/50 text-xs font-mono mb-2">
                             {isLive ? (
                                 <>
                                    <div className="w-2 h-2 border border-amber-500/50 rounded-full"></div>
                                    LISTENING...
                                 </>
                             ) : (
                                 <>
                                    <div className="w-2 h-2 bg-amber-500 rounded-full animate-ping"></div>
                                    AI PROCESSING...
                                 </>
                             )}
                          </div>
                          <Skeleton className="h-4 w-3/4 bg-amber-900/20" />
                          <Skeleton className="h-4 w-1/2 bg-amber-900/20" />
                      </div>
                  )}
              </div>
         </div>
      )}

      {/* FULL MODE: STRATEGY COLUMN */}
      {isFull && (
        <div className="flex flex-col border-l-4 md:border-l border-t-4 md:border-t-0 border-purple-500 md:border-purple-500/30 bg-purple-900/10 min-h-[160px]">
            <div className="px-4 py-2 bg-purple-950/30 border-b border-purple-500/10 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
                <span className="text-[10px] font-black text-purple-300 uppercase tracking-widest">Strategy</span>
            </div>

            <div className="p-4 flex-1">
                {assistantMessage?.analysis || assistantMessage?.strategy ? (
                    <div className="space-y-4">
                        {assistantMessage.analysis && (
                            <div className="text-xs text-purple-200/70 italic border-l-2 border-purple-500/30 pl-2">
                                {assistantMessage.analysis}
                            </div>
                        )}
                        {assistantMessage.strategy && (
                            <div className="text-sm text-purple-100 font-medium leading-relaxed whitespace-pre-line">
                                {assistantMessage.strategy}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="space-y-3 pt-2">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-5/6" />
                    </div>
                )}
            </div>
        </div>
      )}

      {/* FULL & FOCUS MODES: ANSWER COLUMN */}
      {(!isSimple) && (
        <div className="flex flex-col border-l-4 md:border-l border-t-4 md:border-t-0 border-emerald-500 md:border-emerald-500/30 bg-emerald-900/10 min-h-[160px] relative">
            <div className="px-4 py-2 bg-emerald-950/30 border-b border-emerald-500/10 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]"></span>
                    <span className="text-[10px] font-black text-emerald-300 uppercase tracking-widest">Answer</span>
                </div>
                {assistantMessage?.latency && (
                    <span className="text-[10px] font-mono text-emerald-500/50">
                        {assistantMessage.latency}ms
                    </span>
                )}
            </div>

            <div className="p-4 flex-1 flex flex-col gap-3">
                {assistantMessage?.text ? (
                    <>
                        <div className="text-lg md:text-xl font-bold text-emerald-300 leading-relaxed drop-shadow-sm selection:bg-emerald-500/30">
                            "{assistantMessage.text}"
                        </div>
                        
                        {assistantMessage.answerTranslation && (
                            <div className="mt-auto pt-3 border-t border-emerald-500/10">
                                <p className="text-sm text-gray-400 font-medium italic">
                                    {assistantMessage.answerTranslation}
                                </p>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="space-y-3 pt-2">
                        <Skeleton className="h-6 w-full opacity-50" />
                        <Skeleton className="h-6 w-2/3 opacity-50" />
                        <Skeleton className="h-20 w-full mt-4 opacity-30" />
                    </div>
                )}
            </div>

            {onRegenerate && assistantMessage && (
                <button 
                    onClick={onRegenerate} 
                    className="absolute bottom-2 right-2 p-1.5 text-gray-600 hover:text-emerald-400 transition-colors"
                    title="Regenerate"
                >
                    <RefreshIcon className="w-4 h-4" />
                </button>
            )}
        </div>
      )}

    </div>
  );
};

export default React.memo(BrickRow);