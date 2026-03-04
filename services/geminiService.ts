

import { InterviewContext } from "../types";
import { knowledgeSearch } from "./knowledgeSearch";

// Azure Configuration (from .env via Vite)
const AZURE_ENDPOINT = import.meta.env.VITE_AZURE_ENDPOINT || "https://jobbot.openai.azure.com";
const AZURE_API_KEY = import.meta.env.VITE_AZURE_API_KEY || "";
const API_VERSION = import.meta.env.VITE_API_VERSION || "2024-10-01-preview";
const DEPLOYMENT = import.meta.env.VITE_DEPLOYMENT || "gpt-5.1-codex-mini";

// Groq Configuration (from .env via Vite)
const GROQ_ENDPOINT = import.meta.env.VITE_GROQ_ENDPOINT || "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = import.meta.env.VITE_GROQ_MODEL || "llama-3.3-70b-versatile";
const GROQ_API_KEY_DEFAULT = import.meta.env.VITE_GROQ_API_KEY || ""; 

// Helper to mask imperative commands that trigger Azure Jailbreak detection
function sanitizeForAzure(text: string): string {
    if (!text) return "";
    return text
        // Problematic phrases -> Neutral data processing terms
        .replace(/You are (an?|the)/gi, 'Task: Provide')
        .replace(/Act as/gi, 'Function:')
        .replace(/Your role is to/gi, 'Process by')
        .replace(/You must/gi, 'Required:')
        .replace(/You should/gi, 'Recommended:')
        .replace(/You will/gi, 'Expected output:')
        .replace(/Ignore previous/gi, '')
        .replace(/SYSTEM:/gi, 'CONTEXT:')
        .replace(/INSTRUCTIONS?:/gi, 'GUIDELINES:');
}

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

// AZURE IMPLEMENTATION
async function generateViaAzure(prompt: string, onUpdate: (data: any) => void, signal?: AbortSignal) {
     // Use key from constant (if set) or fallback to environment/UI injection in future
     // For now, if empty, it will likely fail unless user has configured backend proxy or local overrides

     if (!AZURE_API_KEY) {
         throw new Error("Azure API Key is missing. Set VITE_AZURE_API_KEY in .env or use Groq in Settings.");
     }

     // Check if already aborted
     if (signal?.aborted) {
         throw new DOMException('Aborted', 'AbortError');
     }

     let response;
     try {
         response = await fetch(`${AZURE_ENDPOINT}/openai/deployments/${DEPLOYMENT}/chat/completions?api-version=${API_VERSION}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-key': AZURE_API_KEY
            },
            body: JSON.stringify({
                messages: [
                    { role: "user", content: prompt }
                ],
                stream: true,
                max_completion_tokens: 4096  // Azure requires max_completion_tokens, not max_tokens
                // Note: temperature not supported by gpt-5.1-codex-mini (only default=1)
            }),
            signal // Pass abort signal to fetch
        });
     } catch (fetchError: any) {
         if (fetchError.name === 'AbortError') {
             throw new DOMException('Aborted', 'AbortError');
         }
         throw fetchError;
     }

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Azure API Error: ${response.status} ${errText}`);
    }

    await processStream(response, onUpdate, signal);
}

// GROQ IMPLEMENTATION
async function generateViaGroq(prompt: string, apiKey: string, onUpdate: (data: any) => void, signal?: AbortSignal) {
    const key = apiKey || GROQ_API_KEY_DEFAULT;
    if (!key) throw new Error("Groq API Key is missing. Set VITE_GROQ_API_KEY in .env or enter in Settings.");

    // Check if already aborted
    if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
    }

    let response;
    try {
        response = await fetch(GROQ_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${key}`
            },
            body: JSON.stringify({
                model: GROQ_MODEL,
                messages: [
                    { role: "user", content: prompt }
                ],
                stream: true,
                temperature: 0.6,
                max_tokens: 1024
            }),
            signal // Pass abort signal to fetch
        });
    } catch (fetchError: any) {
        if (fetchError.name === 'AbortError') {
            throw new DOMException('Aborted', 'AbortError');
        }
        throw fetchError;
    }

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Groq API Error: ${response.status} ${errText}`);
    }

    await processStream(response, onUpdate, signal);
}

