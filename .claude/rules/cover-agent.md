---
paths:
  - "server/**"
---

# cover-agent 수정 규칙

`server/cover-agent.mjs`는 외부 이미지를 내려받아 관리자 토큰으로 백엔드에 올리는 로컬 서비스다. 보안 장치를 약하게 만드는 변경은 하지 않는다. 계약은 `docs/API.md`, 규칙 상세는 `docs/DEVELOPMENT.md`의 cover-agent 절을 본다.

- `localRequest`(로컬 `Host`, POST는 JSON만)와 127.0.0.1 바인딩을 유지한다.
- 백엔드에 쓰는 새 경로는 `startServer`의 ADMIN 경로 배열에 넣는다. 새 POST 경로는 `routes` 배열에도 넣는다.
- 표지 출처를 바꾸면 `coverHost`/`coverUrl`, `applyCover`의 `source` 검사, 리다이렉트 재검증, 테스트를 함께 바꾼다. Kakao 썸네일은 적용 출처가 아니다.
- 창비 파일 접근은 `changbiFile`(정규식과 폴더 내부 검사)을 거친다. `overrides.json`은 `updateOverride`로만 쓴다.
- 오류는 `fail(status, '한국어 메시지')`. 외부 호출에는 `AbortSignal.timeout`을 붙인다.
- 외부 의존(`fetcher`, `callBackend`, `tool`, `dir`)은 인자로 주입하고 `server/cover-agent.test.mjs`에 스텁 테스트를 추가한다. 의존성 패키지를 추가하지 않는다.
- ESLint가 `.mjs`를 검사하지 않는다. `npm run test:cover-agent`를 반드시 실행한다.
- 창비 판정(`usable`, 번역서 거절)을 바꾸면 `src/changbi.ts`와 `src/pages/Changbi.tsx`의 `canQueue`도 맞춘다.
