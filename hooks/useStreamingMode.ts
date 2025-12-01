/**
 * USE STREAMING MODE HOOK
 *
 * Інтеграційний хук для потокової архітектури.
 * Керує накопиченням тексту, перекладом, та станом UI.
 *
 * ВИКОРИСТАННЯ:
 * const { state, addWords, reset, startSession, stopSession } = useStreamingMode(context);
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { InterviewContext } from '../types';
import { localTranslator } from '../services/localTranslator';
import { generateStreamingTranslation, StreamingTranslationResult } from '../services/geminiService';

export interface StreamingState {
    // Text content
    originalText: string;
    ghostTranslation: string;
    llmTranslation: string;

    // Statistics
    wordCount: number;
    sessionStartTime: number;
    sessionDuration: number;

    // Intent classification
    containsQuestion: boolean;
    questionConfidence: number;
    speechType: 'QUESTION' | 'INFO' | 'STORY' | 'SMALL_TALK' | 'UNKNOWN';

    // Extracted company info (accumulated during interview)
    extractedCompanyInfo: string[];

    // Processing flags
    isListening: boolean;
    isProcessingGhost: boolean;
    isProcessingLLM: boolean;
}

interface UseStreamingModeOptions {
    // Trigger thresholds
    llmTriggerWords?: number;      // Min words before LLM (default: 25)
    llmPauseMs?: number;           // Trigger on pause (default: 2000ms)
    ghostContextWords?: number;    // Context for Ghost (default: 50)

    // Callbacks
    onGhostUpdate?: (translation: string) => void;
    onLLMUpdate?: (result: StreamingTranslationResult) => void;
    onQuestionDetected?: (confidence: number) => void;
    onCompanyInfoDetected?: (info: string) => void;
}

const DEFAULT_OPTIONS: Required<UseStreamingModeOptions> = {
    llmTriggerWords: 25,
    llmPauseMs: 2000,
    ghostContextWords: 50,
    onGhostUpdate: () => {},
    onLLMUpdate: () => {},
    onQuestionDetected: () => {},
    onCompanyInfoDetected: () => {}
};

export function useStreamingMode(
    context: InterviewContext,
    options: UseStreamingModeOptions = {}
) {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    // State
    const [state, setState] = useState<StreamingState>({
        originalText: '',
        ghostTranslation: '',
        llmTranslation: '',
        wordCount: 0,
        sessionStartTime: 0,
        sessionDuration: 0,
        containsQuestion: false,
        questionConfidence: 0,
        speechType: 'UNKNOWN',
        extractedCompanyInfo: [],
        isListening: false,
        isProcessingGhost: false,
        isProcessingLLM: false
    });

    // Refs for async operations
    const abortControllerRef = useRef<AbortController | null>(null);
    const llmPauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const ghostDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const llmTranslatedWordCountRef = useRef<number>(0);
    const sessionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const contextRef = useRef(context);
    const originalTextRef = useRef<string>(''); // Track original text for Ghost translation
    const llmTranslationRef = useRef<string>(''); // Track LLM translation for async operations
    const wordCountRef = useRef<number>(0); // Track word count for async operations

    // Keep context ref updated
    useEffect(() => {
        contextRef.current = context;
    }, [context]);

    // Session duration timer
    useEffect(() => {
        if (state.isListening && state.sessionStartTime > 0) {
            sessionIntervalRef.current = setInterval(() => {
                setState(prev => ({
                    ...prev,
                    sessionDuration: Date.now() - prev.sessionStartTime
                }));
            }, 1000);
        } else {
            if (sessionIntervalRef.current) {
                clearInterval(sessionIntervalRef.current);
                sessionIntervalRef.current = null;
            }
        }

        return () => {
            if (sessionIntervalRef.current) {
                clearInterval(sessionIntervalRef.current);
            }
        };
    }, [state.isListening, state.sessionStartTime]);

    // === GHOST TRANSLATION ===
    const executeGhostTranslation = useCallback(async (newWords: string, fullText: string) => {
        setState(prev => ({ ...prev, isProcessingGhost: true }));

        try {
            // Get context (last N words before new words)
            const allWords = fullText.split(/\s+/);
            const newWordCount = newWords.split(/\s+/).length;
            const contextStartIdx = Math.max(0, allWords.length - newWordCount - opts.ghostContextWords);
            const contextEndIdx = allWords.length - newWordCount;
            const contextWords = allWords.slice(contextStartIdx, contextEndIdx);
            const contextText = contextWords.join(' ');

            // Translate with context
            const translation = await localTranslator.translateWithContext(newWords, contextText);

            setState(prev => ({
                ...prev,
                ghostTranslation: prev.ghostTranslation
                    ? `${prev.ghostTranslation} ${translation}`
                    : translation,
                isProcessingGhost: false
            }));

            opts.onGhostUpdate(translation);
        } catch (e) {
            console.error('Ghost translation error:', e);
            setState(prev => ({ ...prev, isProcessingGhost: false }));
        }
    }, [opts]);

    // === LLM TRANSLATION ===
    const executeLLMTranslation = useCallback(async () => {
        // Use refs to avoid stale closure issues
        const currentWordCount = wordCountRef.current;
        const currentOriginalText = originalTextRef.current;
        const currentLLMTranslation = llmTranslationRef.current;

        // Check if there's new content
        if (llmTranslatedWordCountRef.current >= currentWordCount) {
            return;
        }

        // Create abort controller
        abortControllerRef.current = new AbortController();
        const signal = abortControllerRef.current.signal;

        setState(prev => ({ ...prev, isProcessingLLM: true }));

        try {
            const result = await generateStreamingTranslation(
                currentOriginalText,
                currentLLMTranslation,
                contextRef.current,
                signal
            );

            // Update state with new translation
            llmTranslatedWordCountRef.current = currentWordCount;
            llmTranslationRef.current = result.translation; // Keep ref in sync

            // Store company info if detected
            const isCompanyInfo = result.intent.speechType === 'INFO';
            const newCompanyInfo = isCompanyInfo ? result.translation : null;

            setState(prev => ({
                ...prev,
                llmTranslation: result.translation,
                containsQuestion: result.intent.containsQuestion,
                questionConfidence: result.intent.questionConfidence,
                speechType: result.intent.speechType,
                // Accumulate company info when detected
                extractedCompanyInfo: newCompanyInfo
                    ? [...prev.extractedCompanyInfo, newCompanyInfo]
                    : prev.extractedCompanyInfo,
                isProcessingLLM: false
            }));

            opts.onLLMUpdate(result);

            if (result.intent.containsQuestion && result.intent.questionConfidence > 70) {
                opts.onQuestionDetected(result.intent.questionConfidence);
            }

            // Notify about company info extraction
            if (isCompanyInfo && newCompanyInfo) {
                opts.onCompanyInfoDetected(newCompanyInfo);
                console.log(`🏢 [CompanyInfo] Stored: "${newCompanyInfo.substring(0, 50)}..."`);
            }
        } catch (e: any) {
            if (e.name !== 'AbortError') {
                console.error('LLM translation error:', e);
            }
            setState(prev => ({ ...prev, isProcessingLLM: false }));
        } finally {
            abortControllerRef.current = null;
        }
    }, [opts]);

    // Schedule LLM translation
    const scheduleLLMTranslation = useCallback(() => {
        // Clear existing timer
        if (llmPauseTimerRef.current) {
            clearTimeout(llmPauseTimerRef.current);
        }

        // Check if we should trigger immediately (word threshold)
        const untranslatedWords = wordCountRef.current - llmTranslatedWordCountRef.current;
        if (untranslatedWords >= opts.llmTriggerWords) {
            executeLLMTranslation();
            return;
        }

        // Schedule on pause
        llmPauseTimerRef.current = setTimeout(() => {
            executeLLMTranslation();
        }, opts.llmPauseMs);
    }, [opts.llmTriggerWords, opts.llmPauseMs, executeLLMTranslation]);

    // === PUBLIC API ===

    /**
     * Add new words to the accumulator
     */
    const addWords = useCallback((newWords: string) => {
        if (!newWords.trim()) return;

        const trimmedNew = newWords.trim();

        // Update state AND keep refs in sync
        setState(prev => {
            const newOriginal = prev.originalText
                ? `${prev.originalText} ${trimmedNew}`
                : trimmedNew;
            const newWordCount = newOriginal.split(/\s+/).length;

            // Keep refs in sync for async operations
            originalTextRef.current = newOriginal;
            wordCountRef.current = newWordCount;

            return {
                ...prev,
                originalText: newOriginal,
                wordCount: newWordCount
            };
        });

        // Debounce ghost translation (100ms)
        if (ghostDebounceTimerRef.current) {
            clearTimeout(ghostDebounceTimerRef.current);
        }

        // Use ref to get current original text (avoids stale closure)
        ghostDebounceTimerRef.current = setTimeout(() => {
            executeGhostTranslation(trimmedNew, originalTextRef.current);
        }, 100);

        // Schedule LLM translation
        scheduleLLMTranslation();
    }, [executeGhostTranslation, scheduleLLMTranslation]);

    /**
     * Start a new session
     */
    const startSession = useCallback(() => {
        // Reset state (but keep extractedCompanyInfo - it persists across sessions)
        setState(prev => ({
            originalText: '',
            ghostTranslation: '',
            llmTranslation: '',
            wordCount: 0,
            sessionStartTime: Date.now(),
            sessionDuration: 0,
            containsQuestion: false,
            questionConfidence: 0,
            speechType: 'UNKNOWN',
            extractedCompanyInfo: prev.extractedCompanyInfo, // Persist company info
            isListening: true,
            isProcessingGhost: false,
            isProcessingLLM: false
        }));

        llmTranslatedWordCountRef.current = 0;
        originalTextRef.current = '';
        llmTranslationRef.current = '';
        wordCountRef.current = 0;

        console.log('🎙️ [StreamingMode] Session started');
    }, []);

    /**
     * Stop the session and finalize
     */
    const stopSession = useCallback(async () => {
        // Clear timers
        if (llmPauseTimerRef.current) {
            clearTimeout(llmPauseTimerRef.current);
            llmPauseTimerRef.current = null;
        }
        if (ghostDebounceTimerRef.current) {
            clearTimeout(ghostDebounceTimerRef.current);
            ghostDebounceTimerRef.current = null;
        }

        // Abort any pending LLM request
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }

        setState(prev => ({ ...prev, isListening: false }));

        // Final LLM translation (if there's untranslated content)
        if (wordCountRef.current > llmTranslatedWordCountRef.current) {
            await executeLLMTranslation();
        }

        console.log('🛑 [StreamingMode] Session stopped');
    }, [executeLLMTranslation]);

    /**
     * Reset to initial state
     */
    const reset = useCallback(() => {
        // Clear all timers
        if (llmPauseTimerRef.current) {
            clearTimeout(llmPauseTimerRef.current);
            llmPauseTimerRef.current = null;
        }
        if (ghostDebounceTimerRef.current) {
            clearTimeout(ghostDebounceTimerRef.current);
            ghostDebounceTimerRef.current = null;
        }
        if (sessionIntervalRef.current) {
            clearInterval(sessionIntervalRef.current);
            sessionIntervalRef.current = null;
        }

        // Abort pending requests
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }

        // Reset state (full reset including company info)
        setState({
            originalText: '',
            ghostTranslation: '',
            llmTranslation: '',
            wordCount: 0,
            sessionStartTime: 0,
            sessionDuration: 0,
            containsQuestion: false,
            questionConfidence: 0,
            speechType: 'UNKNOWN',
            extractedCompanyInfo: [], // Clear company info on full reset
            isListening: false,
            isProcessingGhost: false,
            isProcessingLLM: false
        });

        llmTranslatedWordCountRef.current = 0;
        originalTextRef.current = '';
        llmTranslationRef.current = '';
        wordCountRef.current = 0;

        console.log('🔄 [StreamingMode] Reset (including company info)');
    }, []);

    /**
     * Force LLM translation now
     */
    const forceLLMTranslation = useCallback(() => {
        if (llmPauseTimerRef.current) {
            clearTimeout(llmPauseTimerRef.current);
            llmPauseTimerRef.current = null;
        }
        executeLLMTranslation();
    }, [executeLLMTranslation]);

    return {
        state,
        addWords,
        startSession,
        stopSession,
        reset,
        forceLLMTranslation
    };
}
