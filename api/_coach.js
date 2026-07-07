// Curriculum-lock core for the ch4 correction-article feedback harness.
//
// The Gemini model is only ever allowed to CLASSIFY — it returns codes from a fixed whitelist
// plus a verbatim quote of the student's own text. This module SANITISES the model's raw output
// so that nothing off-curriculum can reach a student:
//   1) whitelist        — a code must be one of the 12 known codes AND match its criterion number
//   2) grounding        — a "you wrote something bad" code must quote a real substring of the text
//   3) shape/dedup      — at most one item per criterion 1..5, evidence stripped from non-quote codes
// Anything that fails is DROPPED (not guessed): the client then falls back to its offline local read
// for that criterion. No Korean lives here — the client turns codes into pre-authored advice.

const ALL_CODES = new Set([
  'C1_OK', 'C1_NONE',
  'C2_OK', 'C2_ONE',
  'C3_OK', 'C3_CLICKBAIT', 'C3_EXAGGERATION',
  'C4_OK', 'C4_RUMOR',
  'C5_OK', 'C5_NO_TARGET', 'C5_NO_CORRECTION',
]);

// Codes that assert the student WROTE a bad phrase -> must carry grounded evidence.
const EVIDENCE_CODES = new Set(['C3_CLICKBAIT', 'C3_EXAGGERATION', 'C4_RUMOR']);

// Codes that are "partial" rather than "missing" (for status inference).
const PARTIAL_CODES = new Set(['C2_ONE', 'C5_NO_CORRECTION']);

const OK_CODE = { 1: 'C1_OK', 2: 'C2_OK', 3: 'C3_OK', 4: 'C4_OK', 5: 'C5_OK' };

function normStatus(s) {
  s = (s == null ? '' : s).toString().trim().toUpperCase();
  if (s === 'O' || s === 'OK') return 'O';
  if (s === 'PARTIAL' || s === 'P' || s === '△') return 'PARTIAL';
  if (s === 'X' || s === 'MISSING') return 'X';
  return null;
}

function statusForCode(code, n) {
  // The code alone determines the status — the model cannot escalate/soften it.
  if (code === OK_CODE[n]) return 'O';
  if (PARTIAL_CODES.has(code)) return 'PARTIAL';
  return 'X';
}

// The single sentence of `text` that contains `needle` (boundaries: . ! ? newline 。). Used to keep the
// C4 debunk-guard local so a refutation in one sentence can't mask speculation the student adds in another.
function sentenceOf(text, needle) {
  if (!text || !needle) return '';
  const at = text.indexOf(needle);
  if (at < 0) return '';
  const isB = (ch) => ch === '.' || ch === '!' || ch === '?' || ch === '\n' || ch === '。';
  let s = 0, e = text.length;
  for (let i = at - 1; i >= 0; i--) if (isB(text[i])) { s = i + 1; break; }
  for (let i = at + needle.length; i < text.length; i++) if (isB(text[i])) { e = i + 1; break; }
  return text.slice(s, e);
}

