

import { GoogleGenAI } from "@google/genai";
import { InterviewContext } from "../types";
import { knowledgeSearch } from "./knowledgeSearch";

// Gemini Configuration (from .env via Vite)
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";
const GEMINI_MODEL = import.meta.env.VITE_GEMINI_MODEL || "gemini-2.5-flash";
const GEMINI_MODEL_LITE = "gemini-2.5-flash-lite";

// Initialize Google GenAI SDK
const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

function constructPrompt(currentInput: string, historyText: string, context: InterviewContext, safeInstruction: string): string {
    const isSimpleMode = context.viewMode === 'SIMPLE';
    const isFocusMode = context.viewMode === 'FOCUS';
    const isFullMode = context.viewMode === 'FULL';

    console.log(`📋 [constructPrompt] viewMode="${context.viewMode}" | isSimple=${isSimpleMode} | isFocus=${isFocusMode} | isFull=${isFullMode}`);

    // Get mode-specific prompts from context
    const modeConfig = context.modeConfig;
    const simpleConfig = modeConfig?.simple;
    const focusConfig = modeConfig?.focus;
    const fullConfig = modeConfig?.full;

    // ========== SIMPLE MODE: Translation only with clear format ==========
    if (isSimpleMode) {
        // Use custom translation prompt if provided
        const customTranslationHint = simpleConfig?.translationPrompt
            ? `\n\nДОДАТКОВІ ВКАЗІВКИ:\n${simpleConfig.translationPrompt}`
            : '';

        return `Ти професійний перекладач живої мови з ${context.targetLanguage} на ${context.nativeLanguage}.

КОНТЕКСТ РОБОТИ:
Текст надходитиме уривками по 20–25 слів мовою ${context.targetLanguage}, і фрагмент може бути неповним. Твоє завдання — негайно робити переклад цього уривка мовою ${context.nativeLanguage} так, щоб ${context.nativeLanguage}-мовному читачеві сенс був максимально зрозумілий і звучав природно.

ПРАВИЛА ПЕРЕКЛАДУ:
- Не роби буквального перекладу окремих слів мовою ${context.targetLanguage}, якщо в ${context.nativeLanguage} мові вони дають кострубате або дивне звучання
- Передавай сенс фрази, а не форму
- Перекладай так, як перекладає професійний перекладач художньої та живої мови:
  • згладжуй обірваність фрагмента
  • не додавай вигадок
  • але замінюй неприродні конструкції на природні ${context.nativeLanguage}-мовні відповідники
  • передавай інтонацію і прагматику фрази${customTranslationHint}

ФОРМАТ ВІДПОВІДІ (ОБОВ'ЯЗКОВО):
Кожного разу пиши ТІЛЬКИ сенсовий, природний переклад мовою ${context.nativeLanguage} уривка в такому форматі:
[INPUT_TRANSLATION]твій переклад тут[/INPUT_TRANSLATION]

ВАЖЛИВО:
- НЕ пиши нічого крім перекладу в тегах
- НЕ додавай пояснень
- НЕ коментуй переклад

ПРИКЛАД:
Текст (${context.targetLanguage}): "Hva slags kroppsspråk er viktig på intervju ikke sant"
Твоя відповідь: [INPUT_TRANSLATION]Яка мова тіла важлива на співбесіді, правда ж[/INPUT_TRANSLATION]

УРИВОК ДЛЯ ПЕРЕКЛАДУ:
"${currentInput}"`;
    }

    // ========== FOCUS/FULL MODE: Full context with Resume, Job, Company, KB ==========
    // Use TF-IDF search to get relevant context from knowledge base
    // Reduced to 1500 chars to stay within Groq's 12k token limit
    const relevantKnowledge = knowledgeSearch.getRelevantContext(currentInput, 1500);

    // Get mode-specific prompt hints
    const currentConfig = isFocusMode ? focusConfig : fullConfig;
    const translationHint = currentConfig?.translationPrompt || '';
    const analysisHint = (currentConfig as any)?.analysisPrompt || '';
    const answerHint = currentConfig?.answerPrompt || '';
    const strategyLevel = (fullConfig as any)?.strategyDetailLevel || 'detailed';

    // Build mode-specific processing guidelines
    let modeSpecificGuidelines = '';
    if (translationHint) {
        modeSpecificGuidelines += `\n[ДОДАТКОВІ ВКАЗІВКИ ДО ПЕРЕКЛАДУ]\n${translationHint}\n`;
    }
    if (isFullMode && analysisHint) {
        modeSpecificGuidelines += `\n[ДОДАТКОВІ ВКАЗІВКИ ДО АНАЛІЗУ]\n${analysisHint}\n`;
    }
    if (answerHint) {
        modeSpecificGuidelines += `\n[ДОДАТКОВІ ВКАЗІВКИ ДО ВІДПОВІДІ]\n${answerHint}\n`;
    }
    if (isFullMode) {
        modeSpecificGuidelines += `\n[РІВЕНЬ ДЕТАЛІЗАЦІЇ СТРАТЕГІЇ]: ${strategyLevel}\n`;
    }

    // ========== FOCUS MODE: Question detection + Answer from 5 sources ==========
    if (isFocusMode) {
        return `Ти асистент для проходження співбесід. Твоя задача — допомогти кандидату відповісти на питання інтерв'юера.

═══════════════════════════════════════════════════════════════
📋 ДЖЕРЕЛА ЗНАНЬ ПРО КАНДИДАТА (3 джерела):
═══════════════════════════════════════════════════════════════
1. РЕЗЮМЕ КАНДИДАТА:
"${context.resume?.slice(0, 1500) || '[не вказано]'}"

2. БАЗА ЗНАНЬ (технічні деталі, проекти, досвід):
"${relevantKnowledge || '[немає релевантного контексту]'}"

3. СУПРОВІДНИЙ ЛИСТ / SØKNAD:
"${context.applicationLetter?.slice(0, 800) || '[не вказано]'}"

═══════════════════════════════════════════════════════════════
📋 ДЖЕРЕЛА ЗНАНЬ ПРО РОБОТОДАВЦЯ (2 джерела):
═══════════════════════════════════════════════════════════════
4. ОПИС КОМПАНІЇ:
"${context.companyDescription?.slice(0, 800) || '[не вказано]'}"

5. ОПИС ВАКАНСІЇ:
"${context.jobDescription?.slice(0, 1000) || '[не вказано]'}"
${modeSpecificGuidelines}
═══════════════════════════════════════════════════════════════
🎤 ТЕКСТ ІНТЕРВ'ЮЕРА (${context.targetLanguage}):
═══════════════════════════════════════════════════════════════
"${currentInput}"

═══════════════════════════════════════════════════════════════
📝 ТВОЯ ЗАДАЧА:
═══════════════════════════════════════════════════════════════
1. ПРОАНАЛІЗУЙ текст інтерв'юера:
   - Якщо це ПИТАННЯ → сформулюй професійну відповідь на основі 5 джерел знань
   - Якщо це НЕ питання (розповідь про компанію, погоду, small talk) → зроби коротке резюме сказаного

2. ВІДПОВІДЬ формуй:
   - Широко, професійно, з акцентом на досягнення кандидата
   - ТІЛЬКИ на основі даних з 5 джерел — НЕ вигадуй факти!
   - Поєднуй релевантний досвід кандидата з вимогами вакансії

═══════════════════════════════════════════════════════════════
📤 ФОРМАТ ВІДПОВІДІ (використовуй ТОЧНО ці теги):
═══════════════════════════════════════════════════════════════
[INPUT_TRANSLATION]
Переклад/резюме тексту інтерв'юера на ${context.nativeLanguage}
[/INPUT_TRANSLATION]

[TRANSLATION]
Рекомендована відповідь на ${context.nativeLanguage}
(або коротке резюме якщо це не питання)
[/TRANSLATION]

[ANSWER]
Рекомендована відповідь на ${context.targetLanguage}
(або коротке резюме якщо це не питання)
[/ANSWER]

ВАЖЛИВО: Кожен тег на окремому рядку. Відповідай ТІЛЬКИ в цьому форматі.`;
    }

    // ========== FULL MODE: Same as FOCUS + Strategy column ==========
    return `Ти асистент для проходження співбесід. Твоя задача — допомогти кандидату відповісти на питання інтерв'юера з детальним аналізом та стратегією.

═══════════════════════════════════════════════════════════════
📋 ДЖЕРЕЛА ЗНАНЬ ПРО КАНДИДАТА (3 джерела):
═══════════════════════════════════════════════════════════════
1. РЕЗЮМЕ КАНДИДАТА:
"${context.resume?.slice(0, 2000) || '[не вказано]'}"

2. БАЗА ЗНАНЬ (технічні деталі, проекти, досвід):
"${relevantKnowledge || '[немає релевантного контексту]'}"

3. СУПРОВІДНИЙ ЛИСТ / SØKNAD:
"${context.applicationLetter?.slice(0, 1000) || '[не вказано]'}"

═══════════════════════════════════════════════════════════════
📋 ДЖЕРЕЛА ЗНАНЬ ПРО РОБОТОДАВЦЯ (2 джерела):
═══════════════════════════════════════════════════════════════
4. ОПИС КОМПАНІЇ:
"${context.companyDescription?.slice(0, 1000) || '[не вказано]'}"

5. ОПИС ВАКАНСІЇ:
"${context.jobDescription?.slice(0, 1500) || '[не вказано]'}"
${modeSpecificGuidelines}
═══════════════════════════════════════════════════════════════
🎤 ТЕКСТ ІНТЕРВ'ЮЕРА (${context.targetLanguage}):
═══════════════════════════════════════════════════════════════
"${currentInput}"

═══════════════════════════════════════════════════════════════
📝 ТВОЯ ЗАДАЧА:
═══════════════════════════════════════════════════════════════
1. ПРОАНАЛІЗУЙ текст інтерв'юера:
   - Якщо це ПИТАННЯ → визнач що хоче дізнатися інтерв'юер
   - Якщо це НЕ питання (розповідь про компанію, погоду, small talk) → зроби коротке резюме

2. СФОРМУЙ СТРАТЕГІЮ відповіді:
   - Які ключові пункти згадати?
   - Який досвід кандидата найбільш релевантний?
   - Як поєднати з вимогами вакансії?

3. ВІДПОВІДЬ формуй:
   - Широко, професійно, з акцентом на досягнення
   - ТІЛЬКИ на основі даних з 5 джерел — НЕ вигадуй факти!

═══════════════════════════════════════════════════════════════
📤 ФОРМАТ ВІДПОВІДІ (використовуй ТОЧНО ці теги):
═══════════════════════════════════════════════════════════════
[INPUT_TRANSLATION]
Переклад/резюме тексту інтерв'юера на ${context.nativeLanguage}
[/INPUT_TRANSLATION]

[ANALYSIS]
Аналіз: Що хоче дізнатися інтерв'юер? Яка мета цього питання?
(або "Це не питання, а інформація про..." якщо не питання)
[/ANALYSIS]

[STRATEGY]
Стратегія відповіді:
• Ключові пункти для згадування
• Релевантний досвід з резюме/бази знань
• Як це відповідає вимогам вакансії
[/STRATEGY]

[TRANSLATION]
Рекомендована відповідь на ${context.nativeLanguage}
[/TRANSLATION]

[ANSWER]
Рекомендована відповідь на ${context.targetLanguage}
[/ANSWER]

ВАЖЛИВО: Кожен тег на окремому рядку. Відповідай ТІЛЬКИ в цьому форматі.`;
}

