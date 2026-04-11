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
import { generateStreamingTranslation, StreamingTranslationResult, generateInterviewAssist, generateTopicSummary, generateLiteraryTranslation, analyzeConversation, generateInterviewAnswer, refineTranslationPair } from '../services/geminiService';
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
    topicChunks: Array<{ rawText: string; topics: string }>;
    isProcessingTopics: boolean;

    // Literary translation (Flash — quality rewrite of topics)
    literaryChunks: Array<{ rawText: string; topics: string; literary: string }>;
    isProcessingLiterary: boolean;

    // Interview conversation log (FOCUS mode)
    conversationLog: string;
    lastDetectedQuestion: string;
    isProcessingConversation: boolean;
    // Answers stored separately (won't be overwritten by Flash-Lite)
    answeredQuestions: Array<{ question: string; answer: string; translation: string }>;

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
    // FOCUS mode: always use youtube preset for translation quality (big batches)
    // but conversation analyzer still runs (detects questions)
    const presetId = context.viewMode === 'FOCUS' ? 'youtube' : (context.speedPreset || 'interview');
    const speedPreset: SpeedPresetConfig = SPEED_PRESETS[presetId];

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
        topicChunks: [],
        isProcessingTopics: false,
        literaryChunks: [],
        isProcessingLiterary: false,
        conversationLog: '',
        lastDetectedQuestion: '',
        isProcessingConversation: false,
        answeredQuestions: [],
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
    const interimTranslatingRef = useRef<boolean>(false); // Lock: skip new interim while previous is in-flight
    const interimLatestTextRef = useRef<string>(''); // Latest requested text (for coalescing)
    const answerPauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // For answer generation pause
    const freezeFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // For flushing active→frozen on 3s pause
    const topicTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // For topic summarization debounce
    const topicAbortRef = useRef<AbortController | null>(null);
    const lastTopicWordCountRef = useRef<number>(0); // Track words at last topic generation
    const wordsInCountRef = useRef<number>(0); // Count WORDS_IN events since last topic
    const TOPIC_TRIGGER_WORDS = 20; // Generate topics every N words — bigger chunks = better context
    const TOPIC_MIN_WORDS = 15; // Minimum words before first topic
    const TOPIC_PAUSE_MS = 3000; // 3s pause triggers topic update
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
    // BLOCK TRANSLATION: Track how many words have been sent for translation
    const translatedUpToWordRef = useRef<number>(0);
    const BLOCK_SIZE = 7; // Words per translation block
    const blockFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // LLM REFINEMENT: Track original + ghost blocks for sliding window
    const originalBlocksRef = useRef<string[]>([]); // Original text blocks
    const ghostBlocksRef = useRef<string[]>([]);     // Ghost translation blocks
    const refinedUpToBlockRef = useRef<number>(0);   // How many blocks have been LLM-refined
    const refineAbortRef = useRef<AbortController | null>(null);

    // === GHOST TRANSLATION (HIDDEN — draft for LLM) ===
    // Ghost translates blocks silently. User sees only LLM-refined text.
    // First block shows ghost immediately (so user sees something), then LLM replaces it.
    const executeGhostTranslation = useCallback(async (newWords: string, fullText: string) => {
        const ghostStartTime = performance.now();
        if (lastTranslatedTextRef.current === newWords) return;

        setState(prev => ({ ...prev, isProcessingGhost: true }));

        try {
            const words = await localTranslator.translatePhraseChunked(newWords);
            const translation = words.map(w => w.ghostTranslation).join(' ');
            lastTranslatedTextRef.current = newWords;

            if (translation === '⏳...' || translation === '❌' || translation === '⚠️') {
                setTimeout(() => executeGhostTranslation(newWords, fullText), 3000);
                setState(prev => ({ ...prev, isProcessingGhost: false }));
                return;
            }

            // Store blocks for LLM refinement
            const blockIndex = originalBlocksRef.current.length;
            originalBlocksRef.current.push(newWords);
            ghostBlocksRef.current.push(translation.trim());

            metricsCollector.recordWordsTranslated(translation.split(/\s+/).length);

            // Show ghost draft for the FIRST block (so user sees something immediately)
            // For subsequent blocks, show ghost until LLM catches up
            setState(prev => ({
                ...prev,
                ghostTranslation: ghostBlocksRef.current.join(' '),
                isProcessingGhost: false
            }));

            const ghostLatency = performance.now() - ghostStartTime;
            debugLogger.log('GHOST', `${newWords.substring(0, 40)} → ${translation.substring(0, 40)}`, ghostLatency, newWords.split(/\s+/).length);

            opts.onGhostUpdate(translation);

            // TRIGGER LLM REFINEMENT: Every 2 blocks (pair = 14 words)
            if (blockIndex >= 1 && blockIndex % 2 === 1) {
                scheduleLLMRefinement();
            }
        } catch (e) {
            console.error('Ghost translation error:', e);
            setState(prev => ({ ...prev, isProcessingGhost: false }));
        }
    }, [opts]);

    // === LLM SLIDING WINDOW REFINEMENT ===
    // Takes PAIRS of blocks (14 words), sends to Gemini for quality translation
    // Result is a single coherent sentence that replaces both ghost drafts
    // Refined sentences are joined into continuous text
    const refinedSentencesRef = useRef<string[]>([]); // LLM-refined sentences (each from 2 blocks)

    const scheduleLLMRefinement = useCallback(async () => {
        const ctx = contextRef.current;
        const totalBlocks = ghostBlocksRef.current.length;

        // Process pairs: (0,1), (2,3), (4,5)...
        while (refinedUpToBlockRef.current + 1 < totalBlocks) {
            const i = refinedUpToBlockRef.current;
            const origPair = originalBlocksRef.current[i] + ' ' + originalBlocksRef.current[i + 1];
            const draftPair = ghostBlocksRef.current[i] + ' ' + ghostBlocksRef.current[i + 1];

            if (refineAbortRef.current) refineAbortRef.current.abort();
            refineAbortRef.current = new AbortController();

            setState(prev => ({ ...prev, isProcessingLLM: true }));
            const startTime = performance.now();

            const refined = await refineTranslationPair(
                origPair,
                draftPair,
                ctx.targetLanguage || 'Norwegian',
                ctx.nativeLanguage || 'Ukrainian',
                refineAbortRef.current.signal
            );

            if (refined) {
                refinedSentencesRef.current.push(refined.trim());

                // Build display: refined sentences + remaining unrefined ghost blocks
                const refinedText = refinedSentencesRef.current.join(' ');
                const unrefinedStart = refinedUpToBlockRef.current + 2;
                const unrefinedBlocks = ghostBlocksRef.current.slice(unrefinedStart);
                const fullText = unrefinedBlocks.length > 0
                    ? refinedText + ' ' + unrefinedBlocks.join(' ')
                    : refinedText;

                setState(prev => ({
                    ...prev,
                    ghostTranslation: fullText,
                    isProcessingLLM: false
                }));

                debugLogger.log('LLM_REFINE', `pair ${i}-${i+1}: "${refined.substring(0, 50)}"`, performance.now() - startTime);
            } else {
                setState(prev => ({ ...prev, isProcessingLLM: false }));
            }

            refinedUpToBlockRef.current = i + 2;
        }
    }, []);

    // === LLM TRANSLATION ===
    const executeLLMTranslation = useCallback(async () => {
        // FOCUS mode: skip LLM translation — NMT handles it, conversation analyzer handles questions
        if (contextRef.current.viewMode === 'FOCUS') return;

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

    const isTopicRunningRef = useRef<boolean>(false);
    const topicProcessedUpToWordRef = useRef<number>(0); // Track which words were already processed

    const executeTopicSummary = useCallback(async () => {
        const currentOriginal = originalTextRef.current;
        if (!currentOriginal.trim() || currentOriginal.split(/\s+/).length < 10) return;

        // Skip if previous Topics call still running
        if (isTopicRunningRef.current) return;
        isTopicRunningRef.current = true;

        // Only send NEW words (after what was already processed)
        const allWords = currentOriginal.split(/\s+/);
        const newWords = allWords.slice(topicProcessedUpToWordRef.current);
        if (newWords.length < 10) {
            isTopicRunningRef.current = false;
            return;
        }
        const newText = newWords.join(' ');
        topicProcessedUpToWordRef.current = allWords.length;

        if (topicAbortRef.current) topicAbortRef.current.abort();
        topicAbortRef.current = new AbortController();

        setState(prev => ({ ...prev, isProcessingTopics: true }));
        const startTime = performance.now();

        try {
            // Send ONLY new text, no existing topics — LLM produces fresh output for this chunk
            const result = await generateTopicSummary(
                newText,
                '', // No existing topics — each call produces independent output
                topicAbortRef.current.signal,
                contextRef.current.targetLanguage,
                contextRef.current.nativeLanguage
            );

            debugLogger.log('TOPICS', `${Math.round(performance.now() - startTime)}ms`, performance.now() - startTime, newWords.length);
            lastTopicWordCountRef.current = wordCountRef.current;

            if (result && result.trim()) {
                // APPEND new result to existing — frozen text stays, new text added below
                const trimmedResult = result.trim();
                setState(prev => ({
                    ...prev,
                    topicSummary: prev.topicSummary
                        ? `${prev.topicSummary}\n\n${trimmedResult}`
                        : trimmedResult,
                    topicChunks: [...prev.topicChunks, { rawText: newText, topics: trimmedResult }],
                    isProcessingTopics: false
                }));
                // Trigger literary translation for this chunk (fire-and-forget)
                triggerLiterary(newText, trimmedResult);
            } else {
                setState(prev => ({ ...prev, isProcessingTopics: false }));
            }
        } catch (e: any) {
            if (e.name !== 'AbortError') console.error('[Topics] Error:', e);
            setState(prev => ({ ...prev, isProcessingTopics: false }));
        } finally {
            isTopicRunningRef.current = false;
        }
    }, []);

    const scheduleTopicSummary = useCallback(() => {
        if (topicTimerRef.current) clearTimeout(topicTimerRef.current);

        // Schedule on long pause
        topicTimerRef.current = setTimeout(() => {
            if (wordCountRef.current >= TOPIC_MIN_WORDS) {
                executeTopicSummary();
            }
        }, TOPIC_PAUSE_MS);
    }, [executeTopicSummary]);

    // Trigger topics every TOPIC_TRIGGER_WORDS words (called from addWords)
    const triggerTopicOnBlock = useCallback(() => {
        wordsInCountRef.current++;
        if (wordsInCountRef.current >= TOPIC_TRIGGER_WORDS && wordCountRef.current >= TOPIC_MIN_WORDS) {
            wordsInCountRef.current = 0;
            executeTopicSummary();
        }
    }, [executeTopicSummary]);

    // === LITERARY TRANSLATION (Flash — quality rewrite after topics) ===

    const literaryAbortRef = useRef<AbortController | null>(null);
    const isLiteraryRunningRef = useRef<boolean>(false);
    const literaryQueueRef = useRef<Array<{ rawText: string; topics: string }>>([]);

    const processLiteraryItem = async (rawText: string, topics: string) => {
        if (literaryAbortRef.current) literaryAbortRef.current.abort();
        literaryAbortRef.current = new AbortController();

        setState(prev => ({ ...prev, isProcessingLiterary: true }));

        try {
            const result = await generateLiteraryTranslation(
                rawText,
                topics,
                literaryAbortRef.current.signal,
                contextRef.current.targetLanguage,
                contextRef.current.nativeLanguage
            );

            if (result && result.trim()) {
                setState(prev => ({
                    ...prev,
                    literaryChunks: [...prev.literaryChunks, { rawText, topics, literary: result.trim() }],
                    isProcessingLiterary: false
                }));
            } else {
                setState(prev => ({ ...prev, isProcessingLiterary: false }));
            }
        } catch (e: any) {
            if (e.name !== 'AbortError') console.error('[Literary] Error:', e);
            setState(prev => ({ ...prev, isProcessingLiterary: false }));
        } finally {
            isLiteraryRunningRef.current = false;
            // Process queued items
            const next = literaryQueueRef.current.shift();
            if (next) {
                triggerLiterary(next.rawText, next.topics);
            }
        }
    };

    const triggerLiterary = (rawText: string, topics: string) => {
        if (isLiteraryRunningRef.current) {
            literaryQueueRef.current.push({ rawText, topics });
            return;
        }
        isLiteraryRunningRef.current = true;
        processLiteraryItem(rawText, topics);
    };

    // === CONVERSATION ANALYZER (FOCUS mode) ===

    const conversationAbortRef = useRef<AbortController | null>(null);
    const answerAbortRef = useRef<AbortController | null>(null);

    const executeConversationAnalysis = useCallback(async () => {
        const currentOriginal = originalTextRef.current;
        const currentContext = contextRef.current;
        if (!currentOriginal.trim() || currentOriginal.split(/\s+/).length < 10) return;
        if (currentContext.viewMode !== 'FOCUS') return; // Only in FOCUS mode

        if (conversationAbortRef.current) conversationAbortRef.current.abort();
        conversationAbortRef.current = new AbortController();

        setState(prev => ({ ...prev, isProcessingConversation: true }));

        try {
            const result = await analyzeConversation(
                currentOriginal,
                state.conversationLog,
                conversationAbortRef.current.signal
            );

            debugLogger.log('CONV', `q=${result.hasNewQuestion} | ${result.lastQuestion.substring(0, 40)}`, undefined, currentOriginal.split(/\s+/).length);

            setState(prev => ({
                ...prev,
                conversationLog: result.log,
                lastDetectedQuestion: result.hasNewQuestion ? result.lastQuestion : prev.lastDetectedQuestion,
                isProcessingConversation: false
            }));

            // If new question detected — generate answer from candidate profile
            if (result.hasNewQuestion && result.lastQuestion) {
                generateAnswerForQuestion(result.lastQuestion, result.log);
            }
        } catch (e: any) {
            if (e.name !== 'AbortError') console.error('[Conversation] Error:', e);
            setState(prev => ({ ...prev, isProcessingConversation: false }));
        }
    }, [state.conversationLog]);

    const generateAnswerForQuestion = useCallback(async (question: string, conversationContext: string) => {
        const ctx = contextRef.current;

        if (answerAbortRef.current) answerAbortRef.current.abort();
        answerAbortRef.current = new AbortController();

        setState(prev => ({ ...prev, isGeneratingAnswer: true }));
        debugLogger.log('ANSWER_START', question.substring(0, 50));

        try {
            const result = await generateInterviewAnswer(
                question,
                conversationContext,
                ctx.resume || '',
                ctx.knowledgeBase || '',
                ctx.targetLanguage || 'Norwegian',
                ctx.nativeLanguage || 'Ukrainian',
                answerAbortRef.current.signal
            );

            debugLogger.log('ANSWER', result.answer.substring(0, 50));

            // Store answer separately (won't be overwritten by Flash-Lite)
            setState(prev => ({
                ...prev,
                generatedAnswer: result.answer,
                answerTranslation: result.answerTranslation,
                answeredQuestions: [...prev.answeredQuestions, {
                    question,
                    answer: result.answer,
                    translation: result.answerTranslation
                }],
                isGeneratingAnswer: false
            }));
        } catch (e: any) {
            if (e.name !== 'AbortError') console.error('[Answer] Error:', e);
            setState(prev => ({ ...prev, isGeneratingAnswer: false }));
        }
    }, []);

    // Trigger conversation analysis alongside topics (for FOCUS mode)
    const triggerConversationOnBlock = useCallback(() => {
        if (contextRef.current.viewMode === 'FOCUS') {
            executeConversationAnalysis();
        }
    }, [executeConversationAnalysis]);

    // === PUBLIC API ===

    /**
     * Add new words to the accumulator
     * Includes duplicate detection to prevent text repetition after session restart
     * Adds paragraph breaks when there's a significant pause (1.5s+)
     */
    const addWords = useCallback((newWords: string) => {
        if (!newWords.trim()) return;

        const trimmedNew = cleanSpeechText(newWords);
        if (!trimmedNew) return;

        // METRICS
        const newWordCount = trimmedNew.split(/\s+/).length;
        metricsCollector.recordWordsReceived(newWordCount);
        debugLogger.log('WORDS_IN', trimmedNew, undefined, newWordCount);

        // Update original text — just append, no paragraph logic
        setState(prev => {
            const newOriginal = prev.originalText
                ? `${prev.originalText} ${trimmedNew}`
                : trimmedNew;
            const totalWords = newOriginal.split(/\s+/).length;

            originalTextRef.current = newOriginal;
            wordCountRef.current = totalWords;

            return { ...prev, originalText: newOriginal, wordCount: totalWords };
        });

        // NO GHOST TRANSLATION — all resources go to Topics (Structure)
        // Topics triggered on every block + on pause
        triggerTopicOnBlock();
        scheduleTopicSummary();
    }, [triggerTopicOnBlock, scheduleTopicSummary]);

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

        // Debounce interim translation
        if (interimGhostTimerRef.current) {
            clearTimeout(interimGhostTimerRef.current);
        }

        // Interim ghost translation for real-time display
        // OPTIMIZATION 1: Only translate last MAX_INTERIM_TRANSLATE words
        // OPTIMIZATION 2: Coalescing — skip if previous translation still in-flight
        //                  When it finishes, it re-translates with latest text
        const MAX_INTERIM_TRANSLATE = 5;
        interimLatestTextRef.current = displayText; // Always store latest

        if (displayText.trim() && contextRef.current.targetLanguage !== contextRef.current.nativeLanguage) {
            // Skip if already translating — coalescing will pick up latest when done
            if (interimTranslatingRef.current) return;

            interimGhostTimerRef.current = setTimeout(async () => {
                const translateLatest = async () => {
                    const currentText = interimLatestTextRef.current;
                    if (!currentText.trim()) return;

                    interimTranslatingRef.current = true;
                    const startTime = performance.now();
                    try {
                        const words = currentText.split(/\s+/);
                        const totalWords = words.length;
                        const textToTranslate = totalWords > MAX_INTERIM_TRANSLATE
                            ? words.slice(-MAX_INTERIM_TRANSLATE).join(' ')
                            : currentText;

                        const translated = await localTranslator.translatePhraseChunked(textToTranslate);
                        const translation = translated.map(w => w.ghostTranslation).join(' ');
                        const finalTranslation = totalWords > MAX_INTERIM_TRANSLATE
                            ? '… ' + translation : translation;

                        debugLogger.log('INTERIM', finalTranslation.trim().substring(0, 50), performance.now() - startTime, totalWords);
                        setState(prev => ({ ...prev, interimGhostTranslation: finalTranslation.trim() }));
                    } catch (e) { /* ignore */ }
                    interimTranslatingRef.current = false;

                    // COALESCE: If text changed while translating, translate again with latest
                    if (interimLatestTextRef.current !== currentText && interimLatestTextRef.current.trim()) {
                        translateLatest();
                    }
                };
                translateLatest();
            }, speedPreset.interimDebounceMs);
        } else {
            setState(prev => ({ ...prev, interimGhostTranslation: '' }));
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
            topicChunks: [],
            isProcessingTopics: false,
            literaryChunks: [],
            isProcessingLiterary: false,
            conversationLog: '',
            lastDetectedQuestion: '',
            isProcessingConversation: false,
            isGeneratingAnswer: false,
            isAnalyzing: false,
            isListening: true,
            isProcessingGhost: false,
            isProcessingLLM: false
        }));

        llmTranslatedWordCountRef.current = 0;
        originalTextRef.current = '';
        translatedUpToWordRef.current = 0;
        originalBlocksRef.current = [];
        ghostBlocksRef.current = [];
        refinedUpToBlockRef.current = 0;
        refinedSentencesRef.current = [];
        topicProcessedUpToWordRef.current = 0;
        if (literaryAbortRef.current) { literaryAbortRef.current.abort(); literaryAbortRef.current = null; }
        isLiteraryRunningRef.current = false;
        literaryQueueRef.current = [];
        if (refineAbortRef.current) { refineAbortRef.current.abort(); refineAbortRef.current = null; }
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
        // Use contextRef for fresh values (startSession has [] deps = stale closure)
        const effectivePresetId = contextRef.current.viewMode === 'FOCUS' ? 'youtube' : (contextRef.current.speedPreset || 'interview');
        const currentPreset = SPEED_PRESETS[effectivePresetId];
        debugLogger.log('PRESET', `${effectivePresetId} (mode=${contextRef.current.viewMode}) | holdN=${currentPreset.holdN} ghostDb=${currentPreset.ghostDebounceMs}ms llm=${currentPreset.llmEnabled} activeWin=${currentPreset.activeWindowWords}`);

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
            topicSummary: '',
            topicChunks: [],
            isProcessingTopics: false,
            literaryChunks: [],
            isProcessingLiterary: false,
            conversationLog: '',
            lastDetectedQuestion: '',
            isProcessingConversation: false,
            answeredQuestions: [],
            isGeneratingAnswer: false,
            isAnalyzing: false,
            isListening: false,
            isProcessingGhost: false,
            isProcessingLLM: false
        });

        llmTranslatedWordCountRef.current = 0;
        originalTextRef.current = '';
        translatedUpToWordRef.current = 0;
        originalBlocksRef.current = [];
        ghostBlocksRef.current = [];
        refinedUpToBlockRef.current = 0;
        refinedSentencesRef.current = [];
        topicProcessedUpToWordRef.current = 0;
        if (literaryAbortRef.current) { literaryAbortRef.current.abort(); literaryAbortRef.current = null; }
        isLiteraryRunningRef.current = false;
        literaryQueueRef.current = [];
        if (refineAbortRef.current) { refineAbortRef.current.abort(); refineAbortRef.current = null; }
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
