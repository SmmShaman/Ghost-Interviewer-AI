
export interface PromptPreset {
  id: string;
  name: string;
  content: string;
}

// STATIC: Candidate's personal data (rarely changes)
export interface CandidateProfile {
  id: string;
  name: string;
  resume: string;           // CV/Resume content
  knowledgeBase: string;    // Technical docs, project details, skills reference
}

// DYNAMIC: Per-interview data (changes for each job application)
export interface JobProfile {
  id: string;
  name: string;
  companyDescription: string;  // Company values, products, culture
  jobDescription: string;      // Job requirements, responsibilities
  applicationLetter: string;   // Søknad - cover letter for this position
}

// LEGACY: Keep for backward compatibility during migration
export interface InterviewProfile {
  id: string;
  name: string;
  resume: string;
  jobDescription: string;
  companyDescription: string;
  knowledgeBase: string;
}

export type ViewMode = 'FULL' | 'FOCUS' | 'SIMPLE';

// Mode-Specific Configuration for Mode-Centric Cards UI
export interface ModePrompts {
  translationPrompt: string;     // How to translate input
  analysisPrompt?: string;       // How to analyze question (not for SIMPLE)
  answerPrompt?: string;         // How to generate answer (not for SIMPLE)
}

export interface ModeConfig {
  full: ModePrompts & {
    aiModel: 'gemini';
    strategyDetailLevel: 'brief' | 'detailed' | 'comprehensive';
  };
  focus: ModePrompts & {
    aiModel: 'gemini';
  };
  simple: {
    translationPrompt: string;
    useChromeAPI: boolean;       // Whether to prefer Chrome Translator API
  };
}

export type AudioPresetId =
  | 'headphones-youtube'    // Stereo Mix / VB-Cable for system audio capture
  | 'speakers'              // Default mic captures speaker output
  | 'monitor-speakers'      // Monitor built-in speakers + mic capture
  | 'headphones-interview'  // VB-Cable routing for Teams/Zoom calls
  | 'manual'                // User manually selected from dropdown
  | '';                     // No preset selected

// Speed preset for translation pipeline tuning
export type SpeedPresetId = 'youtube' | 'interview' | 'custom';

export interface SpeedPresetConfig {
  ghostBatchWords: number;       // Max words per Ghost translation batch
  ghostDebounceMs: number;       // Debounce before Ghost translates
  interimDebounceMs: number;     // Debounce before interim translates
  holdN: number;                 // Hide last N interim words (reduces flicker)
  llmEnabled: boolean;           // Enable LLM translation
  llmTriggerWords: number;       // Words threshold to trigger LLM
  llmPauseMs: number;            // Pause duration to trigger LLM
  activeWindowWords: number;     // Words kept in active zone before freezing
  paragraphPauseMs: number;      // Pause to trigger paragraph break (ms)
  paragraphMarker: string;       // What to insert on pause: '\n\n' or '. ' or ' '
}

export const SPEED_PRESETS: Record<SpeedPresetId, SpeedPresetConfig & { label: string; description: string }> = {
  youtube: {
    label: 'YouTube / Підкасти',
    description: 'Ghost only, суцільний текст як субтитри',
    ghostBatchWords: 10,
    ghostDebounceMs: 50,
    interimDebounceMs: 50,
    holdN: 2,
    llmEnabled: false,
    llmTriggerWords: 25,
    llmPauseMs: 2000,
    activeWindowWords: 25,
    paragraphPauseMs: 8000,    // 8s — only on real long pauses
    paragraphMarker: '. ',     // Dot + space instead of line break
  },
  interview: {
    label: 'Live інтерв\'ю',
    description: 'Максимальна швидкість Ghost + LLM для відповідей',
    ghostBatchWords: 6,
    ghostDebounceMs: 50,
    interimDebounceMs: 50,
    holdN: 1,
    llmEnabled: true,
    llmTriggerWords: 6,
    llmPauseMs: 600,
    activeWindowWords: 12,
    paragraphPauseMs: 3000,    // 3s — separate interviewer phrases
    paragraphMarker: '\n\n',   // Visual paragraph break
  },
  custom: {
    label: 'Власні',
    description: 'Ручне налаштування всіх параметрів',
    ghostBatchWords: 8,
    ghostDebounceMs: 100,
    interimDebounceMs: 100,
    holdN: 2,
    llmEnabled: true,
    llmTriggerWords: 8,
    llmPauseMs: 800,
    activeWindowWords: 18,
    paragraphPauseMs: 2000,
    paragraphMarker: '\n\n',
  },
};