// GEMINI IMPLEMENTATION using @google/genai SDK
async function generateViaGemini(prompt: string, onUpdate: (data: any) => void, signal?: AbortSignal) {
    if (!GEMINI_API_KEY || !ai) {
        throw new Error("Gemini API Key is missing. Set VITE_GEMINI_API_KEY in .env");
    }

    if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
    }

    let fullText = "";
    let lastUpdate = 0;
    const UPDATE_INTERVAL = 100; // ms - batch UI updates

    try {
        const response = await ai.models.generateContentStream({
            model: GEMINI_MODEL,
            contents: prompt,
            config: {
                temperature: 0.6,
                maxOutputTokens: 4096,
            }
        });

        for await (const chunk of response) {
            if (signal?.aborted) {
                throw new DOMException('Aborted', 'AbortError');
            }

            const content = chunk.text || "";
            if (content) {
                fullText += content;

                const now = Date.now();
                if (now - lastUpdate >= UPDATE_INTERVAL) {
                    parseAndEmit(fullText, onUpdate);
                    onUpdate({ _rawChunk: content, _fullRawText: fullText });
                    lastUpdate = now;
                }
            }
        }

        // Final update: ensure all content is emitted
        parseAndEmit(fullText, onUpdate);
        onUpdate({ _rawChunk: '', _fullRawText: fullText });
    } catch (error: any) {
        if (error.name === 'AbortError' || signal?.aborted) {
            throw new DOMException('Aborted', 'AbortError');
        }
        throw error;
    }
}

