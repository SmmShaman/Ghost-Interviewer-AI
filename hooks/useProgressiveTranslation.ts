import { useState, useEffect, useRef } from 'react';
import { localTranslator, TranslatedWord } from '../services/localTranslator';

export interface TranslatedPhrase {
    words: TranslatedWord[];
    originalText: string;
    ghostFullText: string;
    finalFullText?: string;
    status: 'translating' | 'ghost_ready' | 'final_ready';
}

export const useProgressiveTranslation = (
    text: string, 
    finalTranslation?: string // Provided by Gemini/Azure
) => {
    const [phrase, setPhrase] = useState<TranslatedPhrase | null>(null);
    const lastProcessedText = useRef<string>('');

    useEffect(() => {
        if (!text || !text.trim()) {
            setPhrase(null);
            return;
        }

        // If we have a final translation passed in prop, strictly use that
        if (finalTranslation && finalTranslation.trim().length > 0) {
             setPhrase({
                words: [], // No need for individual words in final state usually
                originalText: text,
                ghostFullText: '', 
                finalFullText: finalTranslation,
                status: 'final_ready'
             });
             return;
        }

        // Avoid re-running ghost translation on same text
        if (text === lastProcessedText.current && phrase?.status === 'ghost_ready') {
            return;
        }

        lastProcessedText.current = text;

        let isMounted = true;

        // Trigger Ghost Translation
        const runGhost = async () => {
            const words = await localTranslator.translatePhrase(text);
            
            if (isMounted) {
                setPhrase({
                    words: words,
                    originalText: text,
                    ghostFullText: words.map(w => w.ghostTranslation).join(' '),
                    status: 'ghost_ready'
                });
            }
        };

        runGhost();

        return () => { isMounted = false; };
    }, [text, finalTranslation]);

    return phrase;
};