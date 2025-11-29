

import React, { useState, useEffect, useRef, useCallback } from 'react';
import SetupPanel from './components/SetupPanel';
import BrickRow from './components/BrickRow';
import CandidateRow from './components/CandidateRow';
import { MicIcon, StopIcon, SettingsIcon, SendIcon, EyeIcon, EyeOffIcon, DownloadIcon, TrashIcon } from './components/Icons';
import { InterviewContext, AppState, Message, IWindow, PromptPreset, InterviewProfile, CandidateProfile, JobProfile } from './types';
import { generateInterviewAssist, translateText } from './services/geminiService';
import { localTranslator } from './services/localTranslator';
import { knowledgeSearch } from './services/knowledgeSearch';
import { translations } from './translations';

// --- CONFIGURATION CONSTANTS ---
const BLOCK_CONFIG = {
    SILENCE_TIMEOUT_MS: 1500,       // Split if silence > 1.5s (reduced for faster response)
    MAX_WORDS_PER_BLOCK: 12,        // Split FINAL chunks at 12 words (Ghost translation)
    MAX_WORDS_OVERFLOW: 20,         // Force split interim at 20 words (hard limit)
    MIN_WORDS_FOR_SENTENCE: 5,      // Allow sentence split after just 5 words
    SENTENCE_END_REGEX: /[.!?।。,;:]+$/ // Punctuation detection (added comma, semicolon, colon)
};

// LLM ACCUMULATION CONFIG: Larger blocks for better context
const LLM_CONFIG = {
    MIN_WORDS_FOR_LLM: 30,          // Minimum words before sending to LLM
    MAX_WORDS_FOR_LLM: 50,          // Force send if exceeds this limit
    SILENCE_TIMEOUT_MS: 5000,       // Send accumulated text after 5s of silence (increased from 3s)
    PAUSE_THRESHOLD_MS: 2000,       // 2 seconds pause = complete LLM block
    MIN_WORDS_FOR_SENTENCE: 5,      // Minimum words needed to consider sentence complete
    SENTENCE_MARKERS: /[.!?।。]+$/,  // Sentence-ending punctuation
    FALLBACK_MAX_WORDS: 100         // Absolute max if no sentence end detected
};

const DEFAULT_PROMPTS: PromptPreset[] = [
    { id: 'default', name: 'Standard Bridge', content: translations.en.defaultPrompt }
];

// NEW: Candidate Profiles (Static - Resume + Knowledge Base)
const DEFAULT_CANDIDATE_PROFILES: CandidateProfile[] = [
    {
        id: 'example_candidate',
        name: 'Example Profile',
        resume: "Experienced React Developer. 3 years experience with JavaScript, TypeScript, Tailwind CSS. Created 'Elvarika' - a language learning app using AI. Familiar with Node.js.",
        knowledgeBase: "Project Elvarika uses React 18, Zustand for state management, and OpenAI API. Database is Supabase."
    }
];

// NEW: Job Profiles (Dynamic - Company + Job + Application)
const DEFAULT_JOB_PROFILES: JobProfile[] = [
    {
        id: 'example_job',
        name: 'Example: Java Dev Position',
        companyDescription: "Innovative tech company focusing on Scandinavian markets. Values honesty, clean code, and fast iteration.",
        jobDescription: "We are looking for a Java Developer with Spring Boot experience. Knowledge of microservices and SQL databases (PostgreSQL) is required. Must speak Norwegian.",
        applicationLetter: "" // Søknad - user fills this
    }
];

// LEGACY: Keep for backward compatibility
const DEFAULT_PROFILES: InterviewProfile[] = [
    {
        id: 'example_java',
        name: 'Example: Java Dev',
        resume: "Experienced React Developer. 3 years experience with JavaScript, TypeScript, Tailwind CSS. Created 'Elvarika' - a language learning app using AI. Familiar with Node.js.",
        jobDescription: "We are looking for a Java Developer with Spring Boot experience. Knowledge of microservices and SQL databases (PostgreSQL) is required. Must speak Norwegian.",
        companyDescription: "Innovative tech company focusing on Scandinavian markets. Values honesty, clean code, and fast iteration.",
        knowledgeBase: "Project Elvarika uses React 18, Zustand for state management, and OpenAI API. Database is Supabase."
    }
];

