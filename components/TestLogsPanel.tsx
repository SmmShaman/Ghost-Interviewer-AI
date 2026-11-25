import React, { useState } from 'react';
import { RecordedSession, sessionFileName, sessionRecorder, sessionToText } from '../services/sessionRecorder';

// Saved test logs: share (phone share sheet -> Gmail / Drive / Telegram), download or copy.

interface Props {
    isOpen: boolean;
    onClose: () => void;
    uiLang: 'en' | 'uk';
}

const TestLogsPanel: React.FC<Props> = ({ isOpen, onClose, uiLang }) => {
    const [sessions, setSessions] = useState<RecordedSession[]>([]);
    const [note, setNote] = useState('');
    const uk = uiLang === 'uk';

    React.useEffect(() => {
        if (!isOpen) return;
        setNote('');
        setSessions(sessionRecorder.list());
        // Push what is pending and refresh the sync status while the panel is open.
        void sessionRecorder.upload().then(() => setSessions(sessionRecorder.list()));
        const timer = setInterval(() => setSessions(sessionRecorder.list()), 3000);
        return () => clearInterval(timer);
    }, [isOpen]);

    if (!isOpen) return null;

    const download = (s: RecordedSession) => {
        const url = URL.createObjectURL(new Blob([sessionToText(s)], { type: 'text/plain;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = sessionFileName(s);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const share = async (s: RecordedSession) => {
        const text = sessionToText(s);
        const file = new File([text], sessionFileName(s), { type: 'text/plain' });
        try {
            if ((navigator as any).canShare?.({ files: [file] })) {
                await navigator.share({ files: [file], title: sessionFileName(s) });
                return;
            }
        } catch (e: any) {
            if (e?.name === 'AbortError') return; // user closed the share sheet
        }
        download(s);
        setNote(uk ? 'Поділитися файлом тут не можна — файл завантажено.' : 'Sharing is not available here — the file was downloaded.');
    };

    const copy = async (s: RecordedSession) => {
        try {
            await navigator.clipboard.writeText(sessionToText(s));
            setNote(uk ? 'Скопійовано в буфер обміну.' : 'Copied to the clipboard.');
        } catch {
            setNote(uk ? 'Не вдалося скопіювати.' : 'Could not copy.');
        }
    };

    const clearAll = () => {
        if (!window.confirm(uk ? 'Видалити всі збережені логи?' : 'Delete all saved logs?')) return;
        sessionRecorder.clearAll();
        setSessions([]);
    };

    const summary = (s: RecordedSession) => {
        const segs = s.events.filter(e => e.k === 'segment').length;
        const qs = s.events.filter(e => e.k === 'question').length;
        const end = s.endedAt ?? s.startedAt + (s.events.at(-1)?.t ?? 0);
        const min = Math.max(0, Math.round((end - s.startedAt) / 60000));
        const pending = s.events.filter(e => (e.seq ?? -1) >= (s.uploadedSeq ?? 0)).length;
        const sync = pending === 0 && (s.textUploaded || !s.endedAt)
            ? (uk ? '☁ на сервері' : '☁ on the server')
            : (uk ? `⏳ ще не відправлено: ${pending} подій` : `⏳ not sent yet: ${pending} events`);
        return `${uk ? `${min} хв · ${segs} фраз · ${qs} питань` : `${min} min · ${segs} phrases · ${qs} questions`} · ${sync}`;
    };

    return (
        <div className="fixed inset-0 z-[95] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm sm:p-6" onClick={onClose}>
            <div
                className="w-full sm:max-w-lg max-h-[85dvh] flex flex-col bg-gray-900 border border-gray-700 rounded-t-2xl sm:rounded-2xl shadow-2xl"
                style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-3 p-4 border-b border-gray-800">
                    <div>
                        <h2 className="text-lg font-bold text-white">{uk ? 'Логи тестів' : 'Test logs'}</h2>
                        <p className="text-xs text-gray-400 leading-snug">
                            {uk
                                ? 'Кожна сесія записується автоматично: кожне розпізнане слово, чернетка, переклад LLM, відповіді й час. Поки ви увійшли через Google, лог одразу йде на сервер; без мережі чекає тут і відправляється пізніше.'
                                : 'Every session is recorded automatically: every recognized word, draft, LLM translation, answers and timings. While signed in it goes to the server right away; offline it waits here and is sent later.'}
                        </p>
                    </div>
                    <button onClick={onClose} className="shrink-0 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300 text-xs font-bold border border-gray-700">
                        {uk ? 'Закрити' : 'Close'}
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {sessions.length === 0 && (
                        <p className="py-8 text-center text-sm text-gray-500 italic">
                            {uk ? 'Ще немає записаних сесій. Запустіть режим і поговоріть.' : 'No recorded sessions yet.'}
                        </p>
                    )}
                    {sessions.map(s => (
                        <div key={s.id} className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                            <div className="flex items-baseline justify-between gap-2">
                                <span className="text-sm font-semibold text-gray-200">{new Date(s.startedAt).toLocaleString()}</span>
                                <span className="text-[11px] text-gray-500">{s.meta.mode}</span>
                            </div>
                            <div className="text-xs text-gray-500 mt-0.5">{summary(s)}</div>
                            <div className="mt-2 grid grid-cols-3 gap-2">
                                <button onClick={() => share(s)} className="min-h-[44px] rounded-lg bg-cyan-600/20 border border-cyan-500/40 text-cyan-200 text-xs font-bold active:bg-cyan-600/40">
                                    {uk ? 'Поділитися' : 'Share'}
                                </button>
                                <button onClick={() => download(s)} className="min-h-[44px] rounded-lg bg-gray-800 border border-gray-700 text-gray-200 text-xs font-bold">
                                    {uk ? 'Завантажити' : 'Download'}
                                </button>
                                <button onClick={() => copy(s)} className="min-h-[44px] rounded-lg bg-gray-800 border border-gray-700 text-gray-200 text-xs font-bold">
                                    {uk ? 'Копіювати' : 'Copy'}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="p-3 border-t border-gray-800 flex items-center justify-between gap-3">
                    <span className="text-xs text-emerald-300">{note}</span>
                    {sessions.length > 0 && (
                        <button onClick={clearAll} className="text-xs text-red-400 hover:text-red-300">{uk ? 'Видалити всі' : 'Delete all'}</button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default TestLogsPanel;
