# API 계약

이 저장소가 **제공하는** API는 cover-agent(`server/cover-agent.mjs`)뿐이다. 백엔드 API는 `../coverage-backend`가 원본이며, 아래 표는 이 SPA가 **사용하는** 엔드포인트 목록이다. 요청·응답 타입은 표에 적은 파일에서 확인한다.

구조와 흐름은 [ARCHITECTURE.md](ARCHITECTURE.md)를 본다.

## cover-agent (`/cover-agent/*` → `127.0.0.1:8766`)

### 공통 규칙 (`startServer`, `localRequest`, `readBody`)

- `Host`가 `localhost` 또는 `127.0.0.1`(포트 무관)이 아니면 403. DNS 재바인딩 방어.
- POST는 `Content-Type: application/json`이어야 한다. 아니면 403. 사전 확인 없는 교차 출처 요청 방어. 프런트엔드는 `coverAgent()`(`src/api.ts`)가 헤더를 붙인다. `/discover?stream=1`만 `CoverDiscovery.tsx`가 `fetch`로 직접 호출한다.
- 요청 본문은 4096바이트 이하의 JSON 객체여야 한다.
- 오류 응답은 `{ message }`(한국어). 상태 코드는 `fail(status, message)`로 던진 값이며, 없으면 메시지에 `입력|ISBN|제목|JSON`이 들어가면 400, 그 외 502다. 새 오류는 `fail()`로 상태를 명시한다.
- ADMIN 경로(`/apply`, `/changbi/apply`, `/changbi/register`): `Authorization: Bearer <token>` 없으면 401 → 백엔드 `GET /api/users/me`(5초 제한)가 실패 상태를 응답하면 401 → `role !== 'ADMIN'`이면 403. 백엔드 연결 실패·시간 초과·JSON이 아닌 응답은 예외로 처리돼 **502**다(인증 실패와 구분된다). 그 토큰을 그대로 백엔드 호출에 쓴다.

### 엔드포인트

| 메서드·경로 | 인증 | 요청 | 응답 | 구현 |
|---|---|---|---|---|
| `POST /books/search` | — | `{query}` | `{books: [{id, source, title, authors, isbn, year, language, imageUrl, sourceUrl}], errors: string[]}` | `searchBooks` |
| `POST /discover` | — | `{title?, author?, isbn?}` (제목 또는 ISBN 필수, ISBN 체크섬 검사) | `{candidates: [{id, source, title, authors, isbn, imageUrl, sourceUrl, match: 'isbn'\|'title', publisher, year, edition}], errors}` | `discover` |
| `POST /discover?stream=1` | — | 위와 같음 | NDJSON: `{type:'progress', source, status:'done'\|'failed', count}`… → `{type:'result', candidates, errors}` 또는 `{type:'error', message}` | `discover` + `startServer` |
| `POST /apply` | ADMIN | `{bookId(UUID), kind:'original'\|'translated', imageUrl, source:'Open Library'\|'Google Books', ribbon:'clean'\|'banded'\|'unknown', edition?, publisher?, year?}` | `{coverId, representative, reused, warning?}` | `applyCover` → `attachCover` |
| `GET /changbi/books` | — | — | `ChangbiBook[]` (`books.json` + `overrides.json`, `key = url`) | `loadChangbi` |
| `GET /changbi/{covers\|thumbs\|candidates}/<file>` | — | — | 이미지. `candidates`만 `max-age=86400`, 나머지 `no-cache` | `changbiFile` + `sendFile` |
| `POST /changbi/candidates` | — | `{key}` | `{id, items}` (보도자료 zip 해제, `tools/backoffice.py candidates`) | `changbiCandidates` |
| `POST /changbi/pick` | — | `{key, file:'<n>.jpg\|png', ribbon:'clean'\|'banded'}` | 갱신된 `ChangbiBook` | `pickChangbiCover` |
| `POST /changbi/apply` | ADMIN | `{key, bookId, kind}` | `{coverId, representative, reused, warning?}` | `applyChangbiCover` |
| `POST /changbi/register` | ADMIN | `{key}` | 201 `{bookId, title, applied}` | `registerChangbiBook` |

