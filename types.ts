
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

export type AudioPresetId =
  | 'best-available'          // Auto-detect best mic (USB > headset > built-in > default)
  | 'default-mic'             // System default microphone (no device selection)
  | 'tab-audio'               // Audio of a browser tab / the system (Chrome share dialog), no microphone
  | 'headphones-youtube'      // VB-Cable: system audio capture to headphones
  | 'speakers'                // VB-Cable: system audio to speakers
  | 'monitor-speakers'        // VB-Cable: system audio to monitor speakers
  | 'headphones-interview'    // VB-Cable: interview call routing
  | 'phone-aux'               // Phone via AUX cable: Line In input
  | 'manual'                  // User manually selected from dropdown
  | '';                       // No preset selected

// Pre-interview briefing: generated once per candidate+job pair, reused as the
// grounded fact sheet for every live answer.
export interface Briefing {
  text: string;        // Human-readable briefing in the native language
  keyterms: string[];  // Names/terms likely to be spoken (helps translation fix STT errors)
  sourceHash: string;  // Hash of the documents it was built from (stale detection)
  createdAt: number;
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
  audioDeviceId: string; // Selected audio input device ID (empty = system default)
  activeAudioPreset: AudioPresetId; // Active audio routing preset
  listenThroughDeviceId: string; // Output device for VB-Cable audio passthrough (empty = disabled)
  viewMode: ViewMode; // Depth of assistance: SIMPLE = translation, FOCUS = + answers, FULL = + strategy/analysis
  googleTranslateKey: string; // Google Cloud Translation API key (dev fallback for the draft translator)

  // === BRIEFINGS (keyed by sourceHash) ===
  briefings: Record<string, Briefing>;
}

// One translated unit of interviewer speech (sentence / utterance).
export interface Segment {
  id: number;
  source: string;                 // Original text from speech recognition
  draft: string;                  // Instant machine translation (shown until the LLM answers)
  translation: string;            // LLM translation (streams in)
  status: 'draft' | 'translating' | 'done' | 'draft-only';
  boundary: 'final' | 'pause' | 'length'; // Why the segment ended ('length' = cut mid-speech)
  timestamp: number;
  latencyMs?: number;             // Segment creation -> first LLM token
}

// A detected interviewer question with the suggested answer.
export interface QAItem {
  id: number;
  question: string;               // In the interview language
  questionTranslation: string;    // In the native language
  strategy: string;               // FULL mode
  analysis: string;               // FULL mode
  answer: string;                 // In the interview language
  answerTranslation: string;      // In the native language
  status: 'generating' | 'done' | 'aborted' | 'error';
  manual: boolean;                // Triggered by the user, not auto-detected
  timestamp: number;
}

export enum AppState {
  IDLE = 'IDLE',
  LISTENING = 'LISTENING',
}
