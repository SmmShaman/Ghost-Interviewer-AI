/**
 * STREAMING ACCUMULATOR SERVICE
 *
 * Центральний сервіс для накопичення та обробки мовлення інтерв'юера.
 * Замість "блоків" використовує єдиний потік тексту.
 *
 * АРХІТЕКТУРА:
 * - Весь текст зберігається в одному буфері
 * - Ghost Translation працює з контекстом (останні 50 слів)
 * - LLM Translation працює з усім накопиченим текстом
 * - UI оновлюється інкрементально (нові слова додаються, старі не зникають)
 */

export interface AccumulatorState {
    // Повний текст сесії (оригінал)
    fullOriginal: string;

    // Повний переклад (Ghost - миттєвий)
    fullGhostTranslation: string;

    // Повний переклад (LLM - якісний)
    fullLLMTranslation: string;

    // Скільки слів вже перекладено LLM
    llmTranslatedWordCount: number;

    // Метадані
    wordCount: number;
    lastUpdateTime: number;
    sessionStartTime: number;

    // Intent classification
    containsQuestion: boolean;
    questionConfidence: number;
    speechType: 'QUESTION' | 'INFO' | 'STORY' | 'SMALL_TALK' | 'UNKNOWN';

    // Збережена інформація про компанію (для контексту відповідей)
    extractedCompanyInfo: string[];
}

export interface TranslationUpdate {
    type: 'ghost' | 'llm';
    newText: string;           // Тільки нова частина
    fullText: string;          // Весь переклад
    wordCount: number;
    latency?: number;
}

export interface IntentUpdate {
    containsQuestion: boolean;
    questionConfidence: number;
    speechType: AccumulatorState['speechType'];
    detectedQuestions?: string[];
}

type TranslationListener = (update: TranslationUpdate) => void;
type IntentListener = (update: IntentUpdate) => void;
type TextListener = (fullOriginal: string, newWords: string) => void;

class StreamingAccumulator {
    private state: AccumulatorState = this.createEmptyState();

    // Listeners for reactive updates
    private translationListeners: TranslationListener[] = [];
    private intentListeners: IntentListener[] = [];
    private textListeners: TextListener[] = [];

    // Configuration
    private static readonly GHOST_CONTEXT_WORDS = 50; // Words to send as context for Ghost
    private static readonly LLM_TRIGGER_WORDS = 30;   // Min words before LLM trigger
    private static readonly LLM_PAUSE_MS = 2000;      // Trigger LLM after pause

    // Timers
    private llmPauseTimer: ReturnType<typeof setTimeout> | null = null;
    private ghostDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    // External services (injected)
    private ghostTranslator: ((text: string, context: string) => Promise<string>) | null = null;
    private llmTranslator: ((text: string, alreadyTranslated: string) => Promise<{ translation: string; intent: IntentUpdate }>) | null = null;

    constructor() {
        this.state = this.createEmptyState();
    }

    private createEmptyState(): AccumulatorState {
        return {
            fullOriginal: '',
            fullGhostTranslation: '',
            fullLLMTranslation: '',
            llmTranslatedWordCount: 0,
            wordCount: 0,
            lastUpdateTime: Date.now(),
            sessionStartTime: Date.now(),
            containsQuestion: false,
            questionConfidence: 0,
            speechType: 'UNKNOWN',
            extractedCompanyInfo: []
        };
    }

    // ========== PUBLIC API ==========

    /**
     * Додати нові слова до акумулятора
     * Викликається при кожному оновленні від Speech Recognition
     */
    addWords(newWords: string): void {
        if (!newWords.trim()) return;

        const trimmedNew = newWords.trim();
        const previousText = this.state.fullOriginal;

        // Append to accumulator
        this.state.fullOriginal = previousText
            ? `${previousText} ${trimmedNew}`
            : trimmedNew;

        this.state.wordCount = this.state.fullOriginal.split(/\s+/).length;
        this.state.lastUpdateTime = Date.now();

        // Notify text listeners
        this.textListeners.forEach(listener => {
            listener(this.state.fullOriginal, trimmedNew);
        });

        // Trigger Ghost translation (debounced)
        this.triggerGhostTranslation(trimmedNew);

        // Schedule LLM translation (on pause or threshold)
        this.scheduleLLMTranslation();
    }

    /**
     * Отримати поточний стан акумулятора
     */
    getState(): Readonly<AccumulatorState> {
        return { ...this.state };
    }

    /**
     * Скинути акумулятор (нова сесія)
     */
    reset(): void {
        // Clear timers
        if (this.llmPauseTimer) {
            clearTimeout(this.llmPauseTimer);
            this.llmPauseTimer = null;
        }
        if (this.ghostDebounceTimer) {
            clearTimeout(this.ghostDebounceTimer);
            this.ghostDebounceTimer = null;
        }

        this.state = this.createEmptyState();

        console.log('🔄 [StreamingAccumulator] Reset');
    }

    /**
     * Примусово відправити на LLM (наприклад, при натисканні STOP)
     */
    async forceLLMTranslation(): Promise<void> {
        if (this.llmPauseTimer) {
            clearTimeout(this.llmPauseTimer);
            this.llmPauseTimer = null;
        }
        await this.executeLLMTranslation();
    }

    // ========== LISTENERS ==========

    onTranslation(listener: TranslationListener): () => void {
        this.translationListeners.push(listener);
        return () => {
            this.translationListeners = this.translationListeners.filter(l => l !== listener);
        };
    }

    onIntent(listener: IntentListener): () => void {
        this.intentListeners.push(listener);
        return () => {
            this.intentListeners = this.intentListeners.filter(l => l !== listener);
        };
    }

