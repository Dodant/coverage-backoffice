// 여러 화면에서 쓰는 작은 부품

export type Page<T> = { content: T[]; number: number; totalPages: number; totalElements: number; first: boolean; last: boolean }

export function Pager<T>({ page, onPage }: { page: Page<T>; onPage: (n: number) => void }) {
  if (page.totalPages <= 1) return null
  return (
    <div className="row" style={{ marginTop: 8 }}>
      <button disabled={page.first} onClick={() => onPage(page.number - 1)}>이전</button>
      <span className="muted">{page.number + 1} / {page.totalPages} (총 {page.totalElements})</span>
      <button disabled={page.last} onClick={() => onPage(page.number + 1)}>다음</button>
    </div>
  )
}
