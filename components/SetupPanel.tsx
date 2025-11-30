

import React, { useState, useEffect, useRef } from 'react';
import { InterviewContext, PromptPreset, InterviewProfile, ViewMode, CandidateProfile, JobProfile, ModeConfig } from '../types';
import { translations } from '../translations';
import { localTranslator } from '../services/localTranslator';
import { knowledgeSearch } from '../services/knowledgeSearch';

interface SetupPanelProps {
  context: InterviewContext;
  onContextChange: (ctx: InterviewContext) => void;
  isOpen: boolean;
  toggleOpen: () => void;
  uiLang: 'en' | 'uk';
}

// Dropdown Section Component (expandable)
const DropdownSection: React.FC<{
  title: string;
  icon: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}> = ({ title, icon, isOpen, onToggle, children }) => (
  <div className="border-b border-gray-800 last:border-b-0">
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-800/50 transition-colors"
    >
      <div className="flex items-center gap-3">
        <span className="text-lg">{icon}</span>
        <span className="text-xs font-bold uppercase tracking-widest text-gray-300">{title}</span>
      </div>
      <span className={`text-gray-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>▼</span>
    </button>
    {isOpen && (
      <div className="px-4 pb-4 space-y-3 animate-fade-in-up bg-gray-900/30">
        {children}
      </div>
    )}
  </div>
);

const SetupPanel: React.FC<SetupPanelProps> = ({ context, onContextChange, isOpen, toggleOpen, uiLang }) => {
  const [showAudioGuide, setShowAudioGuide] = useState(false);
  const [showVMGuide, setShowVMGuide] = useState(false);
  const [availableDevices, setAvailableDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [isTestingAudio, setIsTestingAudio] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [localModelReady, setLocalModelReady] = useState(false);
  const [searchStats, setSearchStats] = useState({ chunks: 0, terms: 0, isReady: false });

  // Dropdown Section States
  const [modeOpen, setModeOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [jobOpen, setJobOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [audioOpen, setAudioOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Prompt Manager State
  const [presetName, setPresetName] = useState("");
  const selectedPresetId = context.activePromptId || "";

  // NEW: Candidate Profile Manager State
  const [candidateProfileName, setCandidateProfileName] = useState("");
  const selectedCandidateProfileId = context.activeCandidateProfileId || "";

  // NEW: Job Profile Manager State
  const [jobProfileName, setJobProfileName] = useState("");
  const selectedJobProfileId = context.activeJobProfileId || "";

  // LEGACY: Old Profile Manager State (for backward compatibility)
  const [profileName, setProfileName] = useState("");
  const selectedProfileId = context.activeProfileId || "";

  // File Upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const t = translations[uiLang].settings;
  const tModes = translations[uiLang].modes;

  const handleChange = (field: keyof InterviewContext, value: any) => {
    onContextChange({ ...context, [field]: value });
  };

  // Handle mode config changes
  const handleModeConfigChange = (mode: 'full' | 'focus' | 'simple', field: string, value: any) => {
    const newModeConfig = {
      ...context.modeConfig,
      [mode]: {
        ...context.modeConfig[mode],
        [field]: value
      }
    };
    onContextChange({ ...context, modeConfig: newModeConfig });
  };

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        toggleOpen();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, toggleOpen]);

  // Poll local model status
  useEffect(() => {
      if(isOpen) {
          const checkStatus = () => {
             const status = localTranslator.getStatus();
             setLocalModelReady(status.isReady);
          }
          checkStatus();
          const interval = setInterval(checkStatus, 1000);
          return () => clearInterval(interval);
      }
  }, [isOpen]);

  // Update search stats when knowledge base changes
  useEffect(() => {
      setSearchStats(knowledgeSearch.getStats());
  }, [context.knowledgeBase]);

  // Initialize profile/prompt names from saved context
  useEffect(() => {
      // NEW: Initialize candidate profile name
      if (context.activeCandidateProfileId && context.savedCandidateProfiles) {
          const profile = context.savedCandidateProfiles.find(p => p.id === context.activeCandidateProfileId);
          if (profile) setCandidateProfileName(profile.name);
      }
      // NEW: Initialize job profile name
      if (context.activeJobProfileId && context.savedJobProfiles) {
          const profile = context.savedJobProfiles.find(p => p.id === context.activeJobProfileId);
          if (profile) setJobProfileName(profile.name);
      }
      // LEGACY: Initialize old profile name
      if (context.activeProfileId) {
          const profile = context.savedProfiles.find(p => p.id === context.activeProfileId);
          if (profile) setProfileName(profile.name);
      }
      // Initialize prompt name
      if (context.activePromptId) {
          const preset = context.savedPrompts.find(p => p.id === context.activePromptId);
          if (preset) setPresetName(preset.name);
      }
  }, []); // Only on mount

  // Fetch audio devices
  useEffect(() => {
    if (isOpen) {
        const fetchDevices = async () => {
            try {
                // Attempt to get permission to read device labels
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                stream.getTracks().forEach(t => t.stop());
            } catch (e) {
                console.warn("Microphone permission not granted. Device labels might be generic.", e);
            }

            try {
                // Enumerate devices regardless of permission outcome (labels might be masked)
                const devices = await navigator.mediaDevices.enumerateDevices();
                const audioInputs = devices.filter(device => device.kind === 'audioinput');
                setAvailableDevices(audioInputs);
            } catch (e) {
                console.error("Failed to enumerate devices", e);
            }
        };

        fetchDevices();
    } else {
        stopAudioTest();
    }
  }, [isOpen]);

  const handleDeviceChange = async (deviceId: string) => {
      setSelectedDeviceId(deviceId);
      if (isTestingAudio) {
          stopAudioTest();
          setTimeout(() => startAudioTest(deviceId), 100);
      }
  };

  const startAudioTest = async (deviceId?: string) => {
      try {
          const idToUse = deviceId || selectedDeviceId;
          const stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                  deviceId: idToUse ? { exact: idToUse } : undefined,
                  echoCancellation: false,
                  autoGainControl: false,
                  noiseSuppression: false
              }
          });

          streamRef.current = stream;
          const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
          audioContextRef.current = audioCtx;

          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 32;
          analyserRef.current = analyser;

          const source = audioCtx.createMediaStreamSource(stream);
          source.connect(analyser);

          const dataArray = new Uint8Array(analyser.frequencyBinCount);

          const update = () => {
              if (!analyserRef.current) return;
              analyserRef.current.getByteFrequencyData(dataArray);
              const avg = dataArray.reduce((a,b) => a+b) / dataArray.length;
              setAudioLevel(Math.min(100, avg * 2));
              rafRef.current = requestAnimationFrame(update);
          };

          update();
          setIsTestingAudio(true);
      } catch (e) {
          console.error("Failed to start audio test", e);
          alert("Could not access microphone for testing. Check permissions.");
      }
  };

  const stopAudioTest = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      if (audioContextRef.current) audioContextRef.current.close();

      streamRef.current = null;
      audioContextRef.current = null;
      analyserRef.current = null;
      setIsTestingAudio(false);
      setAudioLevel(0);
  };

  // Prompt Manager Logic
  const handlePresetSelect = (id: string) => {
      handleChange('activePromptId', id);
      if (id === "") {
          setPresetName("");
          return;
      }
      const preset = context.savedPrompts.find(p => p.id === id);
      if (preset) {
          handleChange('systemInstruction', preset.content);
          setPresetName(preset.name);
      }
  };

  const handleSavePreset = () => {
      if (!presetName.trim()) return;

      const newPreset: PromptPreset = {
          id: selectedPresetId || Date.now().toString(),
          name: presetName,
          content: context.systemInstruction
      };

      const existingIndex = context.savedPrompts.findIndex(p => p.id === newPreset.id);
      let updatedPrompts = [...context.savedPrompts];

      if (existingIndex >= 0) {
          updatedPrompts[existingIndex] = newPreset;
      } else {
          updatedPrompts.push(newPreset);
      }

      onContextChange({ ...context, savedPrompts: updatedPrompts, activePromptId: newPreset.id });
  };

  const handleDeletePreset = () => {
      if (!selectedPresetId) return;
      if (window.confirm(t.prompts.confirmDelete)) {
          const updatedPrompts = context.savedPrompts.filter(p => p.id !== selectedPresetId);
          onContextChange({ ...context, savedPrompts: updatedPrompts, activePromptId: "", systemInstruction: "" });
          setPresetName("");
      }
  };

  const handleNewPreset = () => {
      handleChange('activePromptId', "");
      setPresetName("");
      handleChange('systemInstruction', "");
  };

  // === NEW: CANDIDATE PROFILE HANDLERS ===
  const handleCandidateProfileSelect = (id: string) => {
      handleChange('activeCandidateProfileId', id);
      if (id === "") {
          setCandidateProfileName("");
          return;
      }
      const profiles = context.savedCandidateProfiles || [];
      const profile = profiles.find(p => p.id === id);
      if (profile) {
          setCandidateProfileName(profile.name);
          onContextChange({
              ...context,
              activeCandidateProfileId: id,
              resume: profile.resume,
              knowledgeBase: profile.knowledgeBase
          });
      }
  };

  const handleSaveCandidateProfile = () => {
      if (!candidateProfileName.trim()) return;

      const newProfile: CandidateProfile = {
          id: selectedCandidateProfileId || Date.now().toString(),
          name: candidateProfileName,
          resume: context.resume,
          knowledgeBase: context.knowledgeBase
      };

      const profiles = context.savedCandidateProfiles || [];
      const existingIndex = profiles.findIndex(p => p.id === newProfile.id);
      let updatedProfiles = [...profiles];

      if (existingIndex >= 0) {
          updatedProfiles[existingIndex] = newProfile;
      } else {
          updatedProfiles.push(newProfile);
      }

      onContextChange({ ...context, savedCandidateProfiles: updatedProfiles, activeCandidateProfileId: newProfile.id });
  };

  const handleDeleteCandidateProfile = () => {
      if (!selectedCandidateProfileId) return;
      if (window.confirm(t.candidateProfiles?.confirmDelete || "Delete this profile?")) {
          const profiles = context.savedCandidateProfiles || [];
          const updated = profiles.filter(p => p.id !== selectedCandidateProfileId);
          onContextChange({ ...context, savedCandidateProfiles: updated, activeCandidateProfileId: "" });
          setCandidateProfileName("");
      }
  };

  const handleNewCandidateProfile = () => {
      handleChange('activeCandidateProfileId', "");
      setCandidateProfileName("");
  };

  // === NEW: JOB PROFILE HANDLERS ===
  const handleJobProfileSelect = (id: string) => {
      handleChange('activeJobProfileId', id);
      if (id === "") {
          setJobProfileName("");
          return;
      }
      const profiles = context.savedJobProfiles || [];
      const profile = profiles.find(p => p.id === id);
      if (profile) {
          setJobProfileName(profile.name);
          onContextChange({
              ...context,
              activeJobProfileId: id,
              companyDescription: profile.companyDescription,
              jobDescription: profile.jobDescription,
              applicationLetter: profile.applicationLetter
          });
      }
  };

  const handleSaveJobProfile = () => {
      if (!jobProfileName.trim()) return;

      const newProfile: JobProfile = {
          id: selectedJobProfileId || Date.now().toString(),
          name: jobProfileName,
          companyDescription: context.companyDescription,
          jobDescription: context.jobDescription,
          applicationLetter: context.applicationLetter || ""
      };

      const profiles = context.savedJobProfiles || [];
      const existingIndex = profiles.findIndex(p => p.id === newProfile.id);
      let updatedProfiles = [...profiles];

      if (existingIndex >= 0) {
          updatedProfiles[existingIndex] = newProfile;
      } else {
          updatedProfiles.push(newProfile);
      }

      onContextChange({ ...context, savedJobProfiles: updatedProfiles, activeJobProfileId: newProfile.id });
  };

  const handleDeleteJobProfile = () => {
      if (!selectedJobProfileId) return;
      if (window.confirm(t.jobProfiles?.confirmDelete || "Delete this profile?")) {
          const profiles = context.savedJobProfiles || [];
          const updated = profiles.filter(p => p.id !== selectedJobProfileId);
          onContextChange({ ...context, savedJobProfiles: updated, activeJobProfileId: "" });
          setJobProfileName("");
      }
  };

  const handleNewJobProfile = () => {
      handleChange('activeJobProfileId', "");
      setJobProfileName("");
  };

  // Constants for file upload
  const MAX_KB_SIZE = 3 * 1024 * 1024; // 3MB limit (leave room for other data in localStorage)
  const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8MB per file

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      // Filter valid files first
      const validFiles = Array.from(files).filter((file) => {
          if (file.size > MAX_FILE_SIZE) {
              alert(`File "${file.name}" is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max: 8MB per file.`);
              return false;
          }
          return true;
      });

      if (validFiles.length === 0) {
          e.target.value = '';
          return;
      }

      let totalNewSize = 0;
      const fileContents: string[] = [];
      let filesProcessed = 0;

      validFiles.forEach((file) => {
          const reader = new FileReader();

          reader.onload = (event) => {
              const text = event.target?.result as string;
              if (text) {
                  fileContents.push(`\n\n--- FILE: ${file.name} ---\n${text}`);
                  totalNewSize += text.length;
              }
              filesProcessed++;

              // When all valid files are read
              if (filesProcessed === validFiles.length) {
                  const newContent = context.knowledgeBase + fileContents.join('');

                  // Check total size
                  if (newContent.length > MAX_KB_SIZE) {
                      alert(`Total Knowledge Base would exceed 3MB limit!\nCurrent: ${(context.knowledgeBase.length / 1024 / 1024).toFixed(2)}MB\nAdding: ${(totalNewSize / 1024 / 1024).toFixed(2)}MB`);
                      return;
                  }

                  handleChange('knowledgeBase', newContent);
                  console.log(`📁 Uploaded ${validFiles.length} file(s), total: ${(newContent.length / 1024).toFixed(1)} KB`);
              }
          };

          reader.onerror = () => {
              console.error(`Failed to read file: ${file.name}`);
              filesProcessed++;
          };

          reader.readAsText(file);
      });

      // Reset input to allow re-uploading same files
      e.target.value = '';
  };

  const getLatencyStatus = (length: number) => {
      if (length > MAX_KB_SIZE) return { color: 'text-red-400', bg: 'bg-red-500', label: 'LIMIT!' };
      if (length < 20000) return { color: 'text-emerald-400', bg: 'bg-emerald-500', label: t.latency.low };
      if (length < 100000) return { color: 'text-yellow-400', bg: 'bg-yellow-500', label: t.latency.med };
      return { color: 'text-orange-400', bg: 'bg-orange-500', label: t.latency.high };
  };

  const kbLength = context.knowledgeBase.length;
  const status = getLatencyStatus(kbLength);

  // Get current mode config
  const currentModeConfig = context.modeConfig[context.viewMode.toLowerCase() as 'full' | 'focus' | 'simple'];


  if (!isOpen) return null;

  return (
    <div
      ref={dropdownRef}
      className="absolute left-16 top-16 w-[380px] max-h-[80vh] bg-gray-950 border border-gray-700 rounded-xl shadow-2xl z-50 overflow-hidden animate-fade-in-up"
    >
      {/* Header */}
      <div className="flex justify-between items-center px-4 py-3 bg-gray-900/80 border-b border-gray-800">
        <h2 className="text-sm font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400 tracking-tight flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
          Settings
        </h2>
        <button onClick={toggleOpen} className="text-gray-400 hover:text-white transition-colors p-1 hover:bg-gray-800 rounded">✕</button>
      </div>

      {/* Scrollable Content */}
      <div className="overflow-y-auto max-h-[calc(80vh-52px)]">

        {/* ============================================ */}
        {/* SECTION 1: MODE SELECTION */}
        {/* ============================================ */}
        <DropdownSection
          title={t.modeCards?.selectMode || "SELECT YOUR INTERVIEW MODE"}
          icon="🎯"
          isOpen={modeOpen}
          onToggle={() => setModeOpen(!modeOpen)}
        >
          <div className="grid grid-cols-3 gap-2">
            {/* FULL Mode */}
            <button
              onClick={() => handleChange('viewMode', 'FULL')}
              className={`p-3 rounded-lg border-2 transition-all text-center ${
                context.viewMode === 'FULL'
                  ? 'border-emerald-500 bg-emerald-900/30 shadow-lg shadow-emerald-500/20'
                  : 'border-gray-700 bg-gray-900/30 hover:border-gray-600'
              }`}
            >
              <span className={`text-lg block ${context.viewMode === 'FULL' ? 'text-emerald-400' : 'text-gray-400'}`}>🎯</span>
              <span className={`text-[10px] font-black uppercase ${context.viewMode === 'FULL' ? 'text-emerald-400' : 'text-gray-500'}`}>FULL</span>
            </button>

            {/* FOCUS Mode */}
            <button
              onClick={() => handleChange('viewMode', 'FOCUS')}
              className={`p-3 rounded-lg border-2 transition-all text-center ${
                context.viewMode === 'FOCUS'
                  ? 'border-blue-500 bg-blue-900/30 shadow-lg shadow-blue-500/20'
                  : 'border-gray-700 bg-gray-900/30 hover:border-gray-600'
              }`}
            >
              <span className={`text-lg block ${context.viewMode === 'FOCUS' ? 'text-blue-400' : 'text-gray-400'}`}>👁️</span>
              <span className={`text-[10px] font-black uppercase ${context.viewMode === 'FOCUS' ? 'text-blue-400' : 'text-gray-500'}`}>FOCUS</span>
            </button>

            {/* SIMPLE Mode */}
            <button
              onClick={() => handleChange('viewMode', 'SIMPLE')}
              className={`p-3 rounded-lg border-2 transition-all text-center ${
                context.viewMode === 'SIMPLE'
                  ? 'border-amber-500 bg-amber-900/30 shadow-lg shadow-amber-500/20'
                  : 'border-gray-700 bg-gray-900/30 hover:border-gray-600'
              }`}
            >
              <span className={`text-lg block ${context.viewMode === 'SIMPLE' ? 'text-amber-400' : 'text-gray-400'}`}>⚡</span>
              <span className={`text-[10px] font-black uppercase ${context.viewMode === 'SIMPLE' ? 'text-amber-400' : 'text-gray-500'}`}>SIMPLE</span>
            </button>
          </div>

          {/* Mode Description */}
          <div className={`mt-3 p-2 rounded-lg border text-[10px] ${
            context.viewMode === 'FULL' ? 'border-emerald-800/50 bg-emerald-900/10 text-emerald-300/80' :
            context.viewMode === 'FOCUS' ? 'border-blue-800/50 bg-blue-900/10 text-blue-300/80' :
            'border-amber-800/50 bg-amber-900/10 text-amber-300/80'
          }`}>
            {context.viewMode === 'FULL' && tModes.fullDesc}
            {context.viewMode === 'FOCUS' && tModes.focusDesc}
            {context.viewMode === 'SIMPLE' && tModes.simpleDesc}
          </div>

          {/* AI Model Selector (not for SIMPLE) */}
          {context.viewMode !== 'SIMPLE' && (
            <div className="mt-3">
              <label className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-1 block">
                🤖 AI Model
              </label>
              <select
                className="w-full bg-gray-900/80 border border-gray-700/50 rounded-lg px-3 py-2 text-xs text-gray-200 outline-none focus:border-cyan-500 transition-all"
                value={(currentModeConfig as any).aiModel || 'azure'}
                onChange={(e) => handleModeConfigChange(context.viewMode.toLowerCase() as 'full' | 'focus', 'aiModel', e.target.value)}
              >
                <option value="azure" className="bg-gray-900">Azure OpenAI GPT-4</option>
                <option value="groq" className="bg-gray-900">Groq Llama 3.3 70B</option>
              </select>
            </div>
          )}

          {/* Groq API Key (if groq selected) */}
          {context.viewMode !== 'SIMPLE' && (currentModeConfig as any).aiModel === 'groq' && (
            <div className="mt-2 animate-fade-in-up">
              <label className="text-[10px] text-purple-300/70 uppercase tracking-wide font-medium mb-1 block">
                API Key
              </label>
              <input
                type="password"
                className="w-full bg-gray-900/80 border border-gray-700/40 rounded-lg px-3 py-2 text-xs text-gray-200 font-mono focus:border-purple-500 outline-none placeholder-gray-600"
                value={context.groqApiKey}
                onChange={(e) => handleChange('groqApiKey', e.target.value)}
                placeholder="gsk_..."
              />
            </div>
          )}
        </DropdownSection>

        {/* ============================================ */}
        {/* SECTION 2: YOUR PROFILE */}
        {/* ============================================ */}
        <DropdownSection
          title={t.accordion?.yourProfile || "YOUR PROFILE"}
          icon="👤"
          isOpen={profileOpen}
          onToggle={() => setProfileOpen(!profileOpen)}
        >
          {/* Profile Selector */}
          <div className="flex gap-2 mb-2">
            <select
              className="flex-1 bg-gray-900 border border-emerald-800/50 rounded text-xs px-2 py-1.5 text-gray-300 outline-none focus:border-emerald-500"
              value={selectedCandidateProfileId}
              onChange={(e) => handleCandidateProfileSelect(e.target.value)}
            >
              <option value="" className="bg-gray-900">{t.candidateProfiles?.select || "Select Profile..."}</option>
              {(context.savedCandidateProfiles || []).map(p => (
                <option key={p.id} value={p.id} className="bg-gray-900">{p.name}</option>
              ))}
            </select>
            <button onClick={handleNewCandidateProfile} className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-gray-300 hover:text-white hover:border-emerald-500">+</button>
            <button onClick={handleDeleteCandidateProfile} className="px-2 py-1 bg-red-900/30 border border-red-900/50 rounded text-xs text-red-400 hover:bg-red-900/50">✕</button>
          </div>
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              placeholder={t.candidateProfiles?.namePlaceholder || "Profile Name"}
              className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 outline-none focus:border-emerald-500"
              value={candidateProfileName}
              onChange={(e) => setCandidateProfileName(e.target.value)}
            />
            <button
              onClick={handleSaveCandidateProfile}
              className="px-3 py-1 bg-emerald-600 rounded text-xs font-bold text-white hover:bg-emerald-500"
            >
              {t.profiles.save}
            </button>
          </div>

          {/* Resume */}
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-emerald-400/80 uppercase">{t.resume}</label>
            <textarea
              className="w-full h-20 bg-gray-900 border border-emerald-900/30 rounded-lg p-2 text-xs text-gray-200 focus:border-emerald-500 outline-none resize-none"
              value={context.resume}
              onChange={(e) => handleChange('resume', e.target.value)}
              placeholder={t.resumePlaceholder}
            />
          </div>

          {/* Knowledge Base */}
          <div className="space-y-1 mt-2">
            <div className="flex justify-between items-end">
              <label className="text-[10px] font-medium text-emerald-400/80 uppercase">{t.knowledgeBase}</label>
              <div className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${kbLength > MAX_KB_SIZE ? 'border-red-500 bg-red-900/20' : 'border-gray-700'} flex items-center gap-1 ${status.color}`}>
                <span>{(kbLength / 1024).toFixed(1)} KB</span>
                <span className={`w-1.5 h-1.5 rounded-full ${status.bg}`}></span>
              </div>
            </div>
            {/* Size Progress Bar */}
            <div className="h-0.5 bg-gray-800 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${kbLength > MAX_KB_SIZE ? 'bg-red-500' : kbLength > MAX_KB_SIZE * 0.8 ? 'bg-orange-500' : 'bg-emerald-500'}`}
                style={{ width: `${Math.min(100, (kbLength / MAX_KB_SIZE) * 100)}%` }}
              />
            </div>
            <textarea
              className={`w-full h-16 bg-gray-900 border rounded-lg p-2 text-xs text-gray-200 outline-none resize-none font-mono ${kbLength > MAX_KB_SIZE ? 'border-red-500' : 'border-emerald-900/30 focus:border-emerald-500'}`}
              value={context.knowledgeBase}
              onChange={(e) => handleChange('knowledgeBase', e.target.value)}
              placeholder={t.knowledgeBasePlaceholder}
            />
            <div className="flex justify-end gap-2">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                className="hidden"
                accept=".txt,.md,.json,.csv,.xml,.html"
                multiple
              />
              <button
                onClick={() => handleChange('knowledgeBase', '')}
                className="text-[10px] text-gray-500 hover:text-white underline"
              >
                {t.clearFile}
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-[10px] bg-gray-800 border border-gray-700 px-2 py-1 rounded text-emerald-300 hover:text-white hover:border-emerald-500 transition-colors"
              >
                📁 {t.uploadFile}
              </button>
            </div>
          </div>
        </DropdownSection>

        {/* ============================================ */}
        {/* SECTION 3: JOB APPLICATION */}
        {/* ============================================ */}
        <DropdownSection
          title={t.accordion?.jobApplication || "JOB APPLICATION"}
          icon="💼"
          isOpen={jobOpen}
          onToggle={() => setJobOpen(!jobOpen)}
        >
          {/* Job Profile Selector */}
          <div className="flex gap-2 mb-2">
            <select
              className="flex-1 bg-gray-900 border border-blue-800/50 rounded text-xs px-2 py-1.5 text-gray-300 outline-none focus:border-blue-500"
              value={selectedJobProfileId}
              onChange={(e) => handleJobProfileSelect(e.target.value)}
            >
              <option value="" className="bg-gray-900">{t.jobProfiles?.select || "Select Job..."}</option>
              {(context.savedJobProfiles || []).map(p => (
                <option key={p.id} value={p.id} className="bg-gray-900">{p.name}</option>
              ))}
            </select>
            <button onClick={handleNewJobProfile} className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-gray-300 hover:text-white hover:border-blue-500">+</button>
            <button onClick={handleDeleteJobProfile} className="px-2 py-1 bg-red-900/30 border border-red-900/50 rounded text-xs text-red-400 hover:bg-red-900/50">✕</button>
          </div>
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              placeholder={t.jobProfiles?.namePlaceholder || "Job Name"}
              className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 outline-none focus:border-blue-500"
              value={jobProfileName}
              onChange={(e) => setJobProfileName(e.target.value)}
            />
            <button
              onClick={handleSaveJobProfile}
              className="px-3 py-1 bg-blue-600 rounded text-xs font-bold text-white hover:bg-blue-500"
            >
              {t.profiles.save}
            </button>
          </div>

          {/* Company Description */}
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-blue-400/80 uppercase">{t.companyDesc}</label>
            <textarea
              className="w-full h-16 bg-gray-900 border border-blue-900/30 rounded-lg p-2 text-xs text-gray-200 focus:border-blue-500 outline-none resize-none"
              value={context.companyDescription}
              onChange={(e) => handleChange('companyDescription', e.target.value)}
              placeholder={t.companyDescPlaceholder}
            />
          </div>

          {/* Job Description */}
          <div className="space-y-1 mt-2">
            <label className="text-[10px] font-medium text-blue-400/80 uppercase">{t.jobDesc}</label>
            <textarea
              className="w-full h-16 bg-gray-900 border border-blue-900/30 rounded-lg p-2 text-xs text-gray-200 focus:border-blue-500 outline-none resize-none"
              value={context.jobDescription}
              onChange={(e) => handleChange('jobDescription', e.target.value)}
              placeholder={t.jobDescPlaceholder}
            />
          </div>

          {/* Application Letter */}
          <div className="space-y-1 mt-2">
            <label className="text-[10px] font-medium text-blue-400/80 uppercase">{t.applicationLetter || "APPLICATION LETTER"}</label>
            <textarea
              className="w-full h-16 bg-gray-900 border border-blue-900/30 rounded-lg p-2 text-xs text-gray-200 focus:border-blue-500 outline-none resize-none"
              value={context.applicationLetter || ""}
              onChange={(e) => handleChange('applicationLetter', e.target.value)}
              placeholder={t.applicationLetterPlaceholder || "Your cover letter / søknad..."}
            />
          </div>
        </DropdownSection>

        {/* ============================================ */}
        {/* SECTION 4: LANGUAGE SETTINGS */}
        {/* ============================================ */}
        <DropdownSection
          title={t.accordion?.languageSettings || "LANGUAGE SETTINGS"}
          icon="🌐"
          isOpen={languageOpen}
          onToggle={() => setLanguageOpen(!languageOpen)}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-gray-400 uppercase">{t.targetLang}</label>
              <select
                className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 outline-none"
                value={context.targetLanguage}
                onChange={(e) => handleChange('targetLanguage', e.target.value)}
              >
                <option className="bg-gray-900">Norwegian</option>
                <option className="bg-gray-900">English</option>
                <option className="bg-gray-900">German</option>
                <option className="bg-gray-900">French</option>
                <option className="bg-gray-900">Spanish</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-gray-400 uppercase">{t.nativeLang}</label>
              <select
                className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 outline-none"
                value={context.nativeLanguage}
                onChange={(e) => handleChange('nativeLanguage', e.target.value)}
              >
                <option className="bg-gray-900">Ukrainian</option>
                <option className="bg-gray-900">English</option>
                <option className="bg-gray-900">Russian</option>
                <option className="bg-gray-900">Polish</option>
              </select>
            </div>
          </div>
        </DropdownSection>

        {/* ============================================ */}
        {/* SECTION 5: AUDIO SETUP */}
        {/* ============================================ */}
        <DropdownSection
          title={t.accordion?.audioSetup || "AUDIO SETUP"}
          icon="🎧"
          isOpen={audioOpen}
          onToggle={() => setAudioOpen(!audioOpen)}
        >
          {/* Microphone Selection */}
          <div className="space-y-2">
            <label className="text-[10px] font-medium text-gray-400 uppercase">{t.inputSource}</label>
            <select
              className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:border-emerald-500 outline-none"
              value={selectedDeviceId}
              onChange={(e) => handleDeviceChange(e.target.value)}
            >
              <option value="" className="bg-gray-900">{t.defaultMic}</option>
              {availableDevices.map(device => (
                <option key={device.deviceId} value={device.deviceId} className="bg-gray-900">
                  {device.label || `Microphone ${device.deviceId.slice(0, 5)}...`}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-2">
              <button
                onClick={() => isTestingAudio ? stopAudioTest() : startAudioTest()}
                className={`text-[10px] px-2 py-1 rounded border transition-colors ${isTestingAudio ? 'bg-red-500/20 text-red-400 border-red-500/30' : 'bg-gray-800 text-gray-400 border-gray-700'}`}
              >
                {isTestingAudio ? t.stopTest : t.testMic}
              </button>

              {/* Visualizer Bar */}
              <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-75 ease-out"
                  style={{ width: `${audioLevel}%` }}
                />
              </div>
            </div>

            {/* Stereo Mode Toggle */}
            <div className="flex items-center justify-between pt-2">
              <label className="text-[10px] font-medium text-orange-400 uppercase">{t.stereoMode}</label>
              <button
                onClick={() => handleChange('stereoMode', !context.stereoMode)}
                className={`w-10 h-5 rounded-full relative transition-colors duration-200 ${context.stereoMode ? 'bg-orange-600' : 'bg-gray-700'}`}
              >
                <div className={`w-3 h-3 bg-white rounded-full absolute top-1 transition-all duration-200 ${context.stereoMode ? 'left-6' : 'left-1'}`} />
              </button>
            </div>
          </div>

          {/* Audio Guide */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-2 mt-3">
            <button
              onClick={() => setShowAudioGuide(!showAudioGuide)}
              className="w-full flex justify-between items-center text-[10px] font-bold text-blue-400 uppercase tracking-wider hover:text-blue-300 text-left"
            >
              <span>{t.audioGuideTitle}</span>
              <span>{showAudioGuide ? '−' : '+'}</span>
            </button>

            {showAudioGuide && (
              <div className="mt-2 text-[10px] text-gray-300 space-y-2 leading-relaxed border-t border-gray-800 pt-2">
                <p className="font-semibold text-white">{t.audioGoal}</p>
                <ol className="list-decimal pl-3 space-y-1">
                  <li>{t.step1}</li>
                  <li>{t.step2}</li>
                  <li className="text-blue-200">{t.step3Title}</li>
                  <li className="text-emerald-400">{t.step4}</li>
                  <li className="text-emerald-400">{t.step5}</li>
                </ol>
              </div>
            )}
          </div>
        </DropdownSection>

        {/* ============================================ */}
        {/* SECTION 6: ADVANCED PROMPTS */}
        {/* ============================================ */}
        <DropdownSection
          title={t.accordion?.advancedPrompts || "ADVANCED PROMPTS"}
          icon="🧠"
          isOpen={advancedOpen}
          onToggle={() => setAdvancedOpen(!advancedOpen)}
        >
          {/* Prompt Manager UI */}
          <div className="flex gap-2 mb-2">
            <select
              className="flex-1 bg-gray-900 border border-gray-700 rounded text-xs px-2 py-1 text-gray-300 outline-none"
              value={selectedPresetId}
              onChange={(e) => handlePresetSelect(e.target.value)}
            >
              <option value="" className="bg-gray-900">{t.prompts.select}</option>
              {context.savedPrompts.map(p => (
                <option key={p.id} value={p.id} className="bg-gray-900">{p.name}</option>
              ))}
            </select>
            <button onClick={handleNewPreset} className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-gray-300 hover:text-white">+</button>
            <button onClick={handleDeletePreset} className="px-2 py-1 bg-red-900/30 border border-red-900/50 rounded text-xs text-red-400 hover:bg-red-900/50">✕</button>
          </div>

          <div className="flex gap-2 mb-2">
            <input
              type="text"
              placeholder={t.prompts.namePlaceholder}
              className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 outline-none focus:border-emerald-500"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
            />
            <button
              onClick={handleSavePreset}
              className="px-3 py-1 bg-emerald-600 rounded text-xs font-bold text-white hover:bg-emerald-500"
            >
              {t.prompts.save}
            </button>
          </div>

          <textarea
            className="w-full h-32 bg-gray-800 border border-gray-700 rounded-lg p-2 text-[10px] font-mono text-gray-300 focus:border-emerald-500 outline-none resize-none leading-relaxed"
            value={context.systemInstruction}
            onChange={(e) => handleChange('systemInstruction', e.target.value)}
          />

          {/* Mode-Specific Prompts */}
          {context.viewMode !== 'SIMPLE' && (
            <div className="mt-3 pt-3 border-t border-gray-800 space-y-2">
              <label className="text-[10px] text-gray-400 uppercase tracking-wide font-medium block">
                📝 Mode-Specific Prompts
              </label>

              {/* Translation Prompt */}
              <div>
                <label className="text-[9px] text-gray-500 uppercase tracking-wide mb-1 block">Translation Prompt</label>
                <textarea
                  className="w-full h-14 bg-gray-900/80 border border-gray-700/40 rounded-lg p-2 text-[10px] font-mono text-gray-300 focus:border-cyan-500 outline-none resize-none"
                  value={currentModeConfig.translationPrompt}
                  onChange={(e) => handleModeConfigChange(context.viewMode.toLowerCase() as 'full' | 'focus' | 'simple', 'translationPrompt', e.target.value)}
                />
              </div>

              {/* Analysis Prompt (FULL mode only) */}
              {context.viewMode === 'FULL' && (
                <div>
                  <label className="text-[9px] text-gray-500 uppercase tracking-wide mb-1 block">Analysis Prompt</label>
                  <textarea
                    className="w-full h-14 bg-gray-900/80 border border-gray-700/40 rounded-lg p-2 text-[10px] font-mono text-gray-300 focus:border-purple-500 outline-none resize-none"
                    value={(currentModeConfig as any).analysisPrompt || ''}
                    onChange={(e) => handleModeConfigChange('full', 'analysisPrompt', e.target.value)}
                  />
                </div>
              )}

              {/* Answer Prompt */}
              <div>
                <label className="text-[9px] text-gray-500 uppercase tracking-wide mb-1 block">Answer Prompt</label>
                <textarea
                  className="w-full h-14 bg-gray-900/80 border border-gray-700/40 rounded-lg p-2 text-[10px] font-mono text-gray-300 focus:border-emerald-500 outline-none resize-none"
                  value={(currentModeConfig as any).answerPrompt || ''}
                  onChange={(e) => handleModeConfigChange(context.viewMode.toLowerCase() as 'full' | 'focus', 'answerPrompt', e.target.value)}
                />
              </div>
            </div>
          )}
        </DropdownSection>

      </div>
    </div>
  );
};

export default SetupPanel;
