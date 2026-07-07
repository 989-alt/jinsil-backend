// Offline golden tests for the curriculum lock (no network, no Gemini key needed).
// Feeds crafted / hostile "model outputs" to validate() and asserts they are sanitised so that
// ONLY whitelisted, grounded, correctly-shaped codes can ever reach a student.
// Run: node test/coach.test.js

const { validate, ALL_CODES } = require('../api/_coach');

let fails = 0;
function check(name, cond) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) fails++;
}

const TITLE = '무상급식 중단은 사실이 아니었다';
const BODY = '교육청에 따르면 무상급식을 중단한 사실이 없다. 확인 결과 예산은 늘었다.';

// 1) An off-curriculum code (spelling / handwriting) is dropped entirely.
{
  const out = validate({ items: [
    { n: 1, status: 'X', code: 'C1_SPELLING', evidence: '' },
    { n: 3, status: 'X', code: 'C3_HANDWRITING', evidence: '엉망' },
  ], praise: 'P_TRY' }, TITLE, BODY);
  check('off-curriculum codes dropped (no C1_SPELLING/C3_HANDWRITING)',
    out.items.every((i) => ALL_CODES.has(i.code)) && !out.items.some((i) => i.n === 1 || i.n === 3));
}

// 2) A hallucinated accusation whose evidence is NOT in the text is dropped (anti-hallucination).
{
  const out = validate({ items: [
    { n: 4, status: 'X', code: 'C4_RUMOR', evidence: '외계인이 급식을 먹었다' }, // not in student text
  ], praise: 'P_TRY' }, TITLE, BODY);
  check('ungrounded C4_RUMOR dropped (evidence not in text)', !out.items.some((i) => i.n === 4));
}

// 3) A grounded accusation is kept, with its quote preserved.
{
  const t = '충격! 무상급식 중단 진실';
  const out = validate({ items: [
    { n: 3, status: 'X', code: 'C3_CLICKBAIT', evidence: '충격' },
  ], praise: 'P_TRY' }, t, BODY);
  const it = out.items.find((i) => i.n === 3);
  check('grounded C3_CLICKBAIT kept with evidence', !!it && it.code === 'C3_CLICKBAIT' && it.evidence === '충격');
}

// 4) A code claimed under the WRONG criterion number is dropped.
{
  const out = validate({ items: [
    { n: 4, status: 'X', code: 'C3_CLICKBAIT', evidence: '충격' }, // C3 code under n=4
  ], praise: 'P_TRY' }, '충격 제목', BODY);
  check('cross-criterion code dropped (C3 under n=4)', !out.items.some((i) => i.n === 4));
}

// 5) Evidence is stripped from absence/OK codes even if the model tried to attach one.
{
  const out = validate({ items: [
    { n: 1, status: 'X', code: 'C1_NONE', evidence: '아무거나' },
    { n: 5, status: 'O', code: 'C5_OK', evidence: '무엇' },
  ], praise: 'P_TRY' }, TITLE, BODY);
  const c1 = out.items.find((i) => i.n === 1);
  const c5 = out.items.find((i) => i.n === 5);
  check('evidence stripped from non-quote codes', c1.evidence === '' && c5.evidence === '');
}

// 6) Duplicate criteria are de-duplicated (first wins).
{
  const out = validate({ items: [
    { n: 2, status: 'O', code: 'C2_OK', evidence: '' },
    { n: 2, status: 'X', code: 'C2_ONE', evidence: '' },
  ], praise: 'P_TRY' }, TITLE, BODY);
  check('duplicate n de-duplicated', out.items.filter((i) => i.n === 2).length === 1);
}

// 7) Status is coerced to agree with the code family (a lying status is corrected).
{
  const out = validate({ items: [
    { n: 1, status: 'O', code: 'C1_NONE', evidence: '' }, // says OK but code = NONE
    { n: 2, status: 'X', code: 'C2_ONE', evidence: '' },  // C2_ONE is partial, not X
  ], praise: 'P_TRY' }, TITLE, BODY);
  const c1 = out.items.find((i) => i.n === 1);
  const c2 = out.items.find((i) => i.n === 2);
  check('status coerced from code (C1_NONE -> X)', c1.status === 'X');
  check('status coerced from code (C2_ONE -> PARTIAL)', c2.status === 'PARTIAL');
}

// 8) praise is whitelisted; a bogus praise falls back sensibly.
{
  const allOk = validate({ items: [1, 2, 3, 4, 5].map((n) => ({ n, status: 'O', code: 'C' + n + '_OK', evidence: '' })), praise: 'HAHA' }, TITLE, BODY);
  check('bogus praise -> P_GOOD when all OK', allOk.praise === 'P_GOOD');
  const some = validate({ items: [{ n: 1, status: 'X', code: 'C1_NONE', evidence: '' }], praise: 'nonsense' }, TITLE, BODY);
  check('bogus praise -> P_TRY otherwise', some.praise === 'P_TRY');
}

