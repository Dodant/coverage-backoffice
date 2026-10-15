import { Fragment, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { safeUrl } from '../api'
import { langName } from '../lang'

// 에이전트 실행 기록은 에이전트를 돌린 컴퓨터의 runs/에만 있다.
// coverage-backend에서 `python3 .claude/skills/register-book/api.py serve`를 띄우면 개발 서버가 /agent로 프록시한다

type RunSummary = { file: string; ranAt: string; dryRun: boolean; query: string | null; summary: Record<string, number> }
type CoverRef = string | { url: string; sourceName?: string }
type PlanItem = {
  title?: string; originalTitle?: string; isbn?: string; authorName?: string; translatorName?: string; publisherName?: string
  year?: number; countryCode?: string; genre?: string; coverNote?: string; notes?: string
  coverSourceUrls?: CoverRef[]; sources?: Record<string, string | string[]>
  otherPrintingCovers?: { url: string; sourceName?: string; size?: string; note?: string }[]
}
type Result = {
  kind: string; title: string; languageCode: string; isbn?: string; status: string; reason?: string; id?: string; existingId?: string
  coverUrl?: string; coverSourceUrl?: string; coverSourceName?: string; coverSize?: string; from?: string; to?: string
}
type Run = RunSummary & {
  apiBase: string; results: Result[]
  plan: { query: string; work?: { wikidata?: string; openlibrary?: string; author?: string }; original: PlanItem; translations?: PlanItem[]
    candidates?: { languageCode: string; title: string; isbn?: string; why?: string }[]
    review?: { languageCode: string; title: string; isbn?: string; reason?: string }[] }
}

const STATUS: Record<string, string> = {
  created: '등록', skipped: '건너뜀', 'cover-upgraded': '표지 교체', failed: '실패',
  'would-create': '등록 예정', 'would-upgrade-cover': '표지 교체 예정',
}
const Badge = ({ s }: { s: string }) => <span className={`badge s-${s}`}>{STATUS[s] ?? s}</span>
const urlOf = (c: CoverRef) => (typeof c === 'string' ? c : c.url)

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch('/agent' + path)
  if (!r.ok) throw new Error(String(r.status))
  return r.json()
}

export default function Runs() {
  const { file } = useParams()
  const nav = useNavigate()
  const [runs, setRuns] = useState<RunSummary[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { getJson<RunSummary[]>('/runs').then(setRuns, () => setError('off')) }, [])

  useEffect(() => { if (!file && runs?.length) nav(`/runs/${encodeURIComponent(runs[0].file)}`, { replace: true }) }, [file, runs, nav])

  if (error) return (
    <>
      <h1>등록 기록</h1>
      <div className="panel">
        에이전트 실행 기록 서버가 꺼져 있습니다. coverage-backend에서 실행하세요:
        <pre>python3 .claude/skills/register-book/api.py serve</pre>
      </div>
    </>
  )
  const groups: Record<string, RunSummary[]> = {}
  runs?.forEach(r => (groups[r.query ?? '(제목 없음)'] ??= []).push(r))
  return (
    <>
      <h1>등록 기록</h1>
      <div className="runs-layout">
        <div>
          {Object.entries(groups).map(([q, rs]) => (
            <div key={q}>
              <h2 className="small muted">{q}</h2>
              {rs.map(r => (
                <button key={r.file} className={'list-pick' + (r.file === file ? ' on' : '')} onClick={() => nav(`/runs/${encodeURIComponent(r.file)}`)}>
                  {r.ranAt?.replace('T', ' ')} {r.dryRun && <span className="badge s-dry">dry-run</span>}
                  <div className="muted small">{Object.entries(r.summary ?? {}).map(([k, v]) => `${STATUS[k] ?? k} ${v}`).join(' · ')}</div>
                </button>
              ))}
            </div>
          ))}
          {runs && !runs.length && <p className="muted">기록 없음</p>}
        </div>
        <div>{file && <RunDetail file={file} />}</div>
      </div>
    </>
  )
}

