
import React, { useState } from 'react';
import { Message } from '../types';
import { RefreshIcon } from './Icons';
import { translations } from '../translations';

interface AnswerCardProps {
  message: Message;
  onRegenerate?: () => void;
  uiLang: 'en' | 'uk';
}

const AnswerCard: React.FC<AnswerCardProps> = ({ message, onRegenerate, uiLang }) => {
  const [copied, setCopied] = useState(false);
  const t = translations[uiLang].card;

  const handleCopy = () => {
    navigator.clipboard.writeText(message.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Color code latency: Green (<2s), Yellow (<3s), Red (>3s)
  const getLatencyColor = (ms: number) => {
    if (ms < 2000) return 'text-emerald-400';
    if (ms < 3000) return 'text-yellow-400';
    return 'text-red-400';
  };

  // Determine which reasoning fields to show
  // If new format (Analysis/Strategy) exists, use that. Otherwise fallback to Rationale.
  const hasStructuredReasoning = message.analysis || message.strategy;

  return (
    <div className="w-full bg-gray-950 border border-gray-800 rounded-xl overflow-hidden shadow-2xl transition-all hover:border-gray-700 animate-fade-in-up ring-1 ring-white/5 flex flex-col">
      
      {/* 1. ANALYSIS BLOCK (Understanding) - Gray/Blue Theme */}
      {hasStructuredReasoning && message.analysis && (
        <div className="w-full bg-gray-900 border-b border-gray-800 px-6 py-4">
           <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1 flex items-center gap-2">
             <span className="w-1.5 h-1.5 bg-gray-500 rounded-full"></span>
             ANALYSIS
           </div>
           <p className="text-gray-300 text-sm leading-relaxed font-mono opacity-90">
             {message.analysis}
           </p>
        </div>
      )}

      {/* 2. STRATEGY BLOCK (Argumentation) - Indigo Theme */}
      {hasStructuredReasoning && message.strategy && (
        <div className="w-full bg-indigo-950/30 border-b border-indigo-500/10 px-6 py-4">
           <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-2 flex items-center gap-2">
             <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full shadow-[0_0_8px_rgba(99,102,241,0.8)]"></span>
             {t.strategy}
           </div>
           <div className="text-indigo-100 text-sm md:text-base leading-relaxed font-medium whitespace-pre-line">
             {message.strategy}
           </div>
        </div>
      )}

      {/* 3. TRANSLATION BLOCK (Native Language Understanding) - Teal/Green Theme */}
      {hasStructuredReasoning && message.answerTranslation && (
        <div className="w-full bg-teal-950/30 border-b border-teal-500/10 px-6 py-4">
           <div className="text-[10px] font-bold text-teal-400 uppercase tracking-widest mb-2 flex items-center gap-2">
             <span className="w-1.5 h-1.5 bg-teal-500 rounded-full shadow-[0_0_8px_rgba(20,184,166,0.8)]"></span>
             {t.translation}
           </div>
           <div className="text-teal-100 text-sm md:text-base leading-relaxed font-medium whitespace-pre-line">
             {message.answerTranslation}
           </div>
        </div>
      )}

      {/* Fallback for Old Rationale Style */}
      {!hasStructuredReasoning && message.rationale && (
        <div className="w-full bg-blue-900/20 border-b border-blue-500/20 px-6 py-4">
            <span className="text-blue-400 text-[10px] font-black uppercase tracking-widest mb-1 block opacity-80">
                {t.strategy}
            </span>
            <p className="text-blue-100 text-sm leading-relaxed">
                {message.rationale}
            </p>
        </div>
      )}

      {/* 4. ANSWER BLOCK (Script) - Yellow Text */}
      <div className="p-6 md:p-8 flex-1 bg-gray-950">
        <div className="text-3xl md:text-4xl font-bold text-yellow-400 leading-relaxed font-sans tracking-wide drop-shadow-sm">
          "{message.text}"
        </div>

        {/* Action Bar */}
        <div className="flex justify-between items-center mt-8 pt-6 border-t border-gray-900">
          <div className="flex items-center gap-4 text-xs font-mono">
              {message.latency && (
                  <span className={`${getLatencyColor(message.latency)} flex items-center gap-1 bg-gray-900 px-3 py-1 rounded-full border border-gray-800`}>
                      ⚡ {message.latency}{t.latency}
                  </span>
              )}
          </div>

          <div className="flex gap-3">
              {onRegenerate && (
                  <button 
                    onClick={onRegenerate}
                    className="p-2.5 hover:bg-gray-800 rounded-lg text-gray-500 hover:text-gray-300 transition-colors"
                    title="Regenerate"
                  >
                      <RefreshIcon className="w-5 h-5" />
                  </button>
              )}
              <button 
              onClick={handleCopy}
              className={`px-5 py-2.5 rounded-lg text-xs font-bold tracking-wider transition-all uppercase ${copied ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-900/20' : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'}`}
              >
              {copied ? t.copied : t.copy}
              </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AnswerCard;
