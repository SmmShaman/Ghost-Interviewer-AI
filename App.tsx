import React, { useState, useEffect, useRef, useCallback } from 'react';
import SetupPanel from './components/SetupPanel';
import GearMenu from './components/GearMenu';
import BrickRow from './components/BrickRow';
import CandidateRow from './components/CandidateRow';
import LandingPage from './components/LandingPage';
import SimpleModeLayout from './components/layouts/SimpleModeLayout';
import FocusModeLayout from './components/layouts/FocusModeLayout';
import FullModeLayout from './components/layouts/FullModeLayout';
import StreamingSimpleModeLayout from './components/layouts/StreamingSimpleModeLayout';
import StreamingFocusModeLayout from './components/layouts/StreamingFocusModeLayout';
import StreamingFullModeLayout from './components/layouts/StreamingFullModeLayout';
import { MicIcon, StopIcon, DownloadIcon, TrashIcon } from './components/Icons';
import { InterviewContext, AppState, Message, IWindow, ViewMode } from './types';
import { generateInterviewAssist } from './services/geminiService';
import { localTranslator } from './services/localTranslator';
import { knowledgeSearch } from './services/knowledgeSearch';
import { translations } from './translations';
import { useStreamingMode } from './hooks/useStreamingMode';
import {
    BLOCK_CONFIG,
    LLM_CONFIG,
    DEFAULT_MODE_CONFIG,
    DEFAULT_CONTEXT,
    STORAGE_KEY,
    LANG_MAP,
    AIQueueItem,
    PendingLLMBlock
} from './config/constants';

// Configuration constants imported from config/constants.ts

