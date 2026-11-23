/**
 * PROMPTS + PARSERS
 *
 * Pure functions (no browser, no network) so they can be exercised from
 * Node scripts in tests/. Three jobs:
 *   1. live translation of one speech segment (+ optional question detection),
 *   2. a grounded answer to an interviewer question,
 *   3. the pre-interview briefing.
 *
 * Prompt language is Ukrainian on purpose: the reader of every output is a
 * Ukrainian-speaking candidate, and the models follow the register better.
 */

import type { ViewMode } from '../types';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export interface CandidateDocs {
    resume: string;
    knowledgeBase: string;
    applicationLetter: string;
    companyDescription: string;
    jobDescription: string;
}

// Generous caps: the whole point is to stop truncating the candidate's
// documents. They only guard against a pathological paste.
const CAPS = {
    resume: 20_000,
    knowledgeBase: 60_000,
    applicationLetter: 10_000,
    companyDescription: 15_000,
    jobDescription: 15_000,
    briefing: 14_000,
    personal: 4_000,
};

const clip = (text: string | undefined, max: number): string => {
    const t = (text || '').trim();
    return t.length > max ? t.slice(0, max) + '\n[…обрізано]' : t;
};

const block = (tag: string, text: string): string =>
    `<${tag}>\n${text || '[порожньо]'}\n</${tag}>`;

