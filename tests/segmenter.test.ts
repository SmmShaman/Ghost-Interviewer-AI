/**
 * Run: node --experimental-strip-types tests/segmenter.test.ts
 * Simulates how Chrome's Web Speech API delivers Norwegian speech
 * (growing interim hypotheses, a final after each pause, no punctuation).
 */
import { Segmenter } from '../services/segmenter.ts';

let failed = 0;
const check = (name: string, cond: boolean, detail = '') => {
    if (!cond) failed++;
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

/** Feed a sentence word by word as growing interim text, 150 ms per word. */
function speak(seg: Segmenter, sentence: string, startAt: number, out: string[], boundaries: string[]) {
    const words = sentence.split(' ');
    let t = startAt;
    for (let i = 1; i <= words.length; i++) {
        t += 150;
        for (const s of seg.pushInterim(words.slice(0, i).join(' '), t)) { out.push(s.text); boundaries.push(s.boundary); }
        for (const s of seg.tick(t)) { out.push(s.text); boundaries.push(s.boundary); }
    }
    return t;
}

// 1. Short question followed by a pause: one segment, emitted by the pause timer, final adds nothing.
{
    const seg = new Segmenter();
    const out: string[] = []; const b: string[] = [];
    const q = 'kan du fortelle litt om deg selv';
    let t = speak(seg, q, 0, out, b);
    check('short phrase: nothing emitted while speaking', out.length === 0);
    for (const s of seg.tick(t + 400)) { out.push(s.text); b.push(s.boundary); }
    check('short phrase: not emitted before pauseMs', out.length === 0);
    for (const s of seg.tick(t + 950)) { out.push(s.text); b.push(s.boundary); }
    check('short phrase: emitted on pause', out.length === 1 && out[0] === q && b[0] === 'pause', JSON.stringify(out));
    const fin = seg.pushFinal(q, t + 1200);
    check('short phrase: final after pause adds no duplicate', fin.length === 0, JSON.stringify(fin));
}

// 2. Final arrives before the pause timer: one 'final' segment.
{
    const seg = new Segmenter();
    const out: string[] = []; const b: string[] = [];
    const q = 'hva er din erfaring med react';
    const t = speak(seg, q, 0, out, b);
    const fin = seg.pushFinal(q, t + 300);
    check('final first: single final segment', out.length === 0 && fin.length === 1 && fin[0].text === q && fin[0].boundary === 'final');
    check('final first: later tick emits nothing', seg.tick(t + 5000).length === 0);
}

// 3. Long monologue without pauses: cut before clause openers, no word lost or duplicated.
{
    const seg = new Segmenter();
    const out: string[] = []; const b: string[] = [];
    const mono = 'vi er et lite selskap med rundt tjue ansatte og vi jobber mest med offentlige kunder men vi har også noen private prosjekter fordi vi ønsker å lære nye ting og så bruker vi mye tid på testing';
    const t = speak(seg, mono, 0, out, b);
    const fin = seg.pushFinal(mono, t + 300);
    const all = [...out, ...fin.map(f => f.text)];
    check('monologue: emitted segments while still speaking', out.length >= 2, `${out.length} live segments`);
    check('monologue: no word lost or duplicated', all.join(' ') === mono, '\n      ' + all.join('\n      '));
    check('monologue: live cuts are length boundaries', b.every(x => x === 'length'));
    check('monologue: every live segment starts a clause', out.slice(1).every(s => /^(og (vi|så)|men|fordi)\b/.test(s)), JSON.stringify(out.map(s => s.split(' ').slice(0, 2).join(' '))));
    check('monologue: no tiny segments', all.every(s => s.split(' ').length >= 4), JSON.stringify(all.map(s => s.split(' ').length)));
}

// 4. No natural boundary at all: hard cut, still lossless.
{
    const seg = new Segmenter();
    const out: string[] = []; const b: string[] = [];
    const words = Array.from({ length: 40 }, (_, i) => `ord${i}`).join(' ');
    const t = speak(seg, words, 0, out, b);
    const fin = seg.pushFinal(words, t + 300);
    const all = [...out, ...fin.map(f => f.text)];
    check('no boundary: hard cut happens', out.length >= 1);
    check('no boundary: lossless', all.join(' ') === words);
    check('no boundary: no segment above hard max', all.every(s => s.split(' ').length <= 22), JSON.stringify(all.map(s => s.split(' ').length)));
}

// 5. Recognizer revises the tail after a length cut: revised words still arrive.
{
    const seg = new Segmenter();
    const first = 'vi jobber mye med kunder i hele norge og vi har kontor i oslo og bergen';
    const live: string[] = [];
    for (const s of seg.pushInterim(first, 100)) live.push(s.text);
    const revised = 'vi jobber mye med kunder i hele norge og vi har kontorer i oslo og bergen i dag';
    const fin = seg.pushFinal(revised, 500);
    const all = [...live, ...fin.map(f => f.text)].join(' ');
    check('revision: revised tail is delivered', all.endsWith('i oslo og bergen i dag') && all.includes('kontorer'), all);
}

// 6. Two utterances in a row: state resets between them.
{
    const seg = new Segmenter();
    seg.pushInterim('hei og velkommen', 100);
    const a = seg.pushFinal('hei og velkommen', 300);
    seg.pushInterim('skal vi begynne', 1000);
    const b2 = seg.pushFinal('skal vi begynne', 1300);
    check('two utterances: both intact', a[0]?.text === 'hei og velkommen' && b2[0]?.text === 'skal vi begynne');
}

// 7. flush() on stop returns the unfinished phrase.
{
    const seg = new Segmenter();
    seg.pushInterim('jeg ville bare si at', 100);
    const f = seg.flush();
    check('flush: returns pending words', f.length === 1 && f[0].text === 'jeg ville bare si at');
    check('flush: leaves nothing behind', seg.flush().length === 0 && seg.pendingText === '');
}

// 8. Very long final without interim (recognizer delivered it at once): split, lossless.
{
    const seg = new Segmenter();
    const long = 'først vil jeg si litt om stillingen og hva vi ser etter i en kandidat fordi det er viktig for oss at du forstår hvordan vi jobber i teamet og hvilke forventninger vi har til deg når du begynner hos oss etter sommeren';
    const fin = seg.pushFinal(long, 100);
    check('long final: split into several', fin.length >= 2, `${fin.length} parts`);
    check('long final: lossless', fin.map(f => f.text).join(' ') === long);
}

// 9. Words that look like conjunctions but are not clause boundaries.
{
    const run = (sentence: string) => {
        const seg = new Segmenter();
        const out: string[] = []; const b: string[] = [];
        const t = speak(seg, sentence, 0, out, b);
        const fin = seg.pushFinal(sentence, t + 300);
        return [...out, ...fin.map(f => f.text)];
    };
    const a = run('vi jobber mest med react og typescript på frontend men vi har også en del eldre kode i php som vi holder på å skrive om');
    check('noun list: "react og typescript" stays together', a.some(s => s.includes('react og typescript')), JSON.stringify(a));
    const c = run('hos oss er det ikke så viktig at du kan alt fra før men det er viktig at du tør å spørre når du står fast');
    check('adverb: "ikke så viktig" stays together', c.some(s => s.includes('ikke så viktig')), JSON.stringify(c));
    const d = run('kan du begynne med å fortelle litt om deg selv og hva du har jobbet med de siste årene');
    check('pronoun: "deg selv" stays together', d.some(s => s.includes('deg selv')), JSON.stringify(d));
}

// 10. Hesitation after two words is not the end of a phrase.
{
    const seg = new Segmenter();
    seg.pushInterim('så bra', 0);
    check('hesitation: short phrase survives a 1 s gap', seg.tick(1000).length === 0);
    check('hesitation: short phrase is emitted after a long gap', seg.tick(1900).length === 1);
}

// 11. Interim spanning two recognizer results; only the first is finalized.
{
    const seg = new Segmenter();
    const out: string[] = [];
    seg.pushInterim('jeg har jobbet', 0);
    seg.pushInterim('jeg har jobbet med salg i oslo', 100);
    for (const s of seg.tick(1100)) out.push(s.text);               // pause: everything emitted
    for (const s of seg.pushFinal('jeg har jobbet', 1200)) out.push(s.text);   // result A only
    for (const s of seg.pushInterim('med salg i oslo og bergen', 1300)) out.push(s.text); // result B continues
    for (const s of seg.pushFinal('med salg i oslo og bergen', 1400)) out.push(s.text);
    check('multi-result: no duplicated words', out.join(' ') === 'jeg har jobbet med salg i oslo og bergen', JSON.stringify(out));
}

// 12. Hypothesis shrinks and grows back after a pause emit.
{
    const seg = new Segmenter();
    const out: string[] = [];
    seg.pushInterim('har du erfaring med react', 0);
    for (const s of seg.tick(1000)) out.push(s.text);
    seg.pushInterim('har du', 1100);
    seg.pushInterim('har du erfaring med react og node', 1200);
    for (const s of seg.pushFinal('har du erfaring med react og node', 1300)) out.push(s.text);
    check('shrink/regrow: no duplicated words', out.join(' ') === 'har du erfaring med react og node', JSON.stringify(out));
}

// 13. flushPending keeps the utterance open (pause button), final adds only the rest.
{
    const seg = new Segmenter();
    seg.pushInterim('takk for det', 0);
    const a = seg.flushPending();
    const b = seg.pushFinal('takk for det svaret', 500);
    check('flushPending: no repeat on later final', a[0]?.text === 'takk for det' && b.length === 1 && b[0].text === 'svaret', JSON.stringify([a, b]));
}

// 14. Android Chrome: a new utterance replaces the hypothesis without any final
//     (replay of a real phone log, 2026-11-25). Nothing may be lost.
{
    const seg = new Segmenter();
    const out: string[] = [];
    const feed = (text: string, t: number) => { for (const s of seg.pushInterim(text, t)) out.push(s.text); };
    const wait = (t: number) => { for (const s of seg.tick(t)) out.push(s.text); };
    feed('for', 11170); feed('forsv', 11270); feed('forsvinner', 11335);
    feed('forsvinner ett helt', 11844); feed('forsvinner ett helt eventyr', 12242);
    feed('a', 12945);
    check('android: replaced short phrase is emitted, not lost', out.length === 1 && out[0] === 'forsvinner ett helt eventyr', JSON.stringify(out));
    feed('aksjonærene har tjent svært godt og selskapet selv', 15239);
    wait(16247);
    check('android: pause segment', out[1] === 'aksjonærene har tjent svært godt og selskapet selv', JSON.stringify(out));
    feed('nå', 18006); feed('Nå kan festen likevel være', 18895);
    wait(19900);
    check('android: phrase after an unfinalized one is emitted on pause', out[2] === 'Nå kan festen likevel være', JSON.stringify(out));
    feed('fremover', 24454); feed('fremover historien', 24591);
    for (const s of seg.flush()) out.push(s.text);
    check('android: nothing lost or repeated', out.join(' | ') === 'forsvinner ett helt eventyr | aksjonærene har tjent svært godt og selskapet selv | Nå kan festen likevel være | fremover historien', JSON.stringify(out));
}

console.log(failed === 0 ? '\nALL PASSED' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
