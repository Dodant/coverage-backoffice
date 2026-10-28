import { expect, test } from '@playwright/test'
import type { Cover } from '../../src/catalog'

test('다른 표지를 저장해도 미저장 입력을 유지하고, 저장한 카드만 정리한다', async ({ page }) => {
  const { persisted, cards } = await setup(page)
  const first = cards('cover-a'), second = cards('cover-b')
  await first.getByLabel('표지 설명', { exact: true }).fill('A 미저장 설명')
  await second.getByLabel('표지 설명', { exact: true }).fill(' B 저장 설명 ')
  await second.getByRole('button', { name: '표지 정보 저장', exact: true }).click()
  await expect(second.getByLabel('표지 설명', { exact: true })).toHaveValue('B 저장 설명')
  await expect(second.getByRole('button', { name: '표지 정보 저장', exact: true })).toBeDisabled()
  await expect(first.getByLabel('표지 설명', { exact: true })).toHaveValue('A 미저장 설명')
  await expect(first.getByRole('button', { name: '표지 정보 저장', exact: true })).toBeEnabled()
  expect(persisted()[0].label).toBe('cover-a')

  const dialog = page.waitForEvent('dialog')
  const click = page.getByRole('button', { name: '변경 이력', exact: true }).click()
  await (await dialog).dismiss(); await click
  await expect(first.getByLabel('표지 설명', { exact: true })).toHaveValue('A 미저장 설명')

  await first.getByRole('button', { name: '표지 정보 저장', exact: true }).click()
  await expect(first.getByRole('button', { name: '표지 정보 저장', exact: true })).toBeDisabled()
  expect(persisted().map(cover => cover.label)).toEqual(['A 미저장 설명', 'B 저장 설명'])
})

test('대표 표지와 디자인 묶음을 바꿔도 다른 카드의 입력을 유지한다', async ({ page }) => {
  const { cards } = await setup(page)
  const first = cards('cover-a'), second = cards('cover-b')
  await first.getByLabel('표지 설명', { exact: true }).fill('A 작업 중')
  await second.getByRole('button', { name: '대표 표지로 지정', exact: true }).click()
  await expect(second.getByText('대표 표지', { exact: true })).toBeVisible()
  await expect(first.getByLabel('표지 설명', { exact: true })).toHaveValue('A 작업 중')
  await second.getByLabel('디자인 묶음 변경', { exact: true }).selectOption('cover-a')
  await second.getByRole('button', { name: '묶음 적용', exact: true }).click()
  await expect(second.getByText('design-group', { exact: true })).toBeVisible()
  await expect(first.getByLabel('표지 설명', { exact: true })).toHaveValue('A 작업 중')
  await expect(first.getByRole('button', { name: '표지 정보 저장', exact: true })).toBeEnabled()
})

test('저장 실패와 재시도에서도 두 카드의 입력을 잃지 않는다', async ({ page }) => {
  const { cards, failNextSave } = await setup(page)
  const first = cards('cover-a'), second = cards('cover-b')
  await first.getByLabel('표지 설명', { exact: true }).fill('A 초안')
  await second.getByLabel('표지 설명', { exact: true }).fill('B 초안')
  failNextSave()
  await second.getByRole('button', { name: '표지 정보 저장', exact: true }).click()
  await expect(second.getByRole('alert')).toContainText('검증용 저장 실패')
  await expect(first.getByLabel('표지 설명', { exact: true })).toHaveValue('A 초안')
  await expect(second.getByLabel('표지 설명', { exact: true })).toHaveValue('B 초안')
  await second.getByRole('button', { name: '표지 정보 저장', exact: true }).click()
  await expect(second.getByRole('button', { name: '표지 정보 저장', exact: true })).toBeDisabled()
  await expect(first.getByLabel('표지 설명', { exact: true })).toHaveValue('A 초안')
})