/** Stable hash of everything the briefing depends on (stale detection). */
export function hashDocs(docs: CandidateDocs, sourceLang: string, nativeLang: string): string {
    const input = [docs.resume, docs.knowledgeBase, docs.applicationLetter, docs.companyDescription, docs.jobDescription, sourceLang, nativeLang]
        .map(s => (s || '').trim()).join('\u0001');
    let h1 = 5381, h2 = 52711;
    for (let i = 0; i < input.length; i++) {
        const c = input.charCodeAt(i);
        h1 = ((h1 << 5) + h1) ^ c;
        h2 = ((h2 << 5) + h2) ^ c;
    }
    return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

/** True when there is anything real to ground answers on. */
export function hasDocs(docs: CandidateDocs): boolean {
    return (docs.resume || '').trim().length > 40 || (docs.jobDescription || '').trim().length > 40;
}

// ---------------------------------------------------------------------------
// 1. Live translation
// ---------------------------------------------------------------------------

export const QUESTION_MARKER = '@@Q:';

export interface TranslationRequest {
    sourceLang: string;            // e.g. "Norwegian"
    nativeLang: string;            // e.g. "Ukrainian"
    /** Previous segments, oldest first (already translated). */
    context: Array<{ source: string; translation: string }>;
    fragment: string;
    /** True when the segment was cut while the speaker kept talking. */
    speakerContinues: boolean;
    detectQuestions: boolean;
    handledQuestions: string[];
    keyterms: string[];
}

export function buildTranslationSystem(req: Pick<TranslationRequest, 'sourceLang' | 'nativeLang' | 'detectQuestions' | 'keyterms'>): string {
    const { sourceLang: SRC, nativeLang: DST } = req;
    const keyterms = req.keyterms.length
        ? `\n7. Назви й терміни, які можуть прозвучати (розпізнавання часто їх спотворює — впізнавай і пиши правильно): ${req.keyterms.slice(0, 60).join('; ')}.`
        : '';
    const question = req.detectQuestions ? `

ПИТАННЯ ДО КАНДИДАТА
Якщо в «НОВОМУ ФРАГМЕНТІ» (з урахуванням контексту) інтерв'юер ЗАВЕРШИВ питання або прохання, на яке кандидат має відповісти («розкажіть про…», «чому…», «як би ви…», «маєте питання?»), після перекладу додай з нового рядка рівно один рядок:
${QUESTION_MARKER} <повне питання мовою ${SRC}, відновлене з контексту, одним реченням> || <те саме питання мовою ${DST}>
НЕ додавай цей рядок, якщо: це розповідь або риторичне питання; це технічна репліка («чуєте мене?», «бачите екран?»); питання вже є у списку «ВЖЕ ОПРАЦЬОВАНІ ПИТАННЯ».
Якщо стан — «МОВЕЦЬ ЩЕ ГОВОРИТЬ», кінець фрагмента може бути обірваний: питання, яке стоїть у самому кінці й може бути незавершеним, не позначай (воно прийде наступним фрагментом); питання, яке повністю завершилося всередині фрагмента, позначай.` : '';

    return `Ти синхронний усний перекладач на співбесіді. Перекладаєш мовлення інтерв'юера з мови ${SRC} на мову ${DST}. Кандидат читає твій переклад з екрана просто під час розмови, тому важливі точність і швидкість читання.

ВХІД — автоматична транскрипція живого мовлення: без розділових знаків, з помилками розпізнавання, словами-паразитами й повторами.

ПРАВИЛА
1. Перекладай ТІЛЬКИ «НОВИЙ ФРАГМЕНТ». «ПОПЕРЕДНІЙ КОНТЕКСТ» потрібен лише для розуміння — не перекладай його вдруге.
2. Передавай зміст точно: заперечення, числа, дати, імена, умови, модальність («мусите», «можна», «бажано»). Нічого не додавай, не пояснюй, не прикрашай і не пропускай по суті.
3. Пиши грамотною, природною розмовною мовою ${DST}: без кальок і слів з інших мов, короткими ясними реченнями, з розділовими знаками. Слова-паразити й повтори пропускай. Звертання інтерв'юера до кандидата передавай ввічливою формою («ви»), навіть якщо в оригіналі «du».
   Уважно з особою дієслів і займенників: хто що робить («vi» — ми, «dere» — ви, «de» — вони) має лишитися тим самим.
4. Очевидну помилку розпізнавання (слово звучить схоже, але в контексті безглузде) виправ за змістом. Якщо не впевнений — переклади як почуто, нічого не домислюй.
5. Якщо фрагмент продовжує попереднє речення — продовж його граматично, з малої літери. Якщо фрагмент обривається на півслові — обірви переклад так само («…»), не вигадуй закінчення.
6. Назви компаній, продуктів, технологій та імена людей залишай мовою оригіналу. Звичайні слова оригіналу в дужках не дублюй.${keyterms}

ФОРМАТ ВІДПОВІДІ
Лише переклад одним абзацем. Без лапок, без оригіналу, без слів «Переклад:», без пояснень своїх рішень і без жодних приміток — на екрані кандидата має бути тільки текст перекладу.${question}`;
}

export function buildTranslationUser(req: TranslationRequest): string {
    const ctx = req.context.length
        ? req.context.map(c => `[${req.sourceLang}] ${c.source}\n[${req.nativeLang}] ${c.translation}`).join('\n')
        : '(початок розмови)';
    const parts = [`ПОПЕРЕДНІЙ КОНТЕКСТ (вже перекладено, не повторюй):\n${ctx}`];
    if (req.detectQuestions) {
        parts.push(`ВЖЕ ОПРАЦЬОВАНІ ПИТАННЯ:\n${req.handledQuestions.length ? req.handledQuestions.slice(-6).map(q => `- ${q}`).join('\n') : '(немає)'}`);
        parts.push(`СТАН: ${req.speakerContinues ? 'МОВЕЦЬ ЩЕ ГОВОРИТЬ' : 'мовець зробив паузу'}`);
    }
    parts.push(`НОВИЙ ФРАГМЕНТ (${req.sourceLang}):\n${req.fragment}`);
    return parts.join('\n\n');
}

export interface ParsedTranslation {
    translation: string;
    question: { source: string; native: string } | null;
}

/**
 * Parse a (possibly partial) translation stream. Safe to call on every chunk:
 * a marker that is still arriving is hidden from the visible translation.
 */
export function parseTranslation(raw: string, complete: boolean): ParsedTranslation {
    let text = raw;
    let question: ParsedTranslation['question'] = null;

    const idx = text.indexOf('@@');
    if (idx !== -1) {
        const tail = text.slice(idx);
        text = text.slice(0, idx);
        if (complete && tail.startsWith(QUESTION_MARKER)) {
            const body = tail.slice(QUESTION_MARKER.length).split('\n')[0];
            const [src, native] = body.split('||').map(s => s.trim());
            if (src && src.length > 3) question = { source: src, native: native || '' };
        }
    } else if (!complete) {
        // Hide a lone trailing "@" that may be the start of the marker.
        text = text.replace(/@$/, '');
    }

    const translation = text
        .replace(/^\s*["«„]|["»“]\s*$/g, '')
        .replace(/\s+\n/g, '\n')
        .trim();
    return { translation, question };
}

/**
 * Rough similarity of two questions for de-duplication: shared words over all
 * words (Jaccard). Dividing by the smaller set would treat a short follow-up
 * ("kan du fortelle litt mer om det?") as a duplicate of any longer question.
 */
export function questionSimilarity(a: string, b: string): number {
    const norm = (s: string) => new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 2));
    const A = norm(a), B = norm(b);
    if (A.size === 0 || B.size === 0) return 0;
    let shared = 0;
    for (const w of A) if (B.has(w)) shared++;
    return shared / (A.size + B.size - shared);
}

