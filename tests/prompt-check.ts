/**
 * Manual quality check of the live-translation prompt against real models.
 * Prints each test fragment's system/user prompt as JSON lines; pipe them to
 * any runner. Used during development with the Claude CLI:
 *   node --experimental-strip-types tests/prompt-check.ts > cases.jsonl
 */
import { buildTranslationSystem, buildTranslationUser, type TranslationRequest } from '../services/prompts.ts';

const base = { sourceLang: 'Norwegian', nativeLang: 'Ukrainian', detectQuestions: true, handledQuestions: [] as string[], keyterms: ['Nordlys Digital', 'React', 'TypeScript', 'PHP', 'Kubernetes', 'Hamar'] };
const cases: Array<Partial<TranslationRequest> & { name: string; fragment: string }> = [
    { name: 'greeting', context: [], fragment: 'hei og velkommen til intervjuet hører du meg bra', speakerContinues: false },
    { name: 'continuation+who', context: [{ source: 'men vi har også en del eldre kode i php', translation: 'Але в нас також є чимало старого коду на PHP,' }], fragment: 'som vi holder på å skrive om', speakerContinues: false },
    { name: 'negation', context: [], fragment: 'hos oss er det ikke så viktig at du kan alt fra før men det er viktig at du tør å spørre når du står fast', speakerContinues: false },
    { name: 'question', context: [{ source: 'vi lager bookingløsninger for norske kommuner', translation: 'Ми робимо системи бронювання для норвезьких комун.' }], fragment: 'kan du begynne med å fortelle litt om deg selv og hva du har jobbet med de siste årene', speakerContinues: false },
    { name: 'stt-error', context: [], fragment: 'jeg er teamleder i nord lys digitalt og vi bruker mye reakt og taip skript', speakerContinues: false },
    { name: 'cut-mid-speech', context: [], fragment: 'det vi ser etter er en person som kan jobbe selvstendig men som også', speakerContinues: true },
    { name: 'question-inside-batch', context: [], fragment: 'har du erfaring med kubernetes og drift av tjenester i sky for det er noe vi kommer til å trenge', speakerContinues: true },
    { name: 'numbers', context: [], fragment: 'stillingen er hundre prosent fast med seks måneders prøvetid og oppstart første mars lønnen ligger mellom sekshundre og femti og sjuhundre og tjue tusen', speakerContinues: false },
];
for (const c of cases) {
    const req = { ...base, context: [], speakerContinues: false, ...c } as TranslationRequest;
    console.log(JSON.stringify({ name: c.name, fragment: c.fragment, system: buildTranslationSystem(req), prompt: buildTranslationUser(req) }));
}
