import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyCover, discover, searchBooks } from './cover-agent.mjs'

test('book search returns selectable bibliographic results before cover discovery', async () => {
  const fetcher = async url => String(url).includes('openlibrary.org')
    ? { ok: true, json: async () => ({ docs: [{ key: '/works/OL1W', title: 'Example', author_name: ['Author'], isbn: ['9788936433598'], cover_i: 123, first_publish_year: 2014 }] }) }
    : { ok: true, json: async () => ({ items: [{ id: 'g1', volumeInfo: { title: 'Example edition', authors: ['Author'], language: 'ko', industryIdentifiers: [{ identifier: '9788936433598' }] } }] }) }
  const result = await searchBooks({ query: 'Example' }, fetcher)
  assert.equal(result.books.length, 2)
  assert.equal(result.books[0].sourceUrl, 'https://openlibrary.org/works/OL1W')
  assert.equal(result.books[0].isbn, '')
  assert.equal(result.books[1].language, 'ko')
  assert.deepEqual(result.errors, [])
})

test('book search keeps one source when the other fails', async () => {
  const fetcher = async url => {
    if (String(url).includes('googleapis')) throw new Error('offline')
    return { ok: true, json: async () => ({ docs: [{ key: '/works/OL1W', title: 'Example' }] }) }
  }
  const result = await searchBooks({ query: 'Example' }, fetcher)
  assert.equal(result.books.length, 1)
  assert.deepEqual(result.errors, ['Google Books 도서 검색 실패'])
})

test('book search lists Kakao results first when a key is set', async () => {
  process.env.KAKAO_REST_API_KEY = 'kakao-key'
  try {
    const requests = []
    const fetcher = async (url, init) => {
      requests.push({ url: String(url), auth: init?.headers?.Authorization })
      if (String(url).includes('dapi.kakao.com')) return { ok: true, json: async () => ({ documents: [{
        title: '소년이 온다', authors: ['한강'], isbn: '8936433598 9788936433598', datetime: '2014-05-19T00:00:00.000+09:00',
        thumbnail: 'https://search1.kakaocdn.net/thumb/R120x174.q85/?fname=x', url: 'https://search.daum.net/search?q=x',
      }] }) }
      return { ok: true, json: async () => ({}) }
    }
    const result = await searchBooks({ query: '978-89-364-3359-8' }, fetcher)
    const kakao = requests.find(r => r.url.includes('dapi.kakao.com'))
    assert.equal(kakao.auth, 'KakaoAK kakao-key')
    assert.match(kakao.url, /target=isbn/)
    assert.deepEqual(result.books[0], {
      id: 'kakao-9788936433598', source: 'Kakao', title: '소년이 온다', authors: ['한강'], isbn: '9788936433598',
      year: 2014, language: '', imageUrl: 'https://search1.kakaocdn.net/thumb/R120x174.q85/?fname=x', sourceUrl: 'https://search.daum.net/search?q=x',
    })
  } finally {
    delete process.env.KAKAO_REST_API_KEY
  }
})

test('book search skips Kakao without a key', async () => {
  const fetcher = async url => {
    if (String(url).includes('dapi.kakao.com')) throw new Error('should not call Kakao')
    return { ok: true, json: async () => ({}) }
  }
  const result = await searchBooks({ query: 'Example' }, fetcher)
  assert.deepEqual(result.errors, [])
})

test('ISBN search labels exact edition covers and keeps source links', async () => {
  const fetcher = async url => {
    if (String(url).includes('openlibrary.org')) return { ok: true, json: async () => ({ key: '/books/OL1M', title: 'Example', covers: [123] }) }
    return { ok: true, json: async () => ({ items: [{ id: 'g1', volumeInfo: {
      title: 'Example', industryIdentifiers: [{ type: 'ISBN_13', identifier: '9788936433598' }],
      imageLinks: { thumbnail: 'http://books.google.com/cover.jpg' }, infoLink: 'https://books.google.com/books?id=g1',
    } }] }) }
  }
  const result = await discover({ isbn: '978-89-364-3359-8' }, fetcher)
  assert.equal(result.candidates.length, 2)
  assert(result.candidates.every(c => c.match === 'isbn'))
  assert.equal(result.candidates[0].sourceUrl, 'https://openlibrary.org/books/OL1M')
  assert.equal(result.candidates[1].imageUrl, 'https://books.google.com/cover.jpg')
})