// 9) Fuzz: whatever garbage goes in, every surviving code is on the whitelist and shape holds.
{
  const junk = { items: [], praise: 'x' };
  const codes = ['C1_NONE', 'ZZZ', 'C2_ONE', 'C9_X', 'C3_CLICKBAIT', 'grammar', 'C5_OK', '', null, 42];
  for (let i = 0; i < 40; i++) {
    junk.items.push({ n: (i % 7), status: ['O', 'X', 'PARTIAL', 'weird'][i % 4], code: codes[i % codes.length], evidence: (i % 3 ? '충격' : 'nope' + i) });
  }
  const out = validate(junk, '충격 제목', BODY);
  const uniqueN = new Set(out.items.map((i) => i.n));
  check('fuzz: all output codes whitelisted', out.items.every((i) => ALL_CODES.has(i.code)));
  check('fuzz: <=5 items, unique n in 1..5, sorted', out.items.length <= 5 && uniqueN.size === out.items.length
    && out.items.every((i) => i.n >= 1 && i.n <= 5)
    && out.items.every((i, k) => k === 0 || out.items[k - 1].n < i.n));
  check('fuzz: every code matches its criterion number', out.items.every((i) => i.code.startsWith('C' + i.n + '_')));
}

// 10) Empty / malformed model -> empty items (client falls back fully to local), never throws.
{
  const a = validate(null, TITLE, BODY);
  const b = validate({}, TITLE, BODY);
  const c = validate({ items: 'not-an-array' }, TITLE, BODY);
  check('malformed model -> empty items, no throw', a.items.length === 0 && b.items.length === 0 && c.items.length === 0);
}

// 11) Trivial evidence (whitespace / single char) is dropped even though it is a substring.
{
  const out = validate({ items: [
    { n: 3, status: 'X', code: 'C3_CLICKBAIT', evidence: ' ' },   // space is in every article
    { n: 4, status: 'X', code: 'C4_RUMOR', evidence: '다' },       // single common syllable
  ], praise: 'P_TRY' }, TITLE, BODY);
  check('trivial evidence (space / 1 char) dropped', !out.items.some((i) => i.n === 3 || i.n === 4));
}

// 12) C3 is TRUSTED as the model returns it (the model judges the student's OWN wording). The server no
//     longer quote-guards C3, so a grounded C3_CLICKBAIT survives even when the hit is in quotes — closing
//     an evasion where wrapping a hype word in emphasis quotes silenced C3 on both layers.
{
  const t = "우리 급식은 '대박'입니다";
  const out = validate({ items: [
    { n: 3, status: 'X', code: 'C3_CLICKBAIT', evidence: '대박' },
  ], praise: 'P_TRY' }, t, BODY);
  const it = out.items.find((i) => i.n === 3);
  check('grounded C3 kept even when quoted (model is the judge)', !!it && it.code === 'C3_CLICKBAIT');
}

// 13) C4_RUMOR is dropped ONLY when the student refuted it IN THE SAME SENTENCE (client-sent markers).
{
  const b = '확실하지 않은 소문이 돌았지만 조사 결과 이는 사실이 아니었다';   // one sentence
  const out = validate({ items: [
    { n: 4, status: 'X', code: 'C4_RUMOR', evidence: '확실하지 않' },
  ], praise: 'P_TRY' }, TITLE, b, ['사실이 아니', '조사 결과']);
  check('same-sentence refutation drops C4_RUMOR', !out.items.some((i) => i.n === 4));
  const out2 = validate({ items: [
    { n: 4, status: 'X', code: 'C4_RUMOR', evidence: '확실하지 않' },
  ], praise: 'P_TRY' }, TITLE, b);
  check('C4_RUMOR survives when no refute markers supplied', out2.items.some((i) => i.n === 4));
}

// 13b) A refutation in a DIFFERENT sentence must NOT mask the student's OWN speculation (the over-suppression bug).
{
  const b = '확인해 보니 급식 중단은 사실이 아니었다. 그런데 아마 내년엔 중단될 것 같다';
  const out = validate({ items: [
    { n: 4, status: 'X', code: 'C4_RUMOR', evidence: '아마 내년엔 중단될 것 같다' },
  ], praise: 'P_TRY' }, TITLE, b, ['사실이 아니']);
  check('cross-sentence refutation does NOT mask own speculation', out.items.some((i) => i.n === 4));
}

// 13c) Untrusted refute markers: a single common syllable can never silence C4 (>= 2 chars required).
{
  const b = '아마 급식이 중단될 것 같다';
  const out = validate({ items: [
    { n: 4, status: 'X', code: 'C4_RUMOR', evidence: '아마' },
  ], praise: 'P_TRY' }, TITLE, b, ['다', '이', ' ']);   // all < 2 non-space chars -> ignored
  check('single-syllable refute cannot silence C4', out.items.some((i) => i.n === 4));
}

// 14) praise is DERIVED from items — a model-supplied P_GOOD with a failing item becomes P_TRY.
{
  const out = validate({ items: [{ n: 1, status: 'X', code: 'C1_NONE', evidence: '' }], praise: 'P_GOOD' }, TITLE, BODY);
  check('praise derived: inconsistent P_GOOD -> P_TRY', out.praise === 'P_TRY');
  const allOk = validate({ items: [1, 2, 3, 4, 5].map((n) => ({ n, status: 'O', code: 'C' + n + '_OK', evidence: '' })), praise: 'P_TRY' }, TITLE, BODY);
  check('praise derived: all-OK -> P_GOOD even if model said P_TRY', allOk.praise === 'P_GOOD');
}

console.log('RESULT ' + (fails === 0 ? 'ALL_PASS' : ('HAS_FAIL (' + fails + ')')));
process.exit(fails === 0 ? 0 : 1);
