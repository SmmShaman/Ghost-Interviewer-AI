import React, { useEffect, useRef, useState } from 'react';
import type { Briefing, InterviewContext } from '../types';
import { LLMError, generateBriefing } from '../services/claudeService';
import { CandidateDocs, hasDocs } from '../services/prompts';

/**
 * PRE-INTERVIEW BRIEFING
 *
 * Runs once per candidate + job pair, with no latency pressure: company,
 * vacancy requirements, requirement-to-evidence match, risks, likely
 * questions. The result is shown to the candidate and becomes the grounded
 * fact sheet for every live answer.
 */

interface BriefingPanelProps {
    isOpen: boolean;
    onClose: () => void;
    context: InterviewContext;
    docs: CandidateDocs;
    sourceHash: string;
    /** Briefing matching the current documents, if any. */
    briefing: Briefing | null;
    /** Latest briefing built from older documents (shown as outdated). */
    staleBriefing: Briefing | null;
    isSignedIn: boolean;
    uiLang: 'en' | 'uk';
    onSave: (briefing: Briefing) => void;
    onAuthExpired: () => void;
}

const TEXT = {
    uk: {
        title: 'Брифінг перед співбесідою',
        subtitle: 'Аналіз компанії, вакансії та вашого профілю. Відповіді під час розмови спираються на нього.',
        generate: 'Створити брифінг',
        regenerate: 'Оновити брифінг',
        generating: 'Аналізую документи…',
        stop: 'Зупинити',
        close: 'Закрити',
        stale: 'Документи змінилися після створення цього брифінгу. Оновіть його.',
        needSignIn: 'Щоб створити брифінг, увійдіть через Google на головному екрані.',
        needDocs: 'Спершу заповніть резюме та опис вакансії в налаштуваннях — без них аналізувати нічого.',
        missing: 'Не заповнено',
        resume: 'резюме', job: 'опис вакансії', company: 'опис компанії', letter: 'супровідний лист', kb: 'база знань',
        created: 'Створено',
        keyterms: 'Назви й терміни для розпізнавання',
        error: 'Не вдалося створити брифінг',
        empty: 'Брифінгу ще немає.',
    },
    en: {
        title: 'Pre-interview briefing',
        subtitle: 'Analysis of the company, the vacancy and your profile. Live answers rely on it.',
        generate: 'Create briefing',
        regenerate: 'Refresh briefing',
        generating: 'Analysing documents…',
        stop: 'Stop',
        close: 'Close',
        stale: 'The documents changed after this briefing was created. Refresh it.',
        needSignIn: 'Sign in with Google on the home screen to create a briefing.',
        needDocs: 'Fill in the resume and the job description in settings first — there is nothing to analyse without them.',
        missing: 'Missing',
        resume: 'resume', job: 'job description', company: 'company description', letter: 'application letter', kb: 'knowledge base',
        created: 'Created',
        keyterms: 'Names and terms for recognition',
        error: 'Could not create the briefing',
        empty: 'No briefing yet.',
    },
};

