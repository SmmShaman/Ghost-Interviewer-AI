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
import { generateStreamingTranslation, StreamingTranslationResult, generateInterviewAssist } from '../services/geminiService';

export interface StreamingState {
    // Text content
    originalText: string;
    interimText: string;          // Real-time interim words (not yet finalized)
    ghostTranslation: string;
    interimGhostTranslation: string; // Translation of interim text
    llmTranslation: string;

    // FROZEN ZONE: LLM-translated text that won't change anymore
    frozenTranslation: string;    // Finalized translation (LLM quality)
    frozenWordCount: number;      // How many original words are in frozen zone

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

    // Answer generation (for FOCUS/FULL modes)
    generatedAnswer: string;
    answerTranslation: string;
    analysis: string;
    strategy: string;
    isGeneratingAnswer: boolean;
    isAnalyzing: boolean;

    // Processing flags
    isListening: boolean;
    isProcessingGhost: boolean;
    isProcessingLLM: boolean;
}

interface UseStreamingModeOptions {
    // Feature toggles
    llmTranslationEnabled?: boolean; // Enable/disable LLM translation (default: true)

    // Trigger thresholds
    llmTriggerWords?: number;      // Min words before LLM (default: 25)
    llmPauseMs?: number;           // Trigger on pause (default: 2000ms)
    ghostContextWords?: number;    // Context for Ghost (default: 50)
    answerTriggerConfidence?: number; // Min confidence to trigger answer generation (default: 70)
    answerPauseMs?: number;        // Wait for pause before generating answer (default: 2500ms)

    // Callbacks
    onGhostUpdate?: (translation: string) => void;
    onLLMUpdate?: (result: StreamingTranslationResult) => void;
    onQuestionDetected?: (confidence: number) => void;
    onCompanyInfoDetected?: (info: string) => void;
    onAnswerGenerated?: (answer: string, translation: string) => void;
}

const DEFAULT_OPTIONS: Required<UseStreamingModeOptions> = {
    llmTranslationEnabled: true,
    llmTriggerWords: 25,
    llmPauseMs: 2000,
    ghostContextWords: 50,
    answerTriggerConfidence: 70,
    answerPauseMs: 2500,
    onGhostUpdate: () => {},
    onLLMUpdate: () => {},
    onQuestionDetected: () => {},
    onCompanyInfoDetected: () => {},
    onAnswerGenerated: () => {}
};

