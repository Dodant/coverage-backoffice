import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import { ISSUE_LABELS, STATUS_LABELS, imageOf, type CatalogItem } from '../catalog'
import { langName } from '../lang'
import { Pager, type Page } from '../ui'

export default function Books({ attention = false }: { attention?: boolean }) {
  const [params, setParams] = useSearchParams()
  const [data, setData] = useState<Page<CatalogItem> | null>(null)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const query = params.toString()
  useEffect(() => {
    const controller = new AbortController()
    const search = new URLSearchParams(query)
    search.set('size', '30')
    if (attention) search.set('needsAttention', 'true')
    setData(null)
    setError('')
    api<Page<CatalogItem>>(`/admin/catalog?${search}`, { signal: controller.signal }).then(setData).catch(e => {
      if (!controller.signal.aborted) setError(e instanceof ApiError && [401, 403].includes(e.status)
        ? '도서 목록을 보려면 관리자 인증이 필요합니다.' : String(e))
    })
    return () => controller.abort()
  }, [query, attention, refresh])

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value); else next.delete(key)
    next.delete('page')
    setParams(next)
  }
  const back = `${attention ? '/books/attention' : '/books'}${query ? '?' + query : ''}`
  return <>
    <div className="row catalog-heading"><h1>{attention ? '보완 필요 도서' : '전체 도서'}</h1>
      <button onClick={() => setRefresh(v => v + 1)}>새로고침</button></div>
    <p className="muted">{attention ? '보완 항목을 선택하고 책을 열어 수정하세요. 해상도·출처·크레딧은 대표 표지를 기준으로 확인합니다.' : '원서와 번역서의 서지정보, 판, 표지 버전을 한곳에서 관리합니다.'}</p>
    {attention && <div className="issue-filters" aria-label="보완 항목">
      <button className={!params.get('issue') ? 'primary' : ''} onClick={() => set('issue', '')}>모든 보완 항목</button>
      {Object.entries(ISSUE_LABELS).map(([key, label]) => <button key={key} className={params.get('issue') === key ? 'primary' : ''} onClick={() => set('issue', key)}>{label}</button>)}
    </div>}
    <form className="panel catalog-filters" key={query} onSubmit={e => {
      e.preventDefault()
      const values = new FormData(e.currentTarget)
      const next = new URLSearchParams()
      for (const [key, value] of values) if (String(value).trim()) next.set(key, String(value).trim())
      if (params.get('issue')) next.set('issue', params.get('issue')!)
      setParams(next)
    }}>
      <label className="catalog-query">도서 검색<input name="query" defaultValue={params.get('query') ?? ''} placeholder="제목, 저자, ISBN" /></label>
      <label>종류<select name="kind" defaultValue={params.get('kind') ?? ''}><option value="">원서·번역서</option><option value="ORIGINAL">원서</option><option value="TRANSLATED">번역서</option></select></label>
      <label>상태<select name="status" defaultValue={params.get('status') ?? ''}><option value="">모든 상태</option>{Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>언어<input name="language" defaultValue={params.get('language') ?? ''} placeholder="ko, en, ja" maxLength={2} /></label>
      <label>출판사<input name="publisher" defaultValue={params.get('publisher') ?? ''} placeholder="출판사 이름" /></label>
      <label>표지<select name="hasCover" defaultValue={params.get('hasCover') ?? ''}><option value="">전체</option><option value="true">표지 있음</option><option value="false">없음·숨김</option></select></label>
      <label>정렬<select name="sort" defaultValue={params.get('sort') ?? 'created'}><option value="created">최근 등록</option><option value="updated">최근 수정</option><option value="title">제목순</option></select></label>
      <div className="row"><button className="primary">조회</button><button type="button" onClick={() => setParams({})}>초기화</button></div>
    </form>
    {error && <div role="alert" className="panel"><p className="error">{error}</p><button onClick={() => setRefresh(v => v + 1)}>다시 시도</button></div>}
    {!data && !error && <p role="status">도서 목록을 불러오는 중…</p>}
    {data && <>
      <p className="muted small" role="status">총 {data.totalElements.toLocaleString()}권 {attention && '· 보완 표시가 있다고 공개가 제한되지는 않습니다.'}</p>
      <table className="catalog-table"><thead><tr><th scope="col">도서</th><th scope="col">구분·판</th><th scope="col">출판 정보</th><th scope="col">상태</th><th scope="col">보완 항목</th></tr></thead>
        <tbody>{data.content.map(book => <tr key={book.id}>
          <td><Link className="catalog-book" to={`/books/${book.id}?${new URLSearchParams({ back })}`}>
            {imageOf(book.frontCover) ? <img src={imageOf(book.frontCover)} alt="" loading="lazy" /> : <span className="catalog-no-cover">표지 없음</span>}
            <span><strong>{book.title}</strong><small>{book.author || '저자 미입력'}</small><small>{book.isbn || 'ISBN 없음'}</small></span></Link></td>
          <td>{book.kind === 'ORIGINAL' ? '원서' : '번역서'}<br /><span className="muted small">{langName(book.languageCode)} · {book.edition || '판 미입력'}</span></td>
          <td>{book.publisher || '출판사 미입력'}<br /><span className="muted small">{book.year ? `${book.year}년` : '연도 미입력'}</span></td>
          <td><span className={`badge ${book.status === 'PUBLISHED' ? 's-created' : 's-dry'}`}>{STATUS_LABELS[book.status]}</span></td>
          <td><IssueBadges issues={book.issues} /></td>
        </tr>)}{!data.content.length && <tr><td colSpan={5}>조건에 맞는 도서가 없습니다.</td></tr>}</tbody></table>
      <Pager page={data} onPage={n => { const next = new URLSearchParams(params); next.set('page', String(n)); setParams(next) }} />
    </>}
  </>
}

export function IssueBadges({ issues }: { issues: CatalogItem['issues'] }) {
  return <div className="row issue-badges">{issues.length ? issues.map(issue => <span className="badge s-dry" key={issue}>{ISSUE_LABELS[issue]}</span>) : <span className="muted small">보완 항목 없음</span>}</div>
}
