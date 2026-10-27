import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, readFile, rename, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const backend = (process.env.COVERAGE_BACKEND ?? 'http://localhost:8080').replace(/\/$/, '')
const port = Number(process.env.COVERAGE_COVER_AGENT_PORT ?? 8766)
// 창비 보도자료 수집 폴더 (../changbi-press, tools/collect.py가 만든다)
const changbiDir = resolve(process.env.COVERAGE_CHANGBI_DIR ?? fileURLToPath(new URL('../../changbi-press/', import.meta.url)))

const clean = value => typeof value === 'string' ? value.trim().slice(0, 200) : ''
const isbnDigits = value => value.replace(/[\s-]/g, '').toUpperCase()
const https = value => typeof value === 'string' && /^https?:\/\//i.test(value) ? value.replace(/^http:/i, 'https:') : ''
const yearOf = value => Number(String(value ?? '').match(/\b(?:18|19|20)\d{2}\b/)?.[0]) || null
const coverHost = host => host === 'covers.openlibrary.org' || host === 'books.google.com' || host === 'books.googleusercontent.com'
function coverUrl(value) {
  const url = https(value)
  if (!url) return ''
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && coverHost(parsed.hostname) ? parsed.href : ''
  } catch { return '' }
}
const kakaoThumb = value => {
  try {
    const url = new URL(https(value))
    return url.protocol === 'https:' && url.hostname === 'search1.kakaocdn.net' ? url.href : ''
  } catch { return '' }
}
function fail(status, message) {
  const error = new Error(message)
  error.status = status
  throw error
}

async function backendJson(path, authorization, init = {}) {
  const response = await fetch(`${backend}/api${path}`, {
    ...init,
    headers: { Authorization: authorization, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20000),
  })
  const raw = await response.text()
  let body
  try { body = raw ? JSON.parse(raw) : null } catch { body = raw }
  if (!response.ok) fail(response.status, typeof body === 'object' && body?.message ? body.message : `백엔드 HTTP ${response.status}`)
  return body
}

