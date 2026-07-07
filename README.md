# 진실의 돋보기 — AI 편집장 점검 백엔드 (Vercel)

학생이 쓴 **정정 기사**를 Gemini로 **분류(classify)** 하는 작은 프록시 서버입니다. 모델은 자유 서술을
하지 않고, 12개 고정 코드 중에서만 고르고 학생 글의 일부를 그대로 인용합니다. 서버가 그 출력을
화이트리스트·근거 접지·형식으로 **살균**해 `{ items, praise }`(코드만) 를 돌려줍니다. 화면에 보이는
한국어 문구는 앱(`ko.json coach.*`)이 코드로 조회하므로, **학습 과정 밖의 진단이 학생에게 도달할 수 없습니다.**

> **왜 백엔드인가?** Gemini API 키를 앱에 넣으면(평문·난독화 무관) 유출됩니다. 그래서 키는 **이 서버의
> 환경변수**에만 두고, 앱은 글만 보냅니다. 키 설정은 *선생님이 배포 시 단 1회* 합니다.

## 폴더 구조
```
jinsil-backend/
  api/grade.js        ← 서버리스 함수 (POST /api/grade) — Gemini 호출 + 응답 살균
  api/_coach.js       ← 잠금 코어: ALL_CODES 화이트리스트 + validate() + responseSchema() + buildPrompt()
  test/coach.test.js  ← 오프라인 골든 테스트 (node test/coach.test.js) — 키·네트워크 불필요
  README.md
```
의존성 없음(Node 18+ 전역 `fetch`). Vercel 파일시스템 라우팅(`api/grade.js` → `/api/grade`), `vercel.json` 불필요.

## 배포 방법 (택1)

### A. Vercel 웹 대시보드
1. https://aistudio.google.com 에서 **Gemini API 키** 발급
2. 이 `jinsil-backend` 폴더를 GitHub 저장소로 올리기(이미 `989-alt/jinsil-backend` 존재하면 push)
3. https://vercel.com → 해당 프로젝트 → **Settings → Environment Variables**:
   - `GEMINI_API_KEY` = 발급받은 키 (필수)
   - `APP_TOKEN` = 아무 문자열 (선택, 약한 호출 보호 — 설정 시 앱의 `AiGrade.AppToken`도 동일하게 후 재빌드)
4. **Deployments → 최신 커밋 Redeploy** (또는 git push 시 자동 배포)

### B. Vercel CLI
```bash
cd jinsil-backend
npx vercel --prod            # 이미 .vercel 링크됨 (projectName: jinsil-backend)
# 키 미설정 시: npx vercel env add GEMINI_API_KEY  (그 후 다시 --prod)
```

## 배포 후 스모크 테스트
```bash
curl -X POST https://jinsil-backend.vercel.app/api/grade \
  -H "Content-Type: application/json" \
  -d '{"incident":"meal","title":"무상급식 중단은 사실이 아니었다","body":"교육청에 따르면 무상급식을 중단한 사실이 없다. 조사 결과 예산은 오히려 늘었다.","claim":"교육청이 무상급식을 중단한다","keptCards":["경기도교육청 공식 발표: 중단을 결정한 사실이 없다"],"refute":["사실이 아니","조사 결과","실제로는"]}'
```
정상 응답 예:
```json
{ "items": [ {"n":1,"status":"O","code":"C1_OK","evidence":""}, ... ], "praise": "P_GOOD" }
```
- `{"error":"server is missing GEMINI_API_KEY"}` → 환경변수 미설정.
- 코드가 안 뜨고 빈 items → 모델 출력이 살균에서 전부 탈락(정상 방어). 앱은 이 경우 로컬 체크리스트로 폴백.

## 안전·대회 유의
- 앱에는 키가 전혀 없습니다(유출 불가). 서버는 **코드만** 반환하고, 학생용 한국어는 앱이 코드로 조회합니다.
- **graceful degradation**: 서버가 꺼져 있거나 인터넷이 없어도 학생의 **실시간 로컬 체크리스트**(계층 1)와
  학습·취재 정확도·기사 발행은 정상 동작합니다. AI 점검(계층 2)만 비활성 안내가 뜹니다.
- 대회 심사 시점에 AI 점검을 시연하려면 서버가 켜져 있어야 합니다.
- 키는 요청 URL이 아니라 `x-goog-api-key` 헤더로 전달됩니다(로그·트레이스 노출 방지).