export function useStreamingMode(
    context: InterviewContext,
    options: UseStreamingModeOptions = {}
) {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    // State
    const [state, setState] = useState<StreamingState>({
        originalText: '',
        interimText: '',
        ghostTranslation: '',
        interimGhostTranslation: '',
        llmTranslation: '',
        frozenTranslation: '',
        frozenWordCount: 0,
        wordCount: 0,
        sessionStartTime: 0,
        sessionDuration: 0,
        containsQuestion: false,
        questionConfidence: 0,
        speechType: 'UNKNOWN',
        extractedCompanyInfo: [],
        generatedAnswer: '',
        answerTranslation: '',
        analysis: '',
        strategy: '',
        isGeneratingAnswer: false,
        isAnalyzing: false,
        isListening: false,
        isProcessingGhost: false,
        isProcessingLLM: false
    });

    // Refs for async operations
    const abortControllerRef = useRef<AbortController | null>(null);
    const answerAbortControllerRef = useRef<AbortController | null>(null); // For answer generation
    const llmPauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const ghostDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const interimGhostTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // For interim translation debounce
    const answerPauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // For answer generation pause
    const llmTranslatedWordCountRef = useRef<number>(0);
    const sessionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const contextRef = useRef(context);
    const originalTextRef = useRef<string>(''); // Track original text for Ghost translation
    const llmTranslationRef = useRef<string>(''); // Track LLM translation for async operations
    const wordCountRef = useRef<number>(0); // Track word count for async operations
    const lastAnswerTextRef = useRef<string>(''); // Track text that was last used to generate answer (avoid duplicates)
    const scheduleAnswerGenerationRef = useRef<() => void>(() => {}); // Ref for answer scheduling to avoid circular deps

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
        // Skip if LLM translation is disabled
        if (!opts.llmTranslationEnabled) {
            console.log('🚫 [LLM] Translation disabled - using Ghost only');
            return;
        }

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

            // SLIDING WINDOW: Freeze old part of translation
            // Keep last 50 words "active", freeze the rest
            const ACTIVE_WINDOW_WORDS = 50;
            const translationWords = result.translation.split(/\s+/);
            const originalWords = currentOriginalText.split(/\s+/);

            // Calculate freeze point: freeze everything except last ACTIVE_WINDOW_WORDS
            const freezeWordCount = Math.max(0, originalWords.length - ACTIVE_WINDOW_WORDS);
            const freezeTranslationWordCount = Math.max(0, translationWords.length - ACTIVE_WINDOW_WORDS);

            const newFrozenTranslation = translationWords.slice(0, freezeTranslationWordCount).join(' ');
            const activeTranslation = translationWords.slice(freezeTranslationWordCount).join(' ');

            console.log(`🧊 [LLM] Freezing ${freezeTranslationWordCount} words, active: ${translationWords.length - freezeTranslationWordCount} words`);

            setState(prev => ({
                ...prev,
                llmTranslation: result.translation,
                // Only update frozen if we have more frozen content than before
                frozenTranslation: newFrozenTranslation.length > prev.frozenTranslation.length
                    ? newFrozenTranslation
                    : prev.frozenTranslation,
                frozenWordCount: freezeWordCount > prev.frozenWordCount
                    ? freezeWordCount
                    : prev.frozenWordCount,
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

            if (result.intent.containsQuestion && result.intent.questionConfidence >= opts.answerTriggerConfidence) {
                opts.onQuestionDetected(result.intent.questionConfidence);

                // Trigger answer generation for FOCUS/FULL modes
                if (contextRef.current.viewMode !== 'SIMPLE') {
                    console.log(`❓ [LLM] Question detected (${result.intent.questionConfidence}%) - scheduling answer generation`);
                    scheduleAnswerGenerationRef.current();
                }
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

    // === ANSWER GENERATION (for FOCUS/FULL modes) ===
    const executeAnswerGeneration = useCallback(async () => {
        const currentOriginalText = originalTextRef.current;
        const currentContext = contextRef.current;

        // Skip if no text or SIMPLE mode (no answer generation needed)
        if (!currentOriginalText.trim() || currentContext.viewMode === 'SIMPLE') {
            console.log('⏭️ [Answer] Skipping: SIMPLE mode or no text');
            return;
        }

        // Skip if already generating or same text as before
        if (lastAnswerTextRef.current === currentOriginalText) {
            console.log('⏭️ [Answer] Skipping: Same text as before');
            return;
        }

        // Abort any pending answer generation
        if (answerAbortControllerRef.current) {
            answerAbortControllerRef.current.abort();
        }

        answerAbortControllerRef.current = new AbortController();
        const signal = answerAbortControllerRef.current.signal;

        setState(prev => ({ ...prev, isGeneratingAnswer: true, isAnalyzing: true }));
        lastAnswerTextRef.current = currentOriginalText;

        console.log(`🎯 [Answer] Starting generation for ${currentOriginalText.split(/\s+/).length} words (${currentContext.viewMode} mode)`);

        try {
            await generateInterviewAssist(
                currentOriginalText,
                [], // No history, use accumulated text as complete context
                currentContext,
                (partial) => {
                    // Check if aborted
                    if (signal.aborted) return;

                    // Update state with streaming partial data
                    setState(prev => ({
                        ...prev,
                        // Analysis (FULL mode only)
                        analysis: partial.analysis || prev.analysis,
                        // Strategy (FULL mode only)
                        strategy: partial.strategy || prev.strategy,
                        // Answer in target language
                        generatedAnswer: partial.answer || prev.generatedAnswer,
                        // Answer translation to native language
                        answerTranslation: partial.answerTranslation || prev.answerTranslation,
                        // Clear analyzing flag when we have analysis/strategy
                        isAnalyzing: !partial.analysis && !partial.strategy
                    }));
                },
                signal
            );

            setState(prev => ({ ...prev, isGeneratingAnswer: false, isAnalyzing: false }));

            console.log(`✅ [Answer] Generation complete`);
            opts.onAnswerGenerated(lastAnswerTextRef.current, '');
        } catch (e: any) {
            if (e.name !== 'AbortError') {
                console.error('Answer generation error:', e);
            }
            setState(prev => ({ ...prev, isGeneratingAnswer: false, isAnalyzing: false }));
        } finally {
            answerAbortControllerRef.current = null;
        }
    }, [opts]);

    // Schedule answer generation when question detected with high confidence
    const scheduleAnswerGeneration = useCallback(() => {
        // Clear existing timer
        if (answerPauseTimerRef.current) {
            clearTimeout(answerPauseTimerRef.current);
        }

        // Schedule answer generation after pause (give user time to finish speaking)
        answerPauseTimerRef.current = setTimeout(() => {
            executeAnswerGeneration();
        }, opts.answerPauseMs);

        console.log(`⏱️ [Answer] Scheduled in ${opts.answerPauseMs}ms`);
    }, [opts.answerPauseMs, executeAnswerGeneration]);

    // Keep scheduleAnswerGenerationRef updated (avoids circular dependency with executeLLMTranslation)
    useEffect(() => {
        scheduleAnswerGenerationRef.current = scheduleAnswerGeneration;
    }, [scheduleAnswerGeneration]);

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
     * Set interim text (real-time, not yet finalized)
     * This provides smooth subtitle-like display
     */
    const setInterimText = useCallback((interimText: string) => {
        // Update interim text immediately for smooth display
        setState(prev => ({
            ...prev,
            interimText
        }));

        // Debounce interim translation (50ms - faster than final)
        if (interimGhostTimerRef.current) {
            clearTimeout(interimGhostTimerRef.current);
        }

        if (interimText.trim() && contextRef.current.targetLanguage !== contextRef.current.nativeLanguage) {
            interimGhostTimerRef.current = setTimeout(async () => {
                try {
                    const words = await localTranslator.translatePhraseChunked(interimText);
                    const translation = words.map(w => w.ghostTranslation).join(' ');
                    setState(prev => ({
                        ...prev,
                        interimGhostTranslation: translation
                    }));
                } catch (e) {
                    // Ignore translation errors for interim text
                }
            }, 50);
        } else {
            setState(prev => ({
                ...prev,
                interimGhostTranslation: ''
            }));
        }
    }, []);

    /**
     * Start a new session
     */
    const startSession = useCallback(() => {
        // Reset state (but keep extractedCompanyInfo - it persists across sessions)
        setState(prev => ({
            originalText: '',
            interimText: '',
            ghostTranslation: '',
            interimGhostTranslation: '',
            llmTranslation: '',
            frozenTranslation: '',
            frozenWordCount: 0,
            wordCount: 0,
            sessionStartTime: Date.now(),
            sessionDuration: 0,
            containsQuestion: false,
            questionConfidence: 0,
            speechType: 'UNKNOWN',
            extractedCompanyInfo: prev.extractedCompanyInfo, // Persist company info
            generatedAnswer: '',
            answerTranslation: '',
            analysis: '',
            strategy: '',
            isGeneratingAnswer: false,
            isAnalyzing: false,
            isListening: true,
            isProcessingGhost: false,
            isProcessingLLM: false
        }));

        llmTranslatedWordCountRef.current = 0;
        originalTextRef.current = '';
        llmTranslationRef.current = '';
        wordCountRef.current = 0;
        lastAnswerTextRef.current = ''; // Reset answer text tracker

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
        if (interimGhostTimerRef.current) {
            clearTimeout(interimGhostTimerRef.current);
            interimGhostTimerRef.current = null;
        }
        if (answerPauseTimerRef.current) {
            clearTimeout(answerPauseTimerRef.current);
            answerPauseTimerRef.current = null;
        }

        // Abort any pending LLM translation request (safely)
        try {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
                abortControllerRef.current = null;
            }
        } catch (e) {
            // Ignore abort errors
        }

        // NOTE: Don't abort answer generation on stop - let it complete
        // User might want to see the answer after stopping recording

        // Clear interim text on stop
        setState(prev => ({ ...prev, isListening: false, interimText: '', interimGhostTranslation: '' }));

        // Final LLM translation (if there's untranslated content)
        try {
            if (wordCountRef.current > llmTranslatedWordCountRef.current) {
                await executeLLMTranslation();
            }
        } catch (e: any) {
            if (e.name !== 'AbortError') {
                console.error('Final LLM translation error:', e);
            }
        }

        // Trigger answer generation if question was detected but answer not yet started
        // This ensures answer is generated when user stops after asking a question
        const currentContext = contextRef.current;
        if (currentContext.viewMode !== 'SIMPLE' &&
            originalTextRef.current.trim() &&
            lastAnswerTextRef.current !== originalTextRef.current) {
            console.log('🎯 [StopSession] Triggering final answer generation');
            executeAnswerGeneration();
        }

        console.log('🛑 [StreamingMode] Session stopped');
    }, [executeLLMTranslation, executeAnswerGeneration]);

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
        if (interimGhostTimerRef.current) {
            clearTimeout(interimGhostTimerRef.current);
            interimGhostTimerRef.current = null;
        }
        if (answerPauseTimerRef.current) {
            clearTimeout(answerPauseTimerRef.current);
            answerPauseTimerRef.current = null;
        }
        if (sessionIntervalRef.current) {
            clearInterval(sessionIntervalRef.current);
            sessionIntervalRef.current = null;
        }

        // Abort pending requests (safely)
        try {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
                abortControllerRef.current = null;
            }
        } catch (e) {
            // Ignore abort errors
        }
        try {
            if (answerAbortControllerRef.current) {
                answerAbortControllerRef.current.abort();
                answerAbortControllerRef.current = null;
            }
        } catch (e) {
            // Ignore abort errors
        }

        // Reset state (full reset including company info)
        setState({
            originalText: '',
            interimText: '',
            ghostTranslation: '',
            interimGhostTranslation: '',
            llmTranslation: '',
            frozenTranslation: '',
            frozenWordCount: 0,
            wordCount: 0,
            sessionStartTime: 0,
            sessionDuration: 0,
            containsQuestion: false,
            questionConfidence: 0,
            speechType: 'UNKNOWN',
            extractedCompanyInfo: [], // Clear company info on full reset
            generatedAnswer: '',
            answerTranslation: '',
            analysis: '',
            strategy: '',
            isGeneratingAnswer: false,
            isAnalyzing: false,
            isListening: false,
            isProcessingGhost: false,
            isProcessingLLM: false
        });

        llmTranslatedWordCountRef.current = 0;
        originalTextRef.current = '';
        llmTranslationRef.current = '';
        wordCountRef.current = 0;
        lastAnswerTextRef.current = '';

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
        setInterimText,
        startSession,
        stopSession,
        reset,
        forceLLMTranslation
    };
}
