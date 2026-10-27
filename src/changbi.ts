// 창비 자료실 데이터(cover-agent /changbi/books, 1.9MB). 창비 화면과 전역 검색이 세션에 한 번 받아 같이 쓴다
export type ChangbiBook = {
  key: string; url: string; title: string; list_title: string; imprint: string
  original_title?: string; authors?: string; translators?: string; pub_month?: string; pub_month_from_upload?: boolean
  format?: string; isbn?: string; pages?: number; price?: number
  kind: '단권' | '연작' | '총서' | '세트' | '잡지'; series?: string; volume?: string
  cover_status: 'clean' | '띠지' | '미확인' | '여러권' | '오류'; cover_file?: string; cover_source_name?: string
  images: string[]; isbn_shared?: boolean; error?: string
  applied?: { bookId: string; kind: string; coverId: string; at: string }
}

export const usable = (book: ChangbiBook) => book.cover_status === 'clean' || book.cover_status === '띠지'
export const translated = (book: ChangbiBook) => Boolean(book.original_title || book.translators)
// 표지를 다시 고르면 version을 올려 브라우저 캐시를 피한다
export const thumbUrl = (book: ChangbiBook, version = 0) => book.cover_file && usable(book)
  ? `/cover-agent/changbi/thumbs/${encodeURIComponent(book.cover_file.replace(/\.[^.]+$/, ''))}.jpg?v=${version}` : ''

let cache: Promise<ChangbiBook[]> | null = null
export function loadChangbiBooks(): Promise<ChangbiBook[]> {
  return cache ??= fetch('/cover-agent/changbi/books').then(async response => {
    const data = await response.json().catch(() => null)
    if (!response.ok) throw new Error(data?.message ?? '창비 자료를 불러올 수 없습니다. npm run cover-agent를 실행해 주세요.')
    return data as ChangbiBook[]
  }).catch(error => { cache = null; throw error })
}
// 표지 고르기·등록 결과를 캐시에도 반영한다(화면은 제 상태를 바꾸고, 검색은 이걸 본다)
export function patchChangbiBook(key: string, change: Partial<ChangbiBook>) {
  cache = cache?.then(list => list.map(book => book.key === key ? { ...book, ...change } : book)) ?? null
}
