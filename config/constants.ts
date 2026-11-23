import { InterviewContext, InterviewProfile, CandidateProfile, JobProfile, PromptPreset } from '../types';
import { translations } from '../translations';

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
  audioDeviceId: '',
  activeAudioPreset: '',
  listenThroughDeviceId: '',
  viewMode: 'FOCUS',
  googleTranslateKey: '',

  // === BRIEFINGS ===
  briefings: {}
};

export const STORAGE_KEY = 'ghost_interviewer_context_v2';

// Language code mappings
export const LANG_MAP: Record<string, string> = {
    'Norwegian': 'nb-NO',
    'English': 'en-US',
    'German': 'de-DE',
    'Spanish': 'es-ES',
    'French': 'fr-FR',
    'Ukrainian': 'uk-UA',
    'Russian': 'ru-RU',
    'Polish': 'pl-PL'
};
