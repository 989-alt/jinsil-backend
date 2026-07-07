// 진실의 돋보기 — AI 편집장 점검 프록시 (Vercel Serverless Function)
// 학생이 쓴 '정정 기사'를 Gemini로 CLASSIFY 한다. 모델은 자유 서술을 하지 않고, 고정된 12개
// 코드 중에서만 고르고 학생 글의 일부를 그대로 인용(evidence)한다. 서버는 그 출력을 _coach.validate()
// 로 살균(화이트리스트·근거접지·형식)해 { items, praise } 만 돌려준다. 화면에 보일 한국어 문구는
// 앱(ko.json)이 코드로 조회하므로, 학습 과정 밖의 진단이 학생에게 도달할 수 없다.
//
// ★ Gemini API 키는 절대 앱에 넣지 않는다. 이 서버의 환경변수 GEMINI_API_KEY 에만 둔다.
//
// 요청:  POST /api/grade
//   { "incident":"meal", "title":"...", "body":"...", "claim":"가짜 주장 원문", "keptCards":["...","..."] }
// 응답:  200 { "items":[{"n":1,"status":"O|PARTIAL|X","code":"C1_OK","evidence":""}, ...], "praise":"P_GOOD|P_TRY" }
//        4xx·5xx { "error":"..." }

const { validate, responseSchema, buildPrompt } = require('./_coach');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-token');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const APP_TOKEN = process.env.APP_TOKEN;
  if (APP_TOKEN && req.headers['x-app-token'] !== APP_TOKEN)
    return res.status(401).json({ error: 'unauthorized' });

  const KEY = process.env.GEMINI_API_KEY;
  if (!KEY) return res.status(500).json({ error: 'server is missing GEMINI_API_KEY' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const title = (body.title || '').toString();
  const text = (body.body || '').toString();
  const claim = (body.claim || '').toString();
  const keptCards = Array.isArray(body.keptCards) ? body.keptCards.map((s) => (s || '').toString()) : [];
  const refute = Array.isArray(body.refute) ? body.refute.map((s) => (s || '').toString()) : [];
  if (!title || !text) return res.status(400).json({ error: 'title and body are required' });

  const prompt = buildPrompt(claim, keptCards, title, text);

  try {
    const r = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      {
        method: 'POST',
        // key goes in a header, not the URL query string (query strings surface in access logs / traces)
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 700,
            responseMimeType: 'application/json',
            responseSchema: responseSchema(),
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      }
    );
    const data = await r.json();
    if (!r.ok) {
      const msg = (data && data.error && data.error.message) || ('HTTP ' + r.status);
      return res.status(502).json({ error: 'gemini error: ' + msg });
    }
    const parts = data && data.candidates && data.candidates[0] &&
      data.candidates[0].content && data.candidates[0].content.parts;
    const rawText = parts ? parts.map((p) => p.text || '').join('') : '';
    let model;
    try { model = JSON.parse(rawText); } catch { model = null; }
    if (!model) {
      const fr = (data.candidates && data.candidates[0] && data.candidates[0].finishReason) || '';
      const br = (data.promptFeedback && data.promptFeedback.blockReason) || '';
      return res.status(502).json({ error: 'empty/invalid json from gemini', finishReason: fr, blockReason: br });
    }
    // The lock: only sanitised, whitelisted, grounded codes leave the server.
    const out = validate(model, title, text, refute);
    return res.status(200).json(out);
  } catch (e) {
    console.error('grade error:', e);   // detail stays server-side only
    return res.status(500).json({ error: 'internal error' });
  }
};