export interface InterviewContext {
  // === ACTIVE DATA (loaded from selected profiles) ===
  resume: string;
  knowledgeBase: string;
  companyDescription: string;
  jobDescription: string;
  applicationLetter: string; // NEW: Søknad content

  // === LANGUAGE SETTINGS ===
  targetLanguage: string; // The language of the interview (e.g., Norwegian)
  nativeLanguage: string; // The language you read (e.g., Ukrainian)
  proficiencyLevel: string; // e.g., "B1", "Native"
  tone: 'Professional' | 'Casual' | 'Confident' | 'Humble';

  // === AI CONFIGURATION ===
  systemInstruction: string; // User-editable prompt logic
  savedPrompts: PromptPreset[]; // List of saved prompts
  activePromptId: string; // Currently selected prompt ID

  // === NEW PROFILE SYSTEM ===
  savedCandidateProfiles: CandidateProfile[]; // Static: Resume + Knowledge
  savedJobProfiles: JobProfile[]; // Dynamic: Company + Job + Søknad
  activeCandidateProfileId: string; // Selected candidate profile
  activeJobProfileId: string; // Selected job profile

  // === LEGACY (for migration) ===
  savedProfiles: InterviewProfile[]; // Old combined profiles
  activeProfileId: string; // Old profile ID

  // === UI & HARDWARE ===
  stereoMode: boolean; // Enable VoiceMeeter Left/Right separation
  audioDeviceId: string; // Selected audio input device ID (empty = system default)
  activeAudioPreset: AudioPresetId; // Active audio routing preset
  listenThroughDeviceId: string; // Output device for VB-Cable audio passthrough (empty = disabled)
  viewMode: ViewMode; // Controls the layout and processing depth
  ghostModel: 'opus' | 'nllb'; // Select local model type
  llmProvider: 'gemini'; // Cloud LLM Provider
  speedPreset: SpeedPresetId; // Translation speed preset
  googleTranslateKey: string; // Google Cloud Translation API key (Level 2 NMT)

  // === MODE-SPECIFIC CONFIGURATION ===
  modeConfig: ModeConfig; // Mode-specific prompts and settings
}

export interface TextBlock {
  id: string;
  text: string;
  wordCount: number;
  status: 'collecting' | 'translating' | 'ai-processing' | 'complete';
  ghostTranslation?: string;
  aiResult?: {
    analysis: string;
    strategy: string;
    answer: string;
    answerTranslation: string;
  };
  timestamp: number;
}

export interface Message {
  id: string;
  role: 'interviewer' | 'assistant' | 'candidate';
  text: string; // Original text (Answer Script)
  translatedText?: string; // Deprecated (fallback)
  ghostTranslation?: string; // New: Local Model (Draft)
  aiTranslation?: string;    // New: Azure Model (Final)
  isAiTranslated?: boolean; // New: True if AI has updated the translation
  rationale?: string; // Deprecated/Fallback
  analysis?: string; // New: Understanding the question
  strategy?: string; // New: Bullet points
  answerTranslation?: string; // New: Translation of the suggested answer
  candidateTranslation?: string; // New: Translation of what the candidate said
  timestamp: number;
  latency?: number;
}

export enum AppState {
  IDLE = 'IDLE',
  LISTENING = 'LISTENING',
  PROCESSING = 'PROCESSING',
}

// Browser Speech Recognition Types
export interface IWindow extends Window {
  webkitSpeechRecognition: any;
  SpeechRecognition: any;
}
