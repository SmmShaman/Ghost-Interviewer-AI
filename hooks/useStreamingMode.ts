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
import { metricsCollector } from '../services/metricsCollector';

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
    const lastWordAddedTimeRef = useRef<number>(Date.now()); // Track time of last word addition for paragraph breaks
    const PARAGRAPH_PAUSE_MS = 1500; // Pause duration to trigger paragraph break (1.5 seconds)

    // INTERIM OPTIMIZATION: Cache prefix translation to avoid re-translating stable text
    const interimCacheRef = useRef<{
        originalPrefix: string;      // Original text prefix that was translated
        translatedPrefix: string;    // Cached translation of the prefix
        prefixWordCount: number;     // Number of words in the cached prefix
    }>({ originalPrefix: '', translatedPrefix: '', prefixWordCount: 0 });

    // HOLD-N CONFIG: Don't show last N words of interim (they change most often)
    const HOLD_N = 2;
    const TRANSLATE_LAST_N = 7; // Only translate last N words, use cache for the rest

    // PARAGRAPH MARKER: Used to create visual line breaks between speech blocks
    const PARAGRAPH_MARKER = '\n\n';

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

    // Track last translated text to prevent duplicates
    const lastTranslatedTextRef = useRef<string>('');

    // ACCUMULATOR: Collect words during debounce period to prevent losing rapid finals
    const pendingWordsRef = useRef<string[]>([]);
    // Track if next translation should be preceded by paragraph break
    const pendingParagraphBreakRef = useRef<boolean>(false);

    // === GHOST TRANSLATION ===
    // STABLE APPROACH: Translate ONLY new words, append to existing translation
    // This eliminates flickering caused by context-aware translation inconsistency
    const executeGhostTranslation = useCallback(async (newWords: string, fullText: string, addParagraphBreak: boolean = false) => {
        // DUPLICATE CHECK: Skip if we already translated this text
        if (lastTranslatedTextRef.current === newWords) {
            console.log(`⚠️ [Ghost] Skipping duplicate translation: "${newWords.substring(0, 30)}..."`);
            return;
        }

        // Also check if this text was already translated (contained in previous)
        if (lastTranslatedTextRef.current && newWords.length > 10 &&
            lastTranslatedTextRef.current.includes(newWords)) {
            console.log(`⚠️ [Ghost] Skipping already-translated text: "${newWords.substring(0, 30)}..."`);
            return;
        }

        setState(prev => ({ ...prev, isProcessingGhost: true }));

        try {
            // SIMPLE: Translate only new words (no context)
            // This gives CONSISTENT results - same input = same output
            // Using translatePhraseChunked for built-in caching - repeated phrases return instantly
            const words = await localTranslator.translatePhraseChunked(newWords);
            const translation = words.map(w => w.ghostTranslation).join(' ');

            // Remember what we translated to prevent duplicates
            lastTranslatedTextRef.current = newWords;

            // DUPLICATE CHECK for translation result
            setState(prev => {
                // Check if this translation is already at the end
                if (prev.ghostTranslation && prev.ghostTranslation.endsWith(translation)) {
                    console.log(`⚠️ [Ghost] Translation already appended, skipping`);
                    return { ...prev, isProcessingGhost: false };
                }

                // METRICS: Record words translated
                const translatedWordCount = translation.split(/\s+/).length;
                metricsCollector.recordWordsTranslated(translatedWordCount);

                // APPEND ONLY: Never modify existing translation
                // Add paragraph break if flagged (when there was a pause)
                const separator = addParagraphBreak ? PARAGRAPH_MARKER : ' ';
                return {
                    ...prev,
                    ghostTranslation: prev.ghostTranslation
                        ? `${prev.ghostTranslation}${separator}${translation}`
                        : translation,
                    isProcessingGhost: false
                };
            });

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
     * Includes duplicate detection to prevent text repetition after session restart
     * Adds paragraph breaks when there's a significant pause (1.5s+)
     */
    const addWords = useCallback((newWords: string) => {
        if (!newWords.trim()) return;

        const trimmedNew = newWords.trim();

        // DUPLICATE DETECTION: Check if these words are already at the end of originalText
        // This prevents re-adding the same text after session restart
        const currentOriginal = originalTextRef.current;
        if (currentOriginal && currentOriginal.endsWith(trimmedNew)) {
            console.log(`⚠️ [addWords] Skipping duplicate: "${trimmedNew.substring(0, 30)}..."`);
            return;
        }

        // Also check if the new text is a substring of what we already have
        // This catches cases where Speech API sends overlapping results
        if (currentOriginal && currentOriginal.includes(trimmedNew) && trimmedNew.length > 10) {
            console.log(`⚠️ [addWords] Skipping already-included text: "${trimmedNew.substring(0, 30)}..."`);
            return;
        }

        // PARAGRAPH BREAK: Check if there was a significant pause since last word
        const now = Date.now();
        const timeSinceLastWord = now - lastWordAddedTimeRef.current;
        const shouldAddParagraphBreak = currentOriginal && timeSinceLastWord >= PARAGRAPH_PAUSE_MS;
        lastWordAddedTimeRef.current = now;

        if (shouldAddParagraphBreak) {
            console.log(`📝 [addWords] Adding paragraph break (${timeSinceLastWord}ms pause)`);
            // Set flag for Ghost translation to also add paragraph break
            pendingParagraphBreakRef.current = true;
        }

        // METRICS: Record words received
        const wordCount = trimmedNew.split(/\s+/).length;
        metricsCollector.recordWordsReceived(wordCount);

        // Update state AND keep refs in sync
        setState(prev => {
            // Add paragraph marker if there was a pause
            const separator = shouldAddParagraphBreak ? PARAGRAPH_MARKER : ' ';
            const newOriginal = prev.originalText
                ? `${prev.originalText}${separator}${trimmedNew}`
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

        // ACCUMULATE words for debounce (prevents losing rapid finals)
        pendingWordsRef.current.push(trimmedNew);

        // Debounce ghost translation (100ms)
        if (ghostDebounceTimerRef.current) {
            clearTimeout(ghostDebounceTimerRef.current);
        }

        // Translate ALL accumulated words when debounce fires
        ghostDebounceTimerRef.current = setTimeout(() => {
            const allPendingWords = pendingWordsRef.current.join(' ');
            pendingWordsRef.current = []; // Clear accumulator

            // Capture and reset paragraph break flag
            const addParagraphBreak = pendingParagraphBreakRef.current;
            pendingParagraphBreakRef.current = false;

            if (allPendingWords.trim()) {
                console.log(`📦 [Ghost] Translating ${allPendingWords.split(/\s+/).length} accumulated words${addParagraphBreak ? ' (with paragraph break)' : ''}`);
                executeGhostTranslation(allPendingWords, originalTextRef.current, addParagraphBreak);
            }
        }, 100);

        // Schedule LLM translation
        scheduleLLMTranslation();
    }, [executeGhostTranslation, scheduleLLMTranslation]);

    /**
     * Set interim text (real-time, not yet finalized)
     * OPTIMIZED with Hold-N and prefix caching:
     * - Hold-N: Don't show last N words (they change most often)
     * - Cache: Only translate last TRANSLATE_LAST_N words, use cached prefix
     */
    const setInterimText = useCallback((interimText: string) => {
        const allWords = interimText.trim().split(/\s+/).filter(w => w.length > 0);

        // HOLD-N: Hide last N words from display (they're most unstable)
        const displayWords = allWords.length > HOLD_N
            ? allWords.slice(0, -HOLD_N)
            : [];
        const displayText = displayWords.join(' ');

        // Update interim text with Hold-N applied
        setState(prev => ({
            ...prev,
            interimText: displayText
        }));

        // Debounce interim translation (100ms - slower to reduce flicker)
        if (interimGhostTimerRef.current) {
            clearTimeout(interimGhostTimerRef.current);
        }

        if (displayText.trim() && contextRef.current.targetLanguage !== contextRef.current.nativeLanguage) {
            interimGhostTimerRef.current = setTimeout(async () => {
                try {
                    const wordsToTranslate = displayText.split(/\s+/);
                    const totalWords = wordsToTranslate.length;

                    // OPTIMIZATION: Check if we can use cached prefix
                    const cache = interimCacheRef.current;
                    const cacheHit = cache.prefixWordCount > 0 &&
                                     totalWords > cache.prefixWordCount &&
                                     displayText.startsWith(cache.originalPrefix);

                    let finalTranslation: string;

                    if (cacheHit && totalWords > TRANSLATE_LAST_N) {
                        // Use cached prefix, translate only new words
                        const newWordsCount = totalWords - cache.prefixWordCount;
                        const wordsToActuallyTranslate = Math.min(newWordsCount + 2, TRANSLATE_LAST_N); // +2 for context
                        const newText = wordsToTranslate.slice(-wordsToActuallyTranslate).join(' ');

                        const translated = await localTranslator.translatePhraseChunked(newText);
                        const newTranslation = translated.map(w => w.ghostTranslation).join(' ');

                        // Combine: cached prefix + new translation
                        finalTranslation = cache.translatedPrefix + ' ' + newTranslation;

                        console.log(`🚀 [Interim] Cache HIT: ${cache.prefixWordCount} cached + ${wordsToActuallyTranslate} new words`);
                    } else {
                        // No cache or cache miss - translate from beginning
                        // But only translate last TRANSLATE_LAST_N words for very long text
                        if (totalWords > TRANSLATE_LAST_N * 2) {
                            // Split: cache the stable prefix, translate only recent
                            const prefixWordCount = totalWords - TRANSLATE_LAST_N;
                            const prefixText = wordsToTranslate.slice(0, prefixWordCount).join(' ');
                            const suffixText = wordsToTranslate.slice(prefixWordCount).join(' ');

                            // Translate prefix once and cache
                            const prefixTranslated = await localTranslator.translatePhraseChunked(prefixText);
                            const prefixTranslation = prefixTranslated.map(w => w.ghostTranslation).join(' ');

                            // Translate suffix
                            const suffixTranslated = await localTranslator.translatePhraseChunked(suffixText);
                            const suffixTranslation = suffixTranslated.map(w => w.ghostTranslation).join(' ');

                            finalTranslation = prefixTranslation + ' ' + suffixTranslation;

                            // Update cache
                            interimCacheRef.current = {
                                originalPrefix: prefixText,
                                translatedPrefix: prefixTranslation,
                                prefixWordCount: prefixWordCount
                            };

                            console.log(`📝 [Interim] Cache MISS: Created new cache with ${prefixWordCount} words`);
                        } else {
                            // Short text - translate all
                            const translated = await localTranslator.translatePhraseChunked(displayText);
                            finalTranslation = translated.map(w => w.ghostTranslation).join(' ');
                        }
                    }

                    setState(prev => ({
                        ...prev,
                        interimGhostTranslation: finalTranslation.trim()
                    }));
                } catch (e) {
                    // Ignore translation errors for interim text
                }
            }, 100); // Increased from 50ms to 100ms for stability
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
        pendingWordsRef.current = []; // Clear pending words accumulator
        interimCacheRef.current = { originalPrefix: '', translatedPrefix: '', prefixWordCount: 0 }; // Clear interim cache
        lastWordAddedTimeRef.current = Date.now(); // Reset paragraph break timer
        pendingParagraphBreakRef.current = false; // Clear pending paragraph break flag

        // METRICS: Start metrics session
        metricsCollector.startSession();

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
            // Wrap in try-catch to prevent uncaught AbortError
            try {
                executeAnswerGeneration();
            } catch (e: any) {
                if (e.name !== 'AbortError') {
                    console.error('Answer generation error:', e);
                }
            }
        }

        // METRICS: Stop and log session metrics
        metricsCollector.stopSession();
        metricsCollector.logMetrics();

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
        lastTranslatedTextRef.current = '';  // Reset duplicate tracking
        pendingWordsRef.current = []; // Clear pending words accumulator
        interimCacheRef.current = { originalPrefix: '', translatedPrefix: '', prefixWordCount: 0 }; // Clear interim cache
        lastWordAddedTimeRef.current = Date.now(); // Reset paragraph break timer
        pendingParagraphBreakRef.current = false; // Clear pending paragraph break flag

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