test('one failed source still returns title candidates', async () => {
  const progress = []
  const fetcher = async url => {
    if (String(url).includes('openlibrary.org')) throw new Error('offline')
    return { ok: true, json: async () => ({ items: [{ id: 'g2', volumeInfo: {
      title: 'Example', imageLinks: { thumbnail: 'https://books.google.com/x.jpg' },
    } }] }) }
  }
  const result = await discover({ title: 'Example' }, fetcher, event => progress.push(event))
  assert.equal(result.candidates[0].match, 'title')
  assert.deepEqual(result.errors, ['Open Library 조회 실패'])
  assert.deepEqual(progress, [
    { source: 'Open Library', status: 'failed', count: 0 },
    { source: 'Google Books', status: 'done', count: 1 },
  ])
})

test('rejects empty and malformed input', async () => {
  await assert.rejects(discover({}), /제목 또는 ISBN/)
  await assert.rejects(discover({ isbn: '123' }), /ISBN/)
  await assert.rejects(discover({ isbn: '9788936433599' }), /ISBN/)
})

test('title search includes cover variants from work editions', async () => {
  const fetcher = async url => {
    const path = String(url)
    if (path.includes('/editions.json')) return { ok: true, json: async () => ({ entries: [
      { key: '/books/OL2M', title: 'Example', covers: [456], isbn_13: ['9788936433598'], publishers: ['Publisher'], publish_date: '2007' },
    ] }) }
    if (path.includes('openlibrary.org')) return { ok: true, json: async () => ({ docs: [
      { key: '/works/OL1W', title: 'Example', cover_i: 123 },
    ] }) }
    return { ok: true, json: async () => ({ items: [] }) }
  }
  const result = await discover({ title: 'Example', isbn: '9788936433598' }, fetcher)
  const edition = result.candidates.find(candidate => candidate.id === 'ol-edition-OL2M-456')
  assert.equal(edition?.publisher, 'Publisher')
  assert.equal(edition?.year, 2007)
  assert.equal(edition?.match, 'isbn')
})

test('applying a cover uploads a variant before making it representative', async () => {
  const bookId = '11111111-1111-4111-8111-111111111111'
  const calls = []
  const backend = async (path, _authorization, init = {}) => {
    calls.push({ path, method: init.method ?? 'GET', body: init.body })
    if (path === `/books/original/${bookId}`) return { languageCode: 'ko', countryCode: 'KR', covers: [] }
    if (path === '/covers') return { originalUrl: 'https://stored/image.jpg', thumbnailUrl: 'https://stored/thumb.jpg', originalFileName: 'cover.jpg', width: 900, height: 1300, fileSize: 3 }
    if (path === `/books/${bookId}/covers`) return { id: 'cover-1' }
    return null
  }
  const fetcher = async () => ({ ok: true, status: 200, body: new ReadableStream({ start(controller) {
    controller.enqueue(Uint8Array.from([0xff, 0xd8, 0xff]))
    controller.close()
  } }) })
  const result = await applyCover({ bookId, kind: 'original', imageUrl: 'https://covers.openlibrary.org/b/id/123-L.jpg', source: 'Open Library', ribbon: 'clean' }, 'Bearer token', fetcher, backend)
  assert.equal(result.representative, true)
  assert.deepEqual(calls.map(call => [call.method, call.path]), [
    ['GET', `/books/original/${bookId}`], ['POST', '/covers'], ['POST', `/books/${bookId}/covers`],
    ['PUT', `/books/${bookId}/covers/cover-1/representative`],
  ])
  assert.equal(JSON.parse(calls[2].body).label, '띠지 없음')
})

test('applying an already imported cover reuses its variant', async () => {
  const bookId = '11111111-1111-4111-8111-111111111111'
  const imageUrl = 'https://covers.openlibrary.org/b/id/123-L.jpg'
  const calls = []
  const backend = async (path, _authorization, init = {}) => {
    calls.push([init.method ?? 'GET', path])
    if (path.includes('/original/')) return { covers: [{ id: 'cover-1', sourceUrl: imageUrl }] }
    return null
  }
  const result = await applyCover({ bookId, kind: 'original', imageUrl, source: 'Open Library', ribbon: 'unknown' }, 'Bearer token', () => { throw new Error('unexpected download') }, backend)
  assert.equal(result.reused, true)
  assert.deepEqual(calls, [['GET', `/books/original/${bookId}`], ['PUT', `/books/${bookId}/covers/cover-1/representative`]])
})

test('rejects non-provider image URLs before downloading', async () => {
  await assert.rejects(applyCover({
    bookId: '11111111-1111-4111-8111-111111111111', kind: 'original',
    imageUrl: 'http://127.0.0.1/private', source: 'Open Library', ribbon: 'clean',
  }, 'Bearer token'), /커버 이미지 주소/)
})