    onText(listener: TextListener): () => void {
        this.textListeners.push(listener);
        return () => {
            this.textListeners = this.textListeners.filter(l => l !== listener);
        };
    }

    // ========== SERVICE INJECTION ==========

    setGhostTranslator(translator: (text: string, context: string) => Promise<string>): void {
        this.ghostTranslator = translator;
    }

    setLLMTranslator(translator: (text: string, alreadyTranslated: string) => Promise<{ translation: string; intent: IntentUpdate }>): void {
        this.llmTranslator = translator;
    }

    // ========== PRIVATE METHODS ==========

    private triggerGhostTranslation(newWords: string): void {
        // Debounce ghost translation (100ms)
        if (this.ghostDebounceTimer) {
            clearTimeout(this.ghostDebounceTimer);
        }

        this.ghostDebounceTimer = setTimeout(async () => {
            await this.executeGhostTranslation(newWords);
        }, 100);
    }

    private async executeGhostTranslation(newWords: string): Promise<void> {
        if (!this.ghostTranslator) {
            console.warn('[StreamingAccumulator] Ghost translator not set');
            return;
        }

        const startTime = performance.now();

        // Get context (last N words before new words)
        const allWords = this.state.fullOriginal.split(/\s+/);
        const contextStartIdx = Math.max(0, allWords.length - newWords.split(/\s+/).length - StreamingAccumulator.GHOST_CONTEXT_WORDS);
        const contextWords = allWords.slice(contextStartIdx, allWords.length - newWords.split(/\s+/).length);
        const context = contextWords.join(' ');

        try {
            const translation = await this.ghostTranslator(newWords, context);
            const latency = performance.now() - startTime;

            // Append to full ghost translation
            this.state.fullGhostTranslation = this.state.fullGhostTranslation
                ? `${this.state.fullGhostTranslation} ${translation}`
                : translation;

            // Notify listeners
            const update: TranslationUpdate = {
                type: 'ghost',
                newText: translation,
                fullText: this.state.fullGhostTranslation,
                wordCount: this.state.wordCount,
                latency: Math.round(latency)
            };

            this.translationListeners.forEach(listener => listener(update));

            console.log(`👻 [${Math.round(latency)}ms] Ghost: "${translation.substring(0, 40)}..."`);
        } catch (e) {
            console.error('[StreamingAccumulator] Ghost translation error:', e);
        }
    }

    private scheduleLLMTranslation(): void {
        // Clear existing timer
        if (this.llmPauseTimer) {
            clearTimeout(this.llmPauseTimer);
        }

        // Check if we should trigger immediately (word threshold)
        const untranslatedWords = this.state.wordCount - this.state.llmTranslatedWordCount;
        if (untranslatedWords >= StreamingAccumulator.LLM_TRIGGER_WORDS) {
            // Trigger immediately
            this.executeLLMTranslation();
            return;
        }

        // Schedule on pause
        this.llmPauseTimer = setTimeout(() => {
            this.executeLLMTranslation();
        }, StreamingAccumulator.LLM_PAUSE_MS);
    }

    private async executeLLMTranslation(): Promise<void> {
        if (!this.llmTranslator) {
            console.warn('[StreamingAccumulator] LLM translator not set');
            return;
        }

        // Check if there's new content to translate
        if (this.state.llmTranslatedWordCount >= this.state.wordCount) {
            return; // Nothing new to translate
        }

        const startTime = performance.now();
        const fullText = this.state.fullOriginal;
        const alreadyTranslated = this.state.fullLLMTranslation;

        try {
            const result = await this.llmTranslator(fullText, alreadyTranslated);
            const latency = performance.now() - startTime;

            // Update state with new translation
            this.state.fullLLMTranslation = result.translation;
            this.state.llmTranslatedWordCount = this.state.wordCount;

            // Update intent
            this.state.containsQuestion = result.intent.containsQuestion;
            this.state.questionConfidence = result.intent.questionConfidence;
            this.state.speechType = result.intent.speechType;

            // Notify translation listeners
            const update: TranslationUpdate = {
                type: 'llm',
                newText: result.translation, // For now, full text. Can be optimized to diff.
                fullText: result.translation,
                wordCount: this.state.wordCount,
                latency: Math.round(latency)
            };

            this.translationListeners.forEach(listener => listener(update));

            // Notify intent listeners
            this.intentListeners.forEach(listener => listener(result.intent));

            console.log(`🤖 [${Math.round(latency)}ms] LLM: "${result.translation.substring(0, 40)}..." | Question: ${result.intent.containsQuestion}`);
        } catch (e) {
            console.error('[StreamingAccumulator] LLM translation error:', e);
        }
    }

    // ========== UTILITY ==========

    /**
     * Отримати текст для відображення (з маркером курсору)
     */
    getDisplayText(showCursor: boolean = true): { original: string; ghost: string; llm: string } {
        const cursor = showCursor ? '▊' : '';

        return {
            original: this.state.fullOriginal + cursor,
            ghost: this.state.fullGhostTranslation + (this.state.fullGhostTranslation ? cursor : ''),
            llm: this.state.fullLLMTranslation + (this.state.fullLLMTranslation ? cursor : '')
        };
    }

    /**
     * Отримати статистику сесії
     */
    getStats(): { words: number; duration: number; ghostLatency: number; llmLatency: number } {
        return {
            words: this.state.wordCount,
            duration: Date.now() - this.state.sessionStartTime,
            ghostLatency: 0, // TODO: track average
            llmLatency: 0    // TODO: track average
        };
    }
}

// Export singleton
export const streamingAccumulator = new StreamingAccumulator();
