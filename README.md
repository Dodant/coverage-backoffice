# coverage-backoffice

COVERAGE 백오피스 (Vite + React + TS). 개발 중에는 로그인 화면 없이 접속한다. 백엔드의 관리자 전용 변경 API는 계속 ADMIN 인증을 요구한다.

1. 백엔드를 띄운다: `cd ../coverage-backend && docker compose up -d && ./gradlew bootRun`
2. 에이전트 등록 기록을 보려면: `cd ../coverage-backend && python3 .claude/skills/register-book/api.py serve`
3. 커버 탐색을 쓰려면 별도 터미널에서 `npm run cover-agent`를 실행한다. 제목·저자·ISBN으로 Open Library와 Google Books의 커버 후보를 로그인 없이 찾는다. 표지 적용 시에는 관리자 토큰을 백엔드 `/api/users/me`로 확인한다. Google Books 키가 있으면 `GOOGLE_BOOKS_API_KEY` 환경변수로 넣는다. 기본 포트는 8766이고 `COVERAGE_COVER_AGENT_PORT`로 변경할 수 있다.
4. `npm install && npm run dev` → http://localhost:5173 (개발 서버가 `/api`는 백엔드 8080, `/agent`는 실행 기록 8765, `/cover-agent`는 커버 탐색 8766으로 프록시. 바꾸려면 `COVERAGE_BACKEND`, `COVERAGE_AGENT_RUNS`, `COVERAGE_COVER_AGENT`)
5. 화면: 대시보드·감사 로그, 표지 묶기(언어가 달라도 비슷한 표지, 백엔드 `similar_group_id`), 커버 탐색·적용(원서 메인·언어별 번역서·판/쇄 후보·띠지 확인·표지 변형 등록), 등록 기록(에이전트 runs/), 엔티티 정리(병합·별칭·재색인). 표지 묶기 검색은 검색 인덱스 오류 시 DB의 유사 도서 검색으로 재시도하며, 등록된 원서만 묶을 수 있다. 커버 탐색은 등록 도서 검색이 실패해도 제목으로 온라인 후보를 계속 찾는다. 띠지 여부는 관리자가 이미지를 보고 표시한다. 적용 시 공개 출처의 JPEG/PNG를 받아 백엔드 이미지 검증·업로드를 거친 뒤 변형으로 추가하고 대표로 지정한다.
6. 확인: `npm run build && npm run lint && npm run test:cover-agent`. 배포 시에는 같은 출처에서 `/api`와 `/cover-agent`를 각 서비스로 넘겨야 한다(백엔드에 CORS 설정 없음). 탐색 서비스는 로컬호스트에 바인딩한다.
