import React, { useState, useEffect } from 'react';
import { useProgressiveTranslation } from '../hooks/useProgressiveTranslation';

interface LayeredPhraseProps {
    originalText: string;
    finalTranslation?: string;
    textColorClass?: string;
    translationColorClass?: string;
}

const LayeredPhrase: React.FC<LayeredPhraseProps> = ({ 
    originalText, 
    finalTranslation,
    textColorClass,
    translationColorClass = "text-gray-500"
}) => {
    const phrase = useProgressiveTranslation(originalText, finalTranslation);
    const [isFinal, setIsFinal] = useState(false);

    useEffect(() => {
        if (phrase?.status === 'final_ready') {
            setIsFinal(true);
        } else {
            setIsFinal(false);
        }
    }, [phrase?.status]);

    // Determine content to display
    const isGhost = !isFinal;
    const translationText = isFinal ? phrase?.finalFullText : phrase?.ghostFullText;
    
    // Fallback logic: If we have a translation (ghost or final), show it.
    // We removed the hardcoded "..." to avoid clashing with the "Loading..." status from service.
    const displayTranslation = translationText || "";

    // Check if it's the loading message to adjust styling if needed (e.g. font size)
    const isLoadingMessage = displayTranslation.includes("⏳");

    // Determine Styling
    // If textColorClass is provided (e.g. CandidateRow), use it. 
    // Otherwise use Input Block defaults (Amber -> Emerald).
    let topColorClass = "";
    let prefix = "";

    if (textColorClass) {
        topColorClass = `${textColorClass} ${isGhost ? 'animate-pulse opacity-80' : ''}`;
    } else {
        topColorClass = isGhost 
            ? "text-amber-400 italic animate-pulse opacity-90" 
            : "text-emerald-400 font-bold opacity-100";
        
        // Only show tilde if it's a ghost translation AND NOT the loading message
        if (isGhost && !isLoadingMessage && displayTranslation) prefix = "~ ";
    }
    
    // Dynamic font size: slightly smaller if it's the long loading message
    const fontSizeClass = isLoadingMessage ? "text-sm md:text-base" : "text-lg md:text-xl";

    return (
        <div className="flex flex-col justify-center h-full gap-3 transition-all duration-500">
            {/* TOP BLOCK: TRANSLATION */}
            <div className={`${fontSizeClass} leading-snug transition-all duration-500 ${topColorClass} min-h-[1.75rem]`}>
                <span className="opacity-50 select-none">{prefix}</span>
                {displayTranslation}
            </div>

            {/* SEPARATOR */}
            <div className="h-px bg-gray-700 w-full opacity-30"></div>

            {/* BOTTOM BLOCK: ORIGINAL */}
            <div className={`text-sm md:text-base font-mono leading-relaxed ${translationColorClass} opacity-80`}>
                {originalText}
            </div>
        </div>
    );
};

export default LayeredPhrase;