import { useEffect, useState } from 'react'
import { api } from '../api'
import { Pager, type Page } from '../ui'

type Kind = 'authors' | 'publishers' | 'designers'
type Entity = { id: string; name: string; aliases: string[]; nationality?: string; countryCode?: string; createdAt: string }

const KINDS: [Kind, string][] = [['authors', '작가'], ['publishers', '출판사'], ['designers', '디자이너']]

export default function Entities() {
  const [kind, setKind] = useState<Kind>('authors')
  const [selected, setSelected] = useState<Entity | null>(null)
  const [version, setVersion] = useState(0) // 병합·별칭 변경 뒤 목록 다시 읽기
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>엔티티 정리</h1>
        <Reindex />
      </div>
      <div className="tabs">
        {KINDS.map(([k, label]) => (
          <button key={k} className={k === kind ? 'on' : ''} onClick={() => { setKind(k); setSelected(null) }}>{label}</button>
        ))}
      </div>
      <div className="two-col">
        <EntityList kind={kind} selectedId={selected?.id} onPick={setSelected} version={version} />
        {selected
          ? <EntityDetail kind={kind} entity={selected} onChanged={e => { setSelected(e); setVersion(v => v + 1) }} />
          : <p className="muted">왼쪽에서 항목을 고르세요. 별칭을 관리하거나 다른 항목으로 합칠 수 있습니다.</p>}
      </div>
    </>
  )
}

function EntityList({ kind, selectedId, onPick, version, exclude }: {
  kind: Kind; selectedId?: string; onPick: (e: Entity) => void; version?: number; exclude?: string
}) {
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [data, setData] = useState<Page<Entity> | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { setPage(0) }, [kind, query])
  useEffect(() => {
    const q = new URLSearchParams({ page: String(page), size: '20', sort: 'name,asc' })
    if (query) q.set('name', query)
    api<Page<Entity>>(`/${kind}?${q}`).then(d => { setData(d); setError('') }, e => setError(String(e)))
  }, [kind, query, page, version])
  return (
    <div>
      <form className="row" onSubmit={e => { e.preventDefault(); setQuery(name.trim()) }} style={{ marginBottom: 8 }}>
        <input placeholder="이름으로 찾기" value={name} onChange={e => setName(e.target.value)} />
        <button>찾기</button>
      </form>
      {error && <p className="error">{error}</p>}
      {data?.content.filter(e => e.id !== exclude).map(e => (
        <button key={e.id} className={'list-pick' + (e.id === selectedId ? ' on' : '')} onClick={() => onPick(e)}>
          {e.name} {e.aliases.length > 0 && <span className="muted small">({e.aliases.join(', ')})</span>}
        </button>
      ))}
      {data && !data.content.length && <p className="muted">없음</p>}
      {data && <Pager page={data} onPage={setPage} />}
    </div>
  )
}

function EntityDetail({ kind, entity, onChanged }: { kind: Kind; entity: Entity; onChanged: (e: Entity | null) => void }) {
  const [alias, setAlias] = useState('')
  const [target, setTarget] = useState<Entity | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setTarget(null); setMsg('') }, [entity.id])

  const run = async (f: () => Promise<void>) => {
    setBusy(true)
    setMsg('')
    try { await f() } catch (e) { setMsg(String(e)) } finally { setBusy(false) }
  }
  const addAlias = () => run(async () => {
    const r = await api<{ aliases: string[] }>(`/admin/entities/${kind}/${entity.id}/aliases`, { method: 'POST', body: { alias: alias.trim() } })
    setAlias('')
    onChanged({ ...entity, aliases: r.aliases })
  })
  const removeAlias = (a: string) => run(async () => {
    const r = await api<{ aliases: string[] }>(`/admin/entities/${kind}/${entity.id}/aliases/${encodeURIComponent(a)}`, { method: 'DELETE' })
    onChanged({ ...entity, aliases: r.aliases })
  })
  const merge = () => run(async () => {
    if (!target) return
    if (!confirm(`'${entity.name}'을(를) '${target.name}'(으)로 합칩니다. '${entity.name}'은 삭제되고 연결된 책·표지는 '${target.name}'로 옮겨집니다. 되돌릴 수 없습니다.`)) return
    await api(`/admin/entities/${kind}/merge`, { method: 'POST', body: { sourceId: entity.id, targetId: target.id } })
    setMsg(`'${target.name}'로 합쳤습니다`)
    onChanged(null)
  })

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>{entity.name}</h2>
      <div className="muted small">{entity.id}</div>
      <h2>별칭</h2>
      <div className="row">
        {entity.aliases.map(a => (
          <span key={a} className="badge" style={{ color: 'var(--text)' }}>
            {a} <button aria-label={`${a} 삭제`} onClick={() => removeAlias(a)} disabled={busy} style={{ border: 0, padding: 0, background: 'none' }}>×</button>
          </span>
        ))}
        {!entity.aliases.length && <span className="muted">없음</span>}
      </div>
      <form className="row" style={{ marginTop: 8 }} onSubmit={e => { e.preventDefault(); if (alias.trim()) addAlias() }}>
        <input placeholder="별칭 추가 (예: Han Kang)" value={alias} onChange={e => setAlias(e.target.value)} />
        <button disabled={busy || !alias.trim()}>추가</button>
      </form>
      <h2>다른 항목으로 합치기</h2>
      <p className="muted small">같은 사람·회사가 이름만 다르게 두 번 들어갔을 때 씁니다. 이 항목이 삭제되고 연결된 책·표지가 고른 항목으로 옮겨집니다.</p>
      <EntityList kind={kind} selectedId={target?.id} onPick={setTarget} exclude={entity.id} />
      <button className="danger" disabled={busy || !target} onClick={merge} style={{ marginTop: 8 }}>
        {target ? `'${target.name}'(으)로 합치기` : '합칠 대상을 고르세요'}
      </button>
      {msg && <p className={msg.startsWith('\'') ? '' : 'error'}>{msg}</p>}
    </div>
  )
}

function Reindex() {
  const [state, setState] = useState('')
  const go = async () => {
    if (!confirm('검색 인덱스를 전체 다시 만듭니다. 끝날 때까지 검색 결과가 비어 보입니다.')) return
    setState('재색인 중…')
    try {
      await api('/admin/search/reindex', { method: 'POST' })
      setState('재색인 완료')
    } catch (e) {
      setState(String(e))
    }
  }
  return <div className="row"><span className="muted small">{state}</span><button onClick={go} disabled={state === '재색인 중…'}>검색 재색인</button></div>
}
