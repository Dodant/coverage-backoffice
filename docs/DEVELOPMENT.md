# 개발 가이드

로컬 실행, 검증, 코딩 규칙, 자주 하는 실수를 정리한다. 구조는 [ARCHITECTURE.md](ARCHITECTURE.md), 엔드포인트는 [API.md](API.md)를 본다.

## 로컬 실행

형제 디렉터리 구성을 전제한다.

```
COVERAGE/
├── coverage-backend/     # Spring 백엔드, register-book 실행 기록 서버
├── coverage-backoffice/  # 이 저장소
└── changbi-press/        # 창비 보도자료 수집 결과 (books.json, covers/, thumbs/, venv/, tools/)
```

| 필요한 화면 | 실행할 것 |
|---|---|
| 모든 화면 | `cd ../coverage-backend && docker compose up -d && ./gradlew bootRun` (:8080) |
| 모든 화면 | `npm install && npm run dev` (:5173) |
| 창비 자료실, 온라인 검색, 퍼블리시 드롭 | `npm run cover-agent` (:8766) |
| 등록 기록 | `cd ../coverage-backend && python3 .claude/skills/register-book/api.py serve` (:8765) |
| 창비 zip 후보·10MB 초과 표지 축소 | `../changbi-press/venv/bin/python`과 `tools/backoffice.py` |

### 환경변수

| 변수 | 기본값 | 읽는 곳 |
|---|---|---|
| `COVERAGE_BACKEND` | `http://localhost:8080` | `vite.config.ts` 프록시, `server/cover-agent.mjs` |
| `COVERAGE_AGENT_RUNS` | `http://localhost:8765` | `vite.config.ts` |
| `COVERAGE_COVER_AGENT` | `http://localhost:8766` | `vite.config.ts` |
| `COVERAGE_COVER_AGENT_PORT` | `8766` | `server/cover-agent.mjs` |
| `COVERAGE_CHANGBI_DIR` | `../changbi-press` (이 저장소 기준) | `server/cover-agent.mjs` |
| `GOOGLE_BOOKS_API_KEY` | 없음(키 없이 호출) | `server/cover-agent.mjs` |
| `KAKAO_REST_API_KEY` | 없음(카카오 검색 생략) | `server/cover-agent.mjs` |
| `PLAYWRIGHT_CHANNEL` | 없음(Playwright Chromium) | `playwright.config.ts` |

`COVERAGE_COVER_AGENT_PORT`를 바꾸면 `COVERAGE_COVER_AGENT`도 맞춰야 프록시가 따라간다. `.env` 로딩은 없으므로 셸에서 넘긴다. 키 값은 저장소에 커밋하지 않는다.

### 관리자 인증

로그인 화면이 없다(`/login` → `/cover-discovery`). 관리자 API를 쓰려면 브라우저 sessionStorage의 `coverage-backoffice-session`에 `{"token": "...", "user": {...}}`를 넣어야 한다(`src/api.ts` `session()`). 토큰이 없으면 목록·상세 같은 `/admin/*` 화면은 인증 안내를 보이고, 공개 API를 쓰는 화면은 동작한다.

### 백엔드 마이그레이션

개발 DB는 `ddl-auto=update`로 컬럼이 생긴다. 운영 DB는 백오피스 기능 배포 전에 `../coverage-backend/scripts/migrations/`의 SQL을 날짜순으로 적용한다. 최근 백오피스 기능과 관련된 것:

- `2026-10-27_cover_variant_metadata.sql` — 표지 종류·띠지·쇄·사용 시작일·크레딧 (`/admin/catalog`)
- `2026-10-27_image_fingerprints.sql` — `file_sha256`, 지각 해시 (`/image-duplicates`)
- `2026-10-28_cover_copyright_holder.sql` — `copyrightHolder`

## 검증

끝내기 전에 항상 실행한다.

```bash
npm run build && npm run lint && npm run test:cover-agent
```

| 명령 | 범위 | 비고 |
|---|---|---|
| `npm run build` | `tsc -b`(`src/`, `vite.config.ts`) + Vite 빌드 | 유일한 타입 검사. `tests/`, `playwright.config.ts`는 `tsc` 대상이 아니다 |
| `npm run lint` | ESLint, `**/*.{ts,tsx}`만 | `server/*.mjs`는 린트되지 않는다. 직접 신경 쓴다 |
| `npm run test:cover-agent` | `server/cover-agent.test.mjs`(`node:test`) | 네트워크·백엔드·파일 도구를 스텁한다. 단일 테스트: `node --test --test-name-pattern "<이름 일부>" server/cover-agent.test.mjs` |
| `npm run test:browser` | `tests/browser/*.spec.ts`(Playwright) | 표지 편집(`BookDetail.tsx`) 변경 시 필수. 최초 `npx playwright install chromium`, 로컬 Chrome은 `PLAYWRIGHT_CHANNEL=chrome npm run test:browser` |

