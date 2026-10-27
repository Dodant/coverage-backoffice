# coverage-backoffice

COVERAGE 백오피스 (Vite + React + TS). 개발 중에는 로그인 화면 없이 접속한다. 백엔드의 관리자 전용 변경 API는 계속 ADMIN 인증을 요구한다.

1. 백엔드를 띄운다: `cd ../coverage-backend && docker compose up -d && ./gradlew bootRun`
2. 에이전트 등록 기록을 보려면: `cd ../coverage-backend && python3 .claude/skills/register-book/api.py serve`
3. 커버 탐색을 쓰려면 별도 터미널에서 `npm run cover-agent`를 실행한다. 제목·저자·ISBN으로 Open Library와 Google Books에서 책을 먼저 찾고, 책을 선택한 뒤 커버 후보를 탐색한다. 한 출처가 실패해도 다른 출처의 검색 결과는 표시한다. 표지 적용 시에는 관리자 토큰을 백엔드 `/api/users/me`로 확인한다. Google Books 키가 있으면 `GOOGLE_BOOKS_API_KEY` 환경변수로 넣는다. 국내 도서 검색에는 카카오 REST API 키를 `KAKAO_REST_API_KEY`로 넣는다(없으면 카카오 검색은 건너뛴다. 카카오 썸네일은 검색 목록 표시용이며 표지 적용 출처는 아니다). 기본 포트는 8766이고 `COVERAGE_COVER_AGENT_PORT`로 변경할 수 있다.
4. `npm install && npm run dev` → http://localhost:5173 (개발 서버가 `/api`는 백엔드 8080, `/agent`는 실행 기록 8765, `/cover-agent`는 커버 탐색 8766으로 프록시. 바꾸려면 `COVERAGE_BACKEND`, `COVERAGE_AGENT_RUNS`, `COVERAGE_COVER_AGENT`)
5. 화면: 대시보드·감사 로그, 표지 묶기(언어가 달라도 비슷한 표지, 백엔드 `similar_group_id`), 커버 탐색·적용(책 검색·선택 → 원서 메인·언어별 번역서·판/쇄 후보·띠지 확인·표지 변형 등록), 등록 기록(에이전트 runs/), 엔티티 정리(병합·별칭·재색인). 표지 묶기 검색은 검색 인덱스 오류 시 DB의 유사 도서 검색으로 재시도하며, 등록된 원서만 묶을 수 있다. 커버 탐색은 등록 도서 검색이 실패해도 온라인 도서 검색 결과를 보여준다. 띠지 여부는 관리자가 이미지를 보고 표시한다. 적용 시 공개 출처의 JPEG/PNG를 받아 백엔드 이미지 검증·업로드를 거친 뒤 변형으로 추가하고 대표로 지정한다.
6. 확인: `npm run build && npm run lint && npm run test:cover-agent`. 배포 시에는 같은 출처에서 `/api`와 `/cover-agent`를 각 서비스로 넘겨야 한다(백엔드에 CORS 설정 없음). 탐색 서비스는 로컬호스트에 바인딩한다.

도서 관리 화면:
- `/books`: 원서·번역서의 전체 상태 목록. 제목·저자·ISBN, 종류, 상태, 언어, 출판사, 표지 유무를 함께 필터링하고 최근 등록/수정·제목순으로 조회한다. 전역 검색의 등록 도서도 통합 상세로 연결된다.
- `/books/attention`: 대표 표지 없음·숨김, 해상도 부족/미확인, ISBN·출처 URL·크레딧·연도·출판사 누락, 표지 변형 미분류를 DB에서 필터링한 뒤 페이지 처리한다. 보완 항목은 공개 차단 조건이 아니다.
- `/books/:id`: 서지정보·저자·출판사 수정, 연결 원서·번역서·작품의 다른 판과 변경 이력 조회. 표지 버전 탭에서 업로드, 대표 지정, 표지 종류·띠지·시작 쇄·사용 시작일·출처·역할별 크레딧과 디자인 묶음을 관리한다.

구분 기준은 도서(판/ISBN) → 소속 표지 변형, 표지의 `similarGroupId` → 관리자가 확인한 유사 디자인 묶음, 동일 `imageUrl` → 같은 이미지 주소다. 파일 내용/픽셀의 동일성을 판정하는 기능은 아니며 이미지 주소 비교는 현재 도서의 변형과 연결 도서의 대표 표지 범위다. 표지 묶기 보드에도 대표뿐 아니라 소속 표지 변형을 표시한다.

새 화면은 관리자 인증과 최신 백엔드의 `/api/admin/catalog` API가 필요하다. 백엔드를 재시작해야 하며, 운영 환경은 먼저 `coverage-backend/scripts/migrations/2026-10-27_cover_variant_metadata.sql`을 적용한다. 기존 표지의 변형 종류·띠지 상태는 미확인으로 유지한다. 개발 환경(`ddl-auto=update`)은 기동 시 컬럼을 추가한다.

관계 수정:
- 도서 상세의 **연결 도서 → 도서 관계 수정**에서 번역서의 원서를 이동하거나 원서끼리 같은 작품의 다른 판으로 연결·분리한다. 영향 도서를 미리 보여주며 검토 시점과 적용 시점의 연결이 다르면 저장을 거절한다. 공개 번역서는 비공개 원서로 옮길 수 없다. 표지·ISBN·도서 레코드를 병합하지 않는다.
