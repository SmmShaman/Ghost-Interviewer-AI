
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
    aiModel: 'azure' | 'groq';
    strategyDetailLevel: 'brief' | 'detailed' | 'comprehensive';
  };
  focus: ModePrompts & {
    aiModel: 'azure' | 'groq';
  };
  simple: {
    translationPrompt: string;
    useChromeAPI: boolean;       // Whether to prefer Chrome Translator API
  };
}

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
  viewMode: ViewMode; // Controls the layout and processing depth
  ghostModel: 'opus' | 'nllb'; // Select local model type
  llmProvider: 'azure' | 'groq'; // Select Cloud Provider
  groqApiKey: string; // Store Groq Key

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