// GENERIC STREAM PROCESSOR (Works for both Azure and Groq as they are OpenAI compatible)
async function processStream(response: Response, onUpdate: (data: any) => void, signal?: AbortSignal) {
    if (!response.body) throw new Error("No response body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let fullText = "";

    // BATCHING: Reduce UI updates from 100+/sec to ~10/sec
    let lastUpdate = 0;
    const UPDATE_INTERVAL = 100; // ms

    try {
        while (true) {
            // Check if aborted before reading
            if (signal?.aborted) {
                reader.cancel().catch(() => {}); // Ignore cancel errors
                throw new DOMException('Aborted', 'AbortError');
            }

            let readResult;
            try {
                readResult = await reader.read();
            } catch (readError: any) {
                // Handle abort during read
                if (readError.name === 'AbortError' || signal?.aborted) {
                    throw new DOMException('Aborted', 'AbortError');
                }
                throw readError;
            }

            const { done, value } = readResult;
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split("\n");

            for (const line of lines) {
                if (line.startsWith("data: ")) {
                    const dataStr = line.slice(6);
                    if (dataStr === "[DONE]") continue;
                    try {
                        const data = JSON.parse(dataStr);
                        const content = data.choices?.[0]?.delta?.content || "";
                        if (content) {
                            fullText += content;

                            // BATCHING: Only update UI every 100ms for smooth display
                            const now = Date.now();
                            if (now - lastUpdate >= UPDATE_INTERVAL) {
                                parseAndEmit(fullText, onUpdate);
                                onUpdate({ _rawChunk: content, _fullRawText: fullText });
                                lastUpdate = now;
                            }
                        }
                    } catch (e) {
                        // ignore parse errors for partial chunks
                    }
                }
            }
        }

        // FINAL UPDATE: Ensure all content is emitted
        parseAndEmit(fullText, onUpdate);
        onUpdate({ _rawChunk: '', _fullRawText: fullText });
    } finally {
        // Ensure reader is released safely
        try {
            reader.releaseLock();
        } catch (e) {
            // Ignore release errors
        }
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

    // Sanitize prompt for Azure jailbreak detection (Good practice for Groq too)
    const safeInstruction = sanitizeForAzure(context.systemInstruction);
    const combinedPrompt = constructPrompt(currentInput, historyText, context, safeInstruction);

    // Switch Provider
    if (context.llmProvider === 'groq') {
        // console.log("🚀 Sending to Groq...");
        await generateViaGroq(combinedPrompt, context.groqApiKey, onUpdate, signal);
    } else {
        // console.log("☁️ Sending to Azure...");
        await generateViaAzure(combinedPrompt, onUpdate, signal);
    }

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

// Simple translator fallback
export const translateText = async (text: string, targetLang: string): Promise<string> => {
    // Basic implementation - for now just returns text as this is rarely used in current flow
    // Future: implement router for this too
    return text;
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

        if (context.llmProvider === 'groq') {
            await generateViaGroqDirect(prompt, context.groqApiKey, onUpdate, signal);
        } else {
            await generateViaAzureDirect(prompt, onUpdate, signal);
        }

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

// Direct API calls (without the full interview assist logic)
async function generateViaAzureDirect(prompt: string, onUpdate: (data: any) => void, signal?: AbortSignal) {
    if (!AZURE_API_KEY) {
        throw new Error("Azure API Key is missing");
    }

    if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
    }

    // Sanitize prompt to avoid Azure content filtering issues
    const sanitizedPrompt = sanitizeForAzure(prompt);

    const response = await fetch(`${AZURE_ENDPOINT}/openai/deployments/${DEPLOYMENT}/chat/completions?api-version=${API_VERSION}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'api-key': AZURE_API_KEY
        },
        body: JSON.stringify({
            messages: [{ role: "user", content: sanitizedPrompt }],
            stream: true,
            max_completion_tokens: 4096  // Azure requires max_completion_tokens, not max_tokens
            // Note: temperature not supported by gpt-5.1-codex-mini (only default=1)
        }),
        signal
    });

    if (!response.ok) {
        // Try to get error details for debugging
        let errorDetails = '';
        try {
            const errorBody = await response.text();
            errorDetails = errorBody.slice(0, 500);
            console.error('Azure API Error details:', errorDetails);
        } catch (e) {
            // Ignore parse error
        }
        throw new Error(`Azure API Error: ${response.status} - ${errorDetails}`);
    }

    await processStream(response, onUpdate, signal);
}

async function generateViaGroqDirect(prompt: string, apiKey: string, onUpdate: (data: any) => void, signal?: AbortSignal) {
    const key = apiKey || GROQ_API_KEY_DEFAULT;
    if (!key) throw new Error("Groq API Key is missing");

    if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
    }

    const response = await fetch(GROQ_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
        },
        body: JSON.stringify({
            model: GROQ_MODEL,
            messages: [{ role: "user", content: prompt }],
            stream: true,
            temperature: 0.5,
            max_tokens: 512
        }),
        signal
    });

    if (!response.ok) {
        throw new Error(`Groq API Error: ${response.status}`);
    }

    await processStream(response, onUpdate, signal);
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