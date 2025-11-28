
export interface PromptPreset {
  id: string;
  name: string;
  content: string;
}

export interface InterviewProfile {
  id: string;
  name: string;
  resume: string;
  jobDescription: string;
  companyDescription: string;
  knowledgeBase: string;
}

export type ViewMode = 'FULL' | 'FOCUS' | 'SIMPLE';

export interface InterviewContext {
  resume: string;
  jobDescription: string;
  companyDescription: string; // New field for company values/products
  knowledgeBase: string; // New field for raw data/technical docs
  targetLanguage: string; // The language of the interview (e.g., Norwegian)
  nativeLanguage: string; // The language you read (e.g., Ukrainian)
  proficiencyLevel: string; // e.g., "B1", "Native"
  tone: 'Professional' | 'Casual' | 'Confident' | 'Humble';
  systemInstruction: string; // User-editable prompt logic
  savedPrompts: PromptPreset[]; // List of saved prompts
  savedProfiles: InterviewProfile[]; // List of saved data sets
  activeProfileId: string; // Currently selected profile ID
  activePromptId: string; // Currently selected prompt ID
  stereoMode: boolean; // Enable VoiceMeeter Left/Right separation
  viewMode: ViewMode; // New: Controls the layout and processing depth
  ghostModel: 'opus' | 'nllb'; // New: Select local model type
  llmProvider: 'azure' | 'groq'; // New: Select Cloud Provider
  groqApiKey: string; // New: Store Groq Key
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