export const generateInterviewAssist = async (
  currentInput: string,
  historyBuffer: string[],
  context: InterviewContext,
  onUpdate: (data: { answer: string; analysis: string; strategy: string; answerTranslation: string; inputTranslation: string; rationale: string }) => void,
  signal?: AbortSignal // Optional abort signal for cancellation
): Promise<void> => {
  try {
    const historyText = historyBuffer.join(" ");
    const combinedPrompt = constructPrompt(currentInput, historyText, context, context.systemInstruction);

    await generateViaGemini(combinedPrompt, onUpdate, signal);

  } catch (error: any) {
    // Don't log abort errors as they are expected
    if (error.name === 'AbortError') {
        throw error; // Re-throw to be handled by caller
    }
    console.error("LLM Service Error:", error);
    onUpdate({
        answer: "Error connecting to AI.",
        analysis: "Service Error",
        strategy: "Connection Failed",
        answerTranslation: "",
        inputTranslation: "",
        rationale: error.message || "Unknown Error"
    });
  }
};

// ========== TOPIC STRUCTURING (Flash-Lite) ==========

const TOPIC_SYSTEM_PROMPT = `Ти структурувальник мовлення. Отримуєш норвезький текст (транскрибація) і поточний список тем.

ПРАВИЛА:
- Визнач теми/думки. Для кожної: 📌 заголовок + суть 1-2 реченнями УКРАЇНСЬКОЮ
- Нова інформація доповнює існуючу тему або створює нову
- Максимум 7 тем
- Пиши прямою мовою: "Додай теорію", "Роби відступи", "Використовуй заголовки"
- НЕ пиши пасивно: "Пропонується додати...", "Рекомендується...", "Починається з..."
- НЕ пиши "Спікер каже...", "Далі йде..." — текст може бути з середини
- НЕ додавай вступів чи висновків
- Відповідай ТІЛЬКИ списком тем

ФОРМАТ:
📌 **Заголовок**
Суть прямою мовою.

📌 **Заголовок**
Суть прямою мовою.`;