test('이전 갱신 응답이 늦게 와도 나중에 저장한 표지를 되돌리지 않는다', async ({ page }) => {
  const { cards, holdNextRead } = await setup(page)
  const first = cards('cover-a'), second = cards('cover-b')
  const held = holdNextRead()
  await first.getByLabel('표지 설명', { exact: true }).fill('A 최신 저장')
  await first.getByRole('button', { name: '표지 정보 저장', exact: true }).click()
  await held.arrived
  await second.getByLabel('표지 설명', { exact: true }).fill('B 최신 저장')
  await second.getByRole('button', { name: '표지 정보 저장', exact: true }).click()
  await expect(page.getByText('변경사항을 저장했습니다.', { exact: true })).toBeVisible()
  const delayedResponse = page.waitForResponse(r => new URL(r.url()).pathname === '/api/admin/catalog/book-1')
  held.release()
  await delayedResponse
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await expect(first.getByLabel('표지 설명', { exact: true })).toHaveValue('A 최신 저장')
  await expect(second.getByLabel('표지 설명', { exact: true })).toHaveValue('B 최신 저장')
  await expect(second.getByRole('button', { name: '표지 정보 저장', exact: true })).toBeDisabled()
})

async function setup(page: import('@playwright/test').Page) {
  const cover = (id: string): Cover => ({ id, imageUrl: 'https://example.org/cover.png', thumbnailUrl: 'https://example.org/thumb.png',
    label: id, width: 800, height: 1200, hidden: false, printingFrom: null, usedFrom: null, variantType: 'UNKNOWN', ribbonStatus: 'UNKNOWN',
    sourceName: '', sourceUrl: '', credits: [], similarGroupId: null })
  let covers = [cover('cover-a'), cover('cover-b')]
  let representative = 'cover-a'
  let fail = false
  let delayedRead: { arrived: () => void; untilReleased: Promise<void> } | undefined
  const holdNextRead = () => {
    let arrived!: () => void, release!: () => void
    const ready = new Promise<void>(resolve => { arrived = resolve })
    const untilReleased = new Promise<void>(resolve => { release = resolve })
    delayedRead = { arrived, untilReleased }
    return { arrived: ready, release }
  }
  await page.route('https://example.org/**', route => route.fulfill({ status: 204 }))
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (path === '/api/admin/books') return route.fulfill({ json: { content: [], totalElements: 0 } })
    if (path === '/api/admin/catalog/book-1') {
      const body = JSON.stringify({ kind: 'ORIGINAL', issues: [], relatedBooks: [],
      book: { id: 'book-1', title: '검증용 도서', languageCode: 'ko', countryCode: 'KR', year: 2026, isbn: null, edition: '초판',
        status: 'PUBLISHED', author: null, publisher: null, frontCover: covers.find(c => c.id === representative), covers,
        createdAt: '2026-10-27T00:00:00Z', updatedAt: '2026-10-27T00:00:00Z' } })
      const delay = delayedRead
      delayedRead = undefined
      if (delay) { delay.arrived(); await delay.untilReleased }
      return route.fulfill({ contentType: 'application/json', body })
    }
    if (path.endsWith('/representative')) {
      representative = path.split('/').at(-2)!
      return route.fulfill({ status: 204 })
    }
    if (path.endsWith('/similar-group')) {
      const id = path.split('/').at(-2)
      covers = covers.map(c => c.id === id ? { ...c, similarGroupId: 'design-group' } : c)
      return route.fulfill({ json: covers.find(c => c.id === id) })
    }
    if (request.method() === 'PUT' && path.startsWith('/api/admin/catalog/book-1/covers/')) {
      if (fail) { fail = false; return route.fulfill({ status: 500, json: { message: '검증용 저장 실패' } }) }
      const id = path.split('/').at(-1)
      covers = covers.map(c => c.id === id ? { ...c, ...request.postDataJSON() } : c)
      return route.fulfill({ json: covers.find(c => c.id === id) })
    }
    return route.fulfill({ status: 404, json: { message: '예상하지 않은 검증 요청' } })
  })
  await page.goto('/books/book-1')
  await page.getByRole('button', { name: /판·쇄·표지 버전/ }).click()
  return { persisted: () => covers, cards: (id: string) => page.locator(`[data-cover-id="${id}"]`), failNextSave: () => { fail = true }, holdNextRead }
}
