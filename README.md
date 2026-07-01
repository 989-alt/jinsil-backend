# 진실의 돋보기 — AI 채점 백엔드 (Vercel)

학생이 쓴 **정정 기사**를 Gemini 2.5 Pro로 루브릭 채점하는 작은 프록시 서버입니다.

> **왜 백엔드인가?** Gemini API 키를 앱에 넣으면(평문·난독화 무관) 유출됩니다. 사용자가 앱에서
> 키를 입력하는 것도 금지 조건입니다. 그래서 키는 **이 서버의 환경변수**에만 두고, 앱은 글만 보냅니다.
> 키 설정은 *앱 사용자*가 아니라 *선생님이 배포 시 단 1회* 합니다.

## 폴더 구조
```
jinsil-backend/
  api/grade.js   ← 서버리스 함수 (POST /api/grade)
  README.md
```

## 배포 방법 (택1)

### A. Vercel 웹 대시보드 (가장 쉬움)
1. https://aistudio.google.com 에서 **Gemini API 키** 발급
2. 이 `jinsil-backend` 폴더를 GitHub 저장소로 올리기 (또는 Vercel에 직접 업로드)
3. https://vercel.com → **Add New → Project** → 해당 저장소 import
4. **Settings → Environment Variables** 에 추가:
   - `GEMINI_API_KEY` = 발급받은 키 (필수)
   - `APP_TOKEN` = 아무 문자열 (선택, 약한 호출 보호 — 설정 시 앱의 `AiGrade.AppToken`도 동일하게)
5. **Deploy** → 배포 주소 확인 (예: `https://jinsil-ai.vercel.app`)

### B. Vercel CLI
```bash
npm i -g vercel
cd jinsil-backend
vercel            # 최초 1회 링크
vercel env add GEMINI_API_KEY      # 값 입력
vercel --prod
```

## 배포 후
- 호출 주소: `https://<배포주소>/api/grade`
- 이 주소를 알려주시면 게임의 `AiGrade.BackendUrl` 에 넣고 재빌드합니다.
  (직접 하시려면 `jinsil/Assets/Game/Scripts/Core/AiGrade.cs` 의 `BackendUrl` 상수만 교체)

## 테스트 (배포 확인)
```bash
curl -X POST https://<배포주소>/api/grade \
  -H "Content-Type: application/json" \
  -d '{"incident":"무상급식","title":"정정: 무상급식은 중단되지 않습니다","body":"교육청은 무상급식 중단을 결정한 적이 없다고 밝혔다. 온라인 안내문은 공식 문서가 아니었다."}'
```
→ `{ "feedback": "기준1: ... 총평: ..." }` 가 오면 정상.

## 안전·대회 유의
- 앱에는 키가 전혀 없습니다(유출 불가). 학생은 채점 결과를 보지 않고, **루브릭(기준)만** 봅니다.
- **graceful degradation**: 서버가 꺼져 있거나 인터넷이 없어도 학생 학습·취재 정확도·기사 발행은 정상이며, 교사 대시보드의 "AI 진단"만 비활성 안내가 뜹니다.
- 대회 심사 시점에 채점을 보여주려면 서버가 켜져 있어야 합니다.
- Node 18+ (Vercel 기본) 의 전역 `fetch` 사용 — 별도 의존성 없음.
