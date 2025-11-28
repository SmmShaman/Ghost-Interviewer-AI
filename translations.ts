
export const translations = {
  en: {
    title: "Ghost Interviewer",
    listening: "LISTENING",
    generating: "GENERATING",
    paused: "PAUSED",
    stealthOn: "STEALTH ON",
    stealthOff: "STEALTH OFF",
    saveSession: "SAVE SESSION",
    clearSession: "CLEAR",
    readyMessage: "Ready. Press Microphone or Spacebar to start.",
    selectMode: "SELECT MODE TO START",
    pressMic: "Press Microphone or Spacebar to begin.",
    modeChangeWarning: "Changing view mode requires clearing the session. Save first?",
    interviewerLabel: "INTERVIEWER",
    suggestedAnswer: "SUGGESTED ANSWER",
    placeholderInput: "Or type what the interviewer asked...",
    candidateSpeaking: "CANDIDATE SPEAKING (TRANSCRIBING...)",
    modelDownload: "DOWNLOADING AI MODEL (INITIAL SETUP)...",
    modelReady: "AI MODEL READY",
    settings: {
      audioGuideTitle: "🎧 SPLIT AUDIO SETUP (CRITICAL)",
      audioGoal: "Goal: Teams hears YOU. App hears THEM.",
      step1: "Install VB-Audio Cable (Free & Restart).",
      step2: "Teams Speaker: Set to \"CABLE Input\".",
      step2Warning: "⚠️ App will hear the Interviewer.",
      step3Title: "MONITORING (So you hear them):",
      step3Body: "Windows Sound → Recording → CABLE Output → Properties → Listen tab → ✅ Check \"Listen to this device\". Output: Your Headphones.",
      step3Playback: "",
      step4: "Teams Mic: Set to your REAL Microphone (e.g., Headset).",
      step5: "App Mic (Below): Set to \"CABLE Output\".",
      youtubeTestTitle: "📺 HOW TO TEST WITH YOUTUBE?",
      youtubeTestBody: "YouTube plays to Default Speakers, not Cable. To test: Click Windows Volume -> Select 'CABLE Input'. Don't forget to switch back for the interview!",
      
      voiceMeeterTitle: "🍌 VOICEMEETER STEREO SPLIT (PRO)",
      voiceMeeterBody: "Separate channels to detect WHO is speaking automatically.",
      vmStep1: "Install VoiceMeeter Banana.",
      vmStep2: "Input 1 (Your Mic): Pan fully LEFT (A1).",
      vmStep3: "Input 2 (VB-Cable/Teams): Pan fully RIGHT (A1).",
      vmStep4: "App Mic: Select 'VoiceMeeter Output'.",
      stereoMode: "STEREO SEPARATION MODE",

      inputSource: "APP INPUT SOURCE",
      defaultMic: "Default Microphone",
      testMic: "Test Input",
      stopTest: "Stop",
      profiles: {
          title: "INTERVIEW PROFILES (DATA SETS)",
          select: "Select a Profile...",
          new: "New",
          save: "Save",
          delete: "Delete",
          namePlaceholder: "Profile Name (e.g., Google Java)",
          confirmDelete: "Delete this profile?"
      },
      resume: "RESUME SUMMARY",
      resumePlaceholder: "Paste your key resume points here...",
      jobDesc: "JOB DESCRIPTION",
      jobDescPlaceholder: "Paste the job description here...",
      companyDesc: "COMPANY DESCRIPTION",
      companyDescPlaceholder: "Paste company values, mission, or products...",
      knowledgeBase: "KNOWLEDGE BASE (RAW DATA)",
      knowledgeBasePlaceholder: "Paste FAQ, technical docs, or project history here...",
      uploadFile: "Upload File (.txt, .md, .json)",
      clearFile: "Clear",
      latency: {
        label: "Latency Impact:",
        low: "⚡ LOW (Fast)",
        med: "⚠️ MED (2-4s)",
        high: "🛑 HIGH (Too Slow)"
      },
      targetLang: "TARGET LANG (INTERVIEW)",
      nativeLang: "NATIVE LANG (FOR YOU)",
      aiInstructions: "AI INSTRUCTIONS (PROMPT MANAGER)",
      editLogic: "Edit logic manually",
      prompts: {
          select: "Select a Preset...",
          new: "New",
          save: "Save",
          delete: "Delete",
          namePlaceholder: "Prompt Name",
          confirmDelete: "Delete this preset?"
      },
      viewMode: {
          label: "DISPLAY MODE",
          full: "FULL (3 Cols)",
          focus: "FOCUS (No Strategy)",
          simple: "SIMPLE (Translation Only)"
      },
      ghostModel: {
          label: "LOCAL MODEL (GHOST - STREAM 1)",
          opus: "Fast (Opus - 56MB)",
          nllb: "High Quality (NLLB - 600MB)",
          switching: "Switching models..."
      },
      llmModel: {
          label: "SMART ANALYSIS MODEL (STREAM 2)",
          azure: "Azure OpenAI (Enterprise)",
          groq: "Groq (Llama 3 - Fast)",
          apiKeyLabel: "Groq API Key"
      }
    },
    modes: {
        simple: "SIMPLE (TRANSLATION)",
        simpleDesc: "Two columns. Original text + Parallel High-Quality Translation. No AI Strategy.",
        focus: "FOCUS (ANSWER ONLY)",
        focusDesc: "Input + AI Suggested Answer. Hides the Strategy/Analysis column for cleaner view.",
        full: "FULL (STRATEGIC)",
        fullDesc: "Complete 3-column view: Input + Strategy/Analysis + Suggested Answer."
    },
    card: {
      strategy: "Strategy",
      translation: "Translation (Native)",
      latency: "ms",
      copied: "COPIED",
      copy: "COPY"
    },
    defaultPrompt: `You are an elite interview assistant (Ghost Interviewer).
Your goal is to help the candidate pass the interview by bridging their resume to the job description.

CRITICAL CONTEXT:
1. The candidate developed the project 'Elvarika' entirely ALONE (Solo Developer).
2. They utilized LLM AI models as their only assistance. Do not imply there was a team.
3. The candidate speaks at a B1 proficiency level.

INPUT HANDLING RULES:
- If the input is a QUESTION: Provide a strategic answer using the format below.
- If the input is GENERAL TALK/CONTEXT/STORY: Do NOT refuse to answer. Instead:
  1. [INPUT_TRANSLATION]: Translate their story.
  2. [ANALYSIS]: Summarize what they said.
  3. [STRATEGY]: "Listen and acknowledge."
  4. [ANSWER]: Provide a short, polite acknowledgement.

STRUCTURED OUTPUT FORMAT:
You MUST use these specific tags in this order.

1. [INPUT_TRANSLATION]
   - Translate the *Input Question* into Native Language (High Quality).
   - This corrects any potential speech-to-text errors.

2. [ANALYSIS]
   - Explain the intent of the question briefly.
   - (Write this section in Native Language)

3. [STRATEGY]
   - Provide 2-3 bullet points on how to tackle this.
   - Suggest specific projects or values to mention.
   - (Write this section in Native Language)

4. [TRANSLATION]
   - Translate the *suggested answer* (Step 5) into the Native Language.
   - (Write this section in Native Language)

5. [ANSWER]
   - The final spoken response script.
   - USE SIMPLE, SHORT, CLEAR SENTENCES (B1 Level).
   - Avoid complex structures. Use Subject-Verb-Object.
   - (Write this section in Target Language)

Example:
[INPUT_TRANSLATION] Як ви вирішуєте конфлікти на роботі? [ANALYSIS] Питають про конфлікти, перевіряють софт-скіли... [STRATEGY] * Згадати код-рев'ю... * Фокус на результаті... [TRANSLATION] Я зазвичай вирішую конфлікти через діалог... [ANSWER] Jeg pleier å løse konflikter ved å snakke sammen.`,
    modal: {
        title: "Clear Session?",
        subtitle: "You will lose all chat history.",
        saveAndClear: "Save & Clear",
        clearOnly: "Clear Without Saving",
        cancel: "Cancel"
    }
  },
  uk: {
    title: "Ghost Interviewer",
    listening: "СЛУХАЮ",
    generating: "ГЕНЕРУЮ",
    paused: "ПАУЗА",
    stealthOn: "СТЕЛС ВКЛ",
    stealthOff: "СТЕЛС ВИКЛ",
    saveSession: "ЗБЕРЕГТИ",
    clearSession: "ОЧИСТИТИ",
    readyMessage: "Готово. Натисніть мікрофон або Пробіл.",
    selectMode: "ОБЕРІТЬ РЕЖИМ",
    pressMic: "Натисніть мікрофон або пробіл для старту.",
    modeChangeWarning: "Зміна режиму вимагає очищення сесії. Зберегти?",
    interviewerLabel: "ІНТЕРВ'ЮЕР",
    suggestedAnswer: "РЕКОМЕНДОВАНА ВІДПОВІДЬ",
    placeholderInput: "Або введіть питання вручну...",
    candidateSpeaking: "ГОВОРИТЬ КАНДИДАТ (ЗАПИС...)",
    modelDownload: "ЗАВАНТАЖЕННЯ ШІ МОДЕЛІ (ПЕРШИЙ ЗАПУСК)...",
    modelReady: "ШІ МОДЕЛЬ ГОТОВА",
    settings: {
      audioGuideTitle: "🎧 РОЗДІЛЕННЯ ЗВУКУ (ВАЖЛИВО)",
      audioGoal: "Мета: Teams чує ВАС. Додаток чує ЇХ.",
      step1: "Встановіть VB-Audio Cable (Безкоштовно + Рестарт).",
      step2: "Динамік Teams: Оберіть \"CABLE Input\".",
      step2Warning: "⚠️ Додаток буде чути інтерв'юера.",
      step3Title: "МОНІТОРИНГ (Щоб ви чули):",
      step3Body: "Звук Windows → Запис → CABLE Output → Властивості → Прослуховування → ✅ \"Прослуховувати цей пристрій\". Відтворення: Ваші навушники.",
      step3Playback: "",
      step4: "Мікрофон Teams: Ваш РЕАЛЬНИЙ мікрофон (Гарнітура).",
      step5: "Мікрофон Додатку (Внизу): Оберіть \"CABLE Output\".",
      youtubeTestTitle: "📺 ЯК ПРОТЕСТУВАТИ НА YOUTUBE?",
      youtubeTestBody: "YouTube грає в Динаміки, а не в Кабель. Для тесту: Гучність Windows -> Оберіть 'CABLE Input'. Поверніть назад перед інтерв'ю!",
      
      voiceMeeterTitle: "🍌 VOICEMEETER СТЕРЕО СПЛІТ (PRO)",
      voiceMeeterBody: "Розділення каналів для авто-визначення хто говорить.",
      vmStep1: "Встановіть VoiceMeeter Banana.",
      vmStep2: "Вхід 1 (Ваш мікрофон): Панорама вліво (LEFT) на A1.",
      vmStep3: "Вхід 2 (VB-Cable/Teams): Панорама вправо (RIGHT) на A1.",
      vmStep4: "Мікрофон Додатку: Оберіть 'VoiceMeeter Output'.",
      stereoMode: "РЕЖИМ СТЕРЕО РОЗДІЛЕННЯ",

      inputSource: "ВХІД ДОДАТКУ",
      defaultMic: "Мікрофон за замовчуванням",
      testMic: "Тест входу",
      stopTest: "Стоп",
      profiles: {
          title: "ПРОФІЛІ ІНТЕРВ'Ю (НАБОРИ ДАНИХ)",
          select: "Оберіть профіль...",
          new: "Новий",
          save: "Зберегти",
          delete: "Видалити",
          namePlaceholder: "Назва профілю (напр. Google Java)",
          confirmDelete: "Видалити цей профіль?"
      },
      resume: "РЕЗЮМЕ (ОСНОВНЕ)",
      resumePlaceholder: "Вставте ключові пункти вашого резюме...",
      jobDesc: "ОПИС ВАКАНСІЇ",
      jobDescPlaceholder: "Вставте текст вакансії сюди...",
      companyDesc: "ОПИС КОМПАНІЇ",
      companyDescPlaceholder: "Вставте цінності, місію або продукти компанії...",
      knowledgeBase: "БАЗА ЗНАНЬ (RAW DATA)",
      knowledgeBasePlaceholder: "Вставте FAQ, технічну документацію або історію проектів...",
      uploadFile: "Завантажити файл (.txt, .md, .json)",
      clearFile: "Очистити",
      latency: {
        label: "Вплив на швидкість:",
        low: "⚡ НИЗЬКИЙ (Миттєво)",
        med: "⚠️ СЕРЕДНІЙ (2-4s)",
        high: "🛑 ВИСОКИЙ (Дуже повільно)"
      },
      targetLang: "МОВА ІНТЕРВ'Ю",
      nativeLang: "РІДНА МОВА (ПЕРЕКЛАД)",
      aiInstructions: "ІНСТРУКЦІЯ ДЛЯ ШІ (МЕНЕДЖЕР ПРОМПТІВ)",
      editLogic: "Редагувати логіку",
      prompts: {
          select: "Оберіть пресет...",
          new: "Новий",
          save: "Зберегти",
          delete: "Видалити",
          namePlaceholder: "Назва промпту",
          confirmDelete: "Видалити цей пресет?"
      },
      viewMode: {
          label: "РЕЖИМ ВІДОБРАЖЕННЯ",
          full: "ПОВНИЙ (3 Колонки)",
          focus: "ФОКУС (Без Стратегії)",
          simple: "ПРОСТИЙ (Лише Переклад)"
      },
      ghostModel: {
          label: "ЛОКАЛЬНА МОДЕЛЬ (GHOST - STREAM 1)",
          opus: "Швидка (Opus - 56MB)",
          nllb: "Висока Якість (NLLB - 600MB)",
          switching: "Зміна моделі..."
      },
      llmModel: {
          label: "РОЗУМНИЙ АНАЛІЗ (STREAM 2)",
          azure: "Azure OpenAI (Enterprise)",
          groq: "Groq (Llama 3 - Швидко)",
          apiKeyLabel: "Ключ Groq API"
      }
    },
    modes: {
        simple: "ПРОСТИЙ (ПЕРЕКЛАД)",
        simpleDesc: "Дві колонки. Оригінал + Паралельний Якісний Переклад. Без Стратегії.",
        focus: "ФОКУС (ВІДПОВІДЬ)",
        focusDesc: "Вхід + Рекомендована відповідь. Приховує колонку стратегії для чистоти екрану.",
        full: "ПОВНИЙ (СТРАТЕГІЧНИЙ)",
        fullDesc: "Повний вид з 3 колонок: Вхід + Стратегія/Аналіз + Рекомендована Відповідь."
    },
    card: {
      strategy: "Стратегія",
      translation: "Переклад (Укр)",
      latency: "мс",
      copied: "СКОПІЙОВАНО",
      copy: "КОПІЯ"
    },
    defaultPrompt: `Ти елітний асистент для проходження співбесід (Ghost Interviewer).
Твоя мета: допомогти кандидату пройти інтерв'ю, поєднуючи його резюме з вимогами вакансії.

КРИТИЧНО ВАЖЛИВИЙ КОНТЕКСТ:
1. Кандидат розробив проект 'Elvarika' ПОВНІСТЮ САМОСТІЙНО (Solo Developer).
2. Кандидат використовував LLM (ШІ) як єдиного помічника. Не згадуй про роботу в команді.
3. Рівень володіння мовою - B1 (Середній).

ПРАВИЛА ОБРОБКИ ВХІДНИХ ДАНИХ:
- Якщо це ПИТАННЯ: Дай стратегічну відповідь за структурою нижче.
- Якщо це ЗАГАЛЬНА РОЗМОВА / КОНТЕКСТ / ІСТОРІЯ: НЕ відмовляйся відповідати. Натомість:
  1. [INPUT_TRANSLATION]: Переклади почуте.
  2. [ANALYSIS]: Стисло підсумуй, про що говорив інтерв'юер.
  3. [STRATEGY]: "Уважно слухати та підтвердити розуміння".
  4. [ANSWER]: Напиши коротку, ввічливу фразу підтвердження.

СТРУКТУРА ВІДПОВІДІ (ОБОВ'ЯЗКОВО):
Використовуй ці теги для розділення думок.

1. [INPUT_TRANSLATION]
   - Переклади *Вхідне Питання* на Рідну Мову (Якісно).
   - Це має виправити можливі помилки розпізнавання мови.

2. [ANALYSIS]
   - Стисло поясни суть питання та прихований підтекст.
   - (Пиши цю секцію Рідною Мовою)

3. [STRATEGY]
   - 2-3 пункти плану відповіді.
   - Який саме досвід згадати (проект, навичку).
   - (Пиши цю секцію Рідною Мовою)

4. [TRANSLATION]
   - Переклад запропонованої відповіді (блок 5) на Рідну мову.
   - (Пиши цю секцію Рідною Мовою)

5. [ANSWER]
   - Готовий скрипт відповіді.
   - ВИКОРИСТОВУЙ ПРОСТІ, КОРОТКІ РЕЧЕННЯ (Рівень B1).
   - Уникай складних граматичних конструкцій. Чітко і ясно.
   - (Пиши цю секцію Мовою Інтерв'ю)

Приклад:
[INPUT_TRANSLATION] Як ви вирішуєте конфлікти на роботі? [ANALYSIS] Питають про конфлікти... [STRATEGY] * Згадати код-рев'ю... [TRANSLATION] Я зазвичай вирішую конфлікти через діалог... [ANSWER] Jeg pleier å løse konflikter ved å snakke sammen.`,
    modal: {
        title: "Очистити сесію?",
        subtitle: "Вся історія чату буде втрачена.",
        saveAndClear: "Зберегти та Очистити",
        clearOnly: "Очистити без збереження",
        cancel: "Скасувати"
    }
  }
};
