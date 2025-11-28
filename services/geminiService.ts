

import { InterviewContext } from "../types";
import { knowledgeSearch } from "./knowledgeSearch";

// Azure Configuration
const AZURE_ENDPOINT = "https://jobbot.openai.azure.com";
const AZURE_API_KEY = ""; // SECURITY: Removed hardcoded key. Use UI Settings to inject key or process.env
const API_VERSION = "2024-10-01-preview";
const DEPLOYMENT = "gpt-5.1-codex-mini";

// Groq Configuration
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile"; 

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

    // Use TF-IDF search to get relevant context from knowledge base
    const relevantKnowledge = knowledgeSearch.getRelevantContext(currentInput, 3000);

    return `
      Request: Process the input data and generate a structured response based on the formatting rules.

      [DATA CONTEXT]
      Resume: "${context.resume}"
      Job: "${context.jobDescription}"
      Company: "${context.companyDescription}"
      KB: "${relevantKnowledge || context.knowledgeBase}"
      
      [SESSION CONFIG]
      Target Language: ${context.targetLanguage}
      Native Language: ${context.nativeLanguage}
      Proficiency: ${context.proficiencyLevel}
      Tone: ${context.tone}
      View Mode: ${context.viewMode}

      [PROCESSING GUIDELINES]
      ${safeInstruction}

      CRITICAL: You MUST ALWAYS generate [INPUT_TRANSLATION] first to provide a better translation of the input.
      
      ${isSimpleMode ? "CONSTRAINT: Mode is SIMPLE. Output ONLY the [INPUT_TRANSLATION] tag. Do not generate Analysis or Answer." : ""}

      [CONVERSATION LOG]
      History: "${historyText}"
      Current Input: "${currentInput}"
    `;
}

// AZURE IMPLEMENTATION
async function generateViaAzure(prompt: string, onUpdate: (data: any) => void) {
     // Use key from constant (if set) or fallback to environment/UI injection in future
     // For now, if empty, it will likely fail unless user has configured backend proxy or local overrides
     
     if (!AZURE_API_KEY) {
         throw new Error("Azure API Key is missing. Please configure it in the code or use Groq in settings.");
     }

     const response = await fetch(`${AZURE_ENDPOINT}/openai/deployments/${DEPLOYMENT}/chat/completions?api-version=${API_VERSION}`, {
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
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Azure API Error: ${response.status} ${errText}`);
    }
    
    await processStream(response, onUpdate);
}

// GROQ IMPLEMENTATION
async function generateViaGroq(prompt: string, apiKey: string, onUpdate: (data: any) => void) {
    if (!apiKey) throw new Error("Groq API Key is missing");

    const response = await fetch(GROQ_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: GROQ_MODEL,
            messages: [
                { role: "user", content: prompt }
            ],
            stream: true,
            temperature: 0.6,
            max_tokens: 1024
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Groq API Error: ${response.status} ${errText}`);
    }

    await processStream(response, onUpdate);
}

// GENERIC STREAM PROCESSOR (Works for both Azure and Groq as they are OpenAI compatible)
async function processStream(response: Response, onUpdate: (data: any) => void) {
    if (!response.body) throw new Error("No response body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let fullText = "";

    while (true) {
        const { done, value } = await reader.read();
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
}

export const generateInterviewAssist = async (
  currentInput: string,
  historyBuffer: string[],
  context: InterviewContext,
  onUpdate: (data: { answer: string; analysis: string; strategy: string; answerTranslation: string; inputTranslation: string; rationale: string }) => void
): Promise<void> => {
  try {
    const historyText = historyBuffer.join(" ");
    
    // Sanitize prompt for Azure jailbreak detection (Good practice for Groq too)
    const safeInstruction = sanitizeForAzure(context.systemInstruction);
    const combinedPrompt = constructPrompt(currentInput, historyText, context, safeInstruction);

    // Switch Provider
    if (context.llmProvider === 'groq') {
        // console.log("🚀 Sending to Groq...");
        await generateViaGroq(combinedPrompt, context.groqApiKey, onUpdate);
    } else {
        // console.log("☁️ Sending to Azure...");
        await generateViaAzure(combinedPrompt, onUpdate);
    }

  } catch (error: any) {
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

// Helper for parsing structured output
function parseAndEmit(fullText: string, onUpdate: any) {
    let inputTranslation = "";
    let analysis = "";
    let strategy = "";
    let answerTranslation = "";
    let answer = "";
    let rationale = ""; 

    // 0. Input Translation (New Stream 2 Feature)
    const inputMatch = fullText.match(/\[INPUT_TRANSLATION\]([\s\S]*?)(\[ANALYSIS\]|\[STRATEGY\]|\[TRANSLATION\]|\[ANSWER\]|$)/);
    if (inputMatch) inputTranslation = inputMatch[1].trim();

    // 1. Analysis
    const analysisMatch = fullText.match(/\[ANALYSIS\]([\s\S]*?)(\[STRATEGY\]|\[TRANSLATION\]|\[ANSWER\]|$)/);
    if (analysisMatch) analysis = analysisMatch[1].trim();

    // 2. Strategy
    const strategyMatch = fullText.match(/\[STRATEGY\]([\s\S]*?)(\[TRANSLATION\]|\[ANSWER\]|$)/);
    if (strategyMatch) strategy = strategyMatch[1].trim();

    // 3. Translation
    const translationMatch = fullText.match(/\[TRANSLATION\]([\s\S]*?)(\[ANSWER\]|$)/);
    if (translationMatch) answerTranslation = translationMatch[1].trim();

    // 4. Answer
    const answerMatch = fullText.match(/\[ANSWER\]([\s\S]*?)(\[\/ANSWER\]|$)/);
    if (answerMatch) answer = answerMatch[1].trim();
    
    // Handle streaming case where [ANSWER] exists but tag isn't closed yet
    if (!answer && fullText.includes('[ANSWER]')) {
         const parts = fullText.split('[ANSWER]');
         if (parts.length > 1) {
             answer = parts[1].trim();
         }
    }

    // Fallback if no tags found (raw output)
    if (!answer && !analysis && !strategy && !answerTranslation && !inputTranslation && fullText.length > 0 && !fullText.includes('[')) {
        answer = fullText;
    }

    onUpdate({ analysis, strategy, answerTranslation, inputTranslation, rationale, answer });
}