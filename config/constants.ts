import { InterviewContext, InterviewProfile, CandidateProfile, JobProfile, ModeConfig, PromptPreset } from '../types';
import { translations } from '../translations';

// --- CONFIGURATION CONSTANTS ---
export const BLOCK_CONFIG = {
    SILENCE_TIMEOUT_MS: 1500,       // Split if silence > 1.5s (reduced for faster response)
    MAX_WORDS_PER_BLOCK: 12,        // Split FINAL chunks at 12 words (Ghost translation)
    MAX_WORDS_OVERFLOW: 20,         // Force split interim at 20 words (hard limit)
    MIN_WORDS_FOR_SENTENCE: 5,      // Allow sentence split after just 5 words
    SENTENCE_END_REGEX: /[.!?।。,;:]+$/ // Punctuation detection (added comma, semicolon, colon)
};

// LLM ACCUMULATION CONFIG: Send 20-25 words per block for clear display
// CENTER COLUMN BLOCKS ARE INDEPENDENT FROM GHOST BLOCKS (left column)
// STRICT THRESHOLD: Only send when 20-25 words accumulated, NO automatic pause/sentence triggers
export const LLM_CONFIG = {
    MIN_WORDS_FOR_LLM: 20,          // STRICT minimum - won't send with fewer words (except STOP button)
    MAX_WORDS_FOR_LLM: 25,          // Auto-send when this threshold is reached
};

export const DEFAULT_PROMPTS: PromptPreset[] = [
    { id: 'default', name: 'Standard Bridge', content: translations.en.defaultPrompt }
];

// NEW: Candidate Profiles (Static - Resume + Knowledge Base)
export const DEFAULT_CANDIDATE_PROFILES: CandidateProfile[] = [
    {
        id: 'example_candidate',
        name: 'Example Profile',
        resume: "Experienced React Developer. 3 years experience with JavaScript, TypeScript, Tailwind CSS. Created 'Elvarika' - a language learning app using AI. Familiar with Node.js.",
        knowledgeBase: "Project Elvarika uses React 18, Zustand for state management, and OpenAI API. Database is Supabase."
    }
];

// NEW: Job Profiles (Dynamic - Company + Job + Application)
export const DEFAULT_JOB_PROFILES: JobProfile[] = [
    {
        id: 'example_job',
        name: 'Example: Java Dev Position',
        companyDescription: "Innovative tech company focusing on Scandinavian markets. Values honesty, clean code, and fast iteration.",
        jobDescription: "We are looking for a Java Developer with Spring Boot experience. Knowledge of microservices and SQL databases (PostgreSQL) is required. Must speak Norwegian.",
        applicationLetter: "" // Søknad - user fills this
    }
];

// LEGACY: Keep for backward compatibility
export const DEFAULT_PROFILES: InterviewProfile[] = [
    {
        id: 'example_java',
        name: 'Example: Java Dev',
        resume: "Experienced React Developer. 3 years experience with JavaScript, TypeScript, Tailwind CSS. Created 'Elvarika' - a language learning app using AI. Familiar with Node.js.",
        jobDescription: "We are looking for a Java Developer with Spring Boot experience. Knowledge of microservices and SQL databases (PostgreSQL) is required. Must speak Norwegian.",
        companyDescription: "Innovative tech company focusing on Scandinavian markets. Values honesty, clean code, and fast iteration.",
        knowledgeBase: "Project Elvarika uses React 18, Zustand for state management, and OpenAI API. Database is Supabase."
    }
];

// Default Mode-Specific Prompts
export const DEFAULT_MODE_CONFIG: ModeConfig = {
  full: {
    aiModel: 'azure',
    strategyDetailLevel: 'detailed',
    translationPrompt: `Translate the interviewer's question with full context.
Provide a natural, conversational translation that captures nuances.
Fix any speech recognition errors.`,
    analysisPrompt: `Provide deep strategic analysis of the question.
Identify the hidden intent behind the question.
Explain what the interviewer is really looking for.
Write in Native Language.`,
    answerPrompt: `Generate a structured, formal response.
Use SIMPLE, SHORT sentences (B1 level).
Bridge the candidate's experience to job requirements.
Write the answer in Target Language.`
  },
  focus: {
    aiModel: 'azure',
    translationPrompt: `Quick, accurate translation of the question.
Preserve the original meaning and intent.
Fix any speech recognition errors.`,
    answerPrompt: `Direct, concise answer to the question.
Use simple sentences (B1 level).
Focus on the most relevant experience.
Write in Target Language.`
  },
  simple: {
    translationPrompt: `Natural, flowing translation.
Translate as a professional interpreter would.
Don't be too literal - convey the meaning naturally.`,
    useChromeAPI: true
  }
};

export const DEFAULT_CONTEXT: InterviewContext = {
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
  groqApiKey: "",

  // === MODE-SPECIFIC CONFIGURATION ===
  modeConfig: DEFAULT_MODE_CONFIG
};

export const STORAGE_KEY = 'ghost_interviewer_context_v2';

// Language code mappings
export const LANG_MAP: Record<string, string> = {
    'Norwegian': 'no-NO',
    'English': 'en-US',
    'German': 'de-DE',
    'Spanish': 'es-ES',
    'French': 'fr-FR',
    'Ukrainian': 'uk-UA',
    'Russian': 'ru-RU',
    'Polish': 'pl-PL'
};

// Queue Item Interface to avoid State Lookup Race Conditions
export interface AIQueueItem {
    id: string;         // The Question ID
    text: string;       // The Question Text
    responseId: string; // The ID of the Assistant Message to update
    targetMessageId: string; // The ID of the Interviewer Message to receive LLM translation
    pendingBlockId?: string; // The ID of the visual pending block in center column
}

// Pending LLM Block for visual queue in center column
export interface PendingLLMBlock {
    id: string;
    text: string;           // Original text being collected/translated
    wordCount: number;
    status: 'collecting' | 'processing' | 'completed';
    chromePreview?: string; // Chrome API instant translation (preview)
    translation?: string;   // LLM artistic translation when completed
    timestamp: number;
}
