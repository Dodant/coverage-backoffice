import { useEffect, useState } from 'react'
import { api } from '../api'
import { Pager, type Page } from '../ui'

type Stats = {
  userStats: { totalUsers: number; activeUsers: number; suspendedUsers: number; newUsersToday: number; newUsersThisWeek: number; newUsersThisMonth: number; totalContributors: number; usersByRole: Record<string, number> }
  contentStats: { totalOriginalBooks: number; totalTranslatedBooks: number; totalRedesigns: number; totalCovers: number; newContentToday: number; newContentThisWeek: number }
  reportStats: { pendingReports: number; approvedReports: number; rejectedReports: number; totalReports: number }
  takedownStats: { pendingRequests: number; approvedRequests: number; rejectedRequests: number; totalRequests: number }
}

type AuditLog = {
  id: string; action: string; entityType: string; entityId: string
  performedById: string; performedByName: string; previousValue: string | null; newValue: string | null; createdAt: string
}

const ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'MERGE', 'SPLIT', 'STATUS_CHANGE']
const ENTITY_TYPES = ['ORIGINAL_BOOK', 'TRANSLATED_BOOK', 'REDESIGN', 'USER', 'COLLECTION', 'AUTHOR', 'PUBLISHER', 'DESIGNER']

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api<Stats>('/admin/dashboard/stats').then(setStats, e => setError(String(e)))
  }, [])

  return (
    <>
      <h1>대시보드</h1>
      {error && <p className="error">{error}</p>}
      {stats && (
        <div className="stats">
          <Stat label="원서" value={stats.contentStats.totalOriginalBooks} />
          <Stat label="번역서" value={stats.contentStats.totalTranslatedBooks} />
          <Stat label="리디자인" value={stats.contentStats.totalRedesigns} />
          <Stat label="표지" value={stats.contentStats.totalCovers} />
          <Stat label="오늘 / 이번 주 새 콘텐츠" value={`${stats.contentStats.newContentToday} / ${stats.contentStats.newContentThisWeek}`} />
          <Stat label="사용자 (활성)" value={`${stats.userStats.totalUsers} (${stats.userStats.activeUsers})`} />
          <Stat label="정지된 사용자" value={stats.userStats.suspendedUsers} />
          <Stat label="이번 달 가입" value={stats.userStats.newUsersThisMonth} />
          <Stat label="대기 중 신고" value={stats.reportStats.pendingReports} />
          <Stat label="대기 중 게시중단" value={stats.takedownStats.pendingRequests} />
        </div>
      )}
      <AuditLogs />
    </>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return <div className="stat"><span className="muted small">{label}</span><b>{value}</b></div>
}

function AuditLogs() {
  const [filter, setFilter] = useState({ action: '', entityType: '', entityId: '', userId: '', start: '', end: '' })
  const [applied, setApplied] = useState(filter)
  const [page, setPage] = useState(0)
  const [data, setData] = useState<Page<AuditLog> | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const f = applied
    // 백엔드는 조건 하나씩만 거르는 엔드포인트를 둔다. 엔티티 > 사용자 > 작업 > 기간 순으로 하나를 쓴다
    const base = f.entityType && f.entityId ? `/logs/entity/${f.entityType}/${encodeURIComponent(f.entityId.trim())}`
      : f.userId ? `/logs/user/${encodeURIComponent(f.userId.trim())}`
      : f.action ? `/logs/action/${f.action}`
      : f.start && f.end ? `/logs/range?start=${new Date(f.start).toISOString()}&end=${new Date(f.end).toISOString()}`
      : '/logs'
    const q = `${base.includes('?') ? '&' : '?'}page=${page}&size=30&sort=createdAt,desc`
    setError('')
    api<Page<AuditLog>>('/admin/dashboard' + base + q).then(setData, e => { setData(null); setError(String(e)) })
  }, [applied, page])

  const set = (k: keyof typeof filter) => (e: { target: { value: string } }) => setFilter({ ...filter, [k]: e.target.value })
  return (
    <>
      <h2>감사 로그</h2>
      <form className="panel row" onSubmit={e => { e.preventDefault(); setPage(0); setApplied(filter) }}>
        <select value={filter.action} onChange={set('action')}><option value="">모든 작업</option>{ACTIONS.map(a => <option key={a}>{a}</option>)}</select>
        <select value={filter.entityType} onChange={set('entityType')}><option value="">엔티티 종류</option>{ENTITY_TYPES.map(a => <option key={a}>{a}</option>)}</select>
        <input placeholder="엔티티 ID" value={filter.entityId} onChange={set('entityId')} size={14} />
        <input placeholder="사용자 ID" value={filter.userId} onChange={set('userId')} size={14} />
        <input type="datetime-local" value={filter.start} onChange={set('start')} aria-label="시작" />
        <input type="datetime-local" value={filter.end} onChange={set('end')} aria-label="끝" />
        <button className="primary">조회</button>
        <span className="muted small">조건은 엔티티 → 사용자 → 작업 → 기간 순으로 하나만 적용됩니다</span>
      </form>
      {error && <p className="error">{error}</p>}
      {data && (
        <>
          <table>
            <thead><tr><th>시각</th><th>작업</th><th>대상</th><th>수행자</th><th>변경</th></tr></thead>
            <tbody>
              {data.content.map(l => (
                <tr key={l.id}>
                  <td>{new Date(l.createdAt).toLocaleString()}</td>
                  <td>{l.action}</td>
                  <td>{l.entityType}<br /><span className="muted small">{l.entityId}</span></td>
                  <td>{l.performedByName}<br /><span className="muted small">{l.performedById}</span></td>
                  <td>{(l.previousValue || l.newValue) && (
                    <details><summary className="muted">보기</summary>
                      <pre className="small" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                        {l.previousValue && `이전: ${l.previousValue}\n`}{l.newValue && `이후: ${l.newValue}`}
                      </pre>
                    </details>)}
                  </td>
                </tr>
              ))}
              {!data.content.length && <tr><td colSpan={5} className="muted">기록 없음</td></tr>}
            </tbody>
          </table>
          <Pager page={data} onPage={setPage} />
        </>
      )}
    </>
  )
}
