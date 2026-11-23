
export const translations = {
  en: {
    title: "Ghost Interviewer",
    listening: "LISTENING",
    generating: "GENERATING",
    paused: "PAUSED",
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
      

      // Audio Presets
      presetGroupListen: "LISTEN & TRANSLATE",
      presetGroupInterview: "INTERVIEW MODE",
      presetHeadphonesYoutube: "Headphones + YouTube/Video",
      presetHeadphonesYoutubeDesc: "Sound in headphones, app reads system audio",
      presetSpeakers: "Speakers",
      presetSpeakersDesc: "Sound through speakers, mic picks it up",
      presetMonitor: "Monitor Speakers",
      presetMonitorDesc: "Sound through monitor speakers",
      presetInterview: "Headphones + Teams/Zoom",
      presetInterviewDesc: "Call audio routed to app via VB-Cable",
      presetPhoneAux: "Phone (AUX Cable)",
      presetPhoneAuxDesc: "Phone call audio via AUX cable to Line In",
      presetLineInNeeded: "Connect your phone to the blue Line In jack via AUX cable",
      presetReady: "Ready",
      presetActive: "Active",
      presetDetected: "Detected",
      presetNotAvailable: "Not available",
      presetVBCableNeeded: "Enable Stereo Mix in Windows Sound settings, or install VB-Cable (free): vb-audio.com/Cable/",
      presetVBCableRequired: "Install VB-Cable (free): vb-audio.com/Cable/ → restart PC",
      presetManualDevice: "Manual Device Selection",
      presetShowSetup: "Setup Guide",
      presetHideSetup: "Hide Guide",
      presetSetupHeadphonesYoutube: [
        "① Windows Sound → Output → set to «CABLE Input»",
        "② Sound → Recording → «CABLE Output» → Properties → Listen → ✅ «Listen to this device» → select your Headphones",
        "③ The app auto-selects «CABLE Output» as input",
        "✦ Result: YouTube/video sound goes to the app AND your headphones simultaneously"
      ],
      presetSetupSpeakers: [
        "① Windows Sound → Output → set to «Speakers»",
        "② Place your microphone close to the speakers",
        "③ The app uses your default microphone to pick up speaker audio",
        "⚠ Increase speaker volume if recognition is poor"
      ],
      presetSetupMonitor: [
        "① Windows Sound → Output → set to your monitor (e.g. «PHL 244E5 via HDMI»)",
        "② Place your microphone close to the monitor speakers",
        "③ The app uses your default microphone to pick up monitor audio",
        "⚠ Monitor speakers are usually quiet — sit closer or increase volume"
      ],
      presetSetupInterview: [
        "① In Teams/Zoom → Settings → Speaker → set to «CABLE Input»",
        "② In Teams/Zoom → Settings → Microphone → keep your REAL mic (Webcam / Headset)",
        "③ Sound → Recording → «CABLE Output» → Properties → Listen → ✅ «Listen to this device» → select your Headphones",
        "④ The app auto-selects «CABLE Output» as input",
        "✦ Result: Interviewer's voice goes to the app + your headphones. They hear your real mic."
      ],

      listenThrough: "Listen through",
      listenThroughDesc: "Hear the audio in your headphones/speakers",
      listenThroughNone: "None (use Windows settings)",
      listenThroughActive: "Active",
      listenThroughError: "Audio routing failed",
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
      candidateProfiles: {
          title: "CANDIDATE PROFILE (YOU)",
          subtitle: "Static data - your resume and knowledge",
          select: "Select Candidate...",
          namePlaceholder: "Profile Name (e.g., My Main CV)",
          confirmDelete: "Delete this candidate profile?"
      },
      jobProfiles: {
          title: "JOB PROFILE (VACANCY)",
          subtitle: "Dynamic data - per job application",
          select: "Select Job...",
          namePlaceholder: "Job Name (e.g., Google Java)",
          confirmDelete: "Delete this job profile?"
      },
      applicationLetter: "APPLICATION LETTER (SØKNAD)",
      applicationLetterPlaceholder: "Paste your cover letter / søknad for this position...",
      resume: "RESUME SUMMARY",
      resumePlaceholder: "Paste your key resume points here...",
      jobDesc: "JOB DESCRIPTION",
      jobDescPlaceholder: "Paste the job description here...",
      companyDesc: "COMPANY DESCRIPTION",
      companyDescPlaceholder: "Paste company values, mission, or products...",
      knowledgeBase: "KNOWLEDGE BASE (CONTEXT)",
      knowledgeBasePlaceholder: "Paste FAQ, technical docs, or project history (plain text, max ~20KB recommended)...",
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
      aiInstructions: "PERSONAL INSTRUCTIONS FOR ANSWERS",
      aiInstructionsHint: "Content rules for suggested answers, e.g. \"I built project X alone\". The answer format is fixed by the app.",
      chars: "chars",
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
      // Accordion sections
      accordion: {
          yourProfile: "YOUR PROFILE",
          jobApplication: "JOB APPLICATION",
          audioSetup: "AUDIO SETUP",
          audioAndLanguage: "AUDIO & LANGUAGE",
          advancedAudio: "ADVANCED AUDIO",
          audioSetupGuide: "SETUP GUIDE",
          languageSettings: "LANGUAGE SETTINGS",
          advancedPrompts: "PERSONAL INSTRUCTIONS",
          allSettings: "ALL SETTINGS"
      }
    },
    modes: {
        simple: "SIMPLE (TRANSLATION)",
        simpleDesc: "Live translation only.",
        focus: "FOCUS (ANSWER ONLY)",
        focusDesc: "Translation + a suggested answer to each interviewer question, grounded in your documents.",
        full: "FULL (STRATEGIC)",
        fullDesc: "The same plus a short strategy and an analysis of what the interviewer is really asking."
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
      

      // Audio Presets
      presetGroupListen: "СЛУХАТИ & ПЕРЕКЛАДАТИ",
      presetGroupInterview: "РЕЖИМ ІНТЕРВ'Ю",
      presetHeadphonesYoutube: "Навушники + YouTube/Відео",
      presetHeadphonesYoutubeDesc: "Звук в навушниках, додаток читає системне аудіо",
      presetSpeakers: "Колонки",
      presetSpeakersDesc: "Звук через колонки, мікрофон ловить",
      presetMonitor: "Динаміки монітора",
      presetMonitorDesc: "Звук через вбудовані динаміки монітора",
      presetInterview: "Навушники + Teams/Zoom",
      presetInterviewDesc: "Аудіо дзвінка через VB-Cable в додаток",
      presetPhoneAux: "Телефон (AUX кабель)",
      presetPhoneAuxDesc: "Аудіо дзвінка з телефону через AUX в Line In",
      presetLineInNeeded: "Підключіть телефон до синього роз'єму Line In через AUX кабель",
      presetReady: "Готово",
      presetActive: "Активно",
      presetDetected: "Знайдено",
      presetNotAvailable: "Недоступно",
      presetVBCableNeeded: "Увімкніть Stereo Mix в налаштуваннях звуку Windows, або встановіть VB-Cable (безкоштовно): vb-audio.com/Cable/",
      presetVBCableRequired: "Встановіть VB-Cable (безкоштовно): vb-audio.com/Cable/ → перезавантажте ПК",
      presetManualDevice: "Ручний вибір пристрою",
      presetShowSetup: "Інструкція",
      presetHideSetup: "Сховати",
      presetSetupHeadphonesYoutube: [
        "① Звук Windows → Вивід → обрати «CABLE Input»",
        "② Звук → Запис → «CABLE Output» → Властивості → Прослуховування → ✅ «Прослуховувати цей пристрій» → обрати навушники",
        "③ Додаток автоматично обирає «CABLE Output» як вхід",
        "✦ Результат: Звук YouTube/відео йде в додаток І в навушники одночасно"
      ],
      presetSetupSpeakers: [
        "① Звук Windows → Вивід → обрати «Speakers (колонки)»",
        "② Розмістіть мікрофон ближче до колонок",
        "③ Додаток використовує мікрофон за замовчуванням для захоплення звуку",
        "⚠ Збільшіть гучність колонок якщо розпізнавання слабке"
      ],
      presetSetupMonitor: [
        "① Звук Windows → Вивід → обрати монітор (напр. «PHL 244E5 через HDMI»)",
        "② Розмістіть мікрофон ближче до динаміків монітора",
        "③ Додаток використовує мікрофон за замовчуванням для захоплення звуку",
        "⚠ Динаміки монітора зазвичай тихі — сядьте ближче або збільшіть гучність"
      ],
      presetSetupInterview: [
        "① В Teams/Zoom → Налаштування → Динамік → обрати «CABLE Input»",
        "② В Teams/Zoom → Налаштування → Мікрофон → залишити РЕАЛЬНИЙ мікрофон (Webcam / Гарнітура)",
        "③ Звук → Запис → «CABLE Output» → Властивості → Прослуховування → ✅ «Прослуховувати цей пристрій» → обрати навушники",
        "④ Додаток автоматично обирає «CABLE Output» як вхід",
        "✦ Результат: Голос інтерв'юера йде в додаток + навушники. Вони чують ваш реальний мікрофон."
      ],

      listenThrough: "Слухати через",
      listenThroughDesc: "Чути аудіо у навушниках або колонках",
      listenThroughNone: "Вимкнено (налаштуйте в Windows)",
      listenThroughActive: "Активно",
      listenThroughError: "Помилка маршрутизації",
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
      candidateProfiles: {
          title: "ПРОФІЛЬ КАНДИДАТА (ВИ)",
          subtitle: "Статичні дані - резюме та знання",
          select: "Оберіть кандидата...",
          namePlaceholder: "Назва профілю (напр. Моє основне CV)",
          confirmDelete: "Видалити профіль кандидата?"
      },
      jobProfiles: {
          title: "ПРОФІЛЬ ВАКАНСІЇ",
          subtitle: "Динамічні дані - для кожної заявки",
          select: "Оберіть вакансію...",
          namePlaceholder: "Назва вакансії (напр. Google Java)",
          confirmDelete: "Видалити профіль вакансії?"
      },
      applicationLetter: "СУПРОВІДНИЙ ЛИСТ (SØKNAD)",
      applicationLetterPlaceholder: "Вставте ваш супровідний лист / søknad для цієї позиції...",
      resume: "РЕЗЮМЕ (ОСНОВНЕ)",
      resumePlaceholder: "Вставте ключові пункти вашого резюме...",
      jobDesc: "ОПИС ВАКАНСІЇ",
      jobDescPlaceholder: "Вставте текст вакансії сюди...",
      companyDesc: "ОПИС КОМПАНІЇ",
      companyDescPlaceholder: "Вставте цінності, місію або продукти компанії...",
      knowledgeBase: "БАЗА ЗНАНЬ (КОНТЕКСТ)",
      knowledgeBasePlaceholder: "Вставте FAQ, техдоки або історію проектів (текст, рекомендовано до ~20KB)...",
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
      aiInstructions: "ОСОБИСТІ ІНСТРУКЦІЇ ДЛЯ ВІДПОВІДЕЙ",
      aiInstructionsHint: "Правила змісту підказаних відповідей, напр. «Проєкт X я зробив сам». Формат відповіді задає застосунок.",
      chars: "симв.",
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
      // Accordion sections
      accordion: {
          yourProfile: "ВАШ ПРОФІЛЬ",
          jobApplication: "ЗАЯВКА НА ВАКАНСІЮ",
          audioSetup: "НАЛАШТУВАННЯ АУДІО",
          audioAndLanguage: "АУДІО ТА МОВА",
          advancedAudio: "РОЗШИРЕНЕ АУДІО",
          audioSetupGuide: "ІНСТРУКЦІЯ",
          languageSettings: "НАЛАШТУВАННЯ МОВИ",
          advancedPrompts: "ОСОБИСТІ ІНСТРУКЦІЇ",
          allSettings: "УСІ НАЛАШТУВАННЯ"
      }
    },
    modes: {
        simple: "ПРОСТИЙ (ПЕРЕКЛАД)",
        simpleDesc: "Лише живий переклад.",
        focus: "ФОКУС (ВІДПОВІДЬ)",
        focusDesc: "Переклад + підказка відповіді на кожне питання інтерв'юера, на основі ваших документів.",
        full: "ПОВНИЙ (СТРАТЕГІЧНИЙ)",
        fullDesc: "Те саме + коротка стратегія та аналіз того, що насправді питає інтерв'юер."
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
