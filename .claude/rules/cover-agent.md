---
paths:
  - "server/**"
---

# cover-agent 수정 규칙

`server/cover-agent.mjs`는 외부 이미지를 내려받아 관리자 토큰으로 백엔드에 올리는 로컬 서비스다. 규칙의 원본은 `docs/DEVELOPMENT.md`의 "cover-agent"절이고, 엔드포인트 계약과 보안 검사는 `docs/API.md`에 있다. 수정 전에 읽는다.

- 보안 장치를 약하게 만드는 변경은 하지 않는다. 대상은 `localRequest`, 127.0.0.1 바인딩, ADMIN 확인, 표지 URL 허용 목록, `changbiFile` 경로 검사다.
- ESLint가 `.mjs`를 검사하지 않는다. `npm run test:cover-agent`를 반드시 실행하고, 새 로직에는 주입 인자로 스텁한 테스트를 추가한다.
