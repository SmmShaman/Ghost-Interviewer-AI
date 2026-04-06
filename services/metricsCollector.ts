/**
 * METRICS COLLECTOR SERVICE
 *
 * Збирає та відстежує метрики продуктивності перекладу в реальному часі.
 * Допомагає діагностувати проблеми з втратою слів та затримками.
 *
 * МЕТРИКИ:
 * - wordsReceived: кількість слів від Speech API
 * - wordsTranslated: кількість перекладених слів (Ghost)
 * - wordsDisplayed: кількість показаних слів
 * - avgLatencyMs: середня затримка від слова до показу
 * - erasureRate: середня кількість змін на слово
 */

interface MetricsSnapshot {
    timestamp: number;
    wordsReceived: number;
    wordsTranslated: number;
    wordsDisplayed: number;
    avgLatencyMs: number;
    erasureRate: number;
    cacheHits: number;
    cacheMisses: number;
}

interface LatencyRecord {
    wordId: string;
    receivedAt: number;
    translatedAt?: number;
    displayedAt?: number;
}

class MetricsCollector {
    private wordsReceived: number = 0;
    private wordsTranslated: number = 0;
    private wordsDisplayed: number = 0;
    private erasureCount: number = 0;
    private cacheHits: number = 0;
    private cacheMisses: number = 0;

    private latencyRecords: Map<string, LatencyRecord> = new Map();
    private sessionStartTime: number = 0;
    private isEnabled: boolean = true;

    // History for graphing (last 60 snapshots, ~1/sec)
    private history: MetricsSnapshot[] = [];
    private readonly MAX_HISTORY = 60;

    constructor() {
        // Auto-snapshot every second when session is active
        setInterval(() => {
            if (this.sessionStartTime > 0) {
                this.takeSnapshot();
            }
        }, 1000);
    }

    /**
     * Start a new metrics session
     */
    startSession(): void {
        this.reset();
        this.sessionStartTime = Date.now();
        console.log('📊 [Metrics] Session started');
    }

    /**
     * Stop the current session
     */
    stopSession(): void {
        this.takeSnapshot();
        const summary = this.getSummary();
        console.log('📊 [Metrics] Session ended:', summary);
        this.sessionStartTime = 0;
    }

    /**
     * Reset all metrics
     */
    reset(): void {
        this.wordsReceived = 0;
        this.wordsTranslated = 0;
        this.wordsDisplayed = 0;
        this.erasureCount = 0;
        this.cacheHits = 0;
        this.cacheMisses = 0;
        this.latencyRecords.clear();
        this.history = [];
    }

    /**
     * Record words received from Speech API
     */
    recordWordsReceived(count: number): void {
        if (!this.isEnabled) return;
        this.wordsReceived += count;

        // Create latency records for new words
        const now = Date.now();
        for (let i = 0; i < count; i++) {
            const wordId = `${now}-${this.wordsReceived - count + i}`;
            this.latencyRecords.set(wordId, {
                wordId,
                receivedAt: now
            });
        }
    }

    /**
     * Record words translated (Ghost)
     */
    recordWordsTranslated(count: number): void {
        if (!this.isEnabled) return;
        this.wordsTranslated += count;

        // Update latency records
        const now = Date.now();
        let updated = 0;
        for (const record of this.latencyRecords.values()) {
            if (!record.translatedAt && updated < count) {
                record.translatedAt = now;
                updated++;
            }
        }
    }

    /**
     * Record words displayed to user
     */
    recordWordsDisplayed(count: number): void {
        if (!this.isEnabled) return;
        this.wordsDisplayed += count;

        // Update latency records
        const now = Date.now();
        let updated = 0;
        for (const record of this.latencyRecords.values()) {
            if (record.translatedAt && !record.displayedAt && updated < count) {
                record.displayedAt = now;
                updated++;
            }
        }
    }