const DEFAULT_CONTEXT: InterviewContext = {
  // === ACTIVE DATA ===
  resume: DEFAULT_CANDIDATE_PROFILES[0].resume,
  knowledgeBase: DEFAULT_CANDIDATE_PROFILES[0].knowledgeBase,
  companyDescription: DEFAULT_JOB_PROFILES[0].companyDescription,
  jobDescription: DEFAULT_JOB_PROFILES[0].jobDescription,
  applicationLetter: DEFAULT_JOB_PROFILES[0].applicationLetter,

  // === LANGUAGE ===
  targetLanguage: "Norwegian",
  nativeLanguage: "Ukrainian",
  proficiencyLevel: "B1",
  tone: "Professional",

  // === AI CONFIG ===
  systemInstruction: translations.en.defaultPrompt,
  savedPrompts: DEFAULT_PROMPTS,
  activePromptId: "",

  // === NEW PROFILE SYSTEM ===
  savedCandidateProfiles: DEFAULT_CANDIDATE_PROFILES,
  savedJobProfiles: DEFAULT_JOB_PROFILES,
  activeCandidateProfileId: "",
  activeJobProfileId: "",

  // === LEGACY (for migration) ===
  savedProfiles: DEFAULT_PROFILES,
  activeProfileId: "",

  // === UI & HARDWARE ===
  stereoMode: false,
  viewMode: 'FULL',
  ghostModel: 'opus',
  llmProvider: 'azure',
  groqApiKey: ""
};

const STORAGE_KEY = 'ghost_interviewer_context_v2';

// Queue Item Interface to avoid State Lookup Race Conditions
interface AIQueueItem {
    id: string;         // The Question ID
    text: string;       // The Question Text
    responseId: string; // The ID of the Assistant Message to update
}

