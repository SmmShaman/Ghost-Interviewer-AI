/**
 * STREAMING TEXT VIEW COMPONENT
 *
 * Відображає текст як безперервний потік (субтитри), а не як окремі блоки.
 * Текст росте вниз, нові слова з'являються плавно.
 *
 * ОСОБЛИВОСТІ:
 * - DIRECT DOM: Текст оновлюється через ref.textContent (bypass React reconciliation)
 * - requestAnimationFrame для батчингу оновлень
 * - Один текстовий контейнер замість списку карток
 * - Переклад великим шрифтом (основний фокус)
 * - Оригінал маленьким шрифтом знизу
 * - Автоматичний scroll вниз
 * - Пульсуючий курсор показує активність
 */

import React, { useEffect, useRef, useState, useLayoutEffect } from 'react';

interface StreamingTextViewProps {
    // Текст для відображення
    translationText: string;      // Переклад (основний, великий)
    originalText?: string;        // Оригінал (маленький, знизу)

    // Interim text (real-time, not finalized - shown in grey)
    interimTranslation?: string;  // Interim translation (grey, at end)
    interimOriginal?: string;     // Interim original (grey, at end)

    // Hold-N indicator (shows "..." when words are being held)
    isHoldingWords?: boolean;     // True when Hold-N is active

    // Стан
    isActive: boolean;            // Чи йде запис
    isProcessing?: boolean;       // Чи обробляє LLM

    // Стиль
    variant?: 'ghost' | 'llm' | 'mixed';
    showOriginal?: boolean;
    showCursor?: boolean;

    // Колір
    accentColor?: 'emerald' | 'cyan' | 'blue' | 'amber';

    // Заголовок
    title?: string;

    // Висота
    minHeight?: string;
    maxHeight?: string;
}