const App: React.FC = () => {
  // State initialization with LocalStorage check
  const [context, setContext] = useState<InterviewContext>(() => {
      try {
          const saved = localStorage.getItem(STORAGE_KEY);
          if (saved) {
              const parsed = JSON.parse(saved);
              // Merge with default to ensure new fields exist if loading old state
              // Deep merge modeConfig to preserve any custom prompts
              const mergedModeConfig = {
                  full: { ...DEFAULT_MODE_CONFIG.full, ...(parsed.modeConfig?.full || {}) },
                  focus: { ...DEFAULT_MODE_CONFIG.focus, ...(parsed.modeConfig?.focus || {}) },
                  simple: { ...DEFAULT_MODE_CONFIG.simple, ...(parsed.modeConfig?.simple || {}) }
              };
              return { ...DEFAULT_CONTEXT, ...parsed, modeConfig: mergedModeConfig };
          }
      } catch (e) {
          console.error("Failed to load context", e);
      }
      return DEFAULT_CONTEXT;
  });

  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  
  // Visual transcripts
  const [transcript, setTranscript] = useState<string>(""); // Final chunk
  const [interimTranscript, setInterimTranscript] = useState<string>(""); // Real-time grey text
  const [liveTranslation, setLiveTranslation] = useState<string>(""); // Real-time draft translation (Ghost)
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const [uiLang, setUiLang] = useState<'en' | 'uk'>('en');
  const [hasSessionStarted, setHasSessionStarted] = useState(false); // Landing vs Working view
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [inputLevel, setInputLevel] = useState(0); // For candidate visualizer
  const [isClearModalOpen, setIsClearModalOpen] = useState(false);

  // PENDING LLM BLOCKS: Visual queue for center column
  // Shows blocks at different stages: collecting → processing → completed
  const [pendingBlocks, setPendingBlocks] = useState<PendingLLMBlock[]>([]);
  const [completedBlocks, setCompletedBlocks] = useState<PendingLLMBlock[]>([]);
  const [currentCollectingText, setCurrentCollectingText] = useState<string>(''); // Live ORIGINAL text being collected
  const [currentCollectingTranslation, setCurrentCollectingTranslation] = useState<string>(''); // Live CHROME translation

  // Model Download State
  const [modelProgress, setModelProgress] = useState(0);
  const [isModelReady, setIsModelReady] = useState(false);
  const [modelError, setModelError] = useState(false);

  // STREAMING MODE: New architecture toggle (for SIMPLE mode)
  // Set to true to use the new streaming/subtitle-like UI
  const [useStreamingUI, setUseStreamingUI] = useState(true);

  // LLM TRANSLATION TOGGLE: Enable/disable LLM translation (only Ghost/Chrome when disabled)
  const [llmTranslationEnabled, setLlmTranslationEnabled] = useState(true);

  // STREAMING MODE HOOK: Manages accumulated text and translations
  const streamingMode = useStreamingMode(context, {
    llmTranslationEnabled,
    llmTriggerWords: 25,
    llmPauseMs: 2000,
    ghostContextWords: 50,
    onQuestionDetected: (confidence) => {
      console.log(`❓ [StreamingMode] Question detected with ${confidence}% confidence`);
    }
  });

  const t = translations[uiLang];
  
  // Refs
  const recognitionRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const shouldBeListening = useRef(false); 
  const isUserSpeakingRef = useRef(false); // Ref for instant access in callback
  const translationTimeoutRef = useRef<any>(null); // Ref for debounce
  const translationRequestId = useRef(0); // Race condition fix
  
  // Rolling Buffer Ref (Stores last 2 sentences to fix context if words are dropped)
  const historyBufferRef = useRef<string[]>([]);
  
  // Audio Analysis Refs (For Stereo Split & Visualizer)
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioHistoryRef = useRef<{left: number, right: number}[]>([]); // Stores recent volume levels
  const streamRef = useRef<MediaStream | null>(null);

  // --- SPEECH BUFFERING REFS (Delta Tracking Pattern) ---
  // Web Speech API gives FULL accumulated text each time, not deltas
  // We track how many words we've already committed to extract only NEW words
  const committedWordCountRef = useRef<number>(0); // Words already committed
  const lastFullTextRef = useRef<string>(""); // Last full text from API for delta calculation
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isCommittingRef = useRef<boolean>(false); // Mutex for commit operation
  
  // --- AI QUEUE REFS ---
  // Stores actual data objects, not just IDs, to prevent Race Conditions with React State
  const aiQueueRef = useRef<AIQueueItem[]>([]);
  const isAIProcessingRef = useRef(false); // Mutex for AI processing
  const llmAbortControllerRef = useRef<AbortController | null>(null); // For cancelling LLM requests

  // LLM ACCUMULATOR: Buffer for collecting larger text blocks before sending to LLM
  const llmAccumulatorRef = useRef<{
    text: string;           // Accumulated text
    wordCount: number;      // Total words accumulated
    questionId: string | null;  // Question ID for the accumulated block
    responseId: string | null;  // Response ID for the accumulated block
    targetMessageId: string | null; // ID of interviewer message to receive translation
  }>({ text: '', wordCount: 0, questionId: null, responseId: null, targetMessageId: null });
  const llmSilenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track ALL LLM translation blocks for center column display
  const llmTranslationBlocksRef = useRef<Array<{ id: string; translation: string }>>([]);

  // SESSION-LEVEL IDs: One questionId per recording session (Start to Stop)
  // This ensures all blocks in a session are treated as ONE question for LLM
  const sessionQuestionIdRef = useRef<string | null>(null);
  const sessionResponseIdRef = useRef<string | null>(null);
  const llmLastActivityRef = useRef<number>(Date.now()); // Track pause duration
  const firstSessionMessageIdRef = useRef<string | null>(null); // ID of FIRST message in session (for LLM updates)
  const firstSessionAssistantIdRef = useRef<string | null>(null); // ID of FIRST assistant message in session

  // DEBOUNCE: Store latest streaming data and batch UI updates
  const streamingPartialRef = useRef<{
    responseId: string | null;
    targetMessageId: string | null;
    partial: any;
    startTime: number;
  } | null>(null);
  const streamingUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const STREAMING_DEBOUNCE_MS = 100; // Update UI max every 100ms

  const contextRef = useRef(context);

  // STREAMING MODE REFS: For accessing in speech recognition callback
  const useStreamingUIRef = useRef(useStreamingUI);
  const streamingModeRef = useRef(streamingMode);

  // Keep refs updated
  useEffect(() => {
    useStreamingUIRef.current = useStreamingUI;
    streamingModeRef.current = streamingMode;
  }, [useStreamingUI, streamingMode]);

  // Persist Context to LocalStorage whenever it changes
  useEffect(() => {
    contextRef.current = context;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(context));
    } catch (e) {
        console.error("Failed to save context", e);
    }
  }, [context]);

  // Handle Logic requiring session clear for mode change
  const handleContextChange = (newContext: InterviewContext) => {
      // If View Mode changes AND we have messages, prompt to clear
      if (newContext.viewMode !== context.viewMode && messages.length > 0) {
          if (window.confirm(t.modeChangeWarning || "Changing mode clears session. Proceed?")) {
              setMessages([]);
              setContext(newContext);
          }
          // Else: ignore the change (SetupPanel will not update)
      } else {
          setContext(newContext);
      }
  };

  // INITIALIZE LOCAL TRANSLATOR & Handle Model Switching
  useEffect(() => {
      // If the context model doesn't match the loaded model, switch it.
      // This also handles initial load (where translator.getCurrentModelType() default is 'opus')
      if (context.ghostModel !== localTranslator.getCurrentModelType() || !localTranslator.getStatus().isReady) {
          setIsModelReady(false);
          setModelProgress(0);
          // Clear translation cache when switching models
          localTranslator.clearCache();
          localTranslator.switchModel(context.ghostModel, (progress) => {
              const safeProgress = Number.isFinite(progress) ? progress : 0;
              setModelProgress(Math.round(safeProgress));

              if (safeProgress >= 100) {
                  setIsModelReady(true);
              }
          }).catch(err => {
              console.error("Local Translator Init Error:", err);
              setModelError(true);
          });
      }
  }, [context.ghostModel]);

  // Sync languages with translator and clear cache on language change
  useEffect(() => {
    // Interviewer speaks targetLang -> Translate to nativeLang
    localTranslator.setLanguages(context.targetLanguage, context.nativeLanguage);
    // Clear translation cache when languages change
    localTranslator.clearCache();
    // Pre-initialize Chrome Translator API (prevents race condition)
    localTranslator.preInitChrome();
  }, [context.targetLanguage, context.nativeLanguage]);

  // RETRY GHOST TRANSLATIONS when model becomes ready
  // Re-translates any messages that got "⏳..." while model was loading
  useEffect(() => {
    if (!isModelReady || messages.length === 0) return;

    const retryPendingTranslations = async () => {
      const messagesToRetry = messages.filter(
        msg => msg.role === 'interviewer' && msg.ghostTranslation === '⏳...'
      );

      if (messagesToRetry.length === 0) return;

      console.log(`🔄 Retrying ${messagesToRetry.length} pending Ghost translations...`);

      for (const msg of messagesToRetry) {
        try {
          const words = await localTranslator.translatePhrase(msg.text);
          const ghostText = words.map(w => w.ghostTranslation).join(' ');

          setMessages(prev => prev.map(m =>
            m.id === msg.id ? { ...m, ghostTranslation: ghostText } : m
          ));
          console.log(`✅ Retried translation for: "${msg.text.substring(0, 30)}..."`);
        } catch (e) {
          console.error(`❌ Failed to retry translation for message ${msg.id}`, e);
        }
      }
    };

    retryPendingTranslations();
  }, [isModelReady, messages.length]);

  // INDEX KNOWLEDGE BASE FOR TF-IDF SEARCH
  useEffect(() => {
    if (context.knowledgeBase && context.knowledgeBase.trim().length > 0) {
      knowledgeSearch.index(context.knowledgeBase, 'knowledgeBase');
      const stats = knowledgeSearch.getStats();
      console.log(`📚 Knowledge Base indexed: ${stats.chunks} chunks, ${stats.terms} terms`);
    } else {
      knowledgeSearch.clear();
    }
  }, [context.knowledgeBase]);

  // Update System Prompt when language changes (if using default)
  useEffect(() => {
    const prevLang = uiLang === 'en' ? 'uk' : 'en';
    const prevDefault = translations[prevLang].defaultPrompt;
    const currentDefault = translations[uiLang].defaultPrompt;
    
    // Update the default preset in savedPrompts
    setContext(prev => ({
        ...prev,
        savedPrompts: prev.savedPrompts.map(p => 
            p.id === 'default' ? { ...p, content: currentDefault } : p
        )
    }));

    // If current instruction is the old default, update it
    if (context.systemInstruction.trim() === prevDefault.trim()) {
        setContext(prev => ({
            ...prev,
            systemInstruction: currentDefault
        }));
    }
  }, [uiLang]);

  // ----------------------------------------------------------------------
  // AI QUEUE PROCESSOR (SEQUENTIAL)
  // ----------------------------------------------------------------------
  const processAIQueue = async () => {
    // 1. Check if busy or empty
    if (isAIProcessingRef.current || aiQueueRef.current.length === 0) return;

    // 2. Lock
    isAIProcessingRef.current = true;
    const currentContext = contextRef.current;

    // NOTE: We allow SIMPLE mode here to process Input Translations

    // Create AbortController for this request
    llmAbortControllerRef.current = new AbortController();
    const signal = llmAbortControllerRef.current.signal;

    // 3. Dequeue BEFORE try block so variables are available in catch
    const queueItem = aiQueueRef.current.shift();
    if (!queueItem) {
        isAIProcessingRef.current = false;
        return;
    }

    const { id: messageIdToProcess, text: messageText, responseId, targetMessageId, pendingBlockId } = queueItem;
    const wordCount = messageText.split(/\s+/).length;

    console.log(`🤖 [${Math.round(performance.now())}ms] LLM START: ${wordCount} words | responseId: ${responseId} | targetId: ${targetMessageId} | block: ${pendingBlockId} | provider: ${currentContext.llmProvider}`);

    try {

        // 5. Generate
        const startTime = performance.now();
        let finalTranslation = '';
        let rawLLMResponse = ''; // Track raw response for fallback

        // DEBOUNCED UI UPDATE: Flush buffered streaming data to UI
        const flushStreamingUpdate = () => {
            const data = streamingPartialRef.current;
            if (!data || !data.partial) return;

            const { partial, responseId: respId, targetMessageId: targetId, startTime: sTime } = data;
            const currentTime = performance.now();

            console.log(`🔄 [${Math.round(currentTime)}ms] flushStreamingUpdate | respId: ${respId} | answer: ${!!partial.answer} | translation: ${!!partial.inputTranslation}`);

            setMessages(prev => prev.map(msg => {
                // Update Assistant Message (Right/Middle Columns)
                if (msg.id === respId) {
                    console.log(`✅ [${Math.round(performance.now())}ms] UPDATING ASSISTANT msg.id=${msg.id} with answer: "${(partial.answer || '').substring(0, 50)}..."`);
                    return {
                        ...msg,
                        text: partial.answer,
                        analysis: partial.analysis,
                        strategy: partial.strategy,
                        answerTranslation: partial.answerTranslation,
                        rationale: partial.rationale,
                        latency: Math.round(currentTime - sTime)
                    };
                }

                // LLM TRANSLATION: Update the TARGET message
                if (msg.id === targetId && partial.inputTranslation && partial.inputTranslation.trim().length > 0) {
                    return {
                        ...msg,
                        aiTranslation: partial.inputTranslation,
                        isAiTranslated: true
                    };
                }

                return msg;
            }));
        };

        await generateInterviewAssist(
            messageText,
            [], // Send empty array to process ONLY current block (Atomic Architecture)
            currentContext,
            (partial) => {
                // Check if aborted before updating
                if (signal.aborted) return;

                // Track ALL output for fallback (in case [INPUT_TRANSLATION] tag is missing)
                if (partial.answer) {
                    rawLLMResponse = partial.answer;
                }

                // Track final translation for pending block
                if (partial.inputTranslation) {
                    finalTranslation = partial.inputTranslation;
                }

                // DEBOUNCE: Store latest partial data, don't update UI immediately
                streamingPartialRef.current = {
                    responseId,
                    targetMessageId,
                    partial,
                    startTime
                };

                // Schedule debounced UI update if not already scheduled
                if (!streamingUpdateTimerRef.current) {
                    streamingUpdateTimerRef.current = setTimeout(() => {
                        flushStreamingUpdate();
                        streamingUpdateTimerRef.current = null;
                    }, STREAMING_DEBOUNCE_MS);
                }
            },
            signal // Pass abort signal to LLM service
        );

        // Final flush after stream ends (ensure last chunk is displayed)
        if (streamingUpdateTimerRef.current) {
            clearTimeout(streamingUpdateTimerRef.current);
            streamingUpdateTimerRef.current = null;
        }
        flushStreamingUpdate();
        streamingPartialRef.current = null;

        const endTime = performance.now();
        console.log(`🤖 [${Math.round(endTime)}ms] LLM END: ${Math.round(endTime - startTime)}ms total | finalTranslation=${!!finalTranslation} | rawResponse=${!!rawLLMResponse}`);

        // FALLBACK: If no [INPUT_TRANSLATION] tag, use raw response
        if (!finalTranslation && rawLLMResponse) {
            console.log(`⚠️ [${Math.round(performance.now())}ms] No [INPUT_TRANSLATION] tag found, using raw response as fallback`);
            finalTranslation = rawLLMResponse;
        }

        // Move pending block to completed with translation
        // ALWAYS move block to completed (even if translation is empty - shows error state)
        // Preserve chromePreview from pending block for dual display in Column 3
        if (pendingBlockId) {
            setPendingBlocks(prev => {
                const pendingBlock = prev.find(b => b.id === pendingBlockId);
                const chromePreview = pendingBlock?.chromePreview || '';

                // Move to completed with both Chrome preview and LLM translation
                setCompletedBlocks(completed => [...completed, {
                    id: pendingBlockId,
                    text: messageText,
                    wordCount,
                    status: 'completed' as const,
                    chromePreview, // Instant Chrome translation
                    translation: finalTranslation || '[Помилка перекладу]', // LLM artistic translation
                    timestamp: Date.now()
                }]);

                return prev.filter(b => b.id !== pendingBlockId);
            });
            console.log(`✅ [${Math.round(performance.now())}ms] Block ${pendingBlockId} completed and moved to Column 3`);
        }

    } catch (e: any) {
        // Clean up streaming timer on error/abort
        if (streamingUpdateTimerRef.current) {
            clearTimeout(streamingUpdateTimerRef.current);
            streamingUpdateTimerRef.current = null;
        }
        streamingPartialRef.current = null;

        if (e.name === 'AbortError') {
            console.log(`🛑 [${Math.round(performance.now())}ms] LLM ABORTED`);
            // Move aborted block to completed - preserve Chrome preview
            if (pendingBlockId) {
                setPendingBlocks(prev => {
                    const pendingBlock = prev.find(b => b.id === pendingBlockId);
                    const chromePreview = pendingBlock?.chromePreview || '';

                    setCompletedBlocks(completed => [...completed, {
                        id: pendingBlockId,
                        text: messageText,
                        wordCount,
                        status: 'completed' as const,
                        chromePreview, // Still show Chrome preview even if LLM aborted
                        translation: '[Скасовано]',
                        timestamp: Date.now()
                    }]);

                    return prev.filter(b => b.id !== pendingBlockId);
                });
            }
        } else {
            console.error("Queue Processing Error", e);
            // Move error block to completed - preserve Chrome preview
            if (pendingBlockId) {
                setPendingBlocks(prev => {
                    const pendingBlock = prev.find(b => b.id === pendingBlockId);
                    const chromePreview = pendingBlock?.chromePreview || '';

                    setCompletedBlocks(completed => [...completed, {
                        id: pendingBlockId,
                        text: messageText,
                        wordCount,
                        status: 'completed' as const,
                        chromePreview, // Still show Chrome preview even on error
                        translation: `[Помилка: ${e.message || 'Unknown'}]`,
                        timestamp: Date.now()
                    }]);

                    return prev.filter(b => b.id !== pendingBlockId);
                });
            }
        }
    } finally {
        // 6. Unlock and Process Next
        llmAbortControllerRef.current = null;
        isAIProcessingRef.current = false;
        // ALWAYS process next items in queue (even if stopped - to complete pending blocks)
        if (aiQueueRef.current.length > 0) {
            console.log(`🔄 [${Math.round(performance.now())}ms] Processing next item in queue (${aiQueueRef.current.length} remaining)`);
            processAIQueue();
        }
    }
  };

  // ----------------------------------------------------------------------
  // LLM ACCUMULATOR FUNCTIONS
  // ----------------------------------------------------------------------
  // SEND accumulated text to LLM
  // Called ONLY when: 1) MAX_WORDS (25) reached, or 2) STOP button pressed
  const sendLLMAccumulator = useCallback((force = false, isStopButton = false) => {
    const acc = llmAccumulatorRef.current;

    console.log(`🔍 [${Math.round(performance.now())}ms] sendLLMAccumulator | isStopButton=${isStopButton} | wordCount=${acc.wordCount}`);

    // Don't send if empty
    if (!acc.text.trim() || !acc.questionId || !acc.responseId || !acc.targetMessageId) {
      console.log(`⏭️ [${Math.round(performance.now())}ms] SKIP: Empty accumulator or missing IDs`);
      return;
    }

    // STRICT THRESHOLD: Only send if:
    // 1. User pressed STOP (isStopButton=true) - send whatever we have
    // 2. OR reached MAX_WORDS (25+) - guaranteed to have >= 20 words
    const reachedMaxWords = acc.wordCount >= LLM_CONFIG.MAX_WORDS_FOR_LLM;

    if (!isStopButton && !reachedMaxWords) {
      console.log(`⏭️ [${Math.round(performance.now())}ms] SKIP: Need ${LLM_CONFIG.MAX_WORDS_FOR_LLM}+ words (have ${acc.wordCount}) or STOP button`);
      return;
    }

    console.log(`🚀 [${Math.round(performance.now())}ms] SENDING TO LLM: ${acc.wordCount} words | Target: ${acc.targetMessageId}`);

    // Create a pending block for visual display (ONLY when actually sending)
    // Include Chrome preview translation for instant display in Column 2/3
    const blockId = `block_${Date.now()}`;
    const newBlock: PendingLLMBlock = {
      id: blockId,
      text: acc.text,
      wordCount: acc.wordCount,
      status: 'processing',
      chromePreview: currentCollectingTranslation, // Save Chrome translation for display
      timestamp: Date.now()
    };

    // Add to pending blocks (visual queue)
    setPendingBlocks(prev => [...prev, newBlock]);

    // Clear the collecting text display (both original and translation)
    setCurrentCollectingText('');
    setCurrentCollectingTranslation('');

    // Add to AI queue with target message ID AND block ID
    aiQueueRef.current.push({
      id: acc.questionId,
      text: acc.text,
      responseId: acc.responseId,
      targetMessageId: acc.targetMessageId,
      pendingBlockId: blockId
    });
    processAIQueue();

    // Reset accumulator
    llmAccumulatorRef.current = { text: '', wordCount: 0, questionId: null, responseId: null, targetMessageId: null };
    console.log(`🧹 [${Math.round(performance.now())}ms] Accumulator reset`);
  }, []);

  const addToLLMAccumulator = useCallback((text: string, questionId: string, responseId: string, targetMessageId: string) => {
    const acc = llmAccumulatorRef.current;
    const now = Date.now();
    const pauseDuration = now - llmLastActivityRef.current;
    llmLastActivityRef.current = now;

    const newWordCount = text.split(/\s+/).length;
    console.log(`📥 [${Math.round(performance.now())}ms] addToLLMAccumulator | Adding ${newWordCount} words | Current total: ${acc.wordCount}`);

    // STRICT ACCUMULATION: NO automatic triggers (pauses, punctuation)
    // Only send when MAX_WORDS (25) is reached or STOP button pressed
    // This keeps center column blocks at exactly 20-25 words

    // Add to accumulator - use new targetMessageId if accumulator was empty
    const newText = acc.text ? `${acc.text} ${text}` : text;
    const totalWordCount = newText.split(/\s+/).length;
    llmAccumulatorRef.current = {
      text: newText,
      wordCount: totalWordCount,
      questionId,
      responseId,
      targetMessageId: acc.targetMessageId || targetMessageId // Keep first target if accumulating
    };

    // Update visual collecting text for center column (ORIGINAL)
    setCurrentCollectingText(newText);

    // ⚡ LIVE CHROME TRANSLATION: Translate accumulated text instantly
    // This provides real-time preview in Column 2 while waiting for LLM
    localTranslator.translatePhrase(newText).then(words => {
      const chromeTranslation = words.map(w => w.ghostTranslation).join(' ');
      setCurrentCollectingTranslation(chromeTranslation);
      console.log(`⚡ [${Math.round(performance.now())}ms] LIVE Chrome translation: "${chromeTranslation.substring(0, 50)}..."`);
    }).catch(err => {
      console.warn(`Chrome translation error:`, err);
    });

    console.log(`📊 [${Math.round(performance.now())}ms] ACCUMULATOR STATE: ${totalWordCount} words | Target: ${llmAccumulatorRef.current.targetMessageId} | Text: "${newText.substring(0, 50)}..."`);

    // ONLY SEND when MAX_WORDS (25 words) is reached
    // NO pause timers, NO sentence detection - STRICT 20-25 word blocks
    if (totalWordCount >= LLM_CONFIG.MAX_WORDS_FOR_LLM) {
      console.log(`🚀 [${Math.round(performance.now())}ms] MAX WORDS REACHED (${totalWordCount} >= ${LLM_CONFIG.MAX_WORDS_FOR_LLM}) - Sending to LLM`);
      sendLLMAccumulator(true); // force=true, hasEnoughWords will be true (25 >= 20)
    }
    // NOTE: If less than 25 words, we just keep accumulating
    // The only other way to send is via STOP button (isStopButton=true)

  }, [sendLLMAccumulator]);

  // ----------------------------------------------------------------------
  // BLOCK FINALIZATION & PARALLEL STREAMS
  // ----------------------------------------------------------------------
  const finalizeBlock = (text: string) => {
    if (!text.trim()) return;

    const finalizeStart = performance.now();
    const wordCount = text.split(/\s+/).length;
    console.log(`📦 [${Math.round(finalizeStart)}ms] FINALIZE START: ${wordCount} words`);

    // Buffer Update Logic (Kept for reference, but ignored by AI service now)
    const currentBuffer = [...historyBufferRef.current, text];
    if (currentBuffer.length > 3) currentBuffer.shift();
    historyBufferRef.current = currentBuffer;

    // USE SESSION-LEVEL IDs (same ID for entire recording session)
    const questionId = sessionQuestionIdRef.current || Date.now().toString();
    const responseId = sessionResponseIdRef.current || (Date.now() + 1).toString();
    const currentContext = contextRef.current;

    console.log(`📌 [${Math.round(finalizeStart)}ms] Using sessionId=${questionId}`);

    // Set Processing State (Visual only)
    setAppState(AppState.PROCESSING);

    // 1. CREATE NEW MESSAGE for Ghost block (each block is separate row)
    const blockId = `${questionId}_${Date.now()}`;  // Unique ID for each Ghost block

    // Track FIRST message of session for LLM updates
    if (!firstSessionMessageIdRef.current) {
      firstSessionMessageIdRef.current = blockId;
      console.log(`✨ [${Math.round(finalizeStart)}ms] Creating FIRST Ghost block (LLM target): ${blockId}`);
    } else {
      console.log(`✨ [${Math.round(finalizeStart)}ms] Creating Ghost block: ${blockId}`);
    }

    const initialMessages: Message[] = [
      {
        id: blockId,
        role: 'interviewer',
        text: text,
        translatedText: "...",
        ghostTranslation: "...",
        aiTranslation: "...",  // LLM translation will accumulate in FIRST message only
        isAiTranslated: false,
        timestamp: Date.now()
      }
    ];

    // Create Assistant Placeholder (Unless SIMPLE mode)
    // Track FIRST assistant message ID for LLM updates
    let assistantMsgId: string | null = null;
    if (currentContext.viewMode !== 'SIMPLE') {
      assistantMsgId = `${responseId}_${Date.now()}`;

      // Track FIRST assistant message of session
      if (!firstSessionAssistantIdRef.current) {
        firstSessionAssistantIdRef.current = assistantMsgId;
        console.log(`🎯 [${Math.round(finalizeStart)}ms] Creating FIRST Assistant message: ${assistantMsgId}`);
      }

      initialMessages.push({
        id: assistantMsgId,
        role: 'assistant',
        text: '',
        analysis: '',
        strategy: '',
        answerTranslation: '',
        rationale: '',
        timestamp: Date.now(),
        latency: 0
      });
    }

    setMessages(prev => [...prev, ...initialMessages]);

    // ============================================================
    // PARALLEL STREAM ARCHITECTURE
    // ============================================================

    // STREAM 1: GHOST TRANSLATION (Immediate, Local Model)
    // Runs independently of AI Queue
    // OPTIMIZED: Use chunked translation for O(n) instead of O(n²)
    const ghostStart = performance.now();
    console.log(`👻 [${Math.round(ghostStart)}ms] GHOST FINALIZE START: ${wordCount} words`);

    const ghostPromise = new Promise<void>((resolve) => {
        if (currentContext.targetLanguage !== currentContext.nativeLanguage) {
            // PROGRESSIVE TRANSLATION: Update UI after each chunk
            localTranslator.translatePhraseChunked(
                text,
                false,
                (partialTranslation) => {
                    // Update UI progressively as each chunk completes
                    setMessages(prev => prev.map(msg =>
                        msg.id === blockId ? { ...msg, ghostTranslation: partialTranslation } : msg
                    ));
                }
            )
                .then(words => {
                    const ghostText = words.map(w => w.ghostTranslation).join(' ');
                    const ghostEnd = performance.now();
                    console.log(`👻 [${Math.round(ghostEnd)}ms] GHOST FINALIZE END: ${Math.round(ghostEnd - ghostStart)}ms`);
                    // Final update (in case callback missed it)
                    setMessages(prev => prev.map(msg =>
                        msg.id === blockId ? { ...msg, ghostTranslation: ghostText } : msg
                    ));
                    resolve();
                })
                .catch(err => {
                    console.error("Stream 1 Error:", err);
                    resolve();
                });
        } else {
             setMessages(prev => prev.map(msg =>
                msg.id === blockId ? { ...msg, ghostTranslation: text, translatedText: text } : msg
            ));
            resolve();
        }
    });

    // STREAM 2: LLM ACCUMULATOR (collect larger blocks for better context)
    // Run AI analysis even in SIMPLE mode to get [INPUT_TRANSLATION]
    // Instead of sending immediately, accumulate text for better LLM context
    // Pass blockId as targetMessageId - this message will receive the LLM translation
    // Pass firstSessionAssistantIdRef as responseId - this assistant message will receive [ANSWER]
    const assistantIdForLLM = firstSessionAssistantIdRef.current || assistantMsgId || responseId;
    addToLLMAccumulator(text, questionId, assistantIdForLLM, blockId);

    // Reset visual state when Ghost is done (AI might still be chugging in background)
    ghostPromise.finally(() => {
         if (shouldBeListening.current && !isUserSpeakingRef.current) {
            setAppState(AppState.LISTENING);
        } else {
            setAppState(AppState.IDLE);
        }
    });
  };

  const handleCandidateMessage = async (text: string) => {
      const msgId = Date.now().toString();
      setMessages(prev => [...prev, {
          id: msgId,
          role: 'candidate',
          text: text,
          candidateTranslation: "...", // Placeholder
          timestamp: Date.now()
      }]);

      if (contextRef.current.targetLanguage !== contextRef.current.nativeLanguage) {
          localTranslator.translatePhrase(text).then(words => {
              const translated = words.map(w => w.ghostTranslation).join(' ');
              setMessages(prev => prev.map(m => m.id === msgId ? { ...m, candidateTranslation: translated } : m));
          });
      }
  };

  // Helper to commit NEW words only (delta from last commit)
  // DELTA TRACKING: Web Speech API gives full text, we extract only new words
  const commitNewWords = useCallback((newWordsText: string, totalWordsSoFar: number) => {
      if (!newWordsText.trim()) return;
      if (isCommittingRef.current) return;
      // CRITICAL: Don't commit if session has ended (user pressed STOP)
      if (!shouldBeListening.current) return;

      isCommittingRef.current = true;

      // Update committed word count to current position
      committedWordCountRef.current = totalWordsSoFar;

      const wordCount = newWordsText.split(/\s+/).length;
      console.log(`📦 Committing Block: "${newWordsText.substring(0, 40)}..." (${wordCount} new words, total: ${totalWordsSoFar})`);

      // Reset UI state
      setTranscript("");
      setInterimTranscript("");
      setLiveTranslation("");
      if (translationTimeoutRef.current) clearTimeout(translationTimeoutRef.current);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

      // Determine speaker
      let speaker = 'interviewer';
      if (isUserSpeakingRef.current) {
          speaker = 'candidate';
      } else if (contextRef.current.stereoMode) {
          speaker = determineSpeaker();
      }

      // Process the new words
      if (speaker === 'candidate') {
          handleCandidateMessage(newWordsText);
      } else {
          finalizeBlock(newWordsText);
      }

      // Short unlock delay
      setTimeout(() => {
          isCommittingRef.current = false;
      }, 100);
  }, []);

  // Condition Checker
  const shouldSplitBlock = (text: string): boolean => {
      const trimmed = text.trim();
      if (!trimmed) return false;
      
      const words = trimmed.split(/\s+/);
      const wordCount = words.length;

      // 1. Max Words
      if (wordCount >= BLOCK_CONFIG.MAX_WORDS_PER_BLOCK) return true;

      // 2. Sentence End
      if (wordCount >= BLOCK_CONFIG.MIN_WORDS_FOR_SENTENCE && BLOCK_CONFIG.SENTENCE_END_REGEX.test(trimmed)) {
          return true;
      }
      
      return false;
  };

  // Initialize Speech Recognition
  useEffect(() => {
    const WindowWithSpeech = window as unknown as IWindow;
    const SpeechRecognition = WindowWithSpeech.SpeechRecognition || WindowWithSpeech.webkitSpeechRecognition;

    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true; // CRITICAL for speed
      
      recognition.lang = LANG_MAP[context.targetLanguage] || 'en-US';

      recognition.onresult = (event: any) => {
        // CRITICAL: Ignore trailing events after session ended
        // Web Speech API's stop() is async - it may fire events after shouldBeListening is false
        if (!shouldBeListening.current) return;

        // DELTA TRACKING: Web Speech API gives FULL accumulated text
        // We extract only NEW words by tracking committedWordCountRef
        const eventTime = performance.now();

        // Build FULL text from all results (final + interim)
        let fullFinalText = '';
        let currentInterim = '';

        for (let i = 0; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            fullFinalText += event.results[i][0].transcript + ' ';
          } else {
            currentInterim += event.results[i][0].transcript;
          }
        }

        // Combine final + interim for complete current state
        const fullText = (fullFinalText + currentInterim).trim();
        const allWords = fullText.split(/\s+/).filter(w => w.length > 0);
        const totalWordCount = allWords.length;

        // Extract only NEW words (after what we've already committed)
        const newWords = allWords.slice(committedWordCountRef.current);
        const newWordCount = newWords.length;
        const newText = newWords.join(' ');

        // Skip if no new words
        if (newWordCount === 0) return;

        // Store for reference
        lastFullTextRef.current = fullText;

        // ========== STREAMING MODE (NEW ARCHITECTURE) ==========
        // In all modes with streaming UI enabled, use continuous accumulation instead of blocks
        const isStreamingMode = useStreamingUIRef.current;

        if (isStreamingMode) {
            // STREAMING: Add words continuously to accumulator
            // No block splitting - just accumulate
            if (fullFinalText.trim()) {
                // Only add finalized words (not interim) to avoid duplicates
                const finalWords = fullFinalText.trim().split(/\s+/);
                const newFinalWords = finalWords.slice(committedWordCountRef.current);
                if (newFinalWords.length > 0) {
                    streamingModeRef.current?.addWords(newFinalWords.join(' '));
                    committedWordCountRef.current = finalWords.length;
                    console.log(`🌊 [${Math.round(performance.now())}ms] STREAMING: Added ${newFinalWords.length} words`);
                }
            }

            // REAL-TIME INTERIM: Update interim text for smooth subtitle-like display
            // This shows words IMMEDIATELY as they're spoken (before finalization)
            streamingModeRef.current?.setInterimText(currentInterim);

            // Update legacy interim display (for compatibility)
            setInterimTranscript(currentInterim);
            return; // Skip block-based logic
        }

        // ========== LEGACY BLOCK MODE ==========
        // --- BLOCK SPLITTING LOGIC (Delta Tracking) ---
        const hasFinalContent = fullFinalText.trim().length > 0;

        // Check if we should commit
        if (hasFinalContent && shouldSplitBlock(newText)) {
            console.log(`⚡ [${Math.round(performance.now())}ms] SPLIT: Condition Met (${newWordCount} new words)`);
            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
            commitNewWords(newText, totalWordCount);
        } else if (newWordCount >= BLOCK_CONFIG.MAX_WORDS_OVERFLOW) {
            // Overflow: too many new words accumulated
            console.log(`⚡ [${Math.round(performance.now())}ms] SPLIT: Overflow (${newWordCount} new words)`);
            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
            commitNewWords(newText, totalWordCount);
        } else {
            // Reset silence timer
            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = setTimeout(() => {
                // On silence, commit whatever new words we have
                const currentNewWords = lastFullTextRef.current.split(/\s+/).slice(committedWordCountRef.current);
                if (currentNewWords.length > 0) {
                    console.log(`⚡ [${Math.round(performance.now())}ms] SPLIT: Silence (${currentNewWords.length} new words)`);
                    commitNewWords(currentNewWords.join(' '), lastFullTextRef.current.split(/\s+/).length);
                }
            }, BLOCK_CONFIG.SILENCE_TIMEOUT_MS);
        }

        // Update visuals with NEW words only
        setInterimTranscript(newText);

        // STREAM 1: GHOST TRANSLATION (LOCAL MODEL) - Interim Drafts
        if (newText.length >= 1) {
             if (translationTimeoutRef.current) clearTimeout(translationTimeoutRef.current);

             const currentRequestId = ++translationRequestId.current;

             // OPTIMIZED: Use chunked translation with caching for interim results
             translationTimeoutRef.current = setTimeout(async () => {
                 if (contextRef.current.targetLanguage === contextRef.current.nativeLanguage) return;

                 // Use chunked translation for interim (fast, cached)
                 const words = await localTranslator.translatePhraseChunked(newText);
                 const ghostText = words.map(w => w.ghostTranslation).join(' ');

                 if (currentRequestId === translationRequestId.current) {
                     setLiveTranslation(ghostText);
                 }
             }, 100);
        } else {
             setLiveTranslation("");
        }
      };

      recognition.onerror = (event: any) => {
        if (event.error === 'no-speech') return;
        console.warn("Speech recognition error:", event.error);
        if (shouldBeListening.current && event.error !== 'aborted') {
            setTimeout(() => { try { recognition.start(); } catch(e) {} }, 100);
        }
      };

      recognition.onend = () => {
        if (shouldBeListening.current) {
            try { recognition.start(); } catch (e) {
                setTimeout(() => { if (shouldBeListening.current) try { recognition.start(); } catch(e) {} }, 200);
            }
        } else {
            setAppState(AppState.IDLE);
        }
      };

      recognitionRef.current = recognition;
    }
  }, [commitNewWords]); 

  // Setup Audio Analysis for Stereo Split AND Visualizer
  const setupAudioAnalysis = async () => {
      try {
          if (audioContextRef.current) audioContextRef.current.close();
          if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());

          const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false, channelCount: 2 } 
          });
          streamRef.current = stream;

          const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
          audioContextRef.current = audioCtx;
          const source = audioCtx.createMediaStreamSource(stream);
          const splitter = audioCtx.createChannelSplitter(2);
          
          source.connect(splitter);
          
          const analyserLeft = audioCtx.createAnalyser();
          const analyserRight = audioCtx.createAnalyser();
          analyserLeft.fftSize = 256;
          analyserRight.fftSize = 256;

          splitter.connect(analyserLeft, 0); // Channel 0 -> Left (User)
          splitter.connect(analyserRight, 1); // Channel 1 -> Right (Interviewer)

          const dataLeft = new Uint8Array(analyserLeft.frequencyBinCount);
          const dataRight = new Uint8Array(analyserRight.frequencyBinCount);

          const analyzeLoop = () => {
              if (!audioContextRef.current) return;
              analyserLeft.getByteFrequencyData(dataLeft);
              analyserRight.getByteFrequencyData(dataRight);

              const volLeft = dataLeft.reduce((a,b) => a+b, 0);
              const volRight = dataRight.reduce((a,b) => a+b, 0);

              const avgVol = (volLeft + volRight) / (dataLeft.length + dataRight.length);
              setInputLevel(Math.min(100, avgVol * 2));

              audioHistoryRef.current.push({ left: volLeft, right: volRight });
              if (audioHistoryRef.current.length > 360) audioHistoryRef.current.shift();

              requestAnimationFrame(analyzeLoop);
          };
          analyzeLoop();

      } catch (e) {
          console.error("Failed to setup stereo analysis", e);
      }
  };

  // Manage Audio Analysis Lifecycle
  useEffect(() => {
      const isListening = appState === AppState.LISTENING || appState === AppState.PROCESSING;
      const needsAudio = (context.stereoMode || isUserSpeaking) && isListening;

      if (needsAudio) {
          if (!audioContextRef.current) setupAudioAnalysis();
      } else {
           if (audioContextRef.current && !context.stereoMode && !isUserSpeaking) {
              audioContextRef.current.close();
              audioContextRef.current = null;
              if (streamRef.current) {
                  streamRef.current.getTracks().forEach(t => t.stop());
                  streamRef.current = null;
              }
              setInputLevel(0);
          }
      }
  }, [context.stereoMode, isUserSpeaking, appState]);

  const determineSpeaker = (): 'candidate' | 'interviewer' => {
      if (!contextRef.current.stereoMode) return 'interviewer';
      const history = audioHistoryRef.current;
      if (history.length < 30) return 'interviewer';

      const STT_DELAY_MS = 1000;
      const FPS = 60;
      const STT_DELAY_FRAMES = Math.floor((STT_DELAY_MS / 1000) * FPS); 
      const WINDOW_SIZE = 120;
      
      const endIndex = Math.max(0, history.length - STT_DELAY_FRAMES);
      const startIndex = Math.max(0, endIndex - WINDOW_SIZE);
      
      let leftPeaks = 0;
      let rightPeaks = 0;
      let leftEnergy = 0;
      let rightEnergy = 0;
      
      const SILENCE_THRESHOLD = 500;
      const USER_MIC_BOOST = 1.5;

      for (let i = startIndex; i < endIndex; i++) {
          const { left, right } = history[i];
          leftEnergy += left;
          rightEnergy += right;
          if (left > SILENCE_THRESHOLD) leftPeaks++;
          if (right > SILENCE_THRESHOLD) rightPeaks++;
      }

      if (leftPeaks > 20 && rightPeaks < 10) return 'candidate';
      if (rightPeaks > 20 && leftPeaks < 10) return 'interviewer';
      
      return (leftEnergy * USER_MIC_BOOST) > rightEnergy ? 'candidate' : 'interviewer';
  };

  // Dynamic Language Update
  useEffect(() => {
    if (recognitionRef.current) {
        const newLang = LANG_MAP[context.targetLanguage] || 'en-US';
        if (recognitionRef.current.lang !== newLang) {
             recognitionRef.current.lang = newLang;
             if (shouldBeListening.current) {
                 recognitionRef.current.stop();
             }
        }
    }
  }, [context.targetLanguage]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, interimTranscript]);

  const startListening = () => {
      if (!recognitionRef.current) return;

      // CREATE SESSION-LEVEL IDs (one per recording session)
      sessionQuestionIdRef.current = Date.now().toString();
      sessionResponseIdRef.current = (Date.now() + 1).toString();
      llmLastActivityRef.current = Date.now();

      console.log(`🎙️ [${Math.round(performance.now())}ms] SESSION START: questionId=${sessionQuestionIdRef.current}`);

      // STREAMING MODE: Start session (all modes when streaming UI enabled)
      if (useStreamingUI) {
          streamingMode.startSession();
          console.log(`🌊 [${Math.round(performance.now())}ms] STREAMING MODE: Session started (${context.viewMode})`);
      }

      try {
          recognitionRef.current.start();
          shouldBeListening.current = true;
          setAppState(AppState.LISTENING);
      } catch(e: any) {
          if (e.name === 'InvalidStateError') {
              shouldBeListening.current = true;
              setAppState(AppState.LISTENING);
          }
      }
  };

  const stopListening = () => {
      console.log(`🛑 [${Math.round(performance.now())}ms] SESSION END: questionId=${sessionQuestionIdRef.current}`);

      shouldBeListening.current = false;
      try { recognitionRef.current?.stop(); } catch (e) {}
      setAppState(AppState.IDLE);
      setInterimTranscript("");
      setLiveTranslation("");
      // Reset delta tracking refs
      committedWordCountRef.current = 0;
      lastFullTextRef.current = "";
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

      // STREAMING MODE: Stop session and finalize translation (all modes)
      if (useStreamingUI) {
          streamingMode.stopSession();
          console.log(`🌊 [${Math.round(performance.now())}ms] STREAMING MODE: Session stopped (${context.viewMode})`);
      }

      // ABORT all pending LLM requests immediately
      if (llmAbortControllerRef.current) {
          console.log(`🛑 [${Math.round(performance.now())}ms] ABORTING LLM request`);
          llmAbortControllerRef.current.abort();
          llmAbortControllerRef.current = null;
      }

      // Clean up streaming debounce timer
      if (streamingUpdateTimerRef.current) {
          clearTimeout(streamingUpdateTimerRef.current);
          streamingUpdateTimerRef.current = null;
      }
      streamingPartialRef.current = null;

      // CLEAR LLM queue - don't send any more requests
      const queueLength = aiQueueRef.current.length;
      if (queueLength > 0) {
          console.log(`🛑 [${Math.round(performance.now())}ms] CLEARING LLM queue (${queueLength} items)`);
          aiQueueRef.current = [];
      }

      // SEND accumulated text to LLM when STOP is pressed (even if < 15 words)
      // User pressed STOP, so send whatever we have collected
      if (llmAccumulatorRef.current.text.trim()) {
          console.log(`🛑 [${Math.round(performance.now())}ms] SENDING LLM accumulator on STOP (${llmAccumulatorRef.current.wordCount} words)`);
          sendLLMAccumulator(true, true); // force=true, isStopButton=true - sends regardless of word count
      }
      if (llmSilenceTimerRef.current) {
          clearTimeout(llmSilenceTimerRef.current);
          llmSilenceTimerRef.current = null;
      }

      // Clear visual collecting text (both original and translation)
      setCurrentCollectingText('');
      setCurrentCollectingTranslation('');

      // Reset processing flag
      isAIProcessingRef.current = false;

      // CLEAR SESSION IDs and refs
      sessionQuestionIdRef.current = null;
      sessionResponseIdRef.current = null;
      firstSessionMessageIdRef.current = null;  // Clear first interviewer message ref
      firstSessionAssistantIdRef.current = null;  // Clear first assistant message ref

      if (audioContextRef.current) {
          audioContextRef.current.close();
          audioContextRef.current = null;
      }
      if (streamRef.current) {
          streamRef.current.getTracks().forEach(t => t.stop());
          streamRef.current = null;
      }
  };

  const toggleListening = () => {
    if (appState === AppState.IDLE) startListening(); else stopListening();
  };

  const toggleUserSpeaking = () => {
      if (isUserSpeaking) {
          setIsUserSpeaking(false);
          isUserSpeakingRef.current = false;
      } else {
          setIsUserSpeaking(true);
          isUserSpeakingRef.current = true;
          if (!shouldBeListening.current) startListening();
      }
  };

  useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
          if (e.code === 'Space' && document.activeElement?.tagName !== 'TEXTAREA' && document.activeElement?.tagName !== 'INPUT') {
              e.preventDefault(); 
              toggleUserSpeaking();
          }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isUserSpeaking]);


  const toggleLanguage = () => {
      setUiLang(prev => prev === 'en' ? 'uk' : 'en');
  };

  const handleSaveSession = () => {
      if (messages.length === 0) return;
      let fileContent = `# Ghost Interviewer Session - ${new Date().toLocaleString()}\n\n`;
      messages.forEach(msg => {
          const time = new Date(msg.timestamp).toLocaleTimeString();
          fileContent += `## [${time}] ${msg.role.toUpperCase()}\n`;
          if (msg.role === 'interviewer') {
              const translation = msg.aiTranslation || msg.ghostTranslation || msg.translatedText;
              fileContent += `> ${msg.text}\n> [Translation]: ${translation}\n`;
          } else if (msg.role === 'assistant') {
              if (msg.analysis) fileContent += `**Analysis:**\n${msg.analysis}\n\n`;
              if (msg.strategy) fileContent += `**Strategy:**\n${msg.strategy}\n\n`;
              if (msg.answerTranslation) fileContent += `**Translation:**\n${msg.answerTranslation}\n\n`;
              fileContent += `**Suggested Answer:**\n${msg.text}\n`;
          } else {
              fileContent += `> ${msg.text}\n`;
          }
          fileContent += `\n---\n\n`;
      });
      const blob = new Blob([fileContent], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `interview-session-${new Date().toISOString().slice(0,10)}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
  };

  const handleClearSession = (shouldSave: boolean) => {
      if (shouldSave) handleSaveSession();

      // Clear all messages
      setMessages([]);

      // Clear streaming mode state
      streamingMode.reset();

      // Clear all session refs
      firstSessionMessageIdRef.current = null;
      firstSessionAssistantIdRef.current = null;
      sessionQuestionIdRef.current = null;
      sessionResponseIdRef.current = null;

      // Clear LLM accumulator
      llmAccumulatorRef.current = { text: '', wordCount: 0, questionId: null, responseId: null, targetMessageId: null };
      if (llmSilenceTimerRef.current) {
          clearTimeout(llmSilenceTimerRef.current);
          llmSilenceTimerRef.current = null;
      }

      // Clear AI queue
      aiQueueRef.current = [];

      // Clear translation blocks tracker
      llmTranslationBlocksRef.current = [];

      // Clear delta tracking
      committedWordCountRef.current = 0;
      lastFullTextRef.current = "";

      // Clear visual states
      setTranscript("");
      setInterimTranscript("");
      setLiveTranslation("");

      // Clear pending/completed blocks for center column
      setPendingBlocks([]);
      setCompletedBlocks([]);
      setCurrentCollectingText('');
      setCurrentCollectingTranslation('');

      setIsClearModalOpen(false);
  };

  const confirmClear = () => {
      // Check both legacy messages AND streaming mode content
      const hasContent = messages.length > 0 ||
                        streamingMode.state.originalText.length > 0 ||
                        streamingMode.state.interimText.length > 0;
      if (hasContent) setIsClearModalOpen(true);
  };

  // --- RENDER ---
  const renderMessages = () => {
      const bricks: React.ReactNode[] = [];
      let i = 0;
      while (i < messages.length) {
          const msg = messages[i];
          if (msg.role === 'interviewer') {
              let assistantMsg: Message | undefined = undefined;
              if (i + 1 < messages.length && messages[i+1].role === 'assistant') {
                  assistantMsg = messages[i+1];
                  i++;
              }

              // Check if this is the FIRST session message (where LLM translation accumulates)
              const isFirstSessionMessage = msg.id === firstSessionMessageIdRef.current;

              bricks.push(
                  <BrickRow
                     key={msg.id}
                     interviewerMessage={msg}
                     assistantMessage={assistantMsg}
                     viewMode={context.viewMode}
                     isFirstSessionMessage={isFirstSessionMessage}
                  />
              );
          } else if (msg.role === 'candidate') {
              bricks.push(<CandidateRow key={msg.id} message={msg} />);
          }
          i++;
      }
      return bricks;
  };

  // Start session with selected mode
  const startSessionWithMode = (mode: 'SIMPLE' | 'FOCUS' | 'FULL') => {
    setContext({...context, viewMode: mode});
    setHasSessionStarted(true);
    // Auto-start listening after mode selection
    setTimeout(() => {
      if (recognitionRef.current && isModelReady) {
        startListening();
      }
    }, 100);
  };

  // LANDING PAGE: Show mode selection before session starts
  if (!hasSessionStarted) {
    return (
      <LandingPage
        context={context}
        setContext={setContext}
        isModelReady={isModelReady}
        modelError={modelError}
        modelProgress={modelProgress}
        uiLang={uiLang}
        t={t}
        isSetupOpen={isSetupOpen}
        setIsSetupOpen={setIsSetupOpen}
        startSessionWithMode={startSessionWithMode}
      />
    );
  }

  // WORKING VIEW: Show after mode is selected
  return (
    <div className="relative h-screen w-screen flex flex-col bg-gray-950">
      {!isModelReady && (
        <div className={`absolute top-0 left-0 right-0 z-[100] backdrop-blur-md border-b text-center py-2 transition-all ${modelError ? 'bg-red-900/95 border-red-500' : 'bg-blue-900/80 border-blue-500/30'}`}>
             <div className="flex flex-col items-center justify-center gap-1">
                 <div className="flex items-center gap-3">
                     <span className={`text-[10px] md:text-xs font-bold uppercase tracking-widest ${modelError ? 'text-white' : 'text-blue-200 animate-pulse'}`}>
                         {modelError ? "MODEL FILES MISSING" : (modelProgress > 0 ? `${t.modelDownload} (${modelProgress}%)` : t.modelDownload)}
                     </span>
                     {!modelError && (
                         <div className="w-32 h-1.5 bg-blue-950 rounded-full overflow-hidden border border-blue-500/30">
                            <div className="h-full bg-blue-400 transition-all duration-300 ease-out" style={{ width: `${modelProgress}%` }} />
                        </div>
                     )}
                 </div>
             </div>
        </div>
      )}

      {isClearModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm">
              <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-sm w-full shadow-2xl animate-fade-in-up">
                  <h3 className="text-xl font-bold text-white mb-2">{t.modal.title}</h3>
                  <p className="text-gray-400 mb-6">{t.modal.subtitle}</p>
                  <div className="flex flex-col gap-3">
                      <button onClick={() => handleClearSession(true)} className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-white font-bold transition-colors flex items-center justify-center gap-2">
                          <DownloadIcon className="w-4 h-4" /> {t.modal.saveAndClear}
                      </button>
                      <button onClick={() => handleClearSession(false)} className="w-full py-3 bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded-lg font-medium transition-colors border border-red-900/50">
                          {t.modal.clearOnly}
                      </button>
                      <button onClick={() => setIsClearModalOpen(false)} className="w-full py-2 text-gray-500 hover:text-white transition-colors text-sm mt-2">
                          {t.modal.cancel}
                      </button>
                  </div>
              </div>
          </div>
      )}

      <SetupPanel isOpen={isSetupOpen} toggleOpen={() => setIsSetupOpen(!isSetupOpen)} context={context} onContextChange={handleContextChange} uiLang={uiLang} />

      <div className={`flex justify-between items-center p-4 z-40 bg-gray-900/50 backdrop-blur border-b border-gray-800 ${!isModelReady ? 'mt-10' : ''}`}>
        <div className="flex items-center gap-4">
            {/* Back to Home */}
            <button
              onClick={() => { stopListening(); setHasSessionStarted(false); setMessages([]); }}
              className="p-2 rounded-lg bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition-all border border-gray-700"
              title="Back to mode selection"
            >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
            </button>
            {/* Current Mode Indicator */}
            <div className={`px-3 py-1.5 rounded-lg border text-xs font-black uppercase tracking-widest ${
              context.viewMode === 'SIMPLE' ? 'border-amber-500/50 bg-amber-500/10 text-amber-400' :
              context.viewMode === 'FOCUS' ? 'border-blue-500/50 bg-blue-500/10 text-blue-400' :
              'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
            }`}>
                {context.viewMode}
            </div>
            {/* Animated Gear Menu */}
            <GearMenu
              context={context}
              onContextChange={handleContextChange}
              uiLang={uiLang}
              onOpenFullSettings={() => setIsSetupOpen(true)}
            />
            <button onClick={toggleLanguage} className="px-3 py-1.5 bg-gray-800 text-xs font-black text-emerald-400 rounded-lg border border-gray-700 hover:bg-gray-700 hover:border-emerald-500/50 transition-all shadow-lg shadow-black/20">
                {uiLang === 'en' ? 'UA 🇺🇦' : 'EN 🇺🇸'}
            </button>
            {/* LLM Translation Toggle */}
            <button
              onClick={() => setLlmTranslationEnabled(!llmTranslationEnabled)}
              className={`px-3 py-1.5 text-xs font-black rounded-lg border transition-all shadow-lg shadow-black/20 ${
                llmTranslationEnabled
                  ? 'bg-purple-600 border-purple-500 text-white hover:bg-purple-500'
                  : 'bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700'
              }`}
              title={llmTranslationEnabled ? 'LLM переклад увімкнено (натисни щоб вимкнути)' : 'LLM переклад вимкнено (тільки Ghost/Chrome)'}
            >
              {llmTranslationEnabled ? 'LLM ✓' : 'LLM ✗'}
            </button>
        </div>

        <div className="flex items-center gap-3">
             <div className="flex items-center gap-1 mr-4 bg-gray-900/50 rounded-lg border border-gray-800 p-1">
                 <button onClick={handleSaveSession} className="p-2 hover:bg-gray-800 rounded text-gray-400 hover:text-emerald-400 transition-colors" title={t.saveSession}>
                    <DownloadIcon className="w-5 h-5" />
                 </button>
                 <div className="w-px h-6 bg-gray-800"></div>
                 <button onClick={confirmClear} className="p-2 hover:bg-gray-800 rounded text-gray-400 hover:text-red-400 transition-colors" title={t.clearSession}>
                    <TrashIcon className="w-5 h-5" />
                 </button>
             </div>
             {/* Listening/Pause Indicator */}
             <div className={`flex items-center gap-3 px-4 py-2 rounded-lg border transition-all duration-300 ${isUserSpeaking ? 'border-blue-500/50 bg-blue-500/10' : appState !== AppState.IDLE ? 'border-red-500/50 bg-red-500/10' : 'border-gray-700 bg-gray-800'}`}>
                <div className={`w-2.5 h-2.5 rounded-full shadow-lg ${isUserSpeaking ? 'bg-blue-500 animate-pulse shadow-blue-500/50' : appState !== AppState.IDLE ? 'bg-red-500 animate-pulse shadow-red-500/50' : 'bg-gray-500'}`} />
                <span className="text-xs font-mono font-bold tracking-wider text-gray-200">
                    {isUserSpeaking ? "YOU ARE SPEAKING" : appState === AppState.LISTENING ? (context.stereoMode ? "LISTENING (STEREO)" : t.listening) : appState === AppState.PROCESSING ? t.generating : t.paused}
                </span>
            </div>
            {/* Microphone Button - in header */}
            <button
                onClick={toggleListening}
                disabled={!isModelReady}
                title={!isModelReady ? "Waiting for translation model to load..." : (shouldBeListening.current ? t.paused : t.listening)}
                className={`w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-all transform ${
                    !isModelReady
                        ? 'bg-gray-700 text-gray-500 cursor-not-allowed opacity-50'
                        : shouldBeListening.current
                            ? 'bg-red-500 hover:bg-red-600 text-white shadow-red-900/50 hover:scale-105 ring-2 ring-red-500/30'
                            : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-900/50 hover:scale-105 ring-2 ring-emerald-500/30'
                }`}>
                {shouldBeListening.current ? <StopIcon className="w-6 h-6" /> : <MicIcon className="w-6 h-6" />}
            </button>
        </div>
      </div>

      {isUserSpeaking && (
          <div className="absolute top-24 left-1/2 transform -translate-x-1/2 z-50 flex flex-col items-center gap-2 pointer-events-none">
              <div className="bg-blue-600/90 text-white px-8 py-3 rounded-full shadow-[0_0_20px_rgba(37,99,235,0.5)] animate-bounce font-bold tracking-widest text-sm backdrop-blur-sm border border-blue-400 flex items-center gap-3">
                  <span>{t.candidateSpeaking}</span>
                  <div className="h-4 w-16 bg-blue-900/50 rounded-full overflow-hidden border border-blue-400/30">
                       <div className="h-full bg-white transition-all duration-75" style={{ width: `${inputLevel}%` }} />
                  </div>
              </div>
          </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-8">
         {/* SIMPLE MODE - NEW STREAMING UI */}
         {context.viewMode === 'SIMPLE' && useStreamingUI && (
             <StreamingSimpleModeLayout
                 accumulatedOriginal={streamingMode.state.originalText}
                 accumulatedGhostTranslation={streamingMode.state.ghostTranslation}
                 accumulatedLLMTranslation={streamingMode.state.llmTranslation}
                 interimText={streamingMode.state.interimText}
                 interimGhostTranslation={streamingMode.state.interimGhostTranslation}
                 isListening={streamingMode.state.isListening}
                 isProcessingLLM={streamingMode.state.isProcessingLLM}
                 showOriginal={false}
                 showGhost={false}
                 preferLLM={true}
                 wordCount={streamingMode.state.wordCount}
                 sessionDuration={streamingMode.state.sessionDuration}
             />
         )}

         {/* SIMPLE MODE - LEGACY BLOCK UI */}
         {context.viewMode === 'SIMPLE' && !useStreamingUI && (
             <SimpleModeLayout
                 messages={messages}
                 interimTranscript={interimTranscript}
                 liveTranslation={liveTranslation}
                 isUserSpeaking={isUserSpeaking}
                 currentCollectingText={currentCollectingText}
                 currentCollectingTranslation={currentCollectingTranslation}
                 pendingBlocks={pendingBlocks}
                 completedBlocks={completedBlocks}
                 messagesEndRef={messagesEndRef}
                 renderMessages={renderMessages}
             />
         )}

         {/* FOCUS MODE - NEW STREAMING UI */}
         {context.viewMode === 'FOCUS' && useStreamingUI && (
             <StreamingFocusModeLayout
                 accumulatedOriginal={streamingMode.state.originalText}
                 accumulatedGhostTranslation={streamingMode.state.ghostTranslation}
                 accumulatedLLMTranslation={streamingMode.state.llmTranslation}
                 interimText={streamingMode.state.interimText}
                 interimGhostTranslation={streamingMode.state.interimGhostTranslation}
                 isListening={streamingMode.state.isListening}
                 isProcessingLLM={streamingMode.state.isProcessingLLM}
                 containsQuestion={streamingMode.state.containsQuestion}
                 questionConfidence={streamingMode.state.questionConfidence}
                 speechType={streamingMode.state.speechType}
                 generatedAnswer={streamingMode.state.generatedAnswer}
                 answerTranslation={streamingMode.state.answerTranslation}
                 isGeneratingAnswer={streamingMode.state.isGeneratingAnswer}
                 wordCount={streamingMode.state.wordCount}
                 sessionDuration={streamingMode.state.sessionDuration}
             />
         )}

         {/* FOCUS MODE - LEGACY BLOCK UI */}
         {context.viewMode === 'FOCUS' && !useStreamingUI && (
             <FocusModeLayout
                 messages={messages}
                 interimTranscript={interimTranscript}
                 liveTranslation={liveTranslation}
                 isUserSpeaking={isUserSpeaking}
                 currentCollectingText={currentCollectingText}
                 currentCollectingTranslation={currentCollectingTranslation}
                 pendingBlocks={pendingBlocks}
                 messagesEndRef={messagesEndRef}
             />
         )}

         {/* FULL MODE - NEW STREAMING UI */}
         {context.viewMode === 'FULL' && useStreamingUI && (
             <StreamingFullModeLayout
                 accumulatedOriginal={streamingMode.state.originalText}
                 accumulatedGhostTranslation={streamingMode.state.ghostTranslation}
                 accumulatedLLMTranslation={streamingMode.state.llmTranslation}
                 interimText={streamingMode.state.interimText}
                 interimGhostTranslation={streamingMode.state.interimGhostTranslation}
                 isListening={streamingMode.state.isListening}
                 isProcessingLLM={streamingMode.state.isProcessingLLM}
                 containsQuestion={streamingMode.state.containsQuestion}
                 questionConfidence={streamingMode.state.questionConfidence}
                 speechType={streamingMode.state.speechType}
                 analysis={streamingMode.state.analysis}
                 strategy={streamingMode.state.strategy}
                 isAnalyzing={streamingMode.state.isAnalyzing}
                 generatedAnswer={streamingMode.state.generatedAnswer}
                 answerTranslation={streamingMode.state.answerTranslation}
                 isGeneratingAnswer={streamingMode.state.isGeneratingAnswer}
                 wordCount={streamingMode.state.wordCount}
                 sessionDuration={streamingMode.state.sessionDuration}
             />
         )}

         {/* FULL MODE - LEGACY BLOCK UI */}
         {context.viewMode === 'FULL' && !useStreamingUI && (
             <FullModeLayout
                 messages={messages}
                 interimTranscript={interimTranscript}
                 liveTranslation={liveTranslation}
                 isUserSpeaking={isUserSpeaking}
                 currentCollectingText={currentCollectingText}
                 currentCollectingTranslation={currentCollectingTranslation}
                 pendingBlocks={pendingBlocks}
                 messagesEndRef={messagesEndRef}
             />
         )}
      </div>

      {/* BOTTOM PANEL: Original Norwegian Text */}
      {useStreamingUI && (streamingMode.state.originalText || streamingMode.state.interimText) && (
          <div className="shrink-0 border-t border-gray-800 bg-gray-900/80 backdrop-blur-sm">
              <div className="px-4 md:px-8 py-3">
                  <div className="flex items-start gap-3">
                      <div className="shrink-0 mt-1">
                          <span className="text-[10px] font-black text-red-400 uppercase tracking-widest">
                              {context.targetLanguage === 'Norwegian' ? 'NO' : context.targetLanguage.substring(0, 2).toUpperCase()}
                          </span>
                      </div>
                      <div className="flex-1 text-sm md:text-base text-gray-300 leading-relaxed max-h-24 overflow-y-auto">
                          <span>{streamingMode.state.originalText}</span>
                          {streamingMode.state.interimText && (
                              <span className="text-gray-500 italic ml-1">{streamingMode.state.interimText}</span>
                          )}
                      </div>
                  </div>
              </div>
          </div>
      )}

    </div>
  );
};

export default App;