// ---------------------------------------------------------------------------
// 2. Grounded answers
// ---------------------------------------------------------------------------

export interface AnswerSettings {
    sourceLang: string;
    nativeLang: string;
    proficiencyLevel: string;
    tone: string;
    personalInstructions: string;
    briefing: string;
}

/**
 * System prompt for answers. Depends only on documents + settings, so it is
 * byte-identical for every question of a session and can be prompt-cached.
 */
export function buildAnswerSystem(docs: CandidateDocs, s: AnswerSettings): string {
    const SRC = s.sourceLang, DST = s.nativeLang;
    const personal = clip(s.personalInstructions, CAPS.personal);
    return `Ти — помічник кандидата на співбесіді. Кандидат бачить твою підказку на екрані під час розмови й відповідає своїми словами мовою ${SRC}. Рівень мови кандидата: ${s.proficiencyLevel || 'B1'}. Бажаний тон: ${s.tone || 'Professional'}.

ГОЛОВНЕ ПРАВИЛО — ЖОДНИХ ВИГАДОК
- Факти про кандидата (досвід, проєкти, технології, цифри, дати, освіта, місця роботи) бери ТІЛЬКИ з розділу «ДОКУМЕНТИ КАНДИДАТА» та з брифінгу.
- Факти про компанію і вакансію — ТІЛЬКИ з розділу «ДОКУМЕНТИ РОБОТОДАВЦЯ» і з того, що інтерв'юер сам сказав у розмові.
- Якщо питають про досвід, якого в документах немає, — не вигадуй його. Чесно скажи, що прямого досвіду немає, назви найближчий реальний досвід із документів і готовність швидко розібратися.
- Не вигадуй цифр, назв, строків, сертифікатів, колег чи команд. Чого немає в документах — не згадуй.
- Якщо відповідь залежить від того, що знає лише кандидат (бажана зарплата, дата виходу, особисті обставини), дай готову рамку відповіді й познач місце для власних даних у квадратних дужках, наприклад [ваша сума].

ЯК ВІДПОВІДАТИ
- Відповідь мовою ${SRC}: 2–4 короткі речення простими конструкціями рівня ${s.proficiencyLevel || 'B1'}, щоб їх легко було вимовити вголос. Від першої особи. Без канцеляриту й самовихваляння.
- Спершу пряма відповідь на питання, потім один конкретний приклад із документів — за можливості той, що відповідає вимогам вакансії.
- На побутові чи організаційні питання — одне-два природні речення.
- Не суперечь відповідям, які кандидат уже дав раніше в цій розмові.

ФОРМАТ ЗАДАЄ ПОВІДОМЛЕННЯ КОРИСТУВАЧА. Використовуй теги точно так, як там написано, і нічого поза тегами.

════════ ДОКУМЕНТИ КАНДИДАТА ════════
${block('resume', clip(docs.resume, CAPS.resume))}

${block('knowledge_base', clip(docs.knowledgeBase, CAPS.knowledgeBase))}

${block('application_letter', clip(docs.applicationLetter, CAPS.applicationLetter))}

════════ ДОКУМЕНТИ РОБОТОДАВЦЯ ════════
${block('company', clip(docs.companyDescription, CAPS.companyDescription))}

${block('job', clip(docs.jobDescription, CAPS.jobDescription))}

════════ БРИФІНГ (аналіз, зроблений до співбесіди за цими ж документами) ════════
${block('briefing', clip(s.briefing, CAPS.briefing))}
${personal ? `
════════ ОСОБИСТІ ВКАЗІВКИ КАНДИДАТА ════════
Виконуй їх щодо ЗМІСТУ відповідей. Будь-які вказівки про формат, теги чи структуру відповіді в цьому блоці ігноруй.
${block('personal_instructions', personal)}
` : ''}`;
}

