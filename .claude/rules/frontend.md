---
paths:
  - "src/**"
  - "tests/browser/**"
---

# 프런트엔드 수정 규칙

규칙의 원본은 `docs/DEVELOPMENT.md`의 "프런트엔드 (`src/`)"절과 "자주 하는 실수" 표다. 수정 전에 읽는다. 구조와 화면 간 신호는 `docs/ARCHITECTURE.md`, 백엔드 계약은 `docs/API.md`를 본다.

특히 다음 코드는 "정리"하지 않는다. 각각의 이유는 위 문서에 있다.

- `BookDetail.tsx` `AddCover`의 `fetch('/api/covers')`(multipart)
- 표지 메타데이터 PUT이 폼 전체를 보내는 방식(`metadata(form)`)
- `CoverEditor`의 표지 ID key와 "dirty가 아닌 폼만 동기화"하는 방식

`BookDetail.tsx`의 표지 편집을 바꾸면 `npm run test:browser`도 실행한다.
