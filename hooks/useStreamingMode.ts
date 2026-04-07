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
import { InterviewContext, SPEED_PRESETS, SpeedPresetConfig } from '../types';
import { localTranslator } from '../services/localTranslator';
import { generateStreamingTranslation, StreamingTranslationResult, generateInterviewAssist, generateTopicSummary } from '../services/geminiService';
import { metricsCollector } from '../services/metricsCollector';
import { debugLogger } from '../services/debugLogger';
import { cleanSpeechText } from '../services/speechCleaner';

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
    frozenTranslationWordCount: number; // How many TRANSLATED words are in frozen zone

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

    // Topic structuring (Flash-Lite)
    topicSummary: string;
    isProcessingTopics: boolean;

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
    llmTriggerWords: 8,
    llmPauseMs: 800,
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
    // Resolve speed preset from context
    const speedPreset: SpeedPresetConfig = SPEED_PRESETS[context.speedPreset || 'interview'];

    const opts = {
        ...DEFAULT_OPTIONS,
        ...options,
        // Speed preset overrides — these always win over options
        llmTranslationEnabled: speedPreset.llmEnabled && (options.llmTranslationEnabled !== false),
        llmTriggerWords: speedPreset.llmTriggerWords,
        llmPauseMs: speedPreset.llmPauseMs,
    };

    // State
    const [state, setState] = useState<StreamingState>({
        originalText: '',
        interimText: '',
        ghostTranslation: '',
        interimGhostTranslation: '',
        llmTranslation: '',
        frozenTranslation: '',
        frozenWordCount: 0,
        frozenTranslationWordCount: 0,
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
        topicSummary: '',
        isProcessingTopics: false,
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
    const freezeFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // For flushing active→frozen on 3s pause
    const topicTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // For topic summarization debounce
    const topicAbortRef = useRef<AbortController | null>(null);
    const lastTopicWordCountRef = useRef<number>(0); // Track words at last topic generation
    const wordsInCountRef = useRef<number>(0); // Count WORDS_IN events since last topic
    const TOPIC_TRIGGER_BLOCKS = 2; // Generate topics every N finalized blocks (WORDS_IN)
    const TOPIC_MIN_WORDS = 15; // Minimum words before first topic
    const TOPIC_PAUSE_MS = 8000; // Or after 8s pause (real silence)
    const llmTranslatedWordCountRef = useRef<number>(0);
    const sessionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const contextRef = useRef(context);
    const originalTextRef = useRef<string>(''); // Track original text for Ghost translation
    const llmTranslationRef = useRef<string>(''); // Track LLM translation for async operations
    const wordCountRef = useRef<number>(0); // Track word count for async operations
    const lastAnswerTextRef = useRef<string>(''); // Track text that was last used to generate answer (avoid duplicates)
    const scheduleAnswerGenerationRef = useRef<() => void>(() => {}); // Ref for answer scheduling to avoid circular deps
    const lastWordAddedTimeRef = useRef<number>(Date.now()); // Track time of last word addition for paragraph breaks
    const PARAGRAPH_PAUSE_MS = speedPreset.paragraphPauseMs;

    // INTERIM OPTIMIZATION: Cache prefix translation to avoid re-translating stable text
    const interimCacheRef = useRef<{
        originalPrefix: string;      // Original text prefix that was translated
        translatedPrefix: string;    // Cached translation of the prefix
        prefixWordCount: number;     // Number of words in the cached prefix
    }>({ originalPrefix: '', translatedPrefix: '', prefixWordCount: 0 });

    // HOLD-N CONFIG: Don't show last N words of interim (they change most often)
    const HOLD_N = speedPreset.holdN;
    const TRANSLATE_LAST_N = 7; // Only translate last N words, use cache for the rest

    // PARAGRAPH MARKER: '\n\n' for interview (visual break), '. ' for youtube (continuous)
    const PARAGRAPH_MARKER = speedPreset.paragraphMarker;

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
        const ghostStartTime = performance.now();
        // DUPLICATE CHECK: Skip if we already translated this text
        if (lastTranslatedTextRef.current === newWords) {
            console.log(`⚠️ [Ghost] Skipping duplicate translation: "${newWords.substring(0, 30)}..."`);
            return;
        }

        // Also check if new text is mostly a duplicate of previous
        // Only skip if > 60% of words were in the previous translation
        if (lastTranslatedTextRef.current && newWords.length > 10) {
            const newWordsArray = newWords.split(/\s+/);
            const prevWordsSet = new Set(lastTranslatedTextRef.current.split(/\s+/));
            const overlappingWords = newWordsArray.filter(w => prevWordsSet.has(w)).length;
            const overlapRatio = overlappingWords / newWordsArray.length;

            if (overlapRatio > 0.6) {
                console.log(`⚠️ [Ghost] Skipping mostly-duplicate text (${Math.round(overlapRatio * 100)}% overlap): "${newWords.substring(0, 30)}..."`);
                return;
            } else if (overlappingWords > 0) {
                console.log(`✅ [Ghost] Allowing translation despite ${overlappingWords}/${newWordsArray.length} overlapping words (${Math.round(overlapRatio * 100)}%)`);
            }
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
                // Skip placeholder results — model not loaded yet, schedule retry
                if (translation === '⏳...' || translation === '❌' || translation === '⚠️') {
                    console.log(`🔄 [Ghost] Model not ready, scheduling retry in 3s for: "${newWords.substring(0, 30)}..."`);
                    setTimeout(() => {
                        executeGhostTranslation(newWords, fullText, addParagraphBreak, punctuation);
                    }, 3000);
                    return { ...prev, isProcessingGhost: false };
                }

                // Check if this translation is already at the end
                if (prev.ghostTranslation && prev.ghostTranslation.endsWith(translation)) {
                    return { ...prev, isProcessingGhost: false };
                }

                // METRICS: Record words translated
                const translatedWordCount = translation.split(/\s+/).length;
                metricsCollector.recordWordsTranslated(translatedWordCount);

                // APPEND: Each finalized block = sentence-like unit
                // Add period + block separator (｜) for visual segmentation
                const BLOCK_SEP = '｜'; // Full-width pipe as block boundary marker
                let cleanTranslation = translation.trim();
                // Capitalize first letter of each block
                if (cleanTranslation.length > 0) {
                    cleanTranslation = cleanTranslation[0].toUpperCase() + cleanTranslation.slice(1);
                }
                // Add period if block doesn't end with punctuation
                if (cleanTranslation && !/[.!?;:]$/.test(cleanTranslation)) {
                    cleanTranslation += '.';
                }

                const separator = addParagraphBreak
                    ? (punctuation + PARAGRAPH_MARKER)
                    : (prev.ghostTranslation ? ` ${BLOCK_SEP} ` : '');

                return {
                    ...prev,
                    ghostTranslation: prev.ghostTranslation
                        ? `${prev.ghostTranslation}${separator}${cleanTranslation}`
                        : cleanTranslation,
                    isProcessingGhost: false
                };
            });

            // === GHOST LOG ===
            const ghostLatency = performance.now() - ghostStartTime;
            debugLogger.log('GHOST', `${newWords.substring(0, 40)} → ${translation.substring(0, 40)}`, ghostLatency, newWords.split(/\s+/).length);
            console.log(`\n${'─'.repeat(50)}`);
            console.log(`👻 [GHOST ПЕРЕКЛАД] ${Math.round(ghostLatency)}ms`);
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
        const llmStartTime = performance.now();
        debugLogger.log('LLM_START', `${currentWordCount} words, ${currentWordCount - llmTranslatedWordCountRef.current} new`);

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
            // Active window size from speed preset
            const ACTIVE_WINDOW_WORDS = speedPreset.activeWindowWords;
            const translationWords = result.translation.split(/\s+/);
            const originalWords = currentOriginalText.split(/\s+/);

            // Calculate freeze point: freeze everything except last ACTIVE_WINDOW_WORDS
            const newFreezeWordCount = Math.max(0, originalWords.length - ACTIVE_WINDOW_WORDS);
            const newFreezeTranslationWordCount = Math.max(0, translationWords.length - ACTIVE_WINDOW_WORDS);

            console.log(`🧊 [LLM] Freeze calculation: ${newFreezeTranslationWordCount} words to freeze, ${translationWords.length - newFreezeTranslationWordCount} active`);

            // === DEBUG LOG ===
            const llmLatency = performance.now() - llmStartTime;
            debugLogger.log('LLM', `${result.intent.speechType} | ${result.translation.substring(0, 50)}`, llmLatency, originalWords.length);

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
                // 3. Track frozenTranslationWordCount SEPARATELY from frozenWordCount
                let updatedFrozenTranslation = prev.frozenTranslation;
                let updatedFrozenWordCount = prev.frozenWordCount;
                let updatedFrozenTranslationWordCount = prev.frozenTranslationWordCount;

                if (newFreezeWordCount > prev.frozenWordCount) {
                    // There are new words to freeze
                    // Use frozenTranslationWordCount (not recalculated from split) for accuracy
                    const prevFrozenTranslationWords = prev.frozenTranslationWordCount;
                    const newWordsToFreeze = newFreezeTranslationWordCount - prevFrozenTranslationWords;

                    if (newWordsToFreeze > 0) {
                        // Get the NEW words from translation (starting after previously frozen words)
                        const newFrozenWords = translationWords.slice(prevFrozenTranslationWords, newFreezeTranslationWordCount);
                        const newFrozenPart = newFrozenWords.join(' ');

                        // APPEND with space only — paragraph breaks are managed by addWords pauses
                        if (prev.frozenTranslation && newFrozenPart) {
                            updatedFrozenTranslation = prev.frozenTranslation + ' ' + newFrozenPart;
                        } else if (newFrozenPart) {
                            updatedFrozenTranslation = newFrozenPart;
                        }

                        updatedFrozenWordCount = newFreezeWordCount;
                        updatedFrozenTranslationWordCount = newFreezeTranslationWordCount;
                        debugLogger.log('FREEZE', `+${newWordsToFreeze} words → total ${newFreezeTranslationWordCount} translated`, undefined, newWordsToFreeze);
                        console.log(`🧊 [LLM] APPENDING ${newWordsToFreeze} new frozen words (translated: ${newFreezeTranslationWordCount}, original: ${newFreezeWordCount})`);
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
                    frozenTranslationWordCount: updatedFrozenTranslationWordCount,
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

    // Flush all active text into frozen zone (on pause or session stop)
    const flushActiveToFrozen = useCallback(() => {
        setState(prev => {
            // Only flush if there's LLM translation that hasn't been fully frozen
            if (!prev.llmTranslation || prev.llmTranslation.trim().length === 0) return prev;

            // Safety: strip any leaked LLM tags and placeholders before freezing
            const cleanLLM = prev.llmTranslation
                .replace(/\[\/INPUT_TRANSLATION\]?/gi, '')
                .replace(/\[INPUT_TRANSLATION\]/gi, '')
                .replace(/\[INTENT\][\s\S]*?(\[\/INTENT\]|$)/gi, '')
                .replace(/\[\/INTENT\]/gi, '')
                .replace(/⏳\.{0,3}/g, '')  // Remove loading placeholders
                .replace(/[❌⚠️]/g, '')      // Remove error placeholders
                .trim();

            // Don't freeze if only placeholder content remains
            if (!cleanLLM || cleanLLM.length < 2) return prev;

            const llmWords = cleanLLM.split(/\s+/).filter(w => w);
            const frozenWords = prev.frozenTranslation.split(/\s+/).filter(w => w);

            // If all LLM words are already frozen, nothing to do
            if (frozenWords.length >= llmWords.length) return prev;

            // Move ALL LLM translation to frozen (space only, no forced paragraph breaks)
            const newFrozenPart = llmWords.slice(frozenWords.length).join(' ');
            const updatedFrozen = prev.frozenTranslation
                ? prev.frozenTranslation + ' ' + newFrozenPart
                : cleanLLM;

            const originalWords = prev.originalText.split(/\s+/).filter(w => w);

            console.log(`🧊 [FLUSH] Moving ${llmWords.length - frozenWords.length} active words to frozen (total: ${llmWords.length})`);

            return {
                ...prev,
                frozenTranslation: updatedFrozen,
                frozenWordCount: originalWords.length, // All original words are now frozen
                frozenTranslationWordCount: llmWords.length // Track translated word count
            };
        });
    }, []);

    // Schedule freeze flush after 3s pause
    const scheduleFreezeFLush = useCallback(() => {
        if (freezeFlushTimerRef.current) {
            clearTimeout(freezeFlushTimerRef.current);
        }
        freezeFlushTimerRef.current = setTimeout(() => {
            console.log('⏸️ [3s PAUSE] Flushing active → frozen');
            flushActiveToFrozen();
        }, 3000);
    }, [flushActiveToFrozen]);

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

    // === TOPIC STRUCTURING (Flash-Lite) ===

    const executeTopicSummary = useCallback(async () => {
        const currentOriginal = originalTextRef.current;
        if (!currentOriginal.trim() || currentOriginal.split(/\s+/).length < 10) return;

        // Abort previous
        if (topicAbortRef.current) topicAbortRef.current.abort();
        topicAbortRef.current = new AbortController();

        setState(prev => ({ ...prev, isProcessingTopics: true }));
        const startTime = performance.now();

        try {
            const result = await generateTopicSummary(
                currentOriginal,
                state.topicSummary,
                topicAbortRef.current.signal
            );

            debugLogger.log('TOPICS', `${Math.round(performance.now() - startTime)}ms`, performance.now() - startTime, currentOriginal.split(/\s+/).length);
            lastTopicWordCountRef.current = wordCountRef.current;

            setState(prev => ({
                ...prev,
                topicSummary: result,
                isProcessingTopics: false
            }));
        } catch (e: any) {
            if (e.name !== 'AbortError') console.error('[Topics] Error:', e);
            setState(prev => ({ ...prev, isProcessingTopics: false }));
        }
    }, [state.topicSummary]);

    const scheduleTopicSummary = useCallback(() => {
        if (topicTimerRef.current) clearTimeout(topicTimerRef.current);

        // Schedule on long pause
        topicTimerRef.current = setTimeout(() => {
            if (wordCountRef.current >= TOPIC_MIN_WORDS) {
                executeTopicSummary();
            }
        }, TOPIC_PAUSE_MS);
    }, [executeTopicSummary]);

    // Trigger topics after N finalized blocks (called from addWords)
    const triggerTopicOnBlock = useCallback(() => {
        wordsInCountRef.current++;
        if (wordsInCountRef.current >= TOPIC_TRIGGER_BLOCKS && wordCountRef.current >= TOPIC_MIN_WORDS) {
            wordsInCountRef.current = 0;
            executeTopicSummary();
        }
    }, [executeTopicSummary]);

    // === PUBLIC API ===

    /**
     * Add new words to the accumulator
     * Includes duplicate detection to prevent text repetition after session restart
     * Adds paragraph breaks when there's a significant pause (1.5s+)
     */
    const addWords = useCallback((newWords: string) => {
        if (!newWords.trim()) return;

        // Clean speech: remove fillers (eh, øh), duplicates, fragments
        const trimmedNew = cleanSpeechText(newWords);
        if (!trimmedNew) return;

        // DUPLICATE DETECTION: Multiple checks to prevent text duplication
        const currentOriginal = originalTextRef.current;

        // Check 1: Exact match at end
        if (currentOriginal && currentOriginal.endsWith(trimmedNew)) {
            console.log(`⚠️ [addWords] Skipping duplicate (ends with): "${trimmedNew.substring(0, 30)}..."`);
            return;
        }

        // Check 2: Word-level overlap detection
        // Only skip if new text is MOSTLY a duplicate (not just starting with same words)
        if (currentOriginal) {
            const newWordsArray = trimmedNew.split(/\s+/);
            const newWordCount = newWordsArray.length;
            const lastOriginalWords = currentOriginal.split(/\s+/).slice(-30); // Last 30 words
            const lastOriginalText = lastOriginalWords.join(' ');

            // Find how many leading words of new text exist in recent original
            let overlapWordCount = 0;
            for (let i = Math.min(newWordCount, 10); i >= 3; i--) {
                const firstNWords = newWordsArray.slice(0, i).join(' ');
                if (lastOriginalText.includes(firstNWords)) {
                    overlapWordCount = i;
                    break;
                }
            }

            // Only block if overlap is > 50% of new text (i.e., mostly duplicate)
            if (overlapWordCount > 0) {
                const overlapRatio = overlapWordCount / newWordCount;
                if (overlapRatio > 0.5) {
                    console.log(`⚠️ [addWords] Skipping overlap (${overlapWordCount}/${newWordCount} words = ${Math.round(overlapRatio * 100)}% overlap)`);
                    return;
                } else {
                    console.log(`✅ [addWords] Allowing text despite ${overlapWordCount} overlapping words (only ${Math.round(overlapRatio * 100)}% of ${newWordCount} words)`);
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
        debugLogger.log('WORDS_IN', trimmedNew, undefined, newWordCount);

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
        }, speedPreset.ghostDebounceMs);

        // Schedule LLM translation
        scheduleLLMTranslation();

        // Topic structuring: trigger every 2 blocks + schedule on pause
        triggerTopicOnBlock();
        scheduleTopicSummary();

        // Schedule freeze flush (3s pause → move active to frozen)
        scheduleFreezeFLush();
    }, [executeGhostTranslation, scheduleLLMTranslation, triggerTopicOnBlock, scheduleTopicSummary, scheduleFreezeFLush]);

    /**
     * Set interim text (real-time, not yet finalized)
     * OPTIMIZED with Hold-N and prefix caching:
     * - Hold-N: Don't show last N words (they change most often)
     * - Cache: Only translate last TRANSLATE_LAST_N words, use cached prefix
     */
    const setInterimText = useCallback((interimText: string) => {
        const interimStartTime = performance.now();
        // Clean interim speech too (fillers, duplicates)
        const cleanedInterim = cleanSpeechText(interimText);
        const allWords = cleanedInterim.split(/\s+/).filter(w => w.length > 0);

        // HOLD-N: Hide last N words from display (they're most unstable)
        // BUT if we have too few words, show all of them (better than nothing)
        const displayWords = allWords.length > HOLD_N
            ? allWords.slice(0, -HOLD_N)
            : allWords;  // Show all words if we can't hide N
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

                    const interimLatency = performance.now() - interimStartTime;
                    debugLogger.log('INTERIM', finalTranslation.trim().substring(0, 50), interimLatency, allWords.length);

                    setState(prev => ({
                        ...prev,
                        interimGhostTranslation: finalTranslation.trim()
                    }));
                } catch (e) {
                    // Ignore translation errors for interim text
                }
            }, speedPreset.interimDebounceMs);
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
            frozenTranslationWordCount: 0,
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
            topicSummary: '',
            isProcessingTopics: false,
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
        wordsInCountRef.current = 0; // Reset topic block counter
        lastTopicWordCountRef.current = 0;

        // METRICS: Start metrics session
        metricsCollector.startSession();
        debugLogger.startSession();
        debugLogger.log('PRESET', `${context.speedPreset || 'interview'} | holdN=${speedPreset.holdN} ghostDb=${speedPreset.ghostDebounceMs}ms llm=${speedPreset.llmEnabled} activeWin=${speedPreset.activeWindowWords}`);

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
        if (freezeFlushTimerRef.current) {
            clearTimeout(freezeFlushTimerRef.current);
            freezeFlushTimerRef.current = null;
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

        // Flush remaining active text to frozen zone on session stop
        flushActiveToFrozen();
        console.log('🧊 [StopSession] Flushed active → frozen');

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
        debugLogger.stopSession();

        console.log('🛑 [StreamingMode] Session stopped');
    }, [executeLLMTranslation, executeAnswerGeneration, flushActiveToFrozen]);

    /**
     * Reset to initial state
     */
    const reset = useCallback(() => {
        // Clear all timers
        if (llmPauseTimerRef.current) {
            clearTimeout(llmPauseTimerRef.current);
            llmPauseTimerRef.current = null;
        }
        if (freezeFlushTimerRef.current) {
            clearTimeout(freezeFlushTimerRef.current);
            freezeFlushTimerRef.current = null;
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
