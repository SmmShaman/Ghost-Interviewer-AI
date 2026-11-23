import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SetupPanel from './components/SetupPanel';
import GearMenu from './components/GearMenu';
import LandingPage from './components/LandingPage';
import LiveView from './components/LiveView';
import BriefingPanel from './components/BriefingPanel';
import { MicIcon, StopIcon, DownloadIcon, TrashIcon } from './components/Icons';
import { AppState, Briefing, InterviewContext, ViewMode } from './types';
import { localTranslator } from './services/localTranslator';
import { apiClient } from './services/apiClient';
import { translations } from './translations';
import { CandidateDocs, hashDocs } from './services/prompts';
import { WebSpeechSource } from './services/speech/webSpeechSource';
import { SimulatedSpeechSource } from './services/speech/simulatedSource';
import type { SpeechSource } from './services/speech/types';
import { useLiveSession } from './hooks/useLiveSession';
import { useGoogleAuth } from './hooks/useGoogleAuth';
import { useAudioPassthrough } from './hooks/useAudioPassthrough';
import { DEFAULT_CONTEXT, STORAGE_KEY, LANG_MAP } from './config/constants';

const MAX_STORED_BRIEFINGS = 5;

const loadContext = (): InterviewContext => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      // Merge with defaults so fields added later exist in old saved state.
      const parsed = JSON.parse(saved);
      return { ...DEFAULT_CONTEXT, ...parsed, briefings: parsed.briefings || {} };
    }
  } catch (e) {
    console.error('Failed to load context', e);
  }
  return DEFAULT_CONTEXT;
};

