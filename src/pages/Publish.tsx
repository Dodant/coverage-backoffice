import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, safeUrl } from '../api'
import type { Page } from '../ui'
import { useWork } from '../useWork'

// 사이드바 '퍼블리시'에 끌어다 놓아 DRAFT로 등록된 원서. 고친 뒤 공개하면 사용자 화면(PUBLISHED만 노출)에 나온다
type Draft = {
  id: string; title: string; originalTitle: string | null; countryCode: string | null; languageCode: string
  year: number | null; genre: string | null; isbn: string | null; edition: string | null; seriesNumber: string | null
  author: { name: string } | null; publisher: { name: string } | null; series: { name: string } | null
  frontCover: { thumbnailUrl: string | null; sourceName: string | null } | null; createdAt: string
}
const FIELDS = [['title', '제목'], ['originalTitle', '원제'], ['isbn', 'ISBN'], ['year', '출간 연도'], ['genre', '장르'],
  ['edition', '판'], ['seriesNumber', '시리즈 권'], ['languageCode', '언어'], ['countryCode', '나라']] as const
type Field = (typeof FIELDS)[number][0]
const formOf = (book: Draft) => Object.fromEntries(FIELDS.map(([key]) => [key, String(book[key] ?? '')])) as Record<Field, string>

export default function Publish() {
  const [drafts, setDrafts] = useState<Draft[] | null>(null)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [params, setParams] = useSearchParams()

  const load = () => api<Page<Draft>>('/admin/books?status=DRAFT&size=200')
    .then(page => setDrafts(page.content))
    .catch(e => setError(e instanceof Error ? e.message : String(e)))
  useEffect(() => {
    void load()
    window.addEventListener('publish:queued', load)
    return () => window.removeEventListener('publish:queued', load)
  }, [])
  // 전역 검색에서 온 ?id=: 읽고 지워서 같은 책을 다시 골라도 반응한다
  useEffect(() => {
    const id = params.get('id')
    if (!id) return
    setSelectedId(id)
    setParams({}, { replace: true })
  }, [params, setParams])

  const selected = drafts?.find(book => book.id === selectedId)
  return <>
    <h1>퍼블리시</h1>
    <p className="muted">창비 자료실 카드를 사이드바의 '퍼블리시'로 끌어다 놓으면 펜딩(DRAFT)으로 등록됩니다. 서지정보를 고친 뒤 공개하면 사용자에게 보입니다.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {drafts && !drafts.length && <p className="muted">펜딩 중인 책이 없습니다.</p>}
    {drafts && drafts.length > 0 && <div className={'changbi-layout' + (selected ? ' with-detail' : '')}>
      <div className="changbi-grid">{drafts.map(book => <button key={book.id} className={'changbi-item' + (book.id === selectedId ? ' selected' : '')} onClick={() => setSelectedId(book.id)}>
        {safeUrl(book.frontCover?.thumbnailUrl) ? <img src={safeUrl(book.frontCover?.thumbnailUrl)} alt="" loading="lazy" /> : <span className="nocover">표지 없음</span>}
        <strong>{book.title}</strong>
        <span className="muted small">{[book.author?.name, book.publisher?.name].filter(Boolean).join(' · ')}</span>
        <span className="badge s-dry">펜딩</span>
      </button>)}</div>
      {selected && <Editor key={selected.id} book={selected} onSaved={book => setDrafts(list => list && list.map(b => b.id === book.id ? book : b))}
        onPublished={() => { setDrafts(list => list && list.filter(b => b.id !== selected.id)); setSelectedId('') }} />}
    </div>}
  </>
}

function Editor({ book, onSaved, onPublished }: { book: Draft; onSaved: (book: Draft) => void; onPublished: () => void }) {
  const [form, setForm] = useState(() => formOf(book))
  const { busy, error, message, setMessage, work } = useWork()
  const changed = FIELDS.filter(([key]) => form[key] !== String(book[key] ?? ''))
  const dirty = changed.length > 0
  // 바뀐 칸만 보낸다. 백엔드 PUT은 null을 '그대로 둠'으로 보고 ''는 값으로 저장하므로 비우기는 받지 않는다
  const save = () => work('저장하는 중…', async () => {
    const blank = changed.filter(([key]) => !form[key].trim()).map(([, label]) => label)
    if (blank.length) throw new Error(`비울 수 없는 칸입니다(백엔드가 빈 값을 받지 않음): ${blank.join(', ')}`)
    if (changed.some(([key]) => key === 'year') && !/^\d{4}$/.test(form.year.trim())) throw new Error('출간 연도는 네 자리 숫자여야 합니다.')
    const body = Object.fromEntries(changed.map(([key]) => [key, key === 'year' ? Number(form.year) : form[key].trim()]))
    const saved = await api<Draft>(`/books/original/${book.id}`, { method: 'PUT', body })
    onSaved(saved)
    setForm(formOf(saved)) // 서버가 돌려준 값으로 맞춰야 '저장됨' 상태가 정확하다
    setMessage('저장했습니다.')
  })
  const publish = () => work('공개하는 중…', async () => {
    await api('/admin/moderation/content/restore', { method: 'POST', body: { targetType: 'ORIGINAL_BOOK', targetId: book.id } })
    window.dispatchEvent(new Event('publish:changed')) // 사이드바 펜딩 수
    onPublished()
  })

  return <aside className="panel changbi-detail">
    <div className="changbi-detail-head">
      {safeUrl(book.frontCover?.thumbnailUrl) ? <img src={safeUrl(book.frontCover?.thumbnailUrl)} alt={`${book.title} 표지`} /> : <div className="nocover">표지 없음</div>}
      <div>
        <strong>{book.title}</strong>
        <p className="muted small">{[book.author?.name, book.publisher?.name, book.series && `${book.series.name} ${book.seriesNumber ?? ''}`.trim()].filter(Boolean).join(' · ')}</p>
        <p className="muted small">{book.frontCover?.sourceName} · {new Date(book.createdAt).toLocaleString()} 등록</p>
      </div>
    </div>
    <form className="publish-form" onSubmit={e => { e.preventDefault(); void save() }}>
      {FIELDS.map(([key, label]) => <label key={key}>{label}
        <input value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
      </label>)}
      <p className="muted small">저자·출판사·시리즈는 엔티티 정리에서 바꿉니다.</p>
      {busy && <p className="note" role="status">{busy}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {message && <p className="note" role="status">{message}</p>}
      <div className="row">
        <button type="submit" disabled={!dirty || Boolean(busy)}>저장</button>
        <button type="button" className="primary" disabled={dirty || Boolean(busy)} title={dirty ? '저장한 뒤 공개할 수 있습니다' : ''} onClick={() => void publish()}>사용자에게 공개</button>
      </div>
    </form>
  </aside>
}
