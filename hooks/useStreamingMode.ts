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
}

const DEFAULT_OPTIONS: Required<UseStreamingModeOptions> = {
    llmTriggerWords: 25,
    llmPauseMs: 2000,
    ghostContextWords: 50,
    onGhostUpdate: () => {},
    onLLMUpdate: () => {},
    onQuestionDetected: () => {}
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
        const currentState = state;

        // Check if there's new content
        if (llmTranslatedWordCountRef.current >= currentState.wordCount) {
            return;
        }

        // Create abort controller
        abortControllerRef.current = new AbortController();
        const signal = abortControllerRef.current.signal;

        setState(prev => ({ ...prev, isProcessingLLM: true }));

        try {
            const result = await generateStreamingTranslation(
                currentState.originalText,
                currentState.llmTranslation,
                contextRef.current,
                signal
            );

            // Update state with new translation
            llmTranslatedWordCountRef.current = currentState.wordCount;

            setState(prev => ({
                ...prev,
                llmTranslation: result.translation,
                containsQuestion: result.intent.containsQuestion,
                questionConfidence: result.intent.questionConfidence,
                speechType: result.intent.speechType,
                isProcessingLLM: false
            }));

            opts.onLLMUpdate(result);

            if (result.intent.containsQuestion && result.intent.questionConfidence > 70) {
                opts.onQuestionDetected(result.intent.questionConfidence);
            }
        } catch (e: any) {
            if (e.name !== 'AbortError') {
                console.error('LLM translation error:', e);
            }
            setState(prev => ({ ...prev, isProcessingLLM: false }));
        } finally {
            abortControllerRef.current = null;
        }
    }, [state, opts]);

    // Schedule LLM translation
    const scheduleLLMTranslation = useCallback(() => {
        // Clear existing timer
        if (llmPauseTimerRef.current) {
            clearTimeout(llmPauseTimerRef.current);
        }

        // Check if we should trigger immediately (word threshold)
        const untranslatedWords = state.wordCount - llmTranslatedWordCountRef.current;
        if (untranslatedWords >= opts.llmTriggerWords) {
            executeLLMTranslation();
            return;
        }

        // Schedule on pause
        llmPauseTimerRef.current = setTimeout(() => {
            executeLLMTranslation();
        }, opts.llmPauseMs);
    }, [state.wordCount, opts.llmTriggerWords, opts.llmPauseMs, executeLLMTranslation]);

    // === PUBLIC API ===

    /**
     * Add new words to the accumulator
     */
    const addWords = useCallback((newWords: string) => {
        if (!newWords.trim()) return;

        const trimmedNew = newWords.trim();

        // Update state AND keep ref in sync
        setState(prev => {
            const newOriginal = prev.originalText
                ? `${prev.originalText} ${trimmedNew}`
                : trimmedNew;

            // Keep ref in sync for async Ghost translation
            originalTextRef.current = newOriginal;

            return {
                ...prev,
                originalText: newOriginal,
                wordCount: newOriginal.split(/\s+/).length
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
        // Reset state
        setState({
            originalText: '',
            ghostTranslation: '',
            llmTranslation: '',
            wordCount: 0,
            sessionStartTime: Date.now(),
            sessionDuration: 0,
            containsQuestion: false,
            questionConfidence: 0,
            speechType: 'UNKNOWN',
            isListening: true,
            isProcessingGhost: false,
            isProcessingLLM: false
        });

        llmTranslatedWordCountRef.current = 0;
        originalTextRef.current = '';

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
        if (state.wordCount > llmTranslatedWordCountRef.current) {
            await executeLLMTranslation();
        }

        console.log('🛑 [StreamingMode] Session stopped');
    }, [state.wordCount, executeLLMTranslation]);

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

        // Reset state
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
            isListening: false,
            isProcessingGhost: false,
            isProcessingLLM: false
        });

        llmTranslatedWordCountRef.current = 0;
        originalTextRef.current = '';

        console.log('🔄 [StreamingMode] Reset');
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