### 테스트 작성 규칙

- **cover-agent**: 내보낸 함수를 직접 호출하고 주입 인자로 외부를 대체한다. `fetcher`(외부 HTTP), `callBackend`(백엔드), `tool`(Python 도구), `dir`(창비 폴더, `mkdtemp`로 임시 생성). 실제 네트워크·백엔드를 부르지 않는다. 새 로직도 이 주입 지점을 유지해야 테스트할 수 있다.
- **브라우저**: Playwright가 4175 포트에 전용 Vite 서버를 띄운다(`reuseExistingServer`는 CI가 아닐 때 켜짐). `page.route('**/api/**')`로 모든 백엔드 응답을 모킹하고, 예상하지 않은 요청은 404로 응답해 드러낸다. 실제 데이터를 바꾸지 않는다. 세션 토큰 없이 실행된다.
- 테스트 이름은 기존 파일 관례를 따른다(cover-agent는 영어 문장, 브라우저는 한국어 문장).
- 실데이터 검증 기록은 `docs/<주제>-YYYY-MM-DD.md`로 남긴다(기존 두 문서 참고). 파일명이 날짜로 끝나는 문서는 그 날짜의 결과일 뿐이며 이후 동작의 명세가 아니다. 명세 문서의 파일명에는 날짜를 붙이지 않는다.

## 코딩 규칙

### 공통

- UI 문구·주석·오류 메시지는 한국어. 식별자는 영어.
- 새 의존성을 추가하지 않는 것이 기본이다. 런타임 의존성은 React·React DOM·React Router뿐이고, cover-agent는 의존성이 없다.
- 주석은 "왜"를 쓴다. 의도적으로 남긴 한계는 `// ponytail: <한계>, <언제 고칠지>` 형식으로 남긴다(기존 예: `server/cover-agent.mjs`의 `updateOverride`, `registerChangbiBook`).

### 프런트엔드 (`src/`)

- 화면 하나 = `src/pages/` 파일 하나. 그 화면에서만 쓰는 컴포넌트·타입은 같은 파일에 둔다. 두 화면 이상이 쓰면 `catalog.ts`, `changbi.ts`, `ui.tsx`, `api.ts`로 올린다.
- 화면 추가: 파일 생성 → `App.tsx`의 `Routes`에 `Route` 추가 → 사이드바에 보일 것이면 `MENU`에 `{to, label}` 한 줄.
- 백엔드 호출은 `api<T>('/경로')`(`/api` 접두어 없이). cover-agent POST는 `coverAgent<T>()`(JSON 헤더·토큰·오류 문구 처리). `fetch`를 직접 쓰는 곳은 다음뿐이다: `/agent/*`(`Runs.tsx`), cover-agent GET(`src/changbi.ts`의 `/changbi/books`, 이미지), `/discover?stream=1` NDJSON 스트림(`CoverDiscovery.tsx`), multipart 업로드 `POST /api/covers`(`BookDetail.tsx` `AddCover`). `api()`는 본문을 `JSON.stringify`하므로 `FormData`를 넘기면 업로드가 깨진다.
- 백엔드 PUT은 엔드포인트마다 의미가 다르다.
  - `PUT /books/{original,translated}/:id`(`Publish.tsx`, `BookEditor`): 누락·`null`은 그대로 둠, `''`는 값으로 저장. **바뀐 필드만** 보내고 빈 칸은 화면에서 거절한다.
  - `PUT /admin/catalog/:id/covers/:coverId`(`CoverEditor`, `AddCover`): `metadata(form)`으로 **폼 전체**를 보내고, 빈 값으로 항목을 비운다(저작권자 비우기는 `tests/browser/cover-drafts.spec.ts`가 검증). 바뀐 필드만 보내도록 바꾸지 않는다.
  - `PUT /admin/covers/:coverId/similar-group`: `withCoverId: null`이면 묶음에서 분리.
- 외부에서 온 URL(검색 결과, 에이전트 기록, 표지 주소)을 `href`/`src`에 넣을 때는 `safeUrl()` 또는 `imageOf()`를 거친다. 새 창 링크는 `target="_blank" rel="noopener noreferrer"`.
- 버튼 하나의 비동기 작업은 `useWork()`의 `work(label, task)`로 감싼다. `busy`인 동안 버튼을 비활성화한다.
- 데이터 로딩 `useEffect`는 `AbortController`로 취소하고, 취소된 요청의 오류는 표시하지 않는다(`if (!controller.signal.aborted)`). 연속 요청은 요청 번호(`requestId`/`reloadRequest`)로 늦은 응답을 버린다.
- 목록 필터·페이지는 URL 검색 파라미터에 둔다(`Books.tsx`, `ImageDuplicates.tsx`). 다른 화면에서 넘겨받는 일회성 선택(`?id=`, `?key=`)은 읽은 뒤 `setParams(..., { replace: true })`로 지운다.
- 401/403(`ApiError.status`)은 "관리자 인증이 필요합니다" 류의 안내로 바꾼다. 빈 목록으로 숨기지 않는다.
- 상태 표시는 `role="status"`, 오류는 `role="alert"`와 `className="error"`, 성공은 `className="note"`.
- 스타일은 `src/index.css`의 기존 클래스(`panel`, `row`, `muted`, `small`, `badge s-created/s-dry`, `primary` 등)를 재사용한다.

