import assert from 'node:assert/strict'
import { test } from 'node:test'
import { discover } from './cover-agent.mjs'

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
