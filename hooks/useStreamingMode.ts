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

    // PUNCTUATION CONFIG: Auto-add periods and question marks
    const MIN_WORDS_FOR_PUNCTUATION = 3; // Minimum words before adding punctuation

    // Norwegian question words (case-insensitive)
    const QUESTION_WORDS = [
        'hva', 'hvorfor', 'hvordan', 'når', 'hvor', 'hvem', 'hvilken', 'hvilke',
        'er', 'har', 'kan', 'vil', 'skal', 'må', 'bør', // Verbs that start questions
        'what', 'why', 'how', 'when', 'where', 'who', 'which', // English
        'do', 'does', 'did', 'is', 'are', 'was', 'were', 'have', 'has', 'can', 'could', 'will', 'would'
    ];

    // Track the first word of current sentence for question detection
    const currentSentenceStartRef = useRef<string>('');
    const currentSentenceWordCountRef = useRef<number>(0);
    // Track current sentence text for end-of-sentence ? detection
    const currentSentenceTextRef = useRef<string>('');
    // Track LLM's question detection (updated asynchronously)
    const llmQuestionDetectedRef = useRef<boolean>(false);

    /**
     * Determine punctuation mark based on multiple detection methods:
     * 1. Check if original text ends with '?' (speech recognition captured it)
     * 2. Check if LLM detected a question (contextual analysis)
     * 3. Check if sentence starts with question word (heuristic)
     *
     * Returns '?' for questions, '.' for statements
     */
    const getPunctuationMark = useCallback((sentenceStart: string, wordCount: number, sentenceText: string = ''): string => {
        // Not enough words for punctuation
        if (wordCount < MIN_WORDS_FOR_PUNCTUATION) return '';

        // METHOD 1: Check if original text already ends with '?'
        // Speech recognition might have captured the question intonation
        const trimmedSentence = sentenceText.trim();
        if (trimmedSentence.endsWith('?')) {
            console.log(`❓ [Punctuation] Original text ends with '?' → adding ?`);
            return '?';
        }

        // METHOD 2: Check LLM intent detection
        // LLM analyzed the context and determined it's a question
        if (llmQuestionDetectedRef.current) {
            console.log(`❓ [Punctuation] LLM detected question → adding ?`);
            return '?';
        }

        // METHOD 3: Heuristic - check if starts with question word
        const firstWord = sentenceStart.toLowerCase().trim();
        const isQuestionWord = QUESTION_WORDS.some(qw => firstWord === qw || firstWord.startsWith(qw + ' '));
        if (isQuestionWord) {
            console.log(`❓ [Punctuation] Starts with question word "${firstWord}" → adding ?`);
            return '?';
        }

        // Default: statement with period
        return '.';
    }, []);

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
    // Track punctuation to add before paragraph break
    const pendingPunctuationRef = useRef<string>('');

    // === GHOST TRANSLATION ===
    // STABLE APPROACH: Translate ONLY new words, append to existing translation
    // This eliminates flickering caused by context-aware translation inconsistency
    const executeGhostTranslation = useCallback(async (newWords: string, fullText: string, addParagraphBreak: boolean = false, punctuation: string = '') => {
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
                // Include punctuation before paragraph marker
                const separator = addParagraphBreak ? (punctuation + PARAGRAPH_MARKER) : ' ';
                return {
                    ...prev,
                    ghostTranslation: prev.ghostTranslation
                        ? `${prev.ghostTranslation}${separator}${translation}`
                        : translation,
                    isProcessingGhost: false
                };
            });

            // === GHOST LOG ===
            console.log(`\n${'─'.repeat(50)}`);
            console.log(`👻 [GHOST ПЕРЕКЛАД] Завершено`);
            console.log(`   📝 Вхід: "${newWords.substring(0, 100)}${newWords.length > 100 ? '...' : ''}"`);
            console.log(`   🇺🇦 Вихід: "${translation.substring(0, 100)}${translation.length > 100 ? '...' : ''}"`);
            console.log(`${'─'.repeat(50)}\n`);

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
            console.log(`\n${'─'.repeat(50)}`);
            console.log(`🚫 [LLM] ВИМКНЕНО - використовується тільки Ghost`);
            console.log(`   📝 Оригінал: "${originalTextRef.current.substring(0, 80)}..."`);
            console.log(`   👻 Ghost переклад: "${llmTranslationRef.current ? 'є' : 'немає'}"`);
            console.log(`${'─'.repeat(50)}\n`);
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
            // Keep last N words "active", freeze the rest
            // IMPORTANT: Never REPLACE frozen text, only APPEND to it!
            // NOTE: Reduced from 50 to 20 so freezing starts earlier (with less words)
            const ACTIVE_WINDOW_WORDS = 20;
            const translationWords = result.translation.split(/\s+/);
            const originalWords = currentOriginalText.split(/\s+/);

            // Calculate freeze point: freeze everything except last ACTIVE_WINDOW_WORDS
            const newFreezeWordCount = Math.max(0, originalWords.length - ACTIVE_WINDOW_WORDS);
            const newFreezeTranslationWordCount = Math.max(0, translationWords.length - ACTIVE_WINDOW_WORDS);

            console.log(`🧊 [LLM] Freeze calculation: ${newFreezeTranslationWordCount} words to freeze, ${translationWords.length - newFreezeTranslationWordCount} active`);

            // === COMPARISON LOG: Ghost vs LLM ===
            console.log(`\n${'═'.repeat(60)}`);
            console.log(`📊 [ПОРІВНЯННЯ ПЕРЕКЛАДУ] LLM УВІМКНЕНО`);
            console.log(`${'─'.repeat(60)}`);
            console.log(`📝 ОРИГІНАЛ (${originalWords.length} слів):`);
            console.log(`   "${currentOriginalText.substring(0, 200)}${currentOriginalText.length > 200 ? '...' : ''}"`);
            console.log(`${'─'.repeat(60)}`);
            console.log(`🤖 LLM ПЕРЕКЛАД (тип: ${result.intent.speechType}):`);
            console.log(`   "${result.translation.substring(0, 200)}${result.translation.length > 200 ? '...' : ''}"`);
            console.log(`${'─'.repeat(60)}`);
            console.log(`❓ Питання виявлено: ${result.intent.containsQuestion ? `ТАК (${result.intent.questionConfidence}% впевненість)` : 'НІ'}`);
            console.log(`${'═'.repeat(60)}\n`);

            // UPDATE LLM QUESTION REF: Store question detection for punctuation
            if (result.intent.containsQuestion && result.intent.questionConfidence >= 70) {
                llmQuestionDetectedRef.current = true;
                console.log(`🧠 [LLM] Question detected with ${result.intent.questionConfidence}% confidence → stored for punctuation`);
            }

            setState(prev => {
                // FROZEN ZONE FIX: Never replace, only append new frozen content
                // 1. Keep existing frozen translation intact
                // 2. Only add NEW words that are now being frozen (not previously frozen)
                let updatedFrozenTranslation = prev.frozenTranslation;
                let updatedFrozenWordCount = prev.frozenWordCount;

                if (newFreezeWordCount > prev.frozenWordCount) {
                    // There are new words to freeze
                    // Calculate how many NEW translation words to add to frozen zone
                    const prevFrozenTranslationWords = prev.frozenTranslation.split(/\s+/).filter(w => w).length;
                    const newWordsToFreeze = newFreezeTranslationWordCount - prevFrozenTranslationWords;

                    if (newWordsToFreeze > 0) {
                        // Get the NEW words from translation (starting after previously frozen words)
                        const newFrozenWords = translationWords.slice(prevFrozenTranslationWords, newFreezeTranslationWordCount);
                        const newFrozenPart = newFrozenWords.join(' ');

                        // APPEND to existing frozen translation (with paragraph break to preserve structure)
                        if (prev.frozenTranslation && newFrozenPart) {
                            updatedFrozenTranslation = prev.frozenTranslation + '\n\n' + newFrozenPart;
                        } else if (newFrozenPart) {
                            updatedFrozenTranslation = newFrozenPart;
                        }

                        updatedFrozenWordCount = newFreezeWordCount;
                        console.log(`🧊 [LLM] APPENDING ${newWordsToFreeze} new frozen words (total: ${newFreezeTranslationWordCount})`);
                        console.log(`   OLD frozen: "${prev.frozenTranslation.substring(0, 50)}..."`);
                        console.log(`   NEW part: "${newFrozenPart.substring(0, 50)}..."`);
                    }
                } else {
                    console.log(`🧊 [LLM] No new words to freeze (current: ${prev.frozenWordCount}, needed: ${newFreezeWordCount})`);
                }

                return {
                    ...prev,
                    llmTranslation: result.translation,
                    frozenTranslation: updatedFrozenTranslation,
                    frozenWordCount: updatedFrozenWordCount,
                    containsQuestion: result.intent.containsQuestion,
                    questionConfidence: result.intent.questionConfidence,
                    speechType: result.intent.speechType,
                    // Accumulate company info when detected
                    extractedCompanyInfo: newCompanyInfo
                        ? [...prev.extractedCompanyInfo, newCompanyInfo]
                        : prev.extractedCompanyInfo,
                    isProcessingLLM: false
                };
            });

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

        // DUPLICATE DETECTION: Multiple checks to prevent text duplication
        const currentOriginal = originalTextRef.current;

        // Check 1: Exact match at end
        if (currentOriginal && currentOriginal.endsWith(trimmedNew)) {
            console.log(`⚠️ [addWords] Skipping duplicate (ends with): "${trimmedNew.substring(0, 30)}..."`);
            return;
        }

        // Check 2: Word-level overlap detection
        // Prevents adding text that significantly overlaps with what we already have
        if (currentOriginal) {
            const newWords = trimmedNew.split(/\s+/);
            const lastOriginalWords = currentOriginal.split(/\s+/).slice(-30); // Last 30 words

            // Check if first 3+ words of new text match anywhere in last 30 words of original
            if (newWords.length >= 3) {
                const firstThreeWords = newWords.slice(0, 3).join(' ');
                const lastOriginalText = lastOriginalWords.join(' ');
                if (lastOriginalText.includes(firstThreeWords)) {
                    console.log(`⚠️ [addWords] Skipping overlap (first 3 words "${firstThreeWords}" found in recent text)`);
                    return;
                }
            }

            // Check if entire new text is very short and contained in last part
            if (trimmedNew.length <= 50) {
                const last100Chars = currentOriginal.slice(-100);
                if (last100Chars.includes(trimmedNew)) {
                    console.log(`⚠️ [addWords] Skipping short duplicate: "${trimmedNew.substring(0, 30)}..."`);
                    return;
                }
            }
        }

        // PARAGRAPH BREAK: Check if there was a significant pause since last word
        const now = Date.now();
        const timeSinceLastWord = now - lastWordAddedTimeRef.current;
        const shouldAddParagraphBreak = currentOriginal && timeSinceLastWord >= PARAGRAPH_PAUSE_MS;
        lastWordAddedTimeRef.current = now;

        // PUNCTUATION: Determine what punctuation to add before paragraph break
        let punctuationMark = '';
        if (shouldAddParagraphBreak) {
            punctuationMark = getPunctuationMark(
                currentSentenceStartRef.current,
                currentSentenceWordCountRef.current,
                currentSentenceTextRef.current  // Pass full sentence for ? detection
            );
            console.log(`📝 [addWords] Adding paragraph break (${timeSinceLastWord}ms pause) with "${punctuationMark || 'no'}" punctuation`);
            // Set flags for Ghost translation to also add paragraph break and punctuation
            pendingParagraphBreakRef.current = true;
            pendingPunctuationRef.current = punctuationMark;
            // Reset LLM question detection for new sentence
            llmQuestionDetectedRef.current = false;
        }

        // METRICS: Record words received
        const newWordCount = trimmedNew.split(/\s+/).length;
        metricsCollector.recordWordsReceived(newWordCount);

        // SENTENCE TRACKING: Track first word and full text of current sentence
        if (!currentSentenceStartRef.current || shouldAddParagraphBreak) {
            // Starting a new sentence - capture the first word(s) and full text
            currentSentenceStartRef.current = trimmedNew.split(/\s+/)[0] || '';
            currentSentenceWordCountRef.current = newWordCount;
            currentSentenceTextRef.current = trimmedNew;
            console.log(`📝 [Sentence] New sentence starting with: "${currentSentenceStartRef.current}"`);
        } else {
            // Continuing current sentence - increment word count and append text
            currentSentenceWordCountRef.current += newWordCount;
            currentSentenceTextRef.current = currentSentenceTextRef.current + ' ' + trimmedNew;
        }

        // Update state AND keep refs in sync
        setState(prev => {
            // Build separator: punctuation (if any) + paragraph marker (if pause)
            let separator = ' ';
            if (shouldAddParagraphBreak) {
                separator = punctuationMark + PARAGRAPH_MARKER;
            }
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

            // Capture and reset paragraph break and punctuation flags
            const addParagraphBreak = pendingParagraphBreakRef.current;
            const punctuation = pendingPunctuationRef.current;
            pendingParagraphBreakRef.current = false;
            pendingPunctuationRef.current = '';

            if (allPendingWords.trim()) {
                console.log(`📦 [Ghost] Translating ${allPendingWords.split(/\s+/).length} accumulated words${addParagraphBreak ? ` (with "${punctuation}" + paragraph break)` : ''}`);
                executeGhostTranslation(allPendingWords, originalTextRef.current, addParagraphBreak, punctuation);
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
        pendingPunctuationRef.current = ''; // Clear pending punctuation
        currentSentenceStartRef.current = ''; // Reset sentence tracking
        currentSentenceWordCountRef.current = 0;
        currentSentenceTextRef.current = ''; // Reset sentence text
        llmQuestionDetectedRef.current = false; // Reset LLM question detection

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

        // FINAL PUNCTUATION: Add punctuation at end of session if needed
        const finalPunctuation = getPunctuationMark(
            currentSentenceStartRef.current,
            currentSentenceWordCountRef.current,
            currentSentenceTextRef.current  // Pass full sentence for ? detection
        );

        // Clear interim text on stop and add final punctuation
        setState(prev => {
            let updatedOriginal = prev.originalText;
            let updatedGhost = prev.ghostTranslation;

            // Add final punctuation if text doesn't already end with punctuation
            if (finalPunctuation && updatedOriginal && !/[.?!]$/.test(updatedOriginal.trim())) {
                updatedOriginal = updatedOriginal.trim() + finalPunctuation;
                console.log(`📝 [StopSession] Added final "${finalPunctuation}" to original text`);
            }
            if (finalPunctuation && updatedGhost && !/[.?!]$/.test(updatedGhost.trim())) {
                updatedGhost = updatedGhost.trim() + finalPunctuation;
                console.log(`📝 [StopSession] Added final "${finalPunctuation}" to ghost translation`);
            }

            return {
                ...prev,
                isListening: false,
                interimText: '',
                interimGhostTranslation: '',
                originalText: updatedOriginal,
                ghostTranslation: updatedGhost
            };
        });

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
        pendingPunctuationRef.current = ''; // Clear pending punctuation
        currentSentenceStartRef.current = ''; // Reset sentence tracking
        currentSentenceWordCountRef.current = 0;
        currentSentenceTextRef.current = ''; // Reset sentence text
        llmQuestionDetectedRef.current = false; // Reset LLM question detection

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