/**
 * Generate structured topic summary from Norwegian speech transcript.
 * Uses Flash-Lite (fast, cheap) with thinking disabled.
 */
export async function generateTopicSummary(
    norwegianText: string,
    existingTopics: string,
    signal?: AbortSignal
): Promise<string> {
    if (!ai || !norwegianText.trim()) return existingTopics || '';

    try {
        const userPrompt = existingTopics
            ? `ПОТОЧНІ ТЕМИ:\n${existingTopics}\n\nНОВИЙ ТЕКСТ (норвезька):\n${norwegianText}\n\nОновлений список тем:`
            : `ТЕКСТ (норвезька):\n${norwegianText}\n\nСтруктурований список тем:`;

        const response = await ai.models.generateContent({
            model: GEMINI_MODEL_LITE,
            contents: userPrompt,
            config: {
                systemInstruction: TOPIC_SYSTEM_PROMPT,
                thinkingConfig: { thinkingBudget: 0 },
                temperature: 0.1,
                maxOutputTokens: 300,
            }
        });

        if (signal?.aborted) return existingTopics || '';

        const text = response?.text?.trim();
        return text || existingTopics || '';
    } catch (e: any) {
        if (e.name !== 'AbortError') {
            console.error('[TopicSummary] Error:', e?.message || e);
        }
        return existingTopics || '';
    }
}

// ========== INTERVIEW CONVERSATION ANALYZER (Flash-Lite) ==========

const INTERVIEW_ANALYZER_PROMPT = `Ти асистент на співбесіді. Аналізуєш норвезьке мовлення інтерв'юера і ведеш хронологію розмови УКРАЇНСЬКОЮ.

ДВА ТИПИ ЗАПИСІВ:

1. 📌 ІНФО — коли інтерв'юер розповідає (про компанію, умови, проект):
📌 **Заголовок**
Короткий зміст 1-2 реченнями.

2. ❓ ПИТАННЯ — коли інтерв'юер ставить питання кандидату:
❓ **Питання кандидату**
Точне формулювання питання українською.

ПРАВИЛА:
- Пиши ТІЛЬКИ записи (📌 або ❓), нічого іншого
- Нові записи ДОДАВАЙ в кінець, старі НЕ змінюй
- Питання розпізнавай за інтонацією (? в тексті) та змістом ("розкажи про себе", "які твої", "чому ти", "що ти думаєш")
- Максимум 10 записів
- Прямою мовою, без "Спікер каже..."`;

export interface ConversationEntry {
    type: 'info' | 'question';
    text: string;
    timestamp?: number;
}

/**
 * Analyze interview conversation — detect topics and questions.
 * Returns structured conversation log.
 */
export async function analyzeConversation(
    norwegianText: string,
    existingLog: string,
    signal?: AbortSignal
): Promise<{ log: string; hasNewQuestion: boolean; lastQuestion: string }> {
    if (!ai || !norwegianText.trim()) return { log: existingLog || '', hasNewQuestion: false, lastQuestion: '' };

    try {
        const userPrompt = existingLog
            ? `ПОТОЧНИЙ ЛОГ:\n${existingLog}\n\nНОВИЙ ТЕКСТ (норвезька):\n${norwegianText}\n\nОновлений лог:`
            : `ТЕКСТ (норвезька):\n${norwegianText}\n\nЛог розмови:`;

        const response = await ai.models.generateContent({
            model: GEMINI_MODEL_LITE,
            contents: userPrompt,
            config: {
                systemInstruction: INTERVIEW_ANALYZER_PROMPT,
                thinkingConfig: { thinkingBudget: 0 },
                temperature: 0.1,
                maxOutputTokens: 400,
            }
        });

        if (signal?.aborted) return { log: existingLog || '', hasNewQuestion: false, lastQuestion: '' };

        const text = response?.text?.trim() || existingLog || '';

        // Detect if new question appeared
        const existingQuestions = (existingLog || '').match(/❓/g)?.length || 0;
        const newQuestions = text.match(/❓/g)?.length || 0;
        const hasNewQuestion = newQuestions > existingQuestions;

        // Extract last question text
        let lastQuestion = '';
        if (hasNewQuestion) {
            const questionBlocks = text.split('❓').filter(b => b.trim());
            if (questionBlocks.length > 0) {
                const lastBlock = questionBlocks[questionBlocks.length - 1].trim();
                lastQuestion = lastBlock.split('\n').map(l => l.trim()).filter(l => l).join(' ');
            }
        }

        return { log: text, hasNewQuestion, lastQuestion };
    } catch (e: any) {
        if (e.name !== 'AbortError') {
            console.error('[ConversationAnalyzer] Error:', e?.message || e);
        }
        return { log: existingLog || '', hasNewQuestion: false, lastQuestion: '' };
    }
}

/**
 * Generate answer to interview question using candidate profile.
 * Uses full Gemini Flash for quality.
 */
