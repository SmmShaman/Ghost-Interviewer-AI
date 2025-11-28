
import React from 'react';
import { Message } from '../types';
import LayeredPhrase from './LayeredPhrase';

interface CandidateRowProps {
  message: Message;
  isLive?: boolean;
  liveTranslation?: string;
}

const CandidateRow: React.FC<CandidateRowProps> = ({ message, isLive, liveTranslation }) => {
  return (
    <div className="w-full flex justify-end mb-6 animate-fade-in-up">
      <div className="w-full max-w-4xl border-r-4 border-blue-500 bg-blue-900/10 rounded-l-xl overflow-hidden relative">
        <div className="px-4 py-1.5 bg-blue-950/30 border-b border-blue-500/10 flex justify-end items-center gap-2">
            {isLive && (
                 <div className="flex items-center gap-1.5 px-2 py-0.5 bg-blue-950/80 rounded border border-blue-500/30 mr-auto">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"></div>
                    <span className="text-[9px] font-bold text-blue-300 tracking-wider">LIVE</span>
                 </div>
            )}
            <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">YOU (CANDIDATE)</span>
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
        </div>

        <div className="p-5 text-right">
           
           <LayeredPhrase 
               originalText={message.text}
               finalTranslation={isLive ? liveTranslation : message.candidateTranslation}
               textColorClass="text-blue-100"
               translationColorClass="text-gray-400"
           />

        </div>
      </div>
    </div>
  );
};

export default React.memo(CandidateRow);
