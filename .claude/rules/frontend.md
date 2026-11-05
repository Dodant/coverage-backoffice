---
paths:
  - "src/**"
  - "tests/browser/**"
---

# 프런트엔드 수정 규칙

구조는 `docs/ARCHITECTURE.md`, 컨벤션 상세는 `docs/DEVELOPMENT.md`의 프런트엔드 절을 본다.

- 백엔드는 `api<T>('/경로')`(`/api` 접두어 없이), cover-agent POST는 `coverAgent<T>()`로 호출한다.
- 외부 URL을 `href`/`src`에 넣기 전에 `safeUrl()` 또는 `imageOf()`를 거친다.
- 백엔드 PUT에는 바뀐 필드만 보낸다. 빈 문자열은 값으로 저장되므로 화면에서 거절한다.
- 데이터 로딩은 `AbortController`로 취소하고, 늦게 도착한 응답은 요청 번호로 버린다.
- 화면 추가는 `src/pages/` 파일 + `App.tsx`의 `Route` + 필요하면 `MENU` 한 줄이다.
- 화면 간 신호는 `publish:queued`/`publish:changed` 이벤트, `patchChangbiBook`, URL 파라미터를 쓴다. 새 전역 상태 라이브러리를 들이지 않는다.
- `BookDetail.tsx`의 표지 편집(`CoverEditor`, `markDirty`, `reload`)을 바꾸면 `npm run test:browser`를 실행한다. 표지 ID key와 dirty가 아닌 폼만 동기화하는 방식을 유지한다.
- UI 문구는 한국어로 쓰고 기존 `src/index.css` 클래스를 재사용한다.
