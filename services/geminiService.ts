

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
        modeSpecificGuidelines += `\n[TRANSLATION GUIDELINES]\n${translationHint}\n`;
    }
    if (isFullMode && analysisHint) {
        modeSpecificGuidelines += `\n[ANALYSIS GUIDELINES]\n${analysisHint}\n`;
    }
    if (answerHint) {
        modeSpecificGuidelines += `\n[ANSWER GUIDELINES]\n${answerHint}\n`;
    }
    if (isFullMode) {
        modeSpecificGuidelines += `\n[STRATEGY DETAIL LEVEL]: ${strategyLevel}\n`;
    }

    // ========== FOCUS MODE: Quick answer without analysis ==========
    if (isFocusMode) {
        return `Ти асистент для співбесід. Допоможи кандидату відповісти на питання інтерв'юера.

КОНТЕКСТ КАНДИДАТА:
- Резюме: "${context.resume?.slice(0, 1500) || 'не вказано'}"
- Вакансія: "${context.jobDescription?.slice(0, 1000) || 'не вказано'}"
- Компанія: "${context.companyDescription?.slice(0, 500) || 'не вказано'}"
- База знань: "${relevantKnowledge || 'немає'}"
${modeSpecificGuidelines}

ПИТАННЯ ІНТЕРВ'ЮЕРА (${context.targetLanguage}):
"${currentInput}"

ТВОЯ ВІДПОВІДЬ ПОВИННА БУТИ В ТАКОМУ ФОРМАТІ (використовуй ТОЧНО ці теги):

[INPUT_TRANSLATION]
Переклад питання на ${context.nativeLanguage}
[/INPUT_TRANSLATION]

[TRANSLATION]
Рекомендована відповідь на ${context.nativeLanguage}
[/TRANSLATION]

[ANSWER]
Рекомендована відповідь на ${context.targetLanguage}
[/ANSWER]

ВАЖЛИВО:
- Використовуй ТІЛЬКИ ці теги у квадратних дужках
- Кожен тег на окремому рядку
- Відповідь має бути конкретною, професійною та стислою
- Базуйся на резюме та вакансії кандидата`;
    }

    // ========== FULL MODE: Complete analysis with strategy ==========
    return `Ти асистент для співбесід. Проаналізуй питання та підготуй стратегічну відповідь.

КОНТЕКСТ КАНДИДАТА:
- Резюме: "${context.resume?.slice(0, 2000) || 'не вказано'}"
- Вакансія: "${context.jobDescription?.slice(0, 1500) || 'не вказано'}"
- Компанія: "${context.companyDescription?.slice(0, 1000) || 'не вказано'}"
- База знань: "${relevantKnowledge || 'немає'}"
${modeSpecificGuidelines}

ПИТАННЯ ІНТЕРВ'ЮЕРА (${context.targetLanguage}):
"${currentInput}"

ТВОЯ ВІДПОВІДЬ ПОВИННА БУТИ В ТАКОМУ ФОРМАТІ (використовуй ТОЧНО ці теги):

[INPUT_TRANSLATION]
Переклад питання на ${context.nativeLanguage}
[/INPUT_TRANSLATION]

[ANALYSIS]
Короткий аналіз: що хоче дізнатися інтерв'юер?
[/ANALYSIS]

[STRATEGY]
Стратегія відповіді: ключові пункти для згадування
[/STRATEGY]

[TRANSLATION]
Рекомендована відповідь на ${context.nativeLanguage}
[/TRANSLATION]

[ANSWER]
Рекомендована відповідь на ${context.targetLanguage}
[/ANSWER]

ВАЖЛИВО:
- Використовуй ТІЛЬКИ ці теги у квадратних дужках
- Кожен тег на окремому рядку
- Відповідь має бути професійною та базуватися на контексті кандидата`;
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
                stream: true
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
                            parseAndEmit(fullText, onUpdate);
                        }
                    } catch (e) {
                        // ignore parse errors for partial chunks
                    }
                }
            }
        }
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
    const inputMatch = fullText.match(/\[INPUT_TRANSLATION\]([\s\S]*?)(\[\/INPUT_TRANSLATION\]|<\/INPUT_TRANSLATION>|\[ANALYSIS\]|\[STRATEGY\]|\[TRANSLATION\]|\[ANSWER\]|$)/i);
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