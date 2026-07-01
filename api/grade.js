// 진실의 돋보기 — AI 채점 프록시 (Vercel Serverless Function)
// 학생이 쓴 '정정 기사'를 Gemini 2.5 Pro로 루브릭 채점한다.
// ★ Gemini API 키는 절대 앱에 넣지 않는다. 이 서버의 환경변수 GEMINI_API_KEY 에만 둔다.
//   (선생님이 배포 시 1회 설정 — 앱 사용자가 입력하지 않음)
//
// 요청:  POST /api/grade   { "incident": "...", "title": "...", "body": "..." }
// 응답:  200 { "feedback": "<교사용 한국어 피드백>" }  /  4xx·5xx { "error": "..." }

module.exports = async (req, res) => {
  // CORS (UnityWebRequest엔 불필요하나, 향후 웹 대시보드 대비 허용)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-app-token');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // 선택적 약한 인증 (Gemini 키와 무관한, 앱에 박아 넣을 수 있는 비-민감 토큰)
  const APP_TOKEN = process.env.APP_TOKEN;
  if (APP_TOKEN && req.headers['x-app-token'] !== APP_TOKEN)
    return res.status(401).json({ error: 'unauthorized' });

  const KEY = process.env.GEMINI_API_KEY;
  if (!KEY) return res.status(500).json({ error: 'server is missing GEMINI_API_KEY' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const incident = (body && body.incident) || '';
  const title = (body && body.title) || '';
  const text = (body && body.body) || '';
  if (!title || !text) return res.status(400).json({ error: 'title and body are required' });

  const prompt =
`당신은 초등학교 6학년 미디어 리터러시 수업의 보조 교사입니다.
한 학생이 가짜뉴스를 바로잡는 '정정 기사'를 직접 썼습니다.
아래 5가지 기준으로 평가하고, 담임 선생님에게 보여줄 간결한 한국어 피드백을 작성하세요.

[평가 기준]
1. 믿을 만한 근거에 출처를 밝혔는가
2. 여러 관점(양쪽)을 담았는가
3. 과장·낚시 표현 없이 정확히 썼는가
4. 확인된 사실만 담았는가 (소문·추측 제외)
5. 무엇이 어떻게 틀렸는지 분명히 바로잡았는가

[학생 기사]
사건: ${incident}
제목: ${title}
본문: ${text}

[출력 형식] (반드시 한국어, 6~9줄 이내)
- 각 기준마다 한 줄: "기준n: 충족(O)/부분(△)/미흡(X) — 한 줄 근거"
- 마지막 줄: "총평: 격려 1~2문장 + 개선점 1가지"
초등학생 수준에 맞춰 따뜻하고 구체적으로 쓰세요. 점수나 등급은 매기지 마세요.`;

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 4096, thinkingConfig: { thinkingBudget: 512 } },
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
    const fb = parts ? parts.map((p) => p.text || '').join('') : '';
    if (!fb) {
      const fr = (data.candidates && data.candidates[0] && data.candidates[0].finishReason) || '';
      const br = (data.promptFeedback && data.promptFeedback.blockReason) || '';
      return res.status(502).json({ error: 'empty from gemini', finishReason: fr, blockReason: br });
    }
    return res.status(200).json({ feedback: fb });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
