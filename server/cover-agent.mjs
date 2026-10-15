import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

const backend = (process.env.COVERAGE_BACKEND ?? 'http://localhost:8080').replace(/\/$/, '')
const port = Number(process.env.COVERAGE_COVER_AGENT_PORT ?? 8766)

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
    const bytes = Buffer.concat(chunks)
    const mime = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? 'image/jpeg'
      : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png' : ''
    if (!mime) fail(400, 'JPEG 또는 PNG 커버만 적용할 수 있습니다.')
    return { bytes, mime }
  }
  fail(502, '이미지 주소의 이동 횟수가 너무 많습니다.')
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

  const book = await callBackend(`/books/${kind}/${bookId}`, authorization)
  const existing = (book.covers ?? []).find(cover => !cover.hidden && cover.sourceUrl === imageUrl)
  let coverId = existing?.id
  if (!coverId) {
    const { bytes, mime } = await downloadCover(imageUrl, fetcher)
    const form = new FormData()
    form.append('file', new Blob([bytes], { type: mime }), mime === 'image/png' ? 'cover.png' : 'cover.jpg')
    const upload = await callBackend('/covers', authorization, { method: 'POST', body: form })
    const label = [ribbon === 'clean' ? '띠지 없음' : ribbon === 'banded' ? '띠지 있음' : '띠지 확인 필요',
      clean(input.edition), clean(input.publisher), input.year ? String(input.year) : ''].filter(Boolean).join(' · ').slice(0, 100)
    const cover = await callBackend(`/books/${bookId}/covers`, authorization, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageUrl: upload.originalUrl, thumbnailUrl: upload.thumbnailUrl,
        originalFileName: upload.originalFileName, width: upload.width, height: upload.height, fileSize: upload.fileSize,
        imageSource: 'LINK', sourceUrl: imageUrl, sourceName: input.source, label,
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

async function jsonFrom(url, fetcher) {
  const response = await fetcher(url, { headers: { 'User-Agent': 'coverage-cover-agent/1.0 (cover discovery)' }, signal: AbortSignal.timeout(10000) })
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

  const searches = await Promise.allSettled([
    jsonFrom(ol, fetcher).then(data => (data.docs ?? []).filter(doc => /^\/works\/OL\d+W$/.test(doc.key ?? '')).map(doc => ({
      id: `ol-${doc.key.split('/').pop()}`, source: 'Open Library', title: doc.title ?? '',
      authors: (doc.author_name ?? []).slice(0, 1), isbn: '',
      // 작품 검색 결과의 ISBN/언어는 여러 번역판이 섞여 있으므로 판 정보로 쓰지 않는다.
      year: doc.first_publish_year ?? null, language: '',
      imageUrl: Number.isInteger(doc.cover_i) ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg?default=false` : '',
      sourceUrl: `https://openlibrary.org${doc.key}`,
    })).slice(0, 20)),
    jsonFrom(google, fetcher).then(data => (data.items ?? []).map(item => {
      const info = item.volumeInfo ?? {}
      const identifiers = (info.industryIdentifiers ?? []).map(value => isbnDigits(value.identifier ?? '')).filter(validIsbn)
      return {
        id: `google-${item.id}`, source: 'Google Books', title: info.title ?? '', authors: (info.authors ?? []).slice(0, 3),
        isbn: identifiers.find(value => /^\d{13}$/.test(value)) ?? identifiers[0] ?? '',
        year: yearOf(info.publishedDate), language: info.language ?? '',
        imageUrl: coverUrl(info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail),
        sourceUrl: https(info.infoLink) || `https://books.google.com/books?id=${encodeURIComponent(item.id)}`,
      }
    }).filter(item => item.title).slice(0, 20)),
  ])
  const errors = []
  const books = []
  if (searches[0].status === 'fulfilled') books.push(...searches[0].value)
  else errors.push('Open Library 도서 검색 실패')
  if (searches[1].status === 'fulfilled') books.push(...searches[1].value)
  else errors.push('Google Books 도서 검색 실패')
  if (errors.length === 2) fail(502, '도서 검색 출처에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.')
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

export function startServer() {
  return createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost')
    if (request.method !== 'POST' || !['/books/search', '/discover', '/apply'].includes(url.pathname)) return send(response, 404, { message: 'Not found' })
    const authorization = request.headers.authorization ?? ''
    try {
      if (url.pathname === '/apply') {
        if (!/^Bearer \S+$/.test(authorization)) return send(response, 401, { message: '표지 등록에는 관리자 인증이 필요합니다.' })
        const check = await fetch(`${backend}/api/users/me`, { headers: { Authorization: authorization }, signal: AbortSignal.timeout(5000) })
        if (!check.ok) return send(response, 401, { message: '관리자 인증에 실패했습니다.' })
        const user = await check.json()
        if (user.role !== 'ADMIN') return send(response, 403, { message: '관리자만 사용할 수 있습니다.' })
      }
      const input = await readBody(request)
      if (url.pathname === '/apply') return send(response, 200, await applyCover(input, authorization))
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