    /**
     * Record an erasure (text change after display)
     */
    recordErasure(): void {
        if (!this.isEnabled) return;
        this.erasureCount++;
    }

    /**
     * Record cache hit (interim translation)
     */
    recordCacheHit(): void {
        if (!this.isEnabled) return;
        this.cacheHits++;
    }

    /**
     * Record cache miss (interim translation)
     */
    recordCacheMiss(): void {
        if (!this.isEnabled) return;
        this.cacheMisses++;
    }

    /**
     * Calculate average latency (received → displayed)
     */
    private calculateAvgLatency(): number {
        let totalLatency = 0;
        let count = 0;

        for (const record of this.latencyRecords.values()) {
            if (record.receivedAt && record.displayedAt) {
                totalLatency += record.displayedAt - record.receivedAt;
                count++;
            }
        }

        return count > 0 ? Math.round(totalLatency / count) : 0;
    }

    /**
     * Calculate erasure rate (erasures per displayed word)
     */
    private calculateErasureRate(): number {
        return this.wordsDisplayed > 0
            ? Math.round((this.erasureCount / this.wordsDisplayed) * 100) / 100
            : 0;
    }

    /**
     * Take a snapshot of current metrics
     */
    private takeSnapshot(): void {
        const snapshot: MetricsSnapshot = {
            timestamp: Date.now(),
            wordsReceived: this.wordsReceived,
            wordsTranslated: this.wordsTranslated,
            wordsDisplayed: this.wordsDisplayed,
            avgLatencyMs: this.calculateAvgLatency(),
            erasureRate: this.calculateErasureRate(),
            cacheHits: this.cacheHits,
            cacheMisses: this.cacheMisses
        };

        this.history.push(snapshot);
        if (this.history.length > this.MAX_HISTORY) {
            this.history.shift();
        }
    }

    /**
     * Get current metrics summary
     */
    getSummary(): {
        wordsReceived: number;
        wordsTranslated: number;
        wordsDisplayed: number;
        lossRate: string;
        avgLatencyMs: number;
        erasureRate: number;
        cacheHitRate: string;
        sessionDuration: string;
    } {
        const lossRate = this.wordsReceived > 0
            ? ((1 - this.wordsDisplayed / this.wordsReceived) * 100).toFixed(1)
            : '0.0';

        const totalCacheOps = this.cacheHits + this.cacheMisses;
        const cacheHitRate = totalCacheOps > 0
            ? ((this.cacheHits / totalCacheOps) * 100).toFixed(1)
            : '0.0';

        const sessionDuration = this.sessionStartTime > 0
            ? `${Math.round((Date.now() - this.sessionStartTime) / 1000)}s`
            : '0s';

        return {
            wordsReceived: this.wordsReceived,
            wordsTranslated: this.wordsTranslated,
            wordsDisplayed: this.wordsDisplayed,
            lossRate: `${lossRate}%`,
            avgLatencyMs: this.calculateAvgLatency(),
            erasureRate: this.calculateErasureRate(),
            cacheHitRate: `${cacheHitRate}%`,
            sessionDuration
        };
    }

    /**
     * Get history for graphing
     */
    getHistory(): MetricsSnapshot[] {
        return [...this.history];
    }

    /**
     * Log current metrics to console (dev mode)
     */
    logMetrics(): void {
        const summary = this.getSummary();
        console.log(`📊 [Metrics] Received: ${summary.wordsReceived} | Translated: ${summary.wordsTranslated} | Displayed: ${summary.wordsDisplayed} | Loss: ${summary.lossRate} | Latency: ${summary.avgLatencyMs}ms | Erasures: ${summary.erasureRate} | Cache: ${summary.cacheHitRate}`);
    }

    /**
     * Enable/disable metrics collection
     */
    setEnabled(enabled: boolean): void {
        this.isEnabled = enabled;
    }
}

// Singleton instance
export const metricsCollector = new MetricsCollector();
