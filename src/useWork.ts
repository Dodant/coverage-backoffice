import { useState } from 'react'
// 버튼 하나가 하는 작업의 진행·오류·결과 메시지 한 벌
export function useWork() {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const work = async (label: string, task: () => Promise<void>) => {
    setBusy(label); setError(''); setMessage('')
    try { await task() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy('') }
  }
  return { busy, error, message, setMessage, work }
}