async function downloadCover(rawUrl, fetcher = fetch) {
  let url = coverUrl(rawUrl)
  if (!url) fail(400, '지원하는 커버 출처의 이미지 URL이 아닙니다.')
  for (let redirects = 0; redirects < 4; redirects++) {
    const response = await fetcher(url, {
      redirect: 'manual', signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; COVERAGE cover review)', Accept: 'image/jpeg,image/png,image/*' },
    })
    if (response.status >= 300 && response.status < 400) {
      url = coverUrl(new URL(response.headers.get('location') ?? '', url).href)
      if (!url) fail(400, '이미지가 허용되지 않은 주소로 이동했습니다.')
      continue
    }
    if (!response.ok || !response.body) fail(502, `이미지를 받을 수 없습니다 (HTTP ${response.status}).`)
    const chunks = []
    let size = 0
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > 10 * 1024 * 1024) fail(400, '이미지가 10MB를 넘습니다.')
      chunks.push(Buffer.from(chunk))
    }
    return imageOf(Buffer.concat(chunks))
  }
  fail(502, '이미지 주소의 이동 횟수가 너무 많습니다.')
}

function imageOf(bytes) {
  const mime = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? 'image/jpeg'
    : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png' : ''
  if (!mime) fail(400, 'JPEG 또는 PNG 커버만 적용할 수 있습니다.')
  return { bytes, mime }
}

export async function applyCover(input, authorization, fetcher = fetch, callBackend = backendJson) {
  const bookId = clean(input.bookId)
  const kind = input.kind
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(bookId) || !['original', 'translated'].includes(kind)) fail(400, '도서 선택이 올바르지 않습니다.')
  const imageUrl = coverUrl(input.imageUrl)
  if (!imageUrl || imageUrl.length > 1000) fail(400, '커버 이미지 주소가 올바르지 않습니다.')
  if (!['Open Library', 'Google Books'].includes(input.source)) fail(400, '지원하는 커버 출처가 아닙니다.')
  if (input.source === 'Open Library' && new URL(imageUrl).hostname !== 'covers.openlibrary.org') fail(400, '커버 출처와 이미지 주소가 일치하지 않습니다.')
  if (input.source === 'Google Books' && new URL(imageUrl).hostname === 'covers.openlibrary.org') fail(400, '커버 출처와 이미지 주소가 일치하지 않습니다.')
  const ribbon = input.ribbon
  if (!['clean', 'banded', 'unknown'].includes(ribbon)) fail(400, '띠지 확인 상태를 선택해 주세요.')

  const label = [ribbon === 'clean' ? '띠지 없음' : ribbon === 'banded' ? '띠지 있음' : '띠지 확인 필요',
    clean(input.edition), clean(input.publisher), input.year ? String(input.year) : ''].filter(Boolean).join(' · ')
  return attachCover({ bookId, kind, sourceUrl: imageUrl, sourceName: input.source, label, image: () => downloadCover(imageUrl, fetcher) }, authorization, callBackend)
}

// 표지 변형으로 올리고 대표로 지정한다. 같은 출처 주소로 이미 올린 변형이 있으면 다시 올리지 않는다.
async function attachCover({ bookId, kind, sourceUrl, sourceName, label, image }, authorization, callBackend) {
  const book = await callBackend(`/books/${kind}/${bookId}`, authorization)
  const existing = (book.covers ?? []).find(cover => !cover.hidden && cover.sourceUrl === sourceUrl)
  let coverId = existing?.id
  if (!coverId) {
    const { bytes, mime } = await image()
    const form = new FormData()
    form.append('file', new Blob([bytes], { type: mime }), mime === 'image/png' ? 'cover.png' : 'cover.jpg')
    const upload = await callBackend('/covers', authorization, { method: 'POST', body: form })
    const cover = await callBackend(`/books/${bookId}/covers`, authorization, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageUrl: upload.originalUrl, thumbnailUrl: upload.thumbnailUrl,
        originalFileName: upload.originalFileName, width: upload.width, height: upload.height, fileSize: upload.fileSize,
        imageSource: 'LINK', sourceUrl, sourceName, label: label.slice(0, 100),
        languageCode: book.languageCode, countryCode: book.countryCode,
      }),
    })
    coverId = cover.id
  }
  try {
    await callBackend(`/books/${bookId}/covers/${coverId}/representative`, authorization, { method: 'PUT' })
    return { coverId, representative: true, reused: Boolean(existing) }
  } catch (error) {
    return { coverId, representative: false, reused: Boolean(existing), warning: `표지 변형은 등록됐지만 대표 지정에 실패했습니다: ${error.message}` }
  }
}
function validIsbn(value) {
  if (/^\d{13}$/.test(value)) return [...value].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 ? 3 : 1), 0) % 10 === 0
  if (/^\d{9}[\dX]$/.test(value)) return [...value].reduce((sum, digit, index) => sum + (digit === 'X' ? 10 : Number(digit)) * (10 - index), 0) % 11 === 0
  return false
}

async function jsonFrom(url, fetcher, headers = {}) {
  const response = await fetcher(url, { headers: { 'User-Agent': 'coverage-cover-agent/1.0 (cover discovery)', ...headers }, signal: AbortSignal.timeout(10000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

export async function searchBooks(input = {}, fetcher = fetch) {
  const query = clean(input.query)
  if (!query) fail(400, '도서 제목, 저자 또는 ISBN을 입력해 주세요.')
  const ol = new URL('https://openlibrary.org/search.json')
  ol.searchParams.set('q', query)
  ol.searchParams.set('fields', 'key,title,author_name,first_publish_year,cover_i')
  ol.searchParams.set('limit', '20')
  const google = new URL('https://www.googleapis.com/books/v1/volumes')
  google.searchParams.set('q', /^\d{10,13}$/.test(isbnDigits(query)) ? `isbn:${isbnDigits(query)}` : query)
  google.searchParams.set('maxResults', '20')
  if (process.env.GOOGLE_BOOKS_API_KEY) google.searchParams.set('key', process.env.GOOGLE_BOOKS_API_KEY)
  const kakaoKey = process.env.KAKAO_REST_API_KEY
  const kakao = new URL('https://dapi.kakao.com/v3/search/book')
  kakao.searchParams.set('query', /^\d{10,13}$/.test(isbnDigits(query)) ? isbnDigits(query) : query)
  if (/^\d{10,13}$/.test(isbnDigits(query))) kakao.searchParams.set('target', 'isbn')
  kakao.searchParams.set('size', '20')

  const sources = [
    // 국내 도서는 카카오가 가장 잘 찾으므로 맨 앞에 둔다. 키가 없으면 건너뛴다.
    ...(kakaoKey ? [['Kakao', jsonFrom(kakao, fetcher, { Authorization: `KakaoAK ${kakaoKey}` }).then(data => (data.documents ?? []).map(doc => {
      const identifiers = String(doc.isbn ?? '').split(/\s+/).map(isbnDigits).filter(validIsbn)
      const isbn = identifiers.find(value => /^\d{13}$/.test(value)) ?? identifiers[0] ?? ''
      return {
        id: `kakao-${isbn || doc.url}`, source: 'Kakao', title: doc.title ?? '', authors: (doc.authors ?? []).slice(0, 3), isbn,
        year: yearOf(doc.datetime), language: '',
        // 카카오 썸네일은 검색 목록 표시용이다. 커버 적용 허용 출처(coverUrl)에는 넣지 않는다.
        imageUrl: kakaoThumb(doc.thumbnail), sourceUrl: https(doc.url),
      }
    }).filter((item, index, all) => item.title && all.findIndex(other => other.id === item.id) === index).slice(0, 20))]] : []),
    ['Open Library', jsonFrom(ol, fetcher).then(data => (data.docs ?? []).filter(doc => /^\/works\/OL\d+W$/.test(doc.key ?? '')).map(doc => ({
      id: `ol-${doc.key.split('/').pop()}`, source: 'Open Library', title: doc.title ?? '',
      authors: (doc.author_name ?? []).slice(0, 1), isbn: '',
      // 작품 검색 결과의 ISBN/언어는 여러 번역판이 섞여 있으므로 판 정보로 쓰지 않는다.
      year: doc.first_publish_year ?? null, language: '',
      imageUrl: Number.isInteger(doc.cover_i) ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg?default=false` : '',
      sourceUrl: `https://openlibrary.org${doc.key}`,
    })).slice(0, 20))],
    ['Google Books', jsonFrom(google, fetcher).then(data => (data.items ?? []).map(item => {
      const info = item.volumeInfo ?? {}
      const identifiers = (info.industryIdentifiers ?? []).map(value => isbnDigits(value.identifier ?? '')).filter(validIsbn)
      return {
        id: `google-${item.id}`, source: 'Google Books', title: info.title ?? '', authors: (info.authors ?? []).slice(0, 3),
        isbn: identifiers.find(value => /^\d{13}$/.test(value)) ?? identifiers[0] ?? '',
        year: yearOf(info.publishedDate), language: info.language ?? '',
        imageUrl: coverUrl(info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail),
        sourceUrl: https(info.infoLink) || `https://books.google.com/books?id=${encodeURIComponent(item.id)}`,
      }
    }).filter(item => item.title).slice(0, 20))],
  ]
  const searches = await Promise.allSettled(sources.map(([, search]) => search))
  const errors = []
  const books = []
  searches.forEach((search, index) => {
    if (search.status === 'fulfilled') books.push(...search.value)
    else errors.push(`${sources[index][0]} 도서 검색 실패`)
  })
  if (errors.length === sources.length) fail(502, '도서 검색 출처에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.')
  return { books, errors }
}

function fromOpenLibrary(data, isbn) {
  if ('covers' in data) {
    return (data.covers ?? []).slice(0, 8).map(id => ({
      id: `ol-edition-${id}`, source: 'Open Library', title: data.title ?? '', authors: [],
      isbn: isbn || ((data.isbn_13 ?? data.isbn_10 ?? [])[0] ?? ''),
      imageUrl: `https://covers.openlibrary.org/b/id/${id}-L.jpg?default=false`,
      sourceUrl: `https://openlibrary.org${data.key}`, match: 'isbn',
      publisher: (data.publishers ?? [])[0] ?? '', year: yearOf(data.publish_date), edition: data.edition_name ?? '',
    }))
  }
  return (data.docs ?? []).filter(doc => Number.isInteger(doc.cover_i) && /^\/works\/OL\d+W$/.test(doc.key ?? '')).slice(0, 12).map(doc => ({
    id: `ol-work-${doc.cover_i}`, source: 'Open Library', title: doc.title ?? '',
    authors: (doc.author_name ?? []).slice(0, 3), isbn: '',
    imageUrl: `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg?default=false`,
    sourceUrl: `https://openlibrary.org${doc.key}`, match: 'title',
    publisher: '', year: doc.first_publish_year ?? null, edition: '',
  }))
}

function fromOpenLibraryEditions(data, isbn) {
  return (data.entries ?? []).flatMap(edition => (edition.covers ?? []).slice(0, 3).map(id => ({
    id: `ol-edition-${edition.key?.split('/').pop()}-${id}`,
    source: 'Open Library', title: edition.title ?? '', authors: [],
    isbn: (edition.isbn_13 ?? edition.isbn_10 ?? [])[0] ?? '',
    imageUrl: `https://covers.openlibrary.org/b/id/${id}-L.jpg?default=false`,
    sourceUrl: `https://openlibrary.org${edition.key}`,
    match: (edition.isbn_13 ?? edition.isbn_10 ?? []).some(value => isbnDigits(value) === isbn) && isbn ? 'isbn' : 'title',
    publisher: (edition.publishers ?? [])[0] ?? '', year: yearOf(edition.publish_date), edition: edition.edition_name ?? '',
  }))).slice(0, 40)
}

function fromGoogleBooks(data, isbn) {
  return (data.items ?? []).flatMap(item => {
    const info = item.volumeInfo ?? {}
    const links = info.imageLinks ?? {}
    const imageUrl = coverUrl(links.extraLarge || links.large || links.medium || links.small || links.thumbnail || links.smallThumbnail)
    if (!imageUrl) return []
    const identifiers = (info.industryIdentifiers ?? []).map(x => x.identifier)
    const exact = isbn && identifiers.some(x => isbnDigits(x) === isbn)
    return [{
      id: `google-${item.id}`, source: 'Google Books', title: info.title ?? '',
      authors: (info.authors ?? []).slice(0, 3), isbn: identifiers.find(x => x.length === 13) ?? identifiers[0] ?? '',
      imageUrl, sourceUrl: https(info.infoLink || item.selfLink) || `https://books.google.com/books?id=${encodeURIComponent(item.id)}`,
      match: exact ? 'isbn' : 'title',
      publisher: info.publisher ?? '', year: yearOf(info.publishedDate), edition: info.subtitle ?? '',
    }]
  }).slice(0, 12)
}

export async function discover(input = {}, fetcher = fetch, onProgress = () => {}) {
  const title = clean(input.title)
  const author = clean(input.author)
  const isbn = isbnDigits(clean(input.isbn))
  if (!title && !isbn) throw new Error('제목 또는 ISBN을 입력해 주세요.')
  if (isbn && !validIsbn(isbn)) throw new Error('올바른 ISBN-10 또는 ISBN-13을 입력해 주세요.')

  const ol = new URL('https://openlibrary.org/search.json')
  ol.searchParams.set('title', title)
  if (author) ol.searchParams.set('author', author)
  ol.searchParams.set('fields', 'key,title,author_name,cover_i,first_publish_year')
  ol.searchParams.set('limit', '10')
  const googleUrl = query => {
    const url = new URL('https://www.googleapis.com/books/v1/volumes')
    url.searchParams.set('q', query)
    url.searchParams.set('maxResults', '20')
    if (process.env.GOOGLE_BOOKS_API_KEY) url.searchParams.set('key', process.env.GOOGLE_BOOKS_API_KEY)
    return url
  }
  const bestEffort = async tasks => {
    const results = await Promise.allSettled(tasks.map(task => task()))
    if (results.every(result => result.status === 'rejected')) throw results[0].reason
    return results.flatMap(result => result.status === 'fulfilled' ? result.value : [])
  }
  const sources = [
    { name: 'Open Library', run: () => bestEffort([
      ...(isbn ? [async () => fromOpenLibrary(await jsonFrom(`https://openlibrary.org/isbn/${isbn}.json`, fetcher), isbn)] : []),
      ...(title ? [async () => {
        const data = await jsonFrom(ol, fetcher)
        const work = (data.docs ?? []).find(doc => /^\/works\/OL\d+W$/.test(doc.key ?? ''))
        const covers = fromOpenLibrary(data, isbn)
        if (!work) return covers
        try {
          const editions = await jsonFrom(`https://openlibrary.org${work.key}/editions.json?limit=100`, fetcher)
          return [...covers, ...fromOpenLibraryEditions(editions, isbn)]
        } catch { return covers }
      }] : []),
    ]) },
    { name: 'Google Books', run: () => bestEffort([
      ...(isbn ? [async () => fromGoogleBooks(await jsonFrom(googleUrl(`isbn:${isbn}`), fetcher), isbn)] : []),
      ...(title ? [async () => fromGoogleBooks(await jsonFrom(googleUrl([title, author].filter(Boolean).join(' ')), fetcher), isbn)] : []),
    ]) },
  ]
  const searches = await Promise.allSettled(sources.map(async source => {
    try {
      const found = await source.run()
      onProgress({ source: source.name, status: 'done', count: found.length })
      return found
    } catch (error) {
      onProgress({ source: source.name, status: 'failed', count: 0 })
      throw error
    }
  }))
  const errors = []
  const candidates = []
  if (searches[0].status === 'fulfilled') candidates.push(...searches[0].value)
  else errors.push('Open Library 조회 실패')
  if (searches[1].status === 'fulfilled') candidates.push(...searches[1].value)
  else errors.push('Google Books 조회 실패')
  if (errors.length === 2) throw new Error('커버 출처에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.')
  const byImage = new Map()
  for (const candidate of candidates) if (!byImage.has(candidate.imageUrl)) byImage.set(candidate.imageUrl, candidate)
  const unique = [...byImage.values()]
  unique.sort((a, b) => (a.match === 'isbn' ? 0 : 1) - (b.match === 'isbn' ? 0 : 1))
  return { candidates: unique, errors }
}

// ── 창비 자료실: 수집한 보도자료 표지 검토·선택·적용 ──

const run = promisify(execFile)
async function changbiTool(dir, ...args) {
  const { stdout } = await run(join(dir, 'venv/bin/python'), ['-I', join(dir, 'tools/backoffice.py'), ...args], { timeout: 180000, maxBuffer: 1 << 20 })
  return JSON.parse(stdout)
}
const readJson = async (path, fallback) => {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch (error) { if (error.code === 'ENOENT') return fallback; throw error }
}
const candidateId = url => createHash('sha1').update(url).digest('hex').slice(0, 16)

// 이미지 경로는 이 정규식과 폴더 안쪽인지 둘 다 확인한다
const FILE_KINDS = {
  covers: ['covers', /^[^/\\.][^/\\]*\.(?:jpe?g|png)$/i],
  thumbs: ['thumbs', /^[^/\\.][^/\\]*\.jpg$/i],
  candidates: ['covers/_candidates', /^[0-9a-f]{16}\/t?\d+\.(?:jpg|png)$/],
}
export function changbiFile(dir, kind, name) {
  const [folder, pattern] = FILE_KINDS[kind] ?? []
  if (!folder || !pattern.test(name)) return null
  const base = resolve(dir, folder)
  const path = resolve(base, name)
  return path.startsWith(base + sep) ? path : null
}

export async function loadChangbi(dir = changbiDir) {
  const [books, overrides] = await Promise.all([readJson(join(dir, 'books.json'), null), readJson(join(dir, 'overrides.json'), {})])
  if (!books) fail(404, '창비 수집 결과(books.json)가 없습니다. changbi-press에서 tools/collect.py를 실행해 주세요.')
  return books.map(book => ({ ...book, ...overrides[book.url], key: book.url }))
}

let overridesLock = Promise.resolve()
function updateOverride(dir, key, change) {
  // ponytail: 프로세스 하나 안에서만 직렬화한다. 여러 cover-agent가 같은 폴더를 쓰면 파일 잠금이 필요하다.
  const next = overridesLock.then(async () => {
    const path = join(dir, 'overrides.json')
    const overrides = await readJson(path, {})
    overrides[key] = { ...overrides[key], ...change }
    await writeFile(path + '.tmp', JSON.stringify(overrides, null, 1))
    await rename(path + '.tmp', path) // 쓰는 도중 읽거나 죽어도 깨진 JSON이 남지 않게
  })
  overridesLock = next.catch(() => {})
  return next
}
async function changbiBook(dir, key) {
  const book = (await loadChangbi(dir)).find(item => item.key === key)
  if (!book) fail(404, '창비 자료를 찾을 수 없습니다.')
  return book
}

export async function changbiCandidates(input, dir = changbiDir, tool = changbiTool) {
  const book = await changbiBook(dir, input.key)
  const id = candidateId(book.url)
  const items = await tool(dir, 'candidates', book.url, join(dir, 'covers/_candidates', id))
  return { id, items }
}

const replaceFile = async (src, dest) => { await copyFile(src, dest + '.tmp'); await rename(dest + '.tmp', dest) }

export async function pickChangbiCover(input, dir = changbiDir) {
  const book = await changbiBook(dir, input.key)
  if (!['clean', 'banded'].includes(input.ribbon)) fail(400, '띠지 여부를 선택해 주세요.')
  if (!/^\d+\.(?:jpg|png)$/.test(String(input.file))) fail(400, '이미지 선택이 올바르지 않습니다.')
  const id = candidateId(book.url)
  const manifest = await readJson(join(dir, 'covers/_candidates', id, 'manifest.json'), [])
  const picked = manifest.find(item => item.file === input.file)
  if (!picked) fail(400, 'zip 이미지 목록을 먼저 불러와 주세요.')
  const stem = book.cover_file ? book.cover_file.replace(/\.[^.]+$/, '') : `${book.isbn || 'x'}_${id}`
  const coverFile = stem + extname(input.file)
  // 후보 썸네일은 zip을 풀 때 이미 만들었다
  await replaceFile(join(dir, 'covers/_candidates', id, picked.thumb), join(dir, 'thumbs', `${stem}.jpg`))
  await replaceFile(join(dir, 'covers/_candidates', id, input.file), join(dir, 'covers', coverFile))
  const change = { cover_status: input.ribbon === 'clean' ? 'clean' : '띠지', cover_file: coverFile, cover_source_name: picked.name }
  await updateOverride(dir, book.key, change)
  return { ...book, ...change }
}

// 고른 표지 파일과 출처 정보. 백엔드 업로드 한도(10MB)를 넘으면 줄인 사본을 올린다
async function changbiCover(dir, book, tool) {
  if (!book.cover_file || !['clean', '띠지'].includes(book.cover_status)) fail(400, '적용할 표지가 없습니다. zip 이미지에서 먼저 골라 주세요.')
  const path = join(dir, 'covers', book.cover_file)
  const bytes = await readFile(path).catch(() => fail(404, '표지 파일이 없습니다. zip 이미지에서 다시 골라 주세요.'))
  const image = async () => {
    if (bytes.length <= 10 * 1024 * 1024) return imageOf(bytes)
    const shrunk = join(dir, 'covers/_candidates', `upload-${candidateId(book.url)}.jpg`) // 백엔드 업로드 한도
    await tool(dir, 'shrink', path, shrunk)
    return imageOf(await readFile(shrunk))
  }
  const ribbon = book.cover_status === 'clean' ? 'clean' : 'banded'
  return {
    image,
    // 다른 이미지나 띠지 판정을 바꿔 다시 적용하면 새 변형으로 올라가도록 내용 해시와 띠지 상태를 넣는다
    sourceUrl: `${book.url}#${createHash('sha1').update(bytes).digest('hex').slice(0, 16)}-${ribbon}`,
    sourceName: '창비 보도자료',
    label: [ribbon === 'clean' ? '띠지 없음' : '띠지 있음', book.imprint || '창비', book.pub_month].filter(Boolean).join(' · '),
  }
}

export async function applyChangbiCover(input, authorization, { dir = changbiDir, callBackend = backendJson, tool = changbiTool } = {}) {
  const bookId = clean(input.bookId)
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(bookId) || !['original', 'translated'].includes(input.kind)) fail(400, '도서 선택이 올바르지 않습니다.')
  const book = await changbiBook(dir, input.key)
  const cover = await changbiCover(dir, book, tool)
  const result = await attachCover({ bookId, kind: input.kind, ...cover }, authorization, callBackend)
  await updateOverride(dir, book.key, { applied: { bookId, kind: input.kind, coverId: result.coverId, at: new Date().toISOString() } })
  return result
}

// 창비 책을 원서로 새로 등록한다. DRAFT라 백오피스 '퍼블리시'에서 고쳐 공개하기 전까지 사용자에게 안 보인다
export async function registerChangbiBook(input, authorization, { dir = changbiDir, callBackend = backendJson, tool = changbiTool } = {}) {
  const book = await changbiBook(dir, input.key)
  if (book.applied) fail(409, '이미 백엔드에 등록된 책입니다.')
  // ponytail: 번역서는 원서(외국어판)에 붙여야 해서 아직 못 넣는다. 원서 검색·연결 단계를 붙이면 translated로 등록
  if (book.original_title || book.translators) fail(400, '번역서는 원서를 먼저 등록해야 해서 아직 퍼블리시로 보낼 수 없습니다.')
  const { image, sourceUrl, sourceName } = await changbiCover(dir, book, tool)
  const { bytes, mime } = await image()
  const form = new FormData()
  form.append('file', new Blob([bytes], { type: mime }), mime === 'image/png' ? 'cover.png' : 'cover.jpg')
  const upload = await callBackend('/covers', authorization, { method: 'POST', body: form })
  const created = await callBackend('/books/original', authorization, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: book.title, languageCode: 'ko', countryCode: 'KR', status: 'DRAFT',
      year: Number(book.pub_month?.slice(0, 4)) || undefined, isbn: book.isbn || undefined,
      // '송진권(글), 김윤이(그림)' → 첫 저자 이름만. 나머지는 퍼블리시에서 고친다
      authorName: book.authors?.split(/[,·]/)[0].replace(/\([^)]*\)/g, '').trim() || undefined,
      publisherName: book.imprint || '창비',
      seriesName: book.kind === '단권' ? undefined : book.series, seriesNumber: book.kind === '단권' ? undefined : book.volume?.slice(0, 20),
      frontCover: {
        imageUrl: upload.originalUrl, thumbnailUrl: upload.thumbnailUrl, originalFileName: upload.originalFileName,
        width: upload.width, height: upload.height, fileSize: upload.fileSize, imageSource: 'LINK', sourceUrl, sourceName,
      },
    }),
  })
  const applied = { bookId: created.id, kind: 'original', coverId: created.frontCover?.id, at: new Date().toISOString() }
  await updateOverride(dir, book.key, { applied })
  return { bookId: created.id, title: created.title, applied }
}

async function sendFile(response, path, immutable) {
  try {
    const body = await readFile(path)
    response.writeHead(200, {
      'Content-Type': /\.png$/i.test(path) ? 'image/png' : 'image/jpeg',
      'Cache-Control': immutable ? 'public, max-age=86400' : 'no-cache',
    })
    response.end(body)
  } catch { send(response, 404, { message: 'Not found' }) }
}

async function readBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 4096) throw new Error('입력 크기가 너무 큽니다.')
    chunks.push(chunk)
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('입력 형식이 올바르지 않습니다.')
    return data
  } catch {
    throw new Error('입력 형식이 올바르지 않습니다.')
  }
}

function send(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(body))
}

// 다른 사이트가 브라우저로 이 로컬 서비스를 부르지 못하게 한다.
// Host가 로컬이 아니면 DNS 재바인딩, POST가 JSON이 아니면 사전 확인 없는 교차 출처 요청이다.
export function localRequest({ method, headers }) {
  if (!/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(headers.host ?? '')) return false
  return method !== 'POST' || /^application\/json\b/i.test(headers['content-type'] ?? '')
}

export function startServer() {
  return createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost')
    const authorization = request.headers.authorization ?? ''
    if (!localRequest(request)) return send(response, 403, { message: '허용되지 않은 요청입니다.' })
    try {
      if (request.method === 'GET') {
        if (url.pathname === '/changbi/books') return send(response, 200, await loadChangbi())
        const file = url.pathname.match(/^\/changbi\/(covers|thumbs|candidates)\/(.+)$/)
        let name = ''
        try { name = file ? decodeURIComponent(file[2]) : '' } catch { /* 잘못된 %인코딩은 없는 파일로 본다 */ }
        const path = name && changbiFile(changbiDir, file[1], name)
        if (path) return sendFile(response, path, file[1] === 'candidates')
        return send(response, 404, { message: 'Not found' })
      }
      const routes = ['/books/search', '/discover', '/apply', '/changbi/candidates', '/changbi/pick', '/changbi/apply', '/changbi/register']
      if (request.method !== 'POST' || !routes.includes(url.pathname)) return send(response, 404, { message: 'Not found' })
      if (['/apply', '/changbi/apply', '/changbi/register'].includes(url.pathname)) {
        if (!/^Bearer \S+$/.test(authorization)) return send(response, 401, { message: '표지 등록에는 관리자 인증이 필요합니다.' })
        const check = await fetch(`${backend}/api/users/me`, { headers: { Authorization: authorization }, signal: AbortSignal.timeout(5000) })
        if (!check.ok) return send(response, 401, { message: '관리자 인증에 실패했습니다.' })
        const user = await check.json()
        if (user.role !== 'ADMIN') return send(response, 403, { message: '관리자만 사용할 수 있습니다.' })
      }
      const input = await readBody(request)
      if (url.pathname === '/apply') return send(response, 200, await applyCover(input, authorization))
      if (url.pathname === '/changbi/candidates') return send(response, 200, await changbiCandidates(input))
      if (url.pathname === '/changbi/pick') return send(response, 200, await pickChangbiCover(input))
      if (url.pathname === '/changbi/apply') return send(response, 200, await applyChangbiCover(input, authorization))
      if (url.pathname === '/changbi/register') return send(response, 201, await registerChangbiBook(input, authorization))
      if (url.pathname === '/books/search') return send(response, 200, await searchBooks(input))
      if (url.searchParams.get('stream') === '1') {
        response.writeHead(200, {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no',
        })
        response.flushHeaders()
        const emit = event => response.write(JSON.stringify(event) + '\n')
        const result = await discover(input, fetch, progress => emit({ type: 'progress', ...progress }))
        emit({ type: 'result', ...result })
        response.end()
        return
      }
      return send(response, 200, await discover(input))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (response.headersSent) {
        response.end(JSON.stringify({ type: 'error', message }) + '\n')
        return
      }
      return send(response, error.status ?? (/입력|ISBN|제목|JSON/.test(message) ? 400 : 502), { message })
    }
  }).listen(port, '127.0.0.1', () => console.log(`Cover agent listening on http://127.0.0.1:${port}`))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startServer()