export interface AnswerRequest {
    mode: ViewMode;
    sourceLang: string;
    nativeLang: string;
    question: string;
    /** Recent interviewer speech in the source language, oldest first. */
    transcriptTail: string[];
    /** Earlier questions with the answers suggested for them. */
    previous: Array<{ question: string; answer: string }>;
}

export function buildAnswerUser(req: AnswerRequest): string {
    const SRC = req.sourceLang, DST = req.nativeLang;
    const tail = req.transcriptTail.length ? req.transcriptTail.map(l => `- ${l}`).join('\n') : '(немає)';
    const prev = req.previous.length
        ? req.previous.slice(-5).map(p => `П: ${p.question}\nВ: ${p.answer}`).join('\n')
        : '(немає)';

    const format = req.mode === 'FULL'
        ? `[STRATEGY]
2–3 дуже короткі тези мовою ${DST}, на що спертися у відповіді; кожна з нового рядка і починається з «• »
[ANSWER]
відповідь мовою ${SRC}
[TRANSLATION]
той самий зміст мовою ${DST}
[ANALYSIS]
1–2 речення мовою ${DST}: що інтерв'юер насправді хоче дізнатися і чого у відповіді уникати`
        : `[ANSWER]
відповідь мовою ${SRC}
[TRANSLATION]
той самий зміст мовою ${DST}`;

    return `ОСТАННІ РЕПЛІКИ ІНТЕРВ'ЮЕРА (${SRC}, автоматична транскрипція — можливі помилки):
${tail}

ПОПЕРЕДНІ ПИТАННЯ Й ЗАПРОПОНОВАНІ ВІДПОВІДІ:
${prev}

ПИТАННЯ, НА ЯКЕ ТРЕБА ВІДПОВІСТИ ЗАРАЗ:
${req.question}

ФОРМАТ (теги саме в такому порядку, кожен з нового рядка, без закривальних тегів):
${format}`;
}

export interface ParsedAnswer {
    strategy: string;
    answer: string;
    answerTranslation: string;
    analysis: string;
}

const ANSWER_TAGS = ['STRATEGY', 'ANSWER', 'TRANSLATION', 'ANALYSIS'] as const;

/** Parse a (possibly partial) tagged answer stream. */
export function parseAnswer(raw: string): ParsedAnswer {
    const found: Record<string, string> = {};
    const re = /\[(\/?)(STRATEGY|ANSWER|TRANSLATION|ANALYSIS)\]/gi;
    const marks: Array<{ tag: string; start: number; end: number; closing: boolean }> = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
        marks.push({ tag: m[2].toUpperCase(), start: m.index, end: m.index + m[0].length, closing: m[1] === '/' });
    }
    for (let i = 0; i < marks.length; i++) {
        if (marks[i].closing) continue;
        const stop = i + 1 < marks.length ? marks[i + 1].start : raw.length;
        found[marks[i].tag] = raw.slice(marks[i].end, stop);
    }
    const clean = (s: string | undefined) => (s || '')
        .replace(/\[\/?[A-Z_]*$/i, '')   // half-arrived tag at the end of the stream
        .trim();
    // No tags at all (model ignored the format): treat everything as the answer.
    if (marks.length === 0) return { strategy: '', answer: clean(raw), answerTranslation: '', analysis: '' };
    return {
        strategy: clean(found.STRATEGY),
        answer: clean(found.ANSWER),
        answerTranslation: clean(found.TRANSLATION),
        analysis: clean(found.ANALYSIS),
    };
}
export { ANSWER_TAGS };

