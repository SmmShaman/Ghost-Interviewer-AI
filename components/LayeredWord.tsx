import React from 'react';
import { TranslatedWord } from '../services/localTranslator';

interface LayeredWordProps {
    word: TranslatedWord;
}

const LayeredWord: React.FC<LayeredWordProps> = ({ word }) => {
    // Check redundancy to optionally style it differently, but NEVER hide it entirely.
    // If translation fails (returns original), we want to see it to know the model is running.
    const isRedundant = word.ghostTranslation.toLowerCase() === word.original.toLowerCase();
    
    return (
        <span className="inline-flex flex-col items-center justify-end mx-0.5 md:mx-1 align-bottom group">
             {/* GHOST LAYER (Translation - Top) */}
             <span 
                className={`text-xs md:text-sm font-bold tracking-wide animate-ghost-pulse mb-0.5 leading-none whitespace-nowrap ${isRedundant ? 'text-amber-400/50' : 'text-amber-400'}`}
                style={{ textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}
             >
                {/* Always show the translation. If redundant, it shows the same word, indicating 'no change' */}
                {`~${word.ghostTranslation}`}
            </span>
            
            {/* ORIGINAL LAYER (Bottom) */}
            <span className="text-lg md:text-2xl text-gray-200 font-medium leading-none tracking-tight whitespace-nowrap">
                {word.original}
            </span>
        </span>
    );
};

export default LayeredWord;