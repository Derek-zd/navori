import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, X } from 'lucide-react'
import { api } from '../lib/api'
import type { Run } from '../lib/types'
import { Button, Card, EmptyState, PageHeader, Status, Toast, useToast } from '../components/ui'

interface AuditLog {
  id: number
  username: string
  action: string
  target: string
  createdAt: string
}

function runIdFromTarget(target: string): number | null {
  const m = target.match(/^run\s+(\d+)$/)
  return m ? Number(m[1]) : null
}

export default function Approvals() {
  const [runs, setRuns] = useState<Run[]>([])
  const [history, setHistory] = useState<AuditLog[]>([])
  const [pendingId, setPendingId] = useState<number | null>(null)
  const { toast, setToast } = useToast()

  async function load() {
    const [rs, logs] = await Promise.all([
      api<Run[]>('/api/runs?status=awaiting_approval'),
      api<AuditLog[]>('/api/audit-logs'),
    ])
    setRuns(rs)
    setHistory(logs.filter((l) => l.action === 'approve' || l.action === 'reject'))
  }
  useEffect(() => {
    load().catch(() => {})
  }, [])

  async function decide(id: number, decision: string) {
    setPendingId(id)
    try {
      await api('/api/runs/' + id + '/' + decision, { method: 'POST' })
      setRuns((prev) => prev.filter((r) => r.id !== id))
      setToast({ type: 'success', text: decision === 'approve' ? '已通过' : '已拒绝' })
      await load().catch(() => {})
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '操作失败' })
      await load().catch(() => {})
    } finally {
      setPendingId(null)
    }
  }

  const fmtTime = (s: string) => {
    if (!s) return '—'
    return new Date(s).toLocaleString()
  }

  return (
    <div>
      <PageHeader title="审批中心" description="待审批的部署与历史审批记录" />
      <Card className="mb-6">
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">待审批</div>
        {runs.length === 0 ? (
          <EmptyState title="没有待审批的运行" description="当流水线配置了部署前审批，进入等待时会出现在这里。" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3">运行</th>
                <th className="px-4 py-3">流水线</th>
                <th className="px-4 py-3">镜像</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-3">
                    <Link to={'/runs/' + r.id} className="font-medium text-indigo-600 hover:underline">#{r.number}</Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">#{r.pipelineId}</td>
                  <td className="px-4 py-3 font-mono text-xs">{r.imageTag}</td>
                  <td className="px-4 py-3"><Status value={r.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Button onClick={() => decide(r.id, 'approve')} disabled={pendingId === r.id}>
                        <Check size={15} />
                        {pendingId === r.id ? '处理中…' : '通过'}
                      </Button>
                      <Button variant="danger" onClick={() => decide(r.id, 'reject')} disabled={pendingId === r.id}>
                        <X size={15} />
                        {pendingId === r.id ? '处理中…' : '拒绝'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">审批记录</div>
        {history.length === 0 ? (
          <EmptyState title="暂无审批记录" description="通过或拒绝部署后，这里会留下审计记录。" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3">时间</th>
                <th className="px-4 py-3">操作</th>
                <th className="px-4 py-3">审批人</th>
                <th className="px-4 py-3 text-right">详情</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => {
                const rid = runIdFromTarget(h.target)
                return (
                  <tr key={h.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-3 text-slate-500">{fmtTime(h.createdAt)}</td>
                    <td className="px-4 py-3">
                      <span className={'rounded-full px-2 py-0.5 text-xs ' + (h.action === 'approve' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>
                        {h.action === 'approve' ? '通过' : '拒绝'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{h.username || '—'}</td>
                    <td className="px-4 py-3 text-right">
                      {rid ? (
                        <Link to={'/runs/' + rid} className="text-sm text-indigo-600 hover:underline">查看详情</Link>
                      ) : (
                        <span className="text-slate-400">{h.target}</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>
      <Toast toast={toast} />
    </div>
  )
}