// model: the parsed JSON the LLM returned. title/body: the student's exact text (grounding source).
// refute: optional correction markers from the client — used ONLY to drop a C4_RUMOR accusation when the
// student refuted the claim IN THE SAME SENTENCE (debunking the misinformation is what rubric.5 asks for).
// The model is the accurate judge of clickbait/exaggeration (it is instructed to score the student's OWN
// wording), so C3 is trusted as returned — the server only enforces the hard lock: whitelist + grounding.
// Returns { items:[{n,status,code,evidence}], praise:'P_GOOD'|'P_TRY' } — always safe to render.
function validate(model, title, body, refute) {
  const t = title == null ? '' : title;
  const b = body == null ? '' : body;
  const all = t + '\n' + b;
  // client markers are untrusted: require >= 2 chars so a single common syllable (다, 이 …) can't silence C4
  const refuteMk = (Array.isArray(refute) ? refute : []).filter((m) => typeof m === 'string' && m.trim().length >= 2);
  const raw = model && Array.isArray(model.items) ? model.items : [];
  const seen = new Set();
  const items = [];

  for (const it of raw) {
    const n = Number(it && it.n);
    if (!(n >= 1 && n <= 5) || seen.has(n)) continue;

    const code = (it && it.code != null ? it.code : '').toString().trim();
    // (1) whitelist + must belong to THIS criterion, else drop -> client keeps its local read
    if (!ALL_CODES.has(code) || !code.startsWith('C' + n + '_')) continue;

    let evidence = (it && it.evidence != null ? it.evidence : '').toString();
    if (EVIDENCE_CODES.has(code)) {
      const ev = evidence.trim();
      // (2) grounding: a substantive (>=2 non-space chars) real substring the student actually wrote
      if (ev.length < 2 || !all.includes(evidence)) continue;
      // (2b) for a rumour accusation, drop ONLY if the student refuted it in the SAME sentence
      if (code === 'C4_RUMOR') {
        const seg = sentenceOf(all, evidence);
        if (refuteMk.some((m) => seg.includes(m))) continue;
      }
    } else {
      evidence = ''; // (3) only quote-codes carry evidence
    }

    const status = statusForCode(code, n);
    seen.add(n);
    items.push({ n, status, code, evidence });
  }

  items.sort((a, b2) => a.n - b2.n);

  // praise is DERIVED from the sanitised items — never trusted from the model (which could over-praise).
  const praise = items.length === 5 && items.every((i) => i.status === 'O') ? 'P_GOOD' : 'P_TRY';
  return { items, praise };
}

// JSON schema handed to Gemini so it can only emit valid, enum-constrained classifications.
function responseSchema() {
  return {
    type: 'OBJECT',
    properties: {
      items: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            n: { type: 'INTEGER' },
            status: { type: 'STRING', enum: ['O', 'PARTIAL', 'X'] },
            code: { type: 'STRING', enum: Array.from(ALL_CODES) },
            evidence: { type: 'STRING' },
          },
          required: ['n', 'status', 'code'],
        },
      },
      praise: { type: 'STRING', enum: ['P_GOOD', 'P_TRY'] },
    },
    required: ['items', 'praise'],
  };
}

function buildPrompt(claim, keptCards, title, body) {
  const sources = Array.isArray(keptCards) && keptCards.length ? keptCards.join(' / ') : '(none kept)';
  return (
`You are a STRICT CLASSIFIER for a Korean 6th-grade media-literacy game. A student wrote a "correction article" (정정 기사) that should refute a specific fake-news claim using credible sources they collected in the game.

Judge ONLY the five fixed criteria below and output ONLY codes from the allowed enum. You MUST NOT evaluate spelling, grammar, spacing, handwriting, length, politeness, creativity, or anything not listed. You MUST NOT write free-form advice. If unsure about a criterion, output its _OK code.

1) Did the student cite a credible source?  -> C1_OK or C1_NONE
2) Did the student use more than one source / viewpoint?  -> C2_OK or C2_ONE
3) Did the student AVOID clickbait/exaggeration IN THEIR OWN wording?  -> C3_OK, or C3_CLICKBAIT / C3_EXAGGERATION if THEY wrote such a phrase
4) Did the student include only verified facts (no speculation of their OWN)?  -> C4_OK or C4_RUMOR
5) Did the student name what was wrong AND correct it?  -> C5_OK, C5_NO_TARGET (never says what was wrong), or C5_NO_CORRECTION (says wrong but gives no true fact)

GROUNDING RULE: for C3_CLICKBAIT, C3_EXAGGERATION and C4_RUMOR you MUST set "evidence" to an EXACT substring copied verbatim from the student's title or body. If you cannot copy such a substring, output the _OK code instead. For every other code, "evidence" MUST be "".
DEBUNK GUARD: the student legitimately MENTIONS or quotes the fake claim in order to debunk it — quoting the rumour is NOT C4_RUMOR. Only the student's OWN speculation counts.

Fake-news claim being corrected: ${claim || '(unknown)'}
Credible sources the student collected (these are TRUE; use for judging, do not quote them): ${sources}
--- STUDENT ARTICLE ---
Title: ${title || ''}
Body: ${body || ''}
--- END ---

Return one item object per criterion 1..5.`
  );
}

module.exports = { ALL_CODES, EVIDENCE_CODES, OK_CODE, normStatus, validate, responseSchema, buildPrompt };
