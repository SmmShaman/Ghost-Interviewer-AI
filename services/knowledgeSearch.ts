/**
 * TF-IDF based Knowledge Base Search
 * Allows searching through large documents (up to 10MB+) efficiently
 * No external dependencies - pure TypeScript implementation
 */

interface Chunk {
    id: string;
    text: string;
    source: string; // filename or "manual"
    startIndex: number;
}

interface IndexedChunk extends Chunk {
    tf: Map<string, number>; // term frequency
    magnitude: number; // for cosine similarity
}

interface SearchResult {
    chunk: Chunk;
    score: number;
}

// Configuration
const CHUNK_SIZE = 500; // characters per chunk
const CHUNK_OVERLAP = 100; // overlap between chunks
const TOP_K = 5; // number of results to return
const MIN_SCORE = 0.1; // minimum relevance score

class KnowledgeSearchService {
    private chunks: IndexedChunk[] = [];
    private idf: Map<string, number> = new Map(); // inverse document frequency
    private documentCount = 0;
    private isIndexed = false;

    /**
     * Tokenize text into words (simple but effective)
     */
    private tokenize(text: string): string[] {
        return text
            .toLowerCase()
            .replace(/[^\w\sа-яіїєґ]/gi, ' ') // keep letters (including Ukrainian)
            .split(/\s+/)
            .filter(word => word.length > 2); // skip very short words
    }

    /**
     * Calculate term frequency for a chunk
     */
    private calculateTF(tokens: string[]): Map<string, number> {
        const tf = new Map<string, number>();
        const total = tokens.length;

        for (const token of tokens) {
            tf.set(token, (tf.get(token) || 0) + 1);
        }

        // Normalize by total words
        for (const [term, count] of tf) {
            tf.set(term, count / total);
        }

        return tf;
    }

    /**
     * Split text into overlapping chunks
     */
    private splitIntoChunks(text: string, source: string): Chunk[] {
        const chunks: Chunk[] = [];
        let startIndex = 0;

        while (startIndex < text.length) {
            // Find a good break point (end of sentence or paragraph)
            let endIndex = Math.min(startIndex + CHUNK_SIZE, text.length);

            if (endIndex < text.length) {
                // Try to break at sentence end
                const lastPeriod = text.lastIndexOf('.', endIndex);
                const lastNewline = text.lastIndexOf('\n', endIndex);
                const breakPoint = Math.max(lastPeriod, lastNewline);

                if (breakPoint > startIndex + CHUNK_SIZE / 2) {
                    endIndex = breakPoint + 1;
                }
            }

            const chunkText = text.slice(startIndex, endIndex).trim();

            if (chunkText.length > 50) { // Skip very small chunks
                chunks.push({
                    id: `${source}-${chunks.length}`,
                    text: chunkText,
                    source,
                    startIndex
                });
            }

            startIndex = endIndex - CHUNK_OVERLAP;
            if (startIndex >= text.length - CHUNK_OVERLAP) break;
        }

        return chunks;
    }

    /**
     * Index a document (or multiple documents combined)
     */
    index(text: string, source: string = 'manual'): void {
        if (!text || text.trim().length === 0) {
            this.chunks = [];
            this.idf.clear();
            this.isIndexed = false;
            return;
        }

        // Split into chunks
        const rawChunks = this.splitIntoChunks(text, source);

        // Build document frequency map
        const df = new Map<string, number>();
        const indexedChunks: IndexedChunk[] = [];

        for (const chunk of rawChunks) {
            const tokens = this.tokenize(chunk.text);
            const tf = this.calculateTF(tokens);

            // Count document frequency (unique terms per chunk)
            const uniqueTerms = new Set(tokens);
            for (const term of uniqueTerms) {
                df.set(term, (df.get(term) || 0) + 1);
            }

            // Calculate magnitude for cosine similarity
            let magnitude = 0;
            for (const val of tf.values()) {
                magnitude += val * val;
            }

            indexedChunks.push({
                ...chunk,
                tf,
                magnitude: Math.sqrt(magnitude)
            });
        }

        // Calculate IDF
        this.idf.clear();
        const N = rawChunks.length;
        for (const [term, count] of df) {
            this.idf.set(term, Math.log((N + 1) / (count + 1)) + 1);
        }

        this.chunks = indexedChunks;
        this.documentCount = N;
        this.isIndexed = true;

        console.log(`📚 Knowledge Base indexed: ${N} chunks from "${source}"`);
    }

    /**
     * Search for relevant chunks
     */
    search(query: string, topK: number = TOP_K): SearchResult[] {
        if (!this.isIndexed || this.chunks.length === 0) {
            return [];
        }

        const queryTokens = this.tokenize(query);
        if (queryTokens.length === 0) return [];

        const queryTF = this.calculateTF(queryTokens);

        // Calculate query magnitude
        let queryMagnitude = 0;
        for (const [term, tf] of queryTF) {
            const idf = this.idf.get(term) || 0;
            const tfidf = tf * idf;
            queryMagnitude += tfidf * tfidf;
        }
        queryMagnitude = Math.sqrt(queryMagnitude);

        if (queryMagnitude === 0) return [];

        // Score each chunk using cosine similarity
        const results: SearchResult[] = [];

        for (const chunk of this.chunks) {
            let dotProduct = 0;

            for (const [term, queryTFVal] of queryTF) {
                const chunkTF = chunk.tf.get(term) || 0;
                const idf = this.idf.get(term) || 0;

                dotProduct += (queryTFVal * idf) * (chunkTF * idf);
            }

            // Cosine similarity
            const score = dotProduct / (queryMagnitude * (chunk.magnitude || 1));

            if (score > MIN_SCORE) {
                results.push({ chunk, score });
            }
        }

        // Sort by score and return top K
        results.sort((a, b) => b.score - a.score);
        return results.slice(0, topK);
    }

    /**
     * Get relevant context for a query (formatted for LLM)
     */
    getRelevantContext(query: string, maxChars: number = 15000): string {
        const results = this.search(query);

        if (results.length === 0) {
            return '';
        }

        let context = '';
        let currentLength = 0;

        for (const result of results) {
            const chunkText = `[Relevance: ${(result.score * 100).toFixed(0)}%]\n${result.chunk.text}\n\n`;

            if (currentLength + chunkText.length > maxChars) {
                break;
            }

            context += chunkText;
            currentLength += chunkText.length;
        }

        return context.trim();
    }

    /**
     * Check if knowledge base is indexed and ready
     */
    isReady(): boolean {
        return this.isIndexed;
    }

    /**
     * Get statistics about the indexed knowledge base
     */
    getStats(): { chunks: number; terms: number; isReady: boolean } {
        return {
            chunks: this.chunks.length,
            terms: this.idf.size,
            isReady: this.isIndexed
        };
    }

    /**
     * Clear the index
     */
    clear(): void {
        this.chunks = [];
        this.idf.clear();
        this.isIndexed = false;
        this.documentCount = 0;
    }
}

// Singleton instance
export const knowledgeSearch = new KnowledgeSearchService();