### 엔드포인트별 제약

- **검색 출처**: Kakao는 `KAKAO_REST_API_KEY`가 있을 때만, 결과 맨 앞에 둔다. 한 출처가 실패하면 `errors`에 넣고 나머지를 반환하며 모두 실패하면 502다. Open Library 작품 검색 결과의 ISBN·언어는 여러 판이 섞여 있어 비워 둔다.
- **표지 URL 허용 목록** (`coverUrl`/`coverHost`): `https`이고 사용자 정보가 없으며 호스트가 `covers.openlibrary.org`, `books.google.com`, `books.googleusercontent.com` 중 하나인 주소만 허용한다. `http`는 `https`로 바꾼다. Kakao 썸네일(`search1.kakaocdn.net`)은 `kakaoThumb`로 표시용만 허용하며 적용할 수 없다.
- **다운로드** (`downloadCover`): `redirect: 'manual'`로 최대 4번 이동하며 매번 허용 목록을 다시 검사한다. 15초 제한, 10MB 초과 시 중단, 매직 바이트로 JPEG/PNG만 허용한다(`imageOf`).
- **`/apply`**: `source`와 이미지 호스트가 맞아야 한다(Open Library ↔ `covers.openlibrary.org`).
- **창비 파일 경로**: `FILE_KINDS` 정규식과 `resolve` 후 폴더 내부인지를 둘 다 검사한다. 잘못된 `%` 인코딩은 404다.
- **`/changbi/apply`·`/register` 이미지**: 10MB를 넘으면 `tools/backoffice.py shrink`로 줄인 사본(`covers/_candidates/upload-<id>.jpg`)을 올린다.
- **`/changbi/register`**: `applied`가 있거나 같은 key가 등록 중이면 409. 번역서는 400. `isbn_shared`(세트 ISBN)이면 ISBN을 보내지 않는다. 저자는 `firstAuthor()`가 첫 이름만 고르며, 역할어(글·그림·옮김·외 등)가 섞이면 비워 엔티티 정리에 맡긴다. 단권이 아니면 `seriesName`/`seriesNumber`를 보낸다.

## 백엔드 사용 목록 (`/api/*` → `:8080`)

`src/api.ts`의 `api<T>(path, {method, body, signal})`로 호출한다. 경로에는 `/api`를 붙이지 않는다. 예외로 파일 업로드(`POST /api/covers`, multipart)는 `BookDetail.tsx`의 `AddCover`가 `fetch`로 직접 호출한다.