/** Minimal renderer for the briefing's fixed structure ("## " headings + plain lines). */
const BriefingText: React.FC<{ text: string }> = ({ text }) => (
    <div className="space-y-1">
        {text.split('\n').map((line, i) => {
            const clean = line.replace(/\*\*/g, '').trimEnd();
            if (!clean.trim()) return <div key={i} className="h-1.5" />;
            if (/^#{1,3}\s/.test(clean)) {
                return <h3 key={i} className="pt-3 text-sm font-black uppercase tracking-wider text-emerald-400">{clean.replace(/^#{1,3}\s+/, '')}</h3>;
            }
            const tone = clean.startsWith('✅') ? 'text-emerald-100'
                : clean.startsWith('⚠') ? 'text-amber-100'
                : clean.startsWith('❌') ? 'text-red-200'
                : 'text-gray-200';
            return <p key={i} className={`text-sm leading-relaxed ${tone}`}>{clean}</p>;
        })}
    </div>
);

const BriefingPanel: React.FC<BriefingPanelProps> = ({
    isOpen, onClose, context, docs, sourceHash, briefing, staleBriefing, isSignedIn, uiLang, onSave, onAuthExpired,
}) => {
    const t = TEXT[uiLang];
    const [isGenerating, setIsGenerating] = useState(false);
    const [partial, setPartial] = useState('');
    const [error, setError] = useState('');
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => () => abortRef.current?.abort(), []);

    if (!isOpen) return null;

    const shown = briefing || staleBriefing;
    const isStale = !briefing && !!staleBriefing;
    const docsOk = hasDocs(docs);
    const missing = [
        !docs.resume.trim() && t.resume,
        !docs.jobDescription.trim() && t.job,
        !docs.companyDescription.trim() && t.company,
        !docs.applicationLetter.trim() && t.letter,
        !docs.knowledgeBase.trim() && t.kb,
    ].filter(Boolean) as string[];

    const run = async () => {
        setError('');
        setPartial('');
        setIsGenerating(true);
        abortRef.current = new AbortController();
        try {
            const result = await generateBriefing(docs, context.targetLanguage, context.nativeLanguage, setPartial, abortRef.current.signal);
            onSave({ text: result.text, keyterms: result.keyterms, sourceHash, createdAt: Date.now() });
            setPartial('');
        } catch (e) {
            if ((e as Error).name !== 'AbortError') {
                if (e instanceof LLMError && e.isAuth) onAuthExpired();
                setError(`${t.error}: ${(e as Error).message}`);
            }
        } finally {
            setIsGenerating(false);
            abortRef.current = null;
        }
    };

    const stop = () => abortRef.current?.abort();

    return (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm p-2 sm:p-6" onClick={onClose}>
            <div className="w-full max-w-3xl max-h-full flex flex-col bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
                <div className="shrink-0 px-5 py-4 border-b border-gray-800 flex items-start justify-between gap-4">
                    <div>
                        <h2 className="text-lg font-black text-white">{t.title}</h2>
                        <p className="text-xs text-gray-400 mt-0.5">{t.subtitle}</p>
                    </div>
                    <button onClick={onClose} className="shrink-0 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300 hover:text-white hover:bg-gray-700 text-xs font-bold border border-gray-700">{t.close}</button>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
                    {!isSignedIn && <p className="mb-3 text-sm text-amber-300">{t.needSignIn}</p>}
                    {!docsOk && <p className="mb-3 text-sm text-amber-300">{t.needDocs}</p>}
                    {docsOk && missing.length > 0 && (
                        <p className="mb-3 text-xs text-gray-500">{t.missing}: {missing.join(', ')}</p>
                    )}
                    {isStale && !isGenerating && <p className="mb-3 text-sm text-amber-300">{t.stale}</p>}
                    {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

                    {isGenerating ? (
                        partial
                            ? <BriefingText text={partial} />
                            : <p className="text-sm text-gray-400 animate-pulse">{t.generating}</p>
                    ) : shown ? (
                        <div className={isStale ? 'opacity-60' : ''}>
                            <BriefingText text={shown.text} />
                            {shown.keyterms.length > 0 && (
                                <div className="mt-4 pt-3 border-t border-gray-800">
                                    <div className="text-[10px] uppercase tracking-wider font-bold text-gray-500 mb-1">{t.keyterms}</div>
                                    <p className="text-xs text-gray-400 font-mono leading-relaxed">{shown.keyterms.join(' · ')}</p>
                                </div>
                            )}
                            <p className="mt-3 text-[10px] text-gray-600">{t.created}: {new Date(shown.createdAt).toLocaleString()}</p>
                        </div>
                    ) : (
                        <p className="text-sm text-gray-500 italic">{t.empty}</p>
                    )}
                </div>

                <div className="shrink-0 px-5 py-3 border-t border-gray-800 flex justify-end gap-2">
                    {isGenerating ? (
                        <button onClick={stop} className="px-4 py-2 rounded-lg bg-red-900/40 text-red-300 border border-red-800 text-sm font-bold hover:bg-red-900/60">{t.stop}</button>
                    ) : (
                        <button
                            onClick={run}
                            disabled={!isSignedIn || !docsOk}
                            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                            {shown ? t.regenerate : t.generate}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default BriefingPanel;