export async function generateInterviewAnswer(
    question: string,
    conversationContext: string,
    resume: string,
    knowledgeBase: string,
    targetLanguage: string,
    nativeLanguage: string,
    signal?: AbortSignal
): Promise<{ answer: string; answerTranslation: string }> {
    if (!ai || !question.trim()) return { answer: '', answerTranslation: '' };

    try {
        const prompt = `Ти готуєш відповідь кандидата на співбесіді.

ПИТАННЯ ІНТЕРВ'ЮЕРА: "${question}"

КОНТЕКСТ РОЗМОВИ:
${conversationContext.slice(-500)}

ПРОФІЛЬ КАНДИДАТА:
Резюме: ${resume?.slice(0, 1500) || '[не вказано]'}
База знань: ${knowledgeBase?.slice(0, 1000) || '[не вказано]'}

ЗАВДАННЯ:
1. [ANSWER] — Відповідь мовою інтерв'ю (${targetLanguage}), 2-4 речення, професійно, на основі профілю кандидата
2. [TRANSLATION] — Переклад відповіді на ${nativeLanguage}

Формат:
[ANSWER]
відповідь мовою інтерв'ю
[TRANSLATION]
переклад`;

        const response = await ai.models.generateContent({
            model: GEMINI_MODEL,
            contents: prompt,
            config: {
                thinkingConfig: { thinkingBudget: 0 },
                temperature: 0.4,
                maxOutputTokens: 500,
            }
        });

        if (signal?.aborted) return { answer: '', answerTranslation: '' };

        const text = response?.text || '';
        const answerMatch = text.match(/\[ANSWER\]\s*([\s\S]*?)(?:\[TRANSLATION\]|$)/i);
        const translationMatch = text.match(/\[TRANSLATION\]\s*([\s\S]*?)$/i);

        return {
            answer: answerMatch?.[1]?.trim() || text.trim(),
            answerTranslation: translationMatch?.[1]?.trim() || ''
        };
    } catch (e: any) {
        if (e.name !== 'AbortError') {
            console.error('[InterviewAnswer] Error:', e?.message || e);
        }
        return { answer: '', answerTranslation: '' };
    }
}

// ========== STREAMING TRANSLATION (NEW) ==========

export interface StreamingTranslationResult {
    translation: string;
    intent: {
        containsQuestion: boolean;
        questionConfidence: number;
        speechType: 'QUESTION' | 'INFO' | 'STORY' | 'SMALL_TALK' | 'UNKNOWN';
        detectedQuestions?: string[];
    };
}

/**
 * Incremental LLM translation for streaming architecture.
 * Translates accumulated text and classifies intent.
 *
 * @param fullText - Complete accumulated text from interviewer
 * @param alreadyTranslated - Previous translation (for incremental updates)
 * @param context - Interview context (language settings, etc.)
 * @param signal - Optional abort signal
 * @returns Translation and intent classification
 */
export const generateStreamingTranslation = async (
    fullText: string,
    alreadyTranslated: string,
    context: InterviewContext,
    signal?: AbortSignal
): Promise<StreamingTranslationResult> => {
    const prompt = constructStreamingPrompt(fullText, alreadyTranslated, context);

    let resultText = '';
    let fullResponseText = ''; // Capture full response for intent parsing

    try {
        const onUpdate = (data: any) => {
            if (data.inputTranslation) {
                resultText = data.inputTranslation;
            }
            // Capture full raw text for intent parsing
            if (data._fullRawText) {
                fullResponseText = data._fullRawText;
            }
        };

        await generateViaGemini(prompt, onUpdate, signal);

        // Try to parse LLM-based intent first
        let intent = parseLLMIntent(fullResponseText);

        // Fall back to heuristic classification if LLM didn't provide intent
        if (!intent || intent.speechType === 'UNKNOWN') {
            const heuristicIntent = classifyIntent(fullText, resultText);
            // Merge: use LLM intent if available, otherwise heuristic
            intent = {
                containsQuestion: intent?.containsQuestion ?? heuristicIntent.containsQuestion,
                questionConfidence: intent?.questionConfidence ?? heuristicIntent.questionConfidence,
                // Fix: check if intent exists AND has a valid speechType before using it
                speechType: (intent && intent.speechType && intent.speechType !== 'UNKNOWN')
                    ? intent.speechType
                    : heuristicIntent.speechType
            };
        }

        console.log(`🎯 [Intent] type=${intent.speechType}, question=${intent.containsQuestion}, confidence=${intent.questionConfidence}%`);

        // Sanitize: strip any leaked LLM tags from translation text
        resultText = sanitizeTranslationText(resultText);

        // Strip original text echo: LLMs sometimes repeat the original before translating
        resultText = stripOriginalTextEcho(resultText, fullText);

        return {
            translation: resultText,
            intent
        };
    } catch (e: any) {
        if (e.name === 'AbortError') throw e;
        console.error('Streaming translation error:', e);
        return {
            translation: alreadyTranslated || '',
            intent: {
                containsQuestion: false,
                questionConfidence: 0,
                speechType: 'UNKNOWN'
            }
        };
    }
};