function RunDetail({ file }: { file: string }) {
  const [run, setRun] = useState<Run | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { setRun(null); getJson<Run>('/runs/' + encodeURIComponent(file)).then(setRun, e => setError(String(e))) }, [file])
  if (error) return <p className="error">{error}</p>
  if (!run) return <p className="muted">불러오는 중…</p>
  const plan = run.plan
  const items = [plan.original, ...(plan.translations ?? [])]
  const w = plan.work ?? {}
  const originalId = run.results[0]?.id ?? run.results[0]?.existingId
  return (
    <>
      <div className="row"><h2 style={{ margin: 0 }}>{plan.query}</h2>{run.dryRun && <span className="badge s-dry">dry-run</span>}
        {originalId && <Link to={`/covers/${originalId}`}>표지 묶기로 →</Link>}</div>
      <p className="muted small">
        {run.ranAt?.replace('T', ' ')} · {run.apiBase} · 저자 {w.author}
        {w.wikidata && <> · <a href={`https://www.wikidata.org/wiki/${encodeURIComponent(w.wikidata)}`} target="_blank" rel="noopener">{w.wikidata}</a></>}
        {w.openlibrary && <> · <a href={`https://openlibrary.org/works/${encodeURIComponent(w.openlibrary)}`} target="_blank" rel="noopener">{w.openlibrary}</a></>}
      </p>
      <div className="row" style={{ marginBottom: 12 }}>{Object.entries(run.summary ?? {}).map(([k, v]) => <span key={k}><Badge s={k} /> {v}</span>)}</div>
      {run.results.map((r, i) => <RunCard key={i} r={r} item={items[i] ?? {}} />)}
      {!!plan.review?.length && <>
        <h2>검토 필요 {plan.review.length}</h2>
        <table><thead><tr><th>언어</th><th>제목</th><th>ISBN</th><th>사유</th></tr></thead>
          <tbody>{plan.review.map((x, i) => <tr key={i}><td>{langName(x.languageCode)}</td><td>{x.title}</td><td>{x.isbn}</td><td>{x.reason}</td></tr>)}</tbody></table>
      </>}
      {!!plan.candidates?.length && <>
        <h2>다른 판 (후보) {plan.candidates.length}</h2>
        <table><thead><tr><th>언어</th><th>제목</th><th>ISBN</th><th>이유</th></tr></thead>
          <tbody>{plan.candidates.map((x, i) => <tr key={i}><td>{langName(x.languageCode)}</td><td>{x.title}</td><td>{x.isbn}</td><td>{x.why}</td></tr>)}</tbody></table>
      </>}
    </>
  )
}

function RunCard({ r, item }: { r: Result; item: PlanItem }) {
  // 서버에 올린 이미지 → 원본 출처 → plan의 후보 순으로 시도
  const imgs = [r.coverUrl, r.coverSourceUrl, ...(item.coverSourceUrls ?? []).map(urlOf)].map(safeUrl).filter(Boolean)
  const [n, setN] = useState(0)
  const fields: [string, unknown][] = ([
    ['ISBN', r.isbn || item.isbn], ['작가', item.authorName], ['원제', item.originalTitle !== item.title ? item.originalTitle : ''],
    ['옮긴이', item.translatorName], ['출판사', item.publisherName], ['연도', item.year], ['나라', item.countryCode], ['장르', item.genre],
    ['서버 ID', r.id || r.existingId],
  ] as [string, unknown][]).filter(([, v]) => v)
  const srcs = Object.entries(item.sources ?? {})
  const others = (item.otherPrintingCovers ?? []).filter(o => safeUrl(o.url))
  return (
    <div className="card">
      <div className="cover">
        {n < imgs.length ? <img src={imgs[n]} alt="" onError={() => setN(n + 1)} /> : <div className="nocover">표지 없음</div>}
        <div className="muted small">{r.coverSize || r.to} {r.coverSourceName}</div>
      </div>
      <div>
        <div className="title">{r.title} <Badge s={r.status} /> <span className="muted small">{r.kind === 'original' ? '원서' : '번역서'} · {langName(r.languageCode)}</span></div>
        {r.reason && <div className="muted small">{r.reason}</div>}
        {r.from && <div className="muted small">표지 {r.from} → {r.to}</div>}
        <dl>{fields.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{String(v)}</dd></Fragment>)}</dl>
        {item.coverNote && <div className="note">표지: {item.coverNote}</div>}
        {item.notes && <div className="note">{item.notes}</div>}
        {srcs.length > 0 && (
          <details><summary className="muted">출처 {srcs.reduce((a, [, v]) => a + ([] as string[]).concat(v).length, 0)}개</summary>
            <ul className="small">{srcs.flatMap(([k, v]) => ([] as string[]).concat(v).map((u, i) => {
              const m = String(u).match(/^(https?:\/\/\S+)(.*)$/)
              return <li key={k + i}><b className="muted">{k}</b> {m ? <><a href={m[1]} target="_blank" rel="noopener">{m[1]}</a>{m[2]}</> : String(u)}</li>
            }))}</ul>
          </details>
        )}
        {others.length > 0 && (
          <details><summary className="muted">다른 쇄 표지 {others.length}개 (등록 안 함)</summary>
            <div className="others">{others.map(o => (
              <figure key={o.url}><a href={safeUrl(o.url)} target="_blank" rel="noopener"><img src={safeUrl(o.url)} alt="" loading="lazy" /></a>
                {o.sourceName} {o.size}<br />{o.note}</figure>
            ))}</div>
          </details>
        )}
      </div>
    </div>
  )
}