| 경로 | 메서드 | 권한 | 사용처 |
|---|---|---|---|
| `/search?query=&size=` | GET | 공개 | `GlobalSearch`, `Covers`, `CoverDiscovery`, `Changbi`. `id`에 `original_`/`translated_` 접두어가 붙고 리디자인 문서도 섞여 와서 `type`으로 거른다 |
| `/books/original/check-duplicate?isbn=`, `/books/original/find-similar?title=&authorName=` | GET | 공개 | `Covers` 검색 인덱스 실패 시 폴백 |
| `/books/original/:id`, `/books/translated/by-original/:id` | GET | 공개 | `loadEditions`(토큰 없을 때) |
| `/books/original/:id`, `/books/translated/:id` | PUT | ADMIN | `Publish`, `BookDetail`. 바뀐 필드만 보낸다(아래 주의) |
| `/books/:id/covers` | POST | ADMIN | `AddCover`, cover-agent |
| `/books/:id/covers/:coverId/representative` | PUT | ADMIN | 대표 표지 지정 |
| `/admin/books?status=DRAFT&size=` | GET | ADMIN | 펜딩 배지, `Publish`, `GlobalSearch` |
| `/admin/moderation/content/restore` | POST | ADMIN | 공개(`{targetType:'ORIGINAL_BOOK', targetId}`) |
| `/admin/catalog?query&kind&status&language&publisher&hasCover&sort&issue&needsAttention&page&size` | GET | ADMIN | `Books`, `BookRelationships` |
| `/admin/catalog/:id` | GET | ADMIN | `BookDetail` (`Detail`) |
| `/admin/catalog/:id/editions` | GET | ADMIN | `loadEditions`(토큰 있을 때, 비공개 포함) |
| `/admin/catalog/:id/covers/:coverId` | PUT | ADMIN | 표지 메타데이터 저장. 폼 전체를 보내고 빈 값으로 비운다(아래 주의). 저장된 `Cover`를 반환 |
| `/admin/catalog/:id/relationship-preview` | POST | ADMIN | `{action, targetId}` → `Preview` |
| `/admin/catalog/:id/relationship` | PUT | ADMIN | `{action, targetId, expectedOriginalId, expectedWorkId, expectedTargetWorkId}` |
| `/admin/covers/:coverId/similar-group` | PUT | ADMIN | `{withCoverId}`, `null`이면 묶음에서 분리 |
| `/admin/image-inspection/matches?kind&bookId&page` | GET | ADMIN | `ImageDuplicates` |
| `/admin/image-inspection/scan` | POST | ADMIN | `{after, limit:10}` → `{examined, indexed, nextCursor, hasMore, failures}` |
| `/admin/dashboard/stats`, `/admin/dashboard/logs[/entity/:type/:id \| /user/:id \| /action/:a \| /range?start&end]` | GET | ADMIN | `Dashboard`, 상세의 변경 이력. 필터는 한 번에 하나만 적용 |
| `/{authors,publishers,designers}?name=&size=` | GET | 미확인 | `EntityPicker`, `Entities` |
| `/admin/entities/:kind/:id/aliases[/:alias]` | POST·DELETE | ADMIN | `Entities` |
| `/admin/entities/:kind/merge` | POST | ADMIN | `{sourceId, targetId}` |
| `/admin/search/reindex` | POST | ADMIN | `Entities` |
| `/users/me` | GET | 토큰 | cover-agent ADMIN 확인 |
| `/covers` | POST multipart | ADMIN | 업로드. `{originalUrl, thumbnailUrl, originalFileName, width, height, fileSize}` 반환. 10MB·4천만 픽셀 초과는 400 |

권한 열은 프런트엔드 동작과 기존 문서에서 확인한 내용이다. 정확한 보안 설정은 백엔드 코드에서 확인한다.

### 백엔드 계약상 주의

- **PUT 의미는 엔드포인트마다 다르다.** 프런트엔드가 지켜야 할 규칙은 [DEVELOPMENT.md](DEVELOPMENT.md#프런트엔드-src)에 있다. 요약: 도서 PUT(`/books/{original,translated}/:id`)은 부분 수정이라 `''`가 값으로 저장돼 칸을 비울 수 없다. 표지 메타데이터 PUT은 폼 전체를 보내며 빈 값이 비우기다.
- **초안·숨김 도서**는 공개 조회(`/books/{kind}/:id`)에서 404다. 관리자 경로 `/admin/catalog/:id`로 다시 읽는다(`attachCover`).
- `/admin/catalog` 계열·이미지 검사·표지 메타데이터는 최신 백엔드와 마이그레이션이 필요하다([DEVELOPMENT.md](DEVELOPMENT.md#백엔드-마이그레이션)).

## 에이전트 실행 기록 (`/agent/*` → `:8765`)

`../coverage-backend`의 `python3 .claude/skills/register-book/api.py serve`가 제공한다. `Runs.tsx`가 `GET /agent/runs`(요약 목록)와 `GET /agent/runs/:file`(한 실행)을 `fetch`로 읽는다. 서버가 꺼져 있으면 화면에 실행 명령을 안내한다. 기록 안의 URL은 웹에서 모은 값이므로 `safeUrl()`을 거쳐 표시한다.