/**
 * Strip any leaked LLM structural tags from translation text.
 * Handles cases where the model outputs malformed closing tags or
 * streaming captures partial tags in the translation.
 */
function sanitizeTranslationText(text: string): string {
    return text
        .replace(/\[\/INPUT_TRANSLATION\]?/gi, '')
        .replace(/\[INPUT_TRANSLATION\]/gi, '')
        .replace(/\[INTENT\][\s\S]*?(\[\/INTENT\]|$)/gi, '')
        .replace(/\[\/INTENT\]/gi, '')
        .replace(/\[ANALYSIS\][\s\S]*?(\[\/ANALYSIS\]|$)/gi, '')
        .replace(/\[STRATEGY\][\s\S]*?(\[\/STRATEGY\]|$)/gi, '')
        .replace(/\[ANSWER\][\s\S]*?(\[\/ANSWER\]|$)/gi, '')
        .replace(/\[TRANSLATION\][\s\S]*?(\[\/TRANSLATION\]|$)/gi, '')
        .trim();
}

/**
 * Strip original text echo from translation.
 * Some LLMs repeat the original text before/after the translation.
 * Detects this by checking if the translation contains the original text
 * and removes it, keeping only the actual translated content.
 */
function stripOriginalTextEcho(translation: string, originalText: string): string {
    if (!translation || !originalText) return translation;

    const trimmedOriginal = originalText.trim();
    const trimmedTranslation = translation.trim();

    // Case 1: Translation starts with the original text (most common)
    if (trimmedTranslation.startsWith(trimmedOriginal)) {
        const stripped = trimmedTranslation.slice(trimmedOriginal.length).trim();
        if (stripped.length > 0) {
            console.log(`🧹 [Sanitize] Stripped echoed original text from start of translation`);
            return stripped;
        }
    }

    // Case 2: Translation ends with the original text
    if (trimmedTranslation.endsWith(trimmedOriginal)) {
        const stripped = trimmedTranslation.slice(0, -trimmedOriginal.length).trim();
        if (stripped.length > 0) {
            console.log(`🧹 [Sanitize] Stripped echoed original text from end of translation`);
            return stripped;
        }
    }

    // Case 3: Check if significant portion of original words appear at start
    // (handles partial echo where LLM echoes most but not all original words)
    const originalWords = trimmedOriginal.split(/\s+/);
    const translationWords = trimmedTranslation.split(/\s+/);

    if (originalWords.length >= 3 && translationWords.length > originalWords.length) {
        // Check if first N words of translation match original
        let matchCount = 0;
        for (let i = 0; i < Math.min(originalWords.length, translationWords.length); i++) {
            if (translationWords[i].toLowerCase() === originalWords[i].toLowerCase()) {
                matchCount++;
            } else {
                break; // Stop at first non-match
            }
        }

        // If 60%+ of original words match at start, strip them
        if (matchCount >= originalWords.length * 0.6 && matchCount >= 3) {
            const stripped = translationWords.slice(matchCount).join(' ').trim();
            if (stripped.length > 0) {
                console.log(`🧹 [Sanitize] Stripped ${matchCount} echoed original words from translation`);
                return stripped;
            }
        }
    }

    return translation;
}

/**
 * Parse LLM-based intent from response text
 */
function parseLLMIntent(responseText: string): StreamingTranslationResult['intent'] | null {
    try {
        // Look for [INTENT] section
        const intentMatch = responseText.match(/\[INTENT\]([\s\S]*?)(\[\/INTENT\]|$)/i);
        if (!intentMatch) return null;

        const intentBlock = intentMatch[1];

        // Parse type
        const typeMatch = intentBlock.match(/type:\s*(QUESTION|INFO|SMALL_TALK|STORY|UNKNOWN)/i);
        const speechType = typeMatch
            ? typeMatch[1].toUpperCase() as 'QUESTION' | 'INFO' | 'STORY' | 'SMALL_TALK' | 'UNKNOWN'
            : 'UNKNOWN';

        // Parse confidence
        const confidenceMatch = intentBlock.match(/confidence:\s*(\d+)/i);
        const questionConfidence = confidenceMatch ? parseInt(confidenceMatch[1], 10) : 50;

        // Parse has_question
        const hasQuestionMatch = intentBlock.match(/has_question:\s*(true|false)/i);
        const containsQuestion = hasQuestionMatch
            ? hasQuestionMatch[1].toLowerCase() === 'true'
            : speechType === 'QUESTION';

        return {
            containsQuestion,
            questionConfidence,
            speechType
        };
    } catch (e) {
        console.warn('Failed to parse LLM intent:', e);
        return null;
    }
}