const StreamingTextView: React.FC<StreamingTextViewProps> = ({
    translationText,
    originalText = '',
    interimTranslation = '',
    interimOriginal = '',
    isHoldingWords = false,
    isActive,
    isProcessing = false,
    variant = 'ghost',
    showOriginal = true,
    showCursor = true,
    accentColor = 'emerald',
    title = 'Переклад',
    minHeight = '300px',
    maxHeight = 'calc(100vh - 12rem)'
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

    // DIRECT DOM refs for streaming text (bypass React reconciliation)
    const translationRef = useRef<HTMLSpanElement>(null);
    const interimTranslationRef = useRef<HTMLSpanElement>(null);
    const originalRef = useRef<HTMLSpanElement>(null);
    const interimOriginalRef = useRef<HTMLSpanElement>(null);

    // RAF batching ref
    const rafRef = useRef<number | null>(null);
    const pendingUpdateRef = useRef<{
        translation?: string;
        interimTranslation?: string;
        original?: string;
        interimOriginal?: string;
    } | null>(null);

    // DIRECT DOM UPDATE: Batch updates using requestAnimationFrame
    useLayoutEffect(() => {
        // Store pending update
        pendingUpdateRef.current = {
            translation: translationText,
            interimTranslation,
            original: originalText,
            interimOriginal
        };

        // Cancel previous RAF if exists
        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
        }

        // Schedule DOM update
        rafRef.current = requestAnimationFrame(() => {
            const update = pendingUpdateRef.current;
            if (!update) return;

            // Direct DOM updates - bypass React
            if (translationRef.current && translationRef.current.textContent !== update.translation) {
                translationRef.current.textContent = update.translation || '';
            }
            if (interimTranslationRef.current) {
                interimTranslationRef.current.textContent = update.interimTranslation || '';
                interimTranslationRef.current.style.display = update.interimTranslation ? 'inline' : 'none';
            }
            if (originalRef.current && originalRef.current.textContent !== update.original) {
                originalRef.current.textContent = update.original || '';
            }
            if (interimOriginalRef.current) {
                interimOriginalRef.current.textContent = update.interimOriginal || '';
                interimOriginalRef.current.style.display = update.interimOriginal ? 'inline' : 'none';
            }

            pendingUpdateRef.current = null;
        });

        return () => {
            if (rafRef.current) {
                cancelAnimationFrame(rafRef.current);
            }
        };
    }, [translationText, interimTranslation, originalText, interimOriginal]);

    // Color schemes
    const colorSchemes = {
        emerald: {
            border: 'border-emerald-500',
            bg: 'bg-emerald-900/10',
            header: 'bg-emerald-950/30',
            headerBorder: 'border-emerald-500/10',
            dot: 'bg-emerald-400',
            dotGlow: 'shadow-[0_0_8px_rgba(52,211,153,0.8)]',
            title: 'text-emerald-300',
            text: 'text-emerald-100',
            cursor: 'text-emerald-400',
            originalLabel: 'text-emerald-500/50',
            originalText: 'text-emerald-200/40'
        },
        cyan: {
            border: 'border-cyan-500',
            bg: 'bg-cyan-900/10',
            header: 'bg-cyan-950/30',
            headerBorder: 'border-cyan-500/10',
            dot: 'bg-cyan-400',
            dotGlow: 'shadow-[0_0_8px_rgba(34,211,238,0.8)]',
            title: 'text-cyan-300',
            text: 'text-cyan-100',
            cursor: 'text-cyan-400',
            originalLabel: 'text-cyan-500/50',
            originalText: 'text-cyan-200/40'
        },
        blue: {
            border: 'border-blue-500',
            bg: 'bg-blue-900/10',
            header: 'bg-blue-950/30',
            headerBorder: 'border-blue-500/10',
            dot: 'bg-blue-400',
            dotGlow: 'shadow-[0_0_8px_rgba(96,165,250,0.8)]',
            title: 'text-blue-300',
            text: 'text-blue-100',
            cursor: 'text-blue-400',
            originalLabel: 'text-blue-500/50',
            originalText: 'text-blue-200/40'
        },
        amber: {
            border: 'border-amber-500',
            bg: 'bg-amber-900/10',
            header: 'bg-amber-950/30',
            headerBorder: 'border-amber-500/10',
            dot: 'bg-amber-400',
            dotGlow: 'shadow-[0_0_8px_rgba(251,191,36,0.8)]',
            title: 'text-amber-300',
            text: 'text-amber-100',
            cursor: 'text-amber-400',
            originalLabel: 'text-amber-500/50',
            originalText: 'text-amber-200/40'
        }
    };

    const colors = colorSchemes[accentColor];

    // Auto-scroll to bottom when new content arrives
    useEffect(() => {
        if (shouldAutoScroll && containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
    }, [translationText, shouldAutoScroll]);

    // Detect manual scroll (user scrolled up) -> disable auto-scroll
    const handleScroll = () => {
        if (!containerRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
        const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
        setShouldAutoScroll(isAtBottom);
    };

    // Word count
    const wordCount = translationText.trim().split(/\s+/).filter(w => w).length;

    return (
        <div
            className={`border-l-4 ${colors.border} ${colors.bg} rounded-lg shadow-xl flex flex-col overflow-hidden`}
            style={{ minHeight, maxHeight }}
        >
            {/* Header */}
            <div className={`px-4 py-2.5 ${colors.header} border-b ${colors.headerBorder} flex items-center justify-between sticky top-0 backdrop-blur z-10`}>
                <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${colors.dot} ${isActive ? `animate-pulse ${colors.dotGlow}` : ''}`}></span>
                    <span className={`text-[10px] font-black ${colors.title} uppercase tracking-widest`}>
                        {title}
                    </span>
                    {variant === 'llm' && (
                        <span className="text-[8px] text-gray-500 ml-1">LLM</span>
                    )}
                    {variant === 'ghost' && (
                        <span className="text-[8px] text-gray-500 ml-1">Ghost</span>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    {isProcessing && (
                        <div className="flex gap-0.5">
                            <div className={`w-1 h-3 ${colors.dot} rounded-full animate-pulse`} style={{animationDelay: '0ms'}}></div>
                            <div className={`w-1 h-3 ${colors.dot} rounded-full animate-pulse`} style={{animationDelay: '100ms'}}></div>
                            <div className={`w-1 h-3 ${colors.dot} rounded-full animate-pulse`} style={{animationDelay: '200ms'}}></div>
                        </div>
                    )}
                    {wordCount > 0 && (
                        <span className={`text-[10px] font-mono ${colors.title} bg-black/20 px-2 py-0.5 rounded`}>
                            {wordCount} слів
                        </span>
                    )}
                </div>
            </div>

            {/* Main Content Area - Scrollable with scroll anchoring */}
            <div
                ref={containerRef}
                onScroll={handleScroll}
                className="flex-1 overflow-y-auto p-4 md:p-6 scroll-smooth"
                style={{ overflowAnchor: 'auto' }}
            >
                {(translationText || interimTranslation) ? (
                    <div className="space-y-4">
                        {/* Translation Text - MAIN FOCUS (Direct DOM updates) */}
                        <div className={`text-lg md:text-xl lg:text-2xl leading-relaxed font-medium`}>
                            {/* Finalized text - solid color (ref for direct DOM) */}
                            <span ref={translationRef} className={colors.text}></span>
                            {/* Interim text - grey, italic with gradient fade (ref for direct DOM) */}
                            <span
                                ref={interimTranslationRef}
                                className="text-gray-400 italic ml-1"
                                style={{
                                    background: 'linear-gradient(90deg, rgba(156,163,175,0.8) 0%, rgba(156,163,175,0.4) 100%)',
                                    WebkitBackgroundClip: 'text',
                                    WebkitTextFillColor: 'transparent',
                                    display: interimTranslation ? 'inline' : 'none'
                                }}
                            ></span>
                            {/* Hold-N indicator: shows "..." when words are being held back */}
                            {isHoldingWords && isActive && (
                                <span
                                    className="inline-block ml-1 text-gray-500 animate-pulse"
                                    style={{
                                        letterSpacing: '0.1em',
                                        animation: 'pulse 1.5s ease-in-out infinite'
                                    }}
                                    title="Обробка останніх слів..."
                                >...</span>
                            )}
                            {showCursor && isActive && !isHoldingWords && (
                                <span className={`inline-block ml-1 ${colors.cursor} animate-pulse`}>▊</span>
                            )}
                        </div>

                        {/* Original Text - Secondary, smaller */}
                        {showOriginal && (originalText || interimOriginal) && (
                            <div className="pt-4 border-t border-gray-800/50">
                                <div className={`text-[10px] ${colors.originalLabel} uppercase tracking-wider mb-2`}>
                                    Оригінал
                                </div>
                                <div className={`text-sm leading-relaxed italic`}>
                                    {/* Finalized original - slightly visible (ref for direct DOM) */}
                                    <span ref={originalRef} className={colors.originalText}></span>
                                    {/* Interim original - faded grey (ref for direct DOM) */}
                                    <span
                                        ref={interimOriginalRef}
                                        className="text-gray-500/60 ml-1"
                                        style={{ display: interimOriginal ? 'inline' : 'none' }}
                                    ></span>
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    /* Empty State */
                    <div className="h-full flex flex-col items-center justify-center text-center py-12">
                        <div className={`w-16 h-16 rounded-full ${colors.bg} border ${colors.border} flex items-center justify-center mb-4`}>
                            <svg className={`w-8 h-8 ${colors.title} opacity-50`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                            </svg>
                        </div>
                        <div className={`text-sm ${colors.title} opacity-70 mb-2`}>
                            {isActive ? 'Слухаю...' : 'Очікую запис'}
                        </div>
                        <div className="text-xs text-gray-500">
                            {isActive
                                ? 'Текст з\'явиться тут миттєво'
                                : 'Натисніть мікрофон щоб почати'
                            }
                        </div>
                    </div>
                )}
            </div>

            {/* Footer Status Bar */}
            {isActive && translationText && (
                <div className={`px-4 py-2 ${colors.header} border-t ${colors.headerBorder} flex items-center justify-between text-[10px]`}>
                    <div className="flex items-center gap-2">
                        {shouldAutoScroll ? (
                            <span className="text-gray-500">📍 Авто-прокрутка</span>
                        ) : (
                            <button
                                onClick={() => {
                                    setShouldAutoScroll(true);
                                    if (containerRef.current) {
                                        containerRef.current.scrollTop = containerRef.current.scrollHeight;
                                    }
                                }}
                                className={`${colors.title} hover:underline`}
                            >
                                ↓ До кінця
                            </button>
                        )}
                    </div>
                    <div className="text-gray-500">
                        {Math.round((Date.now() - performance.timeOrigin) / 1000)}s
                    </div>
                </div>
            )}
        </div>
    );
};

export default StreamingTextView;