const App: React.FC = () => {
  // State initialization with LocalStorage check
  const [context, setContext] = useState<InterviewContext>(() => {
      try {
          const saved = localStorage.getItem(STORAGE_KEY);
          if (saved) {
              const parsed = JSON.parse(saved);
              // Merge with default to ensure new fields (like groqApiKey) exist if loading old state
              return { ...DEFAULT_CONTEXT, ...parsed };
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
  const [stealthMode, setStealthMode] = useState(false);
  const [uiLang, setUiLang] = useState<'en' | 'uk'>('en');
  const [hasSessionStarted, setHasSessionStarted] = useState(false); // Landing vs Working view
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [inputLevel, setInputLevel] = useState(0); // For candidate visualizer
  const [isClearModalOpen, setIsClearModalOpen] = useState(false);
  
  // Model Download State
  const [modelProgress, setModelProgress] = useState(0);
  const [isModelReady, setIsModelReady] = useState(false);
  const [modelError, setModelError] = useState(false);

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
  }>({ text: '', wordCount: 0, questionId: null, responseId: null });
  const llmSilenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // SESSION-LEVEL IDs: One questionId per recording session (Start to Stop)
  // This ensures all blocks in a session are treated as ONE question for LLM
  const sessionQuestionIdRef = useRef<string | null>(null);
  const sessionResponseIdRef = useRef<string | null>(null);
  const llmLastActivityRef = useRef<number>(Date.now()); // Track pause duration
  const firstSessionMessageIdRef = useRef<string | null>(null); // ID of FIRST message in session (for LLM updates)

  const contextRef = useRef(context);
  
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

    try {
        // 3. Dequeue
        // We now get the FULL object directly, avoiding React State lookup race conditions
        const queueItem = aiQueueRef.current.shift();
        if (!queueItem) return;

        const { id: messageIdToProcess, text: messageText, responseId } = queueItem;
        const wordCount = messageText.split(/\s+/).length;

        console.log(`🤖 [${Math.round(performance.now())}ms] LLM START: ${wordCount} words, provider: ${currentContext.llmProvider}`);

        // 5. Generate
        const startTime = performance.now();

        await generateInterviewAssist(
            messageText,
            [], // Send empty array to process ONLY current block (Atomic Architecture)
            currentContext,
            (partial) => {
                // Check if aborted before updating
                if (signal.aborted) return;

                const currentTime = performance.now();
                setMessages(prev => prev.map(msg => {
                    // Update Assistant Message (Right/Middle Columns)
                    if (msg.id === responseId) {
                        return {
                            ...msg,
                            text: partial.answer,
                            analysis: partial.analysis,
                            strategy: partial.strategy,
                            answerTranslation: partial.answerTranslation,
                            rationale: partial.rationale,
                            latency: Math.round(currentTime - startTime)
                        };
                    }

                    // LLM TRANSLATION: Update FIRST message of session (accumulative display)
                    // This creates a single growing translation block instead of multiple small blocks
                    if (msg.id === firstSessionMessageIdRef.current && partial.inputTranslation && partial.inputTranslation.trim().length > 0) {
                        console.log(`🔄 [${Math.round(performance.now())}ms] Updating LLM translation in FIRST message: ${msg.id}`);
                        return {
                            ...msg,
                            aiTranslation: partial.inputTranslation,  // Replace with latest accumulated translation
                            isAiTranslated: true  // Mark as AI translated
                        };
                    }

                    return msg;
                }));
            },
            signal // Pass abort signal to LLM service
        );

        const endTime = performance.now();
        console.log(`🤖 [${Math.round(endTime)}ms] LLM END: ${Math.round(endTime - startTime)}ms total`);

    } catch (e: any) {
        if (e.name === 'AbortError') {
            console.log(`🛑 [${Math.round(performance.now())}ms] LLM ABORTED`);
        } else {
            console.error("Queue Processing Error", e);
        }
    } finally {
        // 6. Unlock and Process Next
        llmAbortControllerRef.current = null;
        isAIProcessingRef.current = false;
        // Only process next if not stopped
        if (aiQueueRef.current.length > 0 && shouldBeListening.current) {
            processAIQueue();
        }
    }
  };

  // ----------------------------------------------------------------------
  // LLM ACCUMULATOR FUNCTIONS
  // ----------------------------------------------------------------------
  const sendLLMAccumulator = useCallback((force = false) => {
    const acc = llmAccumulatorRef.current;

    console.log(`🔍 [${Math.round(performance.now())}ms] sendLLMAccumulator called | force=${force} | wordCount=${acc.wordCount} | hasText=${!!acc.text.trim()}`);

    // Don't send if empty
    if (!acc.text.trim() || !acc.questionId || !acc.responseId) {
      console.log(`⏭️ [${Math.round(performance.now())}ms] SKIP: Empty accumulator or missing IDs`);
      return;
    }

    // Only send if:
    // 1. Force flag is true (Stop button, new question, etc.)
    // 2. OR reached max words limit (safety)
    const shouldSend = force || acc.wordCount >= LLM_CONFIG.MAX_WORDS_FOR_LLM;

    console.log(`🎯 [${Math.round(performance.now())}ms] shouldSend=${shouldSend} | force=${force} | wordCount=${acc.wordCount} | MAX=${LLM_CONFIG.MAX_WORDS_FOR_LLM}`);

    if (!shouldSend) {
      console.log(`⏭️ [${Math.round(performance.now())}ms] SKIP: Not ready to send (need force or ${LLM_CONFIG.MAX_WORDS_FOR_LLM}+ words)`);
      return;
    }

    console.log(`🚀 [${Math.round(performance.now())}ms] LLM ACCUMULATOR: Sending ${acc.wordCount} words to queue | Text: "${acc.text.substring(0, 50)}..."`);

    // Add to AI queue
    aiQueueRef.current.push({
      id: acc.questionId,
      text: acc.text,
      responseId: acc.responseId
    });
    processAIQueue();

    // Reset accumulator
    llmAccumulatorRef.current = { text: '', wordCount: 0, questionId: null, responseId: null };
    console.log(`🧹 [${Math.round(performance.now())}ms] Accumulator reset`);

    // Clear silence timer
    if (llmSilenceTimerRef.current) {
      clearTimeout(llmSilenceTimerRef.current);
      llmSilenceTimerRef.current = null;
      console.log(`⏱️ [${Math.round(performance.now())}ms] Silence timer cleared`);
    }
  }, []);

  const addToLLMAccumulator = useCallback((text: string, questionId: string, responseId: string) => {
    const acc = llmAccumulatorRef.current;
    const now = Date.now();
    const pauseDuration = now - llmLastActivityRef.current;
    llmLastActivityRef.current = now;

    const newWordCount = text.split(/\s+/).length;
    console.log(`📥 [${Math.round(performance.now())}ms] addToLLMAccumulator | Adding ${newWordCount} words | Pause: ${pauseDuration}ms | Current total: ${acc.wordCount}`);

    // SMART SENTENCE DETECTION: Check if we should complete the current LLM block
    const shouldCompleteLLMBlock = (accText: string, pause: number): boolean => {
      const wordCount = accText.split(/\s+/).length;

      // Condition 1: Pause > 2 seconds
      if (pause >= LLM_CONFIG.PAUSE_THRESHOLD_MS) {
        console.log(`🎯 [${Math.round(performance.now())}ms] LLM Block Complete: Pause ${pause}ms >= ${LLM_CONFIG.PAUSE_THRESHOLD_MS}ms`);
        return true;
      }

      // Condition 2: Complete sentence (punctuation + min words)
      if (wordCount >= LLM_CONFIG.MIN_WORDS_FOR_SENTENCE &&
          LLM_CONFIG.SENTENCE_MARKERS.test(accText.trim())) {
        console.log(`🎯 [${Math.round(performance.now())}ms] LLM Block Complete: Sentence end detected`);
        return true;
      }

      // Condition 3: Fallback - too many words without sentence end
      if (wordCount >= LLM_CONFIG.FALLBACK_MAX_WORDS) {
        console.log(`🎯 [${Math.round(performance.now())}ms] LLM Block Complete: Fallback max words (${wordCount} >= ${LLM_CONFIG.FALLBACK_MAX_WORDS})`);
        return true;
      }

      return false;
    };

    // Check if previous block should be completed before adding new text
    if (acc.text && shouldCompleteLLMBlock(acc.text, pauseDuration)) {
      console.log(`📤 [${Math.round(performance.now())}ms] Completing previous LLM block (${acc.wordCount} words)`);
      sendLLMAccumulator(true);
    }

    // Add to accumulator
    const newText = acc.text ? `${acc.text} ${text}` : text;
    const totalWordCount = newText.split(/\s+/).length;
    llmAccumulatorRef.current = {
      text: newText,
      wordCount: totalWordCount,
      questionId,
      responseId
    };

    console.log(`📊 [${Math.round(performance.now())}ms] ACCUMULATOR STATE: ${totalWordCount} words | Text: "${newText.substring(0, 50)}..."`);

    // Clear previous pause timer
    if (llmSilenceTimerRef.current) {
      clearTimeout(llmSilenceTimerRef.current);
      llmSilenceTimerRef.current = null;
    }

    // Set pause detection timer (2 seconds)
    llmSilenceTimerRef.current = setTimeout(() => {
      if (llmAccumulatorRef.current.text) {
        console.log(`⏱️ [${Math.round(performance.now())}ms] PAUSE TIMER FIRED (${LLM_CONFIG.PAUSE_THRESHOLD_MS}ms) - Completing LLM block`);
        sendLLMAccumulator(true);
      }
    }, LLM_CONFIG.PAUSE_THRESHOLD_MS);

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
    if (currentContext.viewMode !== 'SIMPLE') {
      initialMessages.push({
        id: `${responseId}_${Date.now()}`,
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
    addToLLMAccumulator(text, questionId, responseId);

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
      
      const langMap: Record<string, string> = {
            'Norwegian': 'no-NO',
            'English': 'en-US',
            'German': 'de-DE',
            'Spanish': 'es-ES',
            'French': 'fr-FR',
            'Ukrainian': 'uk-UA',
            'Russian': 'ru-RU',
            'Polish': 'pl-PL'
      };
      recognition.lang = langMap[context.targetLanguage] || 'en-US';

      recognition.onresult = (event: any) => {
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
        const langMap: Record<string, string> = {
            'Norwegian': 'no-NO', 'English': 'en-US', 'German': 'de-DE',
            'Spanish': 'es-ES', 'French': 'fr-FR', 'Ukrainian': 'uk-UA', 'Russian': 'ru-RU', 'Polish': 'pl-PL'
        };
        const newLang = langMap[context.targetLanguage] || 'en-US';
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

      // ABORT all pending LLM requests immediately
      if (llmAbortControllerRef.current) {
          console.log(`🛑 [${Math.round(performance.now())}ms] ABORTING LLM request`);
          llmAbortControllerRef.current.abort();
          llmAbortControllerRef.current = null;
      }

      // CLEAR LLM queue - don't send any more requests
      const queueLength = aiQueueRef.current.length;
      if (queueLength > 0) {
          console.log(`🛑 [${Math.round(performance.now())}ms] CLEARING LLM queue (${queueLength} items)`);
          aiQueueRef.current = [];
      }

      // CLEAR LLM accumulator without sending
      if (llmAccumulatorRef.current.text.trim()) {
          console.log(`🛑 [${Math.round(performance.now())}ms] DISCARDING LLM accumulator (${llmAccumulatorRef.current.wordCount} words)`);
          llmAccumulatorRef.current = { text: '', wordCount: 0, questionId: null, responseId: null };
      }
      if (llmSilenceTimerRef.current) {
          clearTimeout(llmSilenceTimerRef.current);
          llmSilenceTimerRef.current = null;
      }

      // Reset processing flag
      isAIProcessingRef.current = false;

      // CLEAR SESSION IDs and refs
      sessionQuestionIdRef.current = null;
      sessionResponseIdRef.current = null;
      firstSessionMessageIdRef.current = null;  // Clear first message ref

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


  const handleManualSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if(transcript.trim()) {
          finalizeBlock(transcript);
          setTranscript("");
      }
  }

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
      setMessages([]);
      setIsClearModalOpen(false);
  };

  const confirmClear = () => {
      if (messages.length > 0) setIsClearModalOpen(true);
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

  // Full-screen Landing Page (shown before session starts)
  const renderLandingPage = () => (
    <div className="h-screen w-screen bg-gray-950 flex flex-col items-center justify-center animate-fade-in-up">
        {/* Model loading indicator */}
        {!isModelReady && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50">
            <div className={`flex items-center gap-3 px-4 py-2 rounded-full ${modelError ? 'bg-red-900/80 border-red-500' : 'bg-blue-900/80 border-blue-500/30'} border backdrop-blur-md`}>
              <span className={`text-[10px] font-bold uppercase tracking-widest ${modelError ? 'text-white' : 'text-blue-200 animate-pulse'}`}>
                {modelError ? "MODEL ERROR" : `${t.modelDownload} ${modelProgress}%`}
              </span>
              {!modelError && (
                <div className="w-20 h-1.5 bg-blue-950 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-400 transition-all duration-300" style={{ width: `${modelProgress}%` }} />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Title */}
        <div className="text-center space-y-3 mb-12">
            <h1 className="text-5xl md:text-6xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-cyan-400 to-blue-500">
                Ghost Interviewer
            </h1>
            <p className="text-gray-400 font-mono text-sm tracking-[0.3em] uppercase">{t.selectMode}</p>
        </div>

        {/* Mode Selection Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-5xl px-6 mb-12">
            {/* SIMPLE Mode */}
            <button
              onClick={() => startSessionWithMode('SIMPLE')}
              disabled={!isModelReady}
              className={`group p-8 rounded-2xl border-2 border-amber-500/30 bg-gradient-to-b from-amber-950/20 to-gray-900/50
                hover:border-amber-400 hover:from-amber-900/30 hover:shadow-[0_0_40px_rgba(245,158,11,0.2)]
                transition-all duration-300 text-left relative overflow-hidden
                ${!isModelReady ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
                <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 rounded-full blur-3xl group-hover:bg-amber-500/20 transition-all"></div>
                <div className="relative">
                    <div className="text-amber-400 font-black mb-3 tracking-widest text-sm uppercase flex items-center gap-2">
                        <span className="w-2 h-2 bg-amber-400 rounded-full"></span>
                        {t.modes.simple}
                    </div>
                    <div className="text-gray-300 text-sm leading-relaxed">{t.modes.simpleDesc}</div>
                    <div className="mt-6 flex items-center gap-2 text-amber-500/70 text-xs font-mono">
                        <MicIcon className="w-4 h-4" />
                        <span>Click to start</span>
                    </div>
                </div>
            </button>

            {/* FOCUS Mode */}
            <button
              onClick={() => startSessionWithMode('FOCUS')}
              disabled={!isModelReady}
              className={`group p-8 rounded-2xl border-2 border-blue-500/30 bg-gradient-to-b from-blue-950/20 to-gray-900/50
                hover:border-blue-400 hover:from-blue-900/30 hover:shadow-[0_0_40px_rgba(59,130,246,0.2)]
                transition-all duration-300 text-left relative overflow-hidden
                ${!isModelReady ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
                <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl group-hover:bg-blue-500/20 transition-all"></div>
                <div className="relative">
                    <div className="text-blue-400 font-black mb-3 tracking-widest text-sm uppercase flex items-center gap-2">
                        <span className="w-2 h-2 bg-blue-400 rounded-full"></span>
                        {t.modes.focus}
                    </div>
                    <div className="text-gray-300 text-sm leading-relaxed">{t.modes.focusDesc}</div>
                    <div className="mt-6 flex items-center gap-2 text-blue-500/70 text-xs font-mono">
                        <MicIcon className="w-4 h-4" />
                        <span>Click to start</span>
                    </div>
                </div>
            </button>

            {/* FULL Mode */}
            <button
              onClick={() => startSessionWithMode('FULL')}
              disabled={!isModelReady}
              className={`group p-8 rounded-2xl border-2 border-emerald-500/30 bg-gradient-to-b from-emerald-950/20 to-gray-900/50
                hover:border-emerald-400 hover:from-emerald-900/30 hover:shadow-[0_0_40px_rgba(16,185,129,0.2)]
                transition-all duration-300 text-left relative overflow-hidden
                ${!isModelReady ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
                <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-3xl group-hover:bg-emerald-500/20 transition-all"></div>
                <div className="relative">
                    <div className="text-emerald-400 font-black mb-3 tracking-widest text-sm uppercase flex items-center gap-2">
                        <span className="w-2 h-2 bg-emerald-400 rounded-full"></span>
                        {t.modes.full}
                    </div>
                    <div className="text-gray-300 text-sm leading-relaxed">{t.modes.fullDesc}</div>
                    <div className="mt-6 flex items-center gap-2 text-emerald-500/70 text-xs font-mono">
                        <MicIcon className="w-4 h-4" />
                        <span>Click to start</span>
                    </div>
                </div>
            </button>
        </div>

        {/* Footer hint */}
        <div className="text-center space-y-2">
            <p className="text-xs text-gray-500 font-mono">{t.pressMic}</p>
            <button onClick={() => setIsSetupOpen(true)} className="text-xs text-gray-600 hover:text-gray-400 transition-colors flex items-center gap-2 mx-auto">
                <SettingsIcon className="w-3 h-3" />
                <span>Settings</span>
            </button>
        </div>

        {/* Settings Panel (available from landing) */}
        <SetupPanel isOpen={isSetupOpen} toggleOpen={() => setIsSetupOpen(!isSetupOpen)} context={context} onContextChange={setContext} uiLang={uiLang} />
    </div>
  );

  // LANDING PAGE: Show mode selection before session starts
  if (!hasSessionStarted) {
    return renderLandingPage();
  }

  // WORKING VIEW: Show after mode is selected
  return (
    <div className={`relative h-screen w-screen flex flex-col transition-opacity duration-300 ${stealthMode ? 'bg-transparent' : 'bg-gray-950'}`}>
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

      <div className={`flex justify-between items-center p-4 z-40 ${stealthMode ? 'opacity-20 hover:opacity-100 transition-opacity' : 'bg-gray-900/50 backdrop-blur border-b border-gray-800'} ${!isModelReady ? 'mt-10' : ''}`}>
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
            <button onClick={() => setIsSetupOpen(true)} className="p-2 rounded-lg bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition-all border border-gray-700">
                <SettingsIcon />
            </button>
            <div className={`flex items-center gap-3 px-4 py-2 rounded-lg border transition-all duration-300 ${isUserSpeaking ? 'border-blue-500/50 bg-blue-500/10' : appState !== AppState.IDLE ? 'border-red-500/50 bg-red-500/10' : 'border-gray-700 bg-gray-800'}`}>
                <div className={`w-2.5 h-2.5 rounded-full shadow-lg ${isUserSpeaking ? 'bg-blue-500 animate-pulse shadow-blue-500/50' : appState !== AppState.IDLE ? 'bg-red-500 animate-pulse shadow-red-500/50' : 'bg-gray-500'}`} />
                <span className="text-xs font-mono font-bold tracking-wider text-gray-200">
                    {isUserSpeaking ? "YOU ARE SPEAKING" : appState === AppState.LISTENING ? (context.stereoMode ? "LISTENING (STEREO)" : t.listening) : appState === AppState.PROCESSING ? t.generating : t.paused}
                </span>
            </div>
            <button onClick={toggleLanguage} className="ml-2 px-3 py-1.5 bg-gray-800 text-xs font-black text-emerald-400 rounded-lg border border-gray-700 hover:bg-gray-700 hover:border-emerald-500/50 transition-all shadow-lg shadow-black/20">
                {uiLang === 'en' ? 'UA 🇺🇦' : 'EN 🇺🇸'}
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
             <button onClick={() => setStealthMode(!stealthMode)} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-mono transition-all ${stealthMode ? 'bg-emerald-900/30 border-emerald-500/50 text-emerald-400' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>
                {stealthMode ? <EyeOffIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                {stealthMode ? t.stealthOn : t.stealthOff}
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

      <div className={`flex-1 overflow-y-auto px-4 md:px-8 py-8 ${stealthMode ? 'opacity-90' : ''}`}>
         {/* SIMPLE MODE: Three-column layout */}
         {context.viewMode === 'SIMPLE' ? (
             <div className="max-w-[1800px] mx-auto grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
                 {/* COLUMN 1: Scrollable Ghost blocks */}
                 <div className="space-y-6">
                     {renderMessages()}

                     {interimTranscript && !isUserSpeaking && (
                         <BrickRow
                             isLive={true}
                             interviewerMessage={{ id: 'live', role: 'interviewer', text: interimTranscript, timestamp: Date.now() }}
                             liveTranslation={liveTranslation}
                             viewMode={context.viewMode}
                         />
                     )}

                     {interimTranscript && isUserSpeaking && (
                         <CandidateRow isLive={true} message={{ id: 'live-candidate', role: 'candidate', text: interimTranscript, timestamp: Date.now() }} liveTranslation={liveTranslation} />
                     )}

                     <div ref={messagesEndRef} />
                 </div>

                 {/* COLUMN 2: LLM Translation - Current Block */}
                 <div className="sticky top-8 h-fit">
                     <div className="border-l-4 border-orange-500 bg-orange-900/10 min-h-[200px] rounded-lg shadow-xl">
                         <div className="px-4 py-2 bg-orange-950/30 border-b border-orange-500/10 flex items-center gap-2">
                             <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse"></span>
                             <span className="text-[10px] font-black text-orange-300 uppercase tracking-widest">LLM Переклад (Поточний)</span>
                         </div>
                         <div className="p-6 flex flex-col justify-center min-h-[150px]">
                             {(() => {
                                 // Get LLM translation from first session message
                                 const firstMsg = messages.find(m => m.id === firstSessionMessageIdRef.current);
                                 const llmTranslation = firstMsg?.aiTranslation || '';

                                 return llmTranslation && llmTranslation !== '...' ? (
                                     <div className="text-lg md:text-xl text-orange-400 font-bold leading-relaxed animate-fade-in-up">
                                         {llmTranslation}
                                     </div>
                                 ) : (
                                     <div className="space-y-3 opacity-50 select-none">
                                         <div className="flex items-center gap-2 text-orange-500/50 text-xs font-mono mb-2">
                                             <div className="w-2 h-2 bg-orange-500 rounded-full animate-ping"></div>
                                             ОЧІКУВАННЯ LLM...
                                         </div>
                                         <div className="h-4 w-3/4 bg-orange-900/20 rounded animate-pulse"></div>
                                         <div className="h-4 w-1/2 bg-orange-900/20 rounded animate-pulse"></div>
                                     </div>
                                 );
                             })()}
                         </div>
                     </div>
                 </div>

                 {/* COLUMN 3: LLM Translation - Full Copy */}
                 <div className="sticky top-8 h-fit">
                     <div className="border-l-4 border-emerald-500 bg-emerald-900/10 min-h-[400px] max-h-[calc(100vh-6rem)] overflow-y-auto rounded-lg shadow-xl">
                         <div className="px-4 py-2 bg-emerald-950/30 border-b border-emerald-500/10 flex items-center gap-2 sticky top-0 bg-emerald-950/80 backdrop-blur">
                             <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                             <span className="text-[10px] font-black text-emerald-300 uppercase tracking-widest">LLM Переклад</span>
                         </div>
                         <div className="p-4">
                             {(() => {
                                 // Get LLM translation from first session message
                                 const firstMsg = messages.find(m => m.id === firstSessionMessageIdRef.current);
                                 const llmTranslation = firstMsg?.aiTranslation || '';

                                 return llmTranslation && llmTranslation !== '...' ? (
                                     <div className="text-sm md:text-base text-emerald-200 leading-relaxed font-medium">
                                         {llmTranslation}
                                     </div>
                                 ) : (
                                     <div className="text-[10px] text-emerald-500/50 italic">
                                         Переклад з'явиться тут після обробки...
                                     </div>
                                 );
                             })()}
                         </div>
                     </div>
                 </div>
             </div>
         ) : (
             /* OTHER MODES: Single column layout */
             <div className="max-w-[1600px] mx-auto">
                 {renderMessages()}

                 {interimTranscript && !isUserSpeaking && (
                     <BrickRow
                         isLive={true}
                         interviewerMessage={{ id: 'live', role: 'interviewer', text: interimTranscript, timestamp: Date.now() }}
                         liveTranslation={liveTranslation}
                         viewMode={context.viewMode}
                     />
                 )}

                 {interimTranscript && isUserSpeaking && (
                     <CandidateRow isLive={true} message={{ id: 'live-candidate', role: 'candidate', text: interimTranscript, timestamp: Date.now() }} liveTranslation={liveTranslation} />
                 )}

                 <div ref={messagesEndRef} />
             </div>
         )}
      </div>

      <div className={`p-6 bg-gradient-to-t from-gray-950 via-gray-950 to-transparent ${stealthMode ? 'opacity-10 hover:opacity-100 transition-opacity' : ''}`}>
        <div className="max-w-4xl mx-auto flex gap-6 items-end">
            <button
                onClick={toggleListening}
                disabled={!isModelReady}
                title={!isModelReady ? "Waiting for translation model to load..." : undefined}
                className={`w-16 h-16 rounded-2xl flex items-center justify-center shadow-2xl transition-all transform ${
                    !isModelReady
                        ? 'bg-gray-700 text-gray-500 cursor-not-allowed opacity-50'
                        : shouldBeListening.current
                            ? 'bg-red-500 hover:bg-red-600 text-white shadow-red-900/30 hover:scale-105 hover:-translate-y-1'
                            : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-900/30 hover:scale-105 hover:-translate-y-1'
                }`}>
                {shouldBeListening.current ? <StopIcon className="w-8 h-8" /> : <MicIcon className="w-8 h-8" />}
            </button>
            <form onSubmit={handleManualSubmit} className="flex-1 flex gap-3 relative">
                <input type="text" value={transcript} onChange={(e) => setTranscript(e.target.value)} placeholder={t.placeholderInput} className="flex-1 h-16 bg-gray-900/80 backdrop-blur border border-gray-800 rounded-2xl px-8 text-lg text-gray-200 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 focus:bg-gray-900 outline-none placeholder-gray-600 shadow-xl transition-all" />
                <button type="submit" className="absolute right-3 top-3 bottom-3 w-12 bg-gray-800 text-gray-400 rounded-xl hover:bg-emerald-500 hover:text-white transition-all flex items-center justify-center">
                    <SendIcon className="w-5 h-5" />
                </button>
            </form>
        </div>
      </div>
    </div>
  );
};

export default App;