function constructStreamingPrompt(fullText: string, alreadyTranslated: string, context: InterviewContext): string {
    const hasExistingTranslation = alreadyTranslated && alreadyTranslated.trim().length > 0;

    // Common intent classification instructions
    const intentInstructions = `
КЛАСИФІКАЦІЯ МОВЛЕННЯ:
Визнач тип мовлення та чи є питання до кандидата:
- QUESTION: Пряме питання до кандидата (наприклад: "Розкажіть про себе", "Який ваш досвід?")
- INFO: Інформація про компанію/посаду (наприклад: "У нас в компанії ми використовуємо...")
- SMALL_TALK: Неформальна бесіда (погода, вихідні, як дістались)
- STORY: Розповідь/історія від інтерв'юера
- UNKNOWN: Невизначено

ФОРМАТ ВІДПОВІДІ:
[INPUT_TRANSLATION]
ТІЛЬКИ переклад мовою ${context.nativeLanguage}, БЕЗ оригіналу
[/INPUT_TRANSLATION]
[INTENT]
type: QUESTION/INFO/SMALL_TALK/STORY/UNKNOWN
confidence: 0-100
has_question: true/false
[/INTENT]

КРИТИЧНО: В тегах [INPUT_TRANSLATION] пиши ТІЛЬКИ переклад на ${context.nativeLanguage}. НЕ повторюй оригінальний ${context.targetLanguage} текст. НЕ додавай оригінал перед перекладом.`;

    // Speech recognition error correction instructions (common for Norwegian)
    const speechCorrectionRules = `
ВИПРАВЛЕННЯ ПОМИЛОК РОЗПІЗНАВАННЯ МОВЛЕННЯ:
Текст надходить від Web Speech API і ЧАСТО містить помилки. Ти МУСИШ розпізнати правильне слово з контексту:
- Спотворені слова відновлюй за контекстом (наприклад: "hitmane" → "gi tilbake", "абонути" → "повернути")
- Зламані складені слова з'єднуй (наприклад: "til bake" → "tilbake", "frem over" → "fremover")
- Неправильно розпізнані закінчення виправляй за граматикою
- Якщо слово не має сенсу в контексті — підбери найближче за звучанням правильне ${context.targetLanguage} слово
- Технічні терміни (API, deploy, framework) залишай як є`;

    if (hasExistingTranslation) {
        // Incremental mode - tell LLM what's already translated
        return `Ти професійний перекладач-синхроніст з ${context.targetLanguage} на ${context.nativeLanguage}.

КОНТЕКСТ: Ти перекладаєш ЖИВУ МОВУ інтерв'юера в реальному часі. Текст надходить поступово від розпізнавання мовлення і містить помилки.

ПОПЕРЕДНІЙ ПЕРЕКЛАД (вже зроблено):
"${alreadyTranslated}"

ПОВНИЙ ОРИГІНАЛЬНИЙ ТЕКСТ (включаючи нове):
"${fullText}"
${speechCorrectionRules}

ЗАВДАННЯ:
1. Виправ помилки розпізнавання мовлення в оригіналі, відновлюючи правильні ${context.targetLanguage} слова за контекстом
2. Переклади ВЕСЬ виправлений текст на природну, граматично правильну ${context.nativeLanguage} мову
3. Покращуй попередній переклад з урахуванням нового контексту
4. Класифікуй тип мовлення

ЯКІСТЬ ПЕРЕКЛАДУ:
- Передавай СЕНС, а не буквальний переклад
- Використовуй правильні відмінки, відміни та узгодження в ${context.nativeLanguage}
- Переклад має звучати як природна жива ${context.nativeLanguage} мова, НЕ як машинний переклад
- Зглажуй обірваність фраз
${intentInstructions}`;
    }

    // First translation - no previous context
    return `Ти професійний перекладач-синхроніст з ${context.targetLanguage} на ${context.nativeLanguage}.

КОНТЕКСТ: Ти перекладаєш ЖИВУ МОВУ інтерв'юера в реальному часі. Текст від розпізнавання мовлення і містить помилки.

ТЕКСТ ДЛЯ ПЕРЕКЛАДУ:
"${fullText}"
${speechCorrectionRules}

ПРАВИЛА:
1. Спочатку виправ помилки розпізнавання мовлення, відновлюючи правильні ${context.targetLanguage} слова за контекстом
2. Переклади виправлений текст на природну, граматично правильну ${context.nativeLanguage} мову
3. Використовуй правильні відмінки, відміни та узгодження — переклад має звучати як жива ${context.nativeLanguage} мова
4. Зглажуй обірваність фраз
5. Класифікуй тип мовлення
${intentInstructions}`;
}