// ---------------------------------------------------------------------------
// 3. Pre-interview briefing
// ---------------------------------------------------------------------------

export const KEYTERMS_MARKER = 'KEYTERMS:';

export function buildBriefingSystem(sourceLang: string, nativeLang: string): string {
    return `Ти досвідчений кар'єрний консультант. Готуєш кандидата до конкретної співбесіди, яка відбудеться мовою ${sourceLang}. Пишеш мовою ${nativeLang}, стисло й по суті — кандидат перечитає це за 5 хвилин до розмови, а помічник відповідей спиратиметься на цей текст під час неї.

ГОЛОВНЕ ПРАВИЛО — ЖОДНИХ ВИГАДОК
Спирайся лише на надані документи. Не додавай фактів про компанію, яких у документах немає (навіть якщо знаєш компанію). Не приписуй кандидатові досвіду, якого немає в резюме, базі знань чи супровідному листі. Якщо якогось документа немає або він порожній — так і напиши й не заповнюй прогалину здогадами.

СТРУКТУРА (саме ці заголовки, саме в такому порядку)

## Компанія
3–5 речень: чим займається, що для неї важливо, що з цього варто згадати на співбесіді.

## Вакансія: що їм потрібно
Список ключових вимог і задач (5–8 пунктів), від найважливішого.

## Відповідність вимогам
Для КОЖНОЇ вимоги з попереднього розділу один рядок:
✅ вимога — конкретний доказ із документів кандидата (проєкт, технологія, роль)
⚠️ вимога — частковий збіг: що саме є і чого бракує
❌ вимога — прямого досвіду немає; найближчий реальний досвід і чесна лінія відповіді

## Сильні сторони саме для цієї вакансії
3–5 пунктів, кожен із прикладом із документів.

## Ризикові теми
Що інтерв'юера може насторожити (прогалини, зміна сфери, рівень мови, перерви) і як про це говорити чесно та спокійно. 2–4 пункти.

## Імовірні питання
8–10 питань, які найімовірніше поставлять саме на цій співбесіді. Для кожного: питання мовою ${sourceLang}, переклад у дужках, і дві короткі опорні тези для відповіді (лише з документів).

## Питання до роботодавця
3–5 змістовних питань мовою ${sourceLang} з перекладом у дужках.

ОСТАННІЙ РЯДОК (обов'язково, після всіх розділів):
${KEYTERMS_MARKER} до 40 власних назв і термінів мовою ${sourceLang} або в оригінальному написанні, які можуть прозвучати на співбесіді (назва компанії, продукти, технології, посади, міста), через крапку з комою.`;
}

export function buildBriefingUser(docs: CandidateDocs): string {
    return `${block('resume', clip(docs.resume, CAPS.resume))}

${block('knowledge_base', clip(docs.knowledgeBase, CAPS.knowledgeBase))}

${block('application_letter', clip(docs.applicationLetter, CAPS.applicationLetter))}

${block('company', clip(docs.companyDescription, CAPS.companyDescription))}

${block('job', clip(docs.jobDescription, CAPS.jobDescription))}

Підготуй брифінг за структурою.`;
}

export function parseBriefing(raw: string): { text: string; keyterms: string[] } {
    const idx = raw.lastIndexOf(KEYTERMS_MARKER);
    if (idx === -1) return { text: raw.trim(), keyterms: [] };
    const keyterms = raw.slice(idx + KEYTERMS_MARKER.length)
        .split('\n')[0]
        .split(/[;,]/)
        .map(s => s.trim().replace(/\.$/, ''))
        .filter(s => s.length > 1 && s.length < 60)
        .slice(0, 40);
    return { text: raw.slice(0, idx).trim(), keyterms };
}