### cover-agent (`server/cover-agent.mjs`)

- 오류는 `fail(status, '한국어 메시지')`. 상태 없이 던지면 메시지 정규식으로 400/502가 정해진다.
- 외부 HTTP에는 `AbortSignal.timeout`을 붙인다(기존: 검색 10초, 다운로드 15초, 백엔드 20초, 인증 확인 5초).
- 외부 입력 문자열은 `clean()`(trim, 200자)으로 받는다. 도서 ID는 UUID 정규식으로 검사한다.
- 백엔드에 쓰기 작업을 하는 새 경로는 ADMIN 경로 목록(`startServer`의 배열)에 넣는다. 새 POST 경로는 `routes` 배열에도 넣어야 404가 아니다.
- 파일 쓰기는 임시 파일 후 `rename`(원자적 교체). `overrides.json`은 반드시 `updateOverride()`로 쓴다.
- 창비 판정 규칙을 바꾸면 화면 쪽(`src/changbi.ts`의 `usable`/`translated`, `Changbi.tsx`의 `canQueue`)도 함께 바꾼다.

## 자주 하는 실수

| 실수 | 결과 | 대신 |
|---|---|---|
| cover-agent POST를 `fetch`로 `Content-Type` 없이 호출 | 403 | `coverAgent()` 사용 |
| `api('/api/...')` | `/api/api/...` 404 | `api('/...')` |
| 표지 허용 호스트에 새 출처 추가만 하고 끝냄 | SSRF·임의 이미지 적용 위험 | `coverUrl`/`coverHost`, `/apply`의 `source` 검사, 테스트를 함께 수정. Kakao 썸네일은 적용 출처가 아니다 |
| 도서 PUT에 모든 필드·빈 문자열 전송 | 빈 값이 저장되거나 의도치 않게 덮어씀 | 바뀐 필드만 전송, 빈 값은 화면에서 거절 |
| 표지 메타데이터 PUT을 바뀐 필드만 보내도록 "정리" | 저작권자 등을 비울 수 없게 됨 | 폼 전체 전송 유지 |
| `AddCover`의 `fetch('/api/covers')`를 `api()`로 "정리" | `FormData`가 `{}`로 직렬화돼 업로드 실패 | multipart는 `fetch` 유지 |
| `CoverEditor` key에 갱신 번호를 넣거나 갱신 시 모든 폼을 초기화 | 다른 카드의 미저장 입력 유실 | 표지 ID key 유지, dirty 아닌 폼만 동기화. `npm run test:browser` |
| 유사 이미지 후보를 동일 이미지로 처리하거나 자동 병합 | 오판정 | `SIMILAR`는 검토 후보로만 표시 |
| 보완 항목을 공개 조건으로 사용 | 정책 위반 | 보완 항목은 안내용 |
| 번역서를 `/changbi/register`로 등록 | 400 | 원서 등록 후 연결(미구현) |
| `docs/*-YYYY-MM-DD.md` 기록의 수치를 현재 상태로 인용 | 오래된 정보 | 날짜가 붙은 기록으로만 인용 |

## 배포 시 제약

이 저장소에는 배포 설정(Dockerfile, CI, 호스팅 설정)이 없다. 코드상 지켜야 할 조건:

- `npm run build` 결과는 정적 `dist/`다. SPA 라우팅이므로 알 수 없는 경로를 `index.html`로 돌려야 한다.
- `/api`, `/agent`(접두어 제거), `/cover-agent`(접두어 제거)를 **같은 출처**에서 각 서비스로 프록시해야 한다(백엔드 CORS 없음).
- cover-agent는 127.0.0.1에 바인딩하고 `Host`가 `localhost`/`127.0.0.1`인 요청만 받는다. 리버스 프록시를 두면 `Host`를 로컬 값으로 넘겨야 하며, 이 보호가 무력화되지 않는지 검토해야 한다.
- cover-agent는 `../changbi-press`(또는 `COVERAGE_CHANGBI_DIR`)와 그 안의 Python venv가 있는 머신에서 실행해야 한다.
- 로그인 UI가 없는 개발 미리보기 상태다. 외부 공개 배포 전에 인증 흐름을 복구해야 한다.
