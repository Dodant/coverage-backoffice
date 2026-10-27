import { useEffect, useState, type DragEvent } from 'react'
import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { api, CHANGBI_DRAG, coverAgent, session } from './api'
import type { Page } from './ui'
import Dashboard from './pages/Dashboard'
import Entities from './pages/Entities'
import Covers from './pages/Covers'
import CoverDiscovery from './pages/CoverDiscovery'
import Runs from './pages/Runs'
import Changbi from './pages/Changbi'
import Publish from './pages/Publish'
import GlobalSearch from './GlobalSearch'

// 사이드바. 작업 흐름(수집 → 검토·공개 → 관리) 순서. 항목 추가는 여기 한 줄
type Item = { to: string; label: string; badge?: 'pending'; drop?: boolean }
const MENU: { section?: string; items: Item[] }[] = [
  { items: [{ to: '/dashboard', label: '대시보드' }] },
  { section: '수집', items: [
    { to: '/publishers/changbi', label: '창비 자료실' },
    { to: '/cover-discovery', label: '온라인 검색' },
  ] },
  { section: '검토 · 공개', items: [
    { to: '/publish', label: '퍼블리시', badge: 'pending', drop: true },
    { to: '/covers', label: '표지 묶기' },
  ] },
  { section: '관리', items: [
    { to: '/entities', label: '엔티티 정리' },
    { to: '/runs', label: '등록 기록' },
  ] },
]

export default function App() {
  return <Shell />
}

function Shell() {
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [over, setOver] = useState(false)
  const pending = usePendingCount()

  useEffect(() => {
    if (!toast || toast.error) return
    const timer = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(timer)
  }, [toast])
  // 창비 카드를 끄는 동안 놓을 곳을 표시한다
  useEffect(() => {
    const start = (e: globalThis.DragEvent) => setDragging(Boolean(e.dataTransfer?.types.includes(CHANGBI_DRAG)))
    const end = () => { setDragging(false); setOver(false) }
    window.addEventListener('dragstart', start)
    window.addEventListener('dragend', end)
    return () => { window.removeEventListener('dragstart', start); window.removeEventListener('dragend', end) }
  }, [])

  // 창비 자료실 카드를 '퍼블리시'에 놓으면 DRAFT 원서로 등록한다. 결과는 'publish:queued' 이벤트로 각 화면에 알린다
  const drop = async (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    const key = e.dataTransfer.getData(CHANGBI_DRAG)
    setToast({ text: '펜딩으로 등록하는 중…' })
    try {
      const result = await coverAgent<{ title: string; applied: unknown }>('/changbi/register', { key }, { token: session()?.token })
      window.dispatchEvent(new CustomEvent('publish:queued', { detail: { key, applied: result.applied } }))
      setToast({ text: `'${result.title}' 펜딩으로 등록했습니다.` })
    } catch (error) {
      setToast({ text: error instanceof Error ? error.message : String(error), error: true })
    }
  }

  return (
    <div className="layout">
      <nav className="side">
        <div className="brand">COVERAGE 백오피스</div>
        <GlobalSearch />
        {MENU.map((group, i) => <div key={group.section ?? i} className="side-section">
          {group.section && <span className="side-title">{group.section}</span>}
          {group.items.map(item => <NavLink key={item.to} to={item.to}
            className={item.drop ? (over ? 'drop-over' : dragging ? 'drop-target' : '') : ''}
            onDragOver={item.drop ? e => { if (e.dataTransfer.types.includes(CHANGBI_DRAG)) { e.preventDefault(); setOver(true) } } : undefined}
            onDragLeave={item.drop ? () => setOver(false) : undefined}
            onDrop={item.drop ? e => void drop(e) : undefined}>
            {item.label}
            {item.badge === 'pending' && pending > 0 && <span className="count">{pending}</span>}
          </NavLink>)}
        </div>)}
      </nav>
      <main className="page">
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/covers" element={<Covers />} />
          <Route path="/covers/:originalId" element={<Covers />} />
          <Route path="/cover-discovery" element={<CoverDiscovery />} />
          <Route path="/publishers/changbi" element={<Changbi />} />
          <Route path="/changbi" element={<Navigate to="/publishers/changbi" replace />} />
          <Route path="/publish" element={<Publish />} />
          <Route path="/runs" element={<Runs />} />
          <Route path="/runs/:file" element={<Runs />} />
          <Route path="/entities" element={<Entities />} />
          <Route path="/login" element={<Navigate to="/cover-discovery" replace />} />
          <Route path="*" element={<Navigate to="/cover-discovery" replace />} />
        </Routes>
      </main>
      {toast && <div className={'toast' + (toast.error ? ' error' : '')} role={toast.error ? 'alert' : 'status'}>
        {toast.text} <button onClick={() => setToast(null)} aria-label="닫기">×</button>
      </div>}
    </div>
  )
}

// 펜딩(DRAFT) 원서 수. 관리자 토큰이 없으면 백엔드가 거절하므로 0으로 둔다
function usePendingCount() {
  const [count, setCount] = useState(0)
  useEffect(() => {
    const load = () => api<Page<unknown>>('/admin/books?status=DRAFT&size=1').then(page => setCount(page.totalElements)).catch(() => setCount(0))
    load()
    window.addEventListener('publish:queued', load)
    window.addEventListener('publish:changed', load)
    return () => { window.removeEventListener('publish:queued', load); window.removeEventListener('publish:changed', load) }
  }, [])
  return count
}