function classifyIntent(originalText: string, translation: string): StreamingTranslationResult['intent'] {
    // Heuristic intent classification
    // TODO: Can be improved with LLM classification in the future

    const questionIndicators = [
        // Norwegian question words
        'hva', 'hvordan', 'hvorfor', 'når', 'hvor', 'hvem', 'hvilken', 'hvilke',
        // English question words
        'what', 'how', 'why', 'when', 'where', 'who', 'which',
        // German question words
        'was', 'wie', 'warum', 'wann', 'wo', 'wer', 'welche',
        // Question marks
        '?'
    ];

    const infoIndicators = [
        'vi har', 'hos oss', 'vår bedrift', 'selskapet', 'firmaet',
        'we have', 'at our', 'our company', 'the company',
        'wir haben', 'bei uns', 'unsere firma'
    ];

    const smallTalkIndicators = [
        'været', 'helg', 'ferie', 'kaffe',
        'weather', 'weekend', 'holiday', 'coffee',
        'wetter', 'wochenende', 'urlaub', 'kaffee'
    ];

    const lowerOriginal = originalText.toLowerCase();
    const lowerTranslation = translation.toLowerCase();

    // Check for question
    let questionScore = 0;
    for (const indicator of questionIndicators) {
        if (lowerOriginal.includes(indicator)) questionScore += 2;
        if (lowerTranslation.includes(indicator)) questionScore += 1;
    }

    // Check for company info
    let infoScore = 0;
    for (const indicator of infoIndicators) {
        if (lowerOriginal.includes(indicator)) infoScore += 2;
    }

    // Check for small talk
    let smallTalkScore = 0;
    for (const indicator of smallTalkIndicators) {
        if (lowerOriginal.includes(indicator)) smallTalkScore += 2;
    }

    // Determine type
    const maxScore = Math.max(questionScore, infoScore, smallTalkScore);

    if (questionScore > 3 && questionScore === maxScore) {
        return {
            containsQuestion: true,
            questionConfidence: Math.min(100, questionScore * 15),
            speechType: 'QUESTION'
        };
    }

    if (infoScore > 3 && infoScore === maxScore) {
        return {
            containsQuestion: false,
            questionConfidence: 0,
            speechType: 'INFO'
        };
    }

    if (smallTalkScore > 3 && smallTalkScore === maxScore) {
        return {
            containsQuestion: false,
            questionConfidence: 0,
            speechType: 'SMALL_TALK'
        };
    }

    // Default - unknown but might be question if has question mark
    const hasQuestionMark = originalText.includes('?');
    return {
        containsQuestion: hasQuestionMark,
        questionConfidence: hasQuestionMark ? 70 : 20,
        speechType: hasQuestionMark ? 'QUESTION' : 'UNKNOWN'
    };
}

// Helper for parsing structured output with closing tags support
// Supports both bracket-style [/TAG] and HTML-style </TAG> closing tags
function parseAndEmit(fullText: string, onUpdate: any) {
    let inputTranslation = "";
    let analysis = "";
    let strategy = "";
    let answerTranslation = "";
    let answer = "";
    let rationale = "";

    // 0. Input Translation - supports both [/INPUT_TRANSLATION] and </INPUT_TRANSLATION>
    // Note: \]? makes closing bracket optional (LLMs sometimes omit it)
    // [INTENT] added as delimiter to prevent intent block leaking into translation
    const inputMatch = fullText.match(/\[INPUT_TRANSLATION\]([\s\S]*?)(\[\/INPUT_TRANSLATION\]?|<\/INPUT_TRANSLATION>|\[ANALYSIS\]|\[STRATEGY\]|\[TRANSLATION\]|\[ANSWER\]|\[INTENT\]|$)/i);
    if (inputMatch) inputTranslation = inputMatch[1].trim();

    // 1. Analysis - supports both [/ANALYSIS] and </ANALYSIS>
    const analysisMatch = fullText.match(/\[ANALYSIS\]([\s\S]*?)(\[\/ANALYSIS\]|<\/ANALYSIS>|\[STRATEGY\]|\[TRANSLATION\]|\[ANSWER\]|$)/i);
    if (analysisMatch) analysis = analysisMatch[1].trim();

    // 2. Strategy - supports both [/STRATEGY] and </STRATEGY>
    const strategyMatch = fullText.match(/\[STRATEGY\]([\s\S]*?)(\[\/STRATEGY\]|<\/STRATEGY>|\[TRANSLATION\]|\[ANSWER\]|$)/i);
    if (strategyMatch) strategy = strategyMatch[1].trim();

    // 3. Translation (answer translation) - supports both [/TRANSLATION] and </TRANSLATION>
    const translationMatch = fullText.match(/\[TRANSLATION\]([\s\S]*?)(\[\/TRANSLATION\]|<\/TRANSLATION>|\[ANSWER\]|$)/i);
    if (translationMatch) answerTranslation = translationMatch[1].trim();

    // 4. Answer - supports both [/ANSWER] and </ANSWER>
    const answerMatch = fullText.match(/\[ANSWER\]([\s\S]*?)(\[\/ANSWER\]|<\/ANSWER>|$)/i);
    if (answerMatch) answer = answerMatch[1].trim();

    // Handle streaming case where [ANSWER] exists but tag isn't closed yet
    if (!answer && fullText.includes('[ANSWER]')) {
         const parts = fullText.split('[ANSWER]');
         if (parts.length > 1) {
             // Remove closing tag if partially present (both styles)
             answer = parts[1].replace(/(\[\/ANSWER\]|<\/ANSWER>).*$/i, '').trim();
         }
    }

    // Fallback: If no tags found but text exists, use as inputTranslation (for SIMPLE mode raw output)
    if (!inputTranslation && !answer && !analysis && fullText.length > 0 && !fullText.includes('[')) {
        inputTranslation = fullText.trim();
    }

    onUpdate({ analysis, strategy, answerTranslation, inputTranslation, rationale, answer });
}