const App: React.FC = () => {
  const [context, setContext] = useState<InterviewContext>(loadContext);
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const [isBriefingOpen, setIsBriefingOpen] = useState(false);
  const [isClearModalOpen, setIsClearModalOpen] = useState(false);
  const [uiLang, setUiLang] = useState<'en' | 'uk'>('uk');
  const [hasSessionStarted, setHasSessionStarted] = useState(false);
  const [speechError, setSpeechError] = useState('');
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [draftMethod, setDraftMethod] = useState(localTranslator.getStatus().method);

  const googleAuth = useGoogleAuth();
  const t = translations[uiLang];

  // Routes audio from the input device to the selected output (VB-Cable, phone AUX…).
  const audioPassthrough = useAudioPassthrough({
    inputDeviceId: context.audioDeviceId,
    outputDeviceId: context.listenThroughDeviceId || '',
    enabled: !!context.audioDeviceId && !!context.listenThroughDeviceId,
  });

  // ---- briefing ------------------------------------------------------------

  const docs: CandidateDocs = useMemo(() => ({
    resume: context.resume,
    knowledgeBase: context.knowledgeBase,
    applicationLetter: context.applicationLetter,
    companyDescription: context.companyDescription,
    jobDescription: context.jobDescription,
  }), [context.resume, context.knowledgeBase, context.applicationLetter, context.companyDescription, context.jobDescription]);

  const docsHash = useMemo(
    () => hashDocs(docs, context.targetLanguage, context.nativeLanguage),
    [docs, context.targetLanguage, context.nativeLanguage],
  );
  const briefing: Briefing | null = context.briefings?.[docsHash] || null;
  const staleBriefing: Briefing | null = useMemo(() => {
    if (briefing) return null;
    const all: Briefing[] = Object.values(context.briefings ?? ({} as Record<string, Briefing>));
    return all.length ? all.reduce((a, b) => (a.createdAt > b.createdAt ? a : b)) : null;
  }, [briefing, context.briefings]);

  const saveBriefing = useCallback((b: Briefing) => {
    setContext(prev => {
      const merged: Record<string, Briefing> = { ...(prev.briefings ?? {}), [b.sourceHash]: b };
      const entries = Object.entries(merged)
        .sort((x, y) => y[1].createdAt - x[1].createdAt)
        .slice(0, MAX_STORED_BRIEFINGS);
      return { ...prev, briefings: Object.fromEntries(entries) };
    });
  }, []);

  // ---- live session --------------------------------------------------------

  const live = useLiveSession(context, { briefing, onAuthExpired: googleAuth.markExpired });
  const liveRef = useRef(live);
  useEffect(() => { liveRef.current = live; }, [live]);

  const contextRef = useRef(context);
  useEffect(() => {
    contextRef.current = context;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(context));
    } catch (e) {
      console.error('Failed to save context', e);
    }
  }, [context]);

  const addDebug = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const line = `[${ts}] ${msg}`;
    console.log(line);
    setDebugLog(prev => [...prev.slice(-19), line]);
  }, []);

  // The speech source lives outside React state: one instance for the app's lifetime.
  // Swap this constructor to move to a cloud streaming recognizer.
  const speechRef = useRef<SpeechSource | null>(null);
  if (!speechRef.current) {
    // Dev server + `?sim`: replay a scripted interview instead of the microphone.
    const simulate = import.meta.env.DEV && new URLSearchParams(window.location.search).has('sim');
    const Source = simulate ? SimulatedSpeechSource : WebSpeechSource;
    speechRef.current = new Source({
      onInterim: text => liveRef.current.handleInterim(text),
      onFinal: text => liveRef.current.handleFinal(text),
      onState: (state, detail) => {
        if (state === 'error') {
          setSpeechError(detail || 'speech recognition error');
          liveRef.current.stop();
          setAppState(AppState.IDLE);
        }
      },
      onDebug: msg => addDebug(msg),
    });
  }

  // ---- draft translator ----------------------------------------------------

  useEffect(() => {
    // Interviewer speaks targetLanguage -> we read nativeLanguage.
    localTranslator.setLanguages(context.targetLanguage, context.nativeLanguage);
    const apiUrl = import.meta.env.VITE_API_URL || 'https://ghost.vitalii.no';
    const token = apiClient.getIdToken();
    if (token) localTranslator.setGoogleNMTProxy(apiUrl, token);
    else if (context.googleTranslateKey) localTranslator.setGoogleNMTKey(context.googleTranslateKey);
    // Never blocks the session: the draft simply appears once an engine is ready.
    localTranslator.initialize()
      .catch(err => console.error('Draft translator init error:', err))
      .finally(() => setDraftMethod(localTranslator.getStatus().method));
  }, [context.targetLanguage, context.nativeLanguage, context.googleTranslateKey, googleAuth.isSignedIn]);

  // Sign-in must be possible without leaving (and thereby stopping) the session.
  const needsSignIn = hasSessionStarted && !googleAuth.isSignedIn && (live.state.llmStatus === 'offline' || live.state.llmStatus === 'auth');
  useEffect(() => {
    if (!needsSignIn) return;
    const timer = setTimeout(() => googleAuth.renderButton('google-signin-live'), 50);
    return () => clearTimeout(timer);
  }, [needsSignIn, googleAuth.renderButton]);

  // After a (re-)sign-in, translate what was left as machine draft meanwhile.
  useEffect(() => {
    if (googleAuth.isSignedIn) liveRef.current.retryDrafts();
  }, [googleAuth.isSignedIn]);

  // Keep the default personal-instructions preset in the UI language.
  useEffect(() => {
    const prevLang = uiLang === 'en' ? 'uk' : 'en';
    const prevDefault = translations[prevLang].defaultPrompt;
    const currentDefault = translations[uiLang].defaultPrompt;
    setContext(prev => ({
      ...prev,
      savedPrompts: prev.savedPrompts.map(p => (p.id === 'default' ? { ...p, content: currentDefault } : p)),
      systemInstruction: prev.systemInstruction.trim() === prevDefault.trim() ? currentDefault : prev.systemInstruction,
    }));
  }, [uiLang]);

  // ---- start / stop --------------------------------------------------------

  /** Resolve the input device for the active audio preset (may update the context). */
  const resolveDeviceId = async (): Promise<string> => {
    const ctx = contextRef.current;
    let deviceId = ctx.audioDeviceId;
    const preset = ctx.activeAudioPreset;
    if (!preset || preset === 'manual') return deviceId;
    try {
      // Device labels are only available after a permission grant.
      const temp = await navigator.mediaDevices.getUserMedia({ audio: true });
      temp.getTracks().forEach(track => track.stop());
      const inputs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');

      if (preset === 'default-mic') {
        deviceId = '';
      } else if (preset === 'best-available') {
        const priority = ['usb', 'blue yeti', 'at2020', 'fifine', 'rode', 'headset', 'airpods', 'jabra', 'webcam', 'camera', 'realtek', 'high definition', 'built-in', 'internal mic'];
        let best: MediaDeviceInfo | undefined;
        for (const pattern of priority) {
          best = inputs.find(d => d.label.toLowerCase().includes(pattern));
          if (best) break;
        }
        deviceId = best?.deviceId || inputs[0]?.deviceId || '';
        addDebug(`🎤 mic: ${best?.label || inputs[0]?.label || 'default'}`);
      } else if (!deviceId) {
        // VB-Cable presets: capture the virtual cable's output.
        const cable = inputs.find(d => d.label.toLowerCase().includes('cable output'));
        if (cable) {
          deviceId = cable.deviceId;
          addDebug(`🔌 ${cable.label}`);
        }
      }
      if (deviceId !== ctx.audioDeviceId) setContext(prev => ({ ...prev, audioDeviceId: deviceId }));
    } catch { /* permission denied or no devices: fall through to the default mic */ }
    return deviceId;
  };

  // Bumped by every start and stop: an async start that was overtaken bails out.
  const startTokenRef = useRef(0);

  const startListening = async () => {
    const speech = speechRef.current!;
    if (speech.isActive) return;
    const token = ++startTokenRef.current;
    setSpeechError('');
    if (!speech.isSupported) {
      setSpeechError(uiLang === 'uk' ? 'Цей браузер не підтримує розпізнавання мовлення. Потрібен Chrome або Edge.' : 'This browser has no speech recognition. Use Chrome or Edge.');
      return;
    }
    live.start();
    setAppState(AppState.LISTENING);
    const deviceId = await resolveDeviceId();
    // Stopped (or restarted) while the permission prompt was open.
    if (token !== startTokenRef.current) return;
    await speech.start({ lang: LANG_MAP[contextRef.current.targetLanguage] || 'en-US', deviceId });
    if (token !== startTokenRef.current) speech.stop();
  };

  const stopListening = () => {
    startTokenRef.current++;
    // Session first: it flushes the unfinished phrase before the recognizer clears it.
    live.stop();
    speechRef.current?.stop();
    setAppState(AppState.IDLE);
  };

  const toggleListening = () => {
    if (appState === AppState.IDLE) void startListening(); else stopListening();
  };

  // Follow device / language changes made during a session.
  useEffect(() => { speechRef.current?.setDevice(context.audioDeviceId); }, [context.audioDeviceId]);
  useEffect(() => { speechRef.current?.setLang(LANG_MAP[context.targetLanguage] || 'en-US'); }, [context.targetLanguage]);
  useEffect(() => () => speechRef.current?.stop(), []);

  // Space: "I am speaking" (pause processing). Enter: answer the last remark.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || '').toUpperCase();
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
      if (!hasSessionStarted || isSetupOpen || isBriefingOpen || isClearModalOpen) return;
      if (e.code !== 'Space' && e.code !== 'Enter') return;
      // A focused button would otherwise be "clicked" by Space/Enter — e.g. the
      // microphone button right after starting, which would stop the session.
      if (tag === 'BUTTON') (document.activeElement as HTMLElement).blur();
      if (e.repeat) { e.preventDefault(); return; }
      if (e.code === 'Space') {
        e.preventDefault();
        if (live.state.isListening) live.setPaused(!live.state.isPaused);
      } else if (e.code === 'Enter' && context.viewMode !== 'SIMPLE') {
        e.preventDefault();
        live.answerLast();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasSessionStarted, isSetupOpen, isBriefingOpen, isClearModalOpen, live, context.viewMode]);

  // ---- session export / clear ----------------------------------------------

  const hasContent = live.state.segments.length > 0 || live.state.qa.length > 0;

  const handleSaveSession = () => {
    if (!hasContent) return;
    const time = (ts: number) => new Date(ts).toLocaleTimeString();
    let out = `# Ghost Interviewer — ${new Date().toLocaleString()}\n\nMode: ${context.viewMode} · ${context.targetLanguage} → ${context.nativeLanguage}\n\n## Transcript\n\n`;
    for (const s of live.state.segments) {
      out += `**[${time(s.timestamp)}]** ${s.translation || s.draft || ''}\n> ${s.source}\n\n`;
    }
    if (live.state.qa.length) {
      out += `## Questions and answers\n\n`;
      for (const q of live.state.qa) {
        out += `### [${time(q.timestamp)}] ${q.questionTranslation || q.question}\n> ${q.question}\n\n`;
        if (q.strategy) out += `**Strategy:**\n${q.strategy}\n\n`;
        out += `**Answer:**\n${q.answer}\n\n`;
        if (q.answerTranslation) out += `**Translation:**\n${q.answerTranslation}\n\n`;
        if (q.analysis) out += `**Analysis:**\n${q.analysis}\n\n`;
      }
    }
    const url = URL.createObjectURL(new Blob([out], { type: 'text/markdown' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `interview-session-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleClearSession = (shouldSave: boolean) => {
    if (shouldSave) handleSaveSession();
    live.reset();
    setIsClearModalOpen(false);
  };

  const startSessionWithMode = (mode: ViewMode) => {
    setContext(prev => ({ ...prev, viewMode: mode }));
    setHasSessionStarted(true);
    // Let the mode reach the session hook before the first speech event.
    setTimeout(() => { void startListening(); }, 100);
  };

  const goHome = () => {
    stopListening();
    setHasSessionStarted(false);
  };

  const briefingPanel = (
    <BriefingPanel
      isOpen={isBriefingOpen}
      onClose={() => setIsBriefingOpen(false)}
      context={context}
      docs={docs}
      sourceHash={docsHash}
      briefing={briefing}
      staleBriefing={staleBriefing}
      isSignedIn={googleAuth.isSignedIn}
      uiLang={uiLang}
      onSave={saveBriefing}
      onAuthExpired={googleAuth.markExpired}
    />
  );

  // ---- render --------------------------------------------------------------

  if (!hasSessionStarted) {
    return (
      <>
        <LandingPage
          context={context}
          setContext={setContext}
          uiLang={uiLang}
          t={t}
          isSetupOpen={isSetupOpen}
          setIsSetupOpen={setIsSetupOpen}
          startSessionWithMode={startSessionWithMode}
          listenThroughActive={audioPassthrough.isActive}
          listenThroughError={audioPassthrough.error}
          googleUser={googleAuth.user}
          isAuthLoading={googleAuth.isLoading}
          onSignOut={googleAuth.signOut}
          renderGoogleButton={googleAuth.renderButton}
          isSignedIn={googleAuth.isSignedIn}
          briefingStatus={briefing ? 'ready' : staleBriefing ? 'stale' : 'none'}
          onOpenBriefing={() => setIsBriefingOpen(true)}
        />
        {briefingPanel}
      </>
    );
  }

  const isListening = appState === AppState.LISTENING;
  const presetLabels: Record<string, { icon: string; label: string; source: string }> = {
    'best-available': { icon: '🎤', label: 'Best Mic', source: 'Мікрофон' },
    'default-mic': { icon: '🔇', label: 'System', source: 'Мікрофон' },
    'speakers': { icon: '🔊', label: 'Колонки', source: 'VB-Cable' },
    'headphones-youtube': { icon: '🎧', label: 'Навушники+Відео', source: 'VB-Cable' },
    'monitor-speakers': { icon: '🖥️', label: 'Монітор', source: 'VB-Cable' },
    'headphones-interview': { icon: '🎙️', label: 'Інтерв\'ю', source: 'VB-Cable' },
    'phone-aux': { icon: '📱', label: 'Телефон', source: 'Line In' },
    'manual': { icon: '⚙️', label: 'Ручний', source: 'Ручний' },
  };
  const preset = presetLabels[context.activeAudioPreset] || { icon: '🎤', label: context.activeAudioPreset || 'System', source: 'Мікрофон' };

  return (
    <div className="relative w-screen flex flex-col bg-gray-950" style={{ height: '100dvh' }}>
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

      <SetupPanel isOpen={isSetupOpen} toggleOpen={() => setIsSetupOpen(!isSetupOpen)} context={context} onContextChange={setContext} uiLang={uiLang} />
      {briefingPanel}

      {/* HEADER */}
      <div className="shrink-0 flex justify-between items-center p-2 sm:p-3 gap-2 z-40 bg-gray-900/50 backdrop-blur border-b border-gray-800">
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <button
            onClick={goHome}
            className="p-1.5 sm:p-2 rounded-lg bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition-all border border-gray-700"
            title="Back to mode selection"
          >
            <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
          </button>
          {/* Mode switch: depth of assistance can change mid-session, nothing is lost */}
          <div className="flex rounded-lg border border-gray-700 overflow-hidden text-[10px] sm:text-xs font-black uppercase tracking-widest">
            {(['SIMPLE', 'FOCUS', 'FULL'] as ViewMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => setContext(prev => ({ ...prev, viewMode: mode }))}
                className={`px-2 sm:px-3 py-1.5 transition-colors ${context.viewMode === mode
                  ? mode === 'SIMPLE' ? 'bg-amber-500/20 text-amber-400' : mode === 'FOCUS' ? 'bg-blue-500/20 text-blue-400' : 'bg-emerald-500/20 text-emerald-400'
                  : 'bg-gray-800 text-gray-500 hover:text-gray-300'}`}
              >
                {mode}
              </button>
            ))}
          </div>
          <GearMenu
            context={context}
            onContextChange={setContext}
            uiLang={uiLang}
            onOpenFullSettings={() => setIsSetupOpen(true)}
            listenThroughActive={audioPassthrough.isActive}
          />
          <button
            onClick={() => setIsBriefingOpen(true)}
            className={`hidden sm:block px-3 py-1.5 text-xs font-black rounded-lg border transition-all ${briefing ? 'bg-gray-800 text-emerald-400 border-gray-700 hover:border-emerald-500/50' : 'bg-amber-500/10 text-amber-300 border-amber-500/40 hover:bg-amber-500/20'}`}
            title={uiLang === 'uk' ? 'Брифінг перед співбесідою' : 'Pre-interview briefing'}
          >
            {uiLang === 'uk' ? 'БРИФІНГ' : 'BRIEFING'}{!briefing && ' !'}
          </button>
          <button onClick={() => setUiLang(prev => (prev === 'en' ? 'uk' : 'en'))} className="hidden sm:block px-3 py-1.5 bg-gray-800 text-xs font-black text-emerald-400 rounded-lg border border-gray-700 hover:bg-gray-700 hover:border-emerald-500/50 transition-all">
            {uiLang === 'en' ? 'UA 🇺🇦' : 'EN 🇺🇸'}
          </button>
        </div>

        <div className="flex items-center gap-1 sm:gap-3 shrink-0">
          {googleAuth.isSignedIn && googleAuth.user && (
            <div className="hidden sm:flex items-center gap-1.5 mr-2" title={googleAuth.user.email}>
              {googleAuth.user.picture && <img src={googleAuth.user.picture} alt="" className="w-6 h-6 rounded-full border border-gray-600" />}
              <span className="text-[10px] text-gray-400 max-w-[80px] truncate hidden md:inline">{googleAuth.user.name}</span>
            </div>
          )}
          <div className="flex items-center gap-1 mr-1 sm:mr-2 bg-gray-900/50 rounded-lg border border-gray-800 p-1">
            <button onClick={handleSaveSession} disabled={!hasContent} className="p-1.5 sm:p-2 hover:bg-gray-800 rounded text-gray-400 hover:text-emerald-400 transition-colors disabled:opacity-30" title={t.saveSession}>
              <DownloadIcon className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
            <div className="w-px h-5 sm:h-6 bg-gray-800" />
            <button onClick={() => hasContent && setIsClearModalOpen(true)} disabled={!hasContent} className="p-1.5 sm:p-2 hover:bg-gray-800 rounded text-gray-400 hover:text-red-400 transition-colors disabled:opacity-30" title={t.clearSession}>
              <TrashIcon className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </div>
          {isListening && (
            <button
              onClick={() => live.setPaused(!live.state.isPaused)}
              className={`px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg border text-xs font-bold transition-all ${live.state.isPaused ? 'border-blue-500/60 bg-blue-500/20 text-blue-200' : 'border-gray-700 bg-gray-800 text-gray-300 hover:border-blue-500/40'}`}
              title={uiLang === 'uk' ? 'Пробіл: поки ви говорите, мовлення не обробляється' : 'Space: speech is ignored while you talk'}
            >
              {live.state.isPaused ? (uiLang === 'uk' ? '▶ СЛУХАТИ' : '▶ LISTEN') : (uiLang === 'uk' ? '🗣 Я ГОВОРЮ' : '🗣 I SPEAK')}
              <span className="hidden md:inline ml-1.5 text-[9px] text-gray-500 font-mono">Space</span>
            </button>
          )}
          <button
            onClick={toggleListening}
            title={isListening ? t.paused : t.listening}
            className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center shadow-lg transition-all transform shrink-0 hover:scale-105 text-white ring-2 ${isListening
              ? 'bg-red-500 hover:bg-red-600 shadow-red-900/50 ring-red-500/30'
              : 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-900/50 ring-emerald-500/30'}`}
          >
            {isListening ? <StopIcon className="w-6 h-6" /> : <MicIcon className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Audio status bar */}
      <div className="shrink-0 flex items-center justify-center gap-3 px-4 py-1 bg-gray-950/80 border-b border-gray-800/50 text-xs">
        <span>{preset.icon}</span>
        <span className="text-cyan-400 font-bold">{preset.label}</span>
        <span className="text-gray-600">·</span>
        <span className="text-gray-400">{preset.source}</span>
        <span className="text-gray-600">·</span>
        <span className="text-amber-400 font-bold">{context.targetLanguage} → {context.nativeLanguage}</span>
      </div>

      {speechError && (
        <div className="shrink-0 mx-2 sm:mx-4 mt-2 px-3 py-2 rounded-lg border border-red-500/40 bg-red-500/10 text-red-300 text-sm">
          {uiLang === 'uk' ? 'Розпізнавання мовлення зупинилося' : 'Speech recognition stopped'}: {speechError}
        </div>
      )}

      <div className="flex-1 min-h-0 px-2 sm:px-4 py-2 sm:py-3">
        <LiveView
          mode={context.viewMode}
          state={live.state}
          uiLang={uiLang}
          draftMethod={draftMethod}
          onAnswerLast={live.answerLast}
          signInSlot={!googleAuth.isSignedIn ? <div id="google-signin-live" className="shrink-0" /> : null}
        />
      </div>

      {/* DEBUG OVERLAY: speech recognizer diagnostics, visible with ?debug in the URL */}
      {debugLog.length > 0 && new URLSearchParams(window.location.search).has('debug') && (
        <div id="debug-overlay" className="fixed bottom-0 right-0 z-[9999] bg-black/90 border-t border-l border-yellow-500/50 px-2 py-1 max-h-[100px] w-[400px] overflow-y-auto font-mono text-[8px] leading-tight rounded-tl-lg">
          {debugLog.map((line, i) => (
            <div key={i} className={line.includes('❌') ? 'text-red-400' : line.includes('🐕') ? 'text-yellow-400' : 'text-green-400/70'}>{line}</div>
          ))}
        </div>
      )}
    </div>
  );
};

export default App;
