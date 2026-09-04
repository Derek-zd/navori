import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, CheckCircle2, Layers, Search, Square, XCircle } from 'lucide-react'
import { api } from '../lib/api'
import type { Run } from '../lib/types'
import { Button, Card, EmptyState, Input, PageHeader, Select, StatCard, Status, Toast, useToast } from '../components/ui'

const triggerOptions = [
  { value: '', label: '全部触发' },
  { value: 'manual', label: '手动' },
  { value: 'webhook', label: 'Webhook' },
  { value: 'cron', label: '定时' },
]

const statusOptions = [
  { value: '', label: '全部状态' },
  { value: 'success', label: '成功' },
  { value: 'failed', label: '失败' },
  { value: 'running', label: '运行中' },
  { value: 'pending', label: '等待中' },
  { value: 'awaiting_approval', label: '待审批' },
  { value: 'cancelled', label: '已取消' },
  { value: 'rejected', label: '已拒绝' },
]

export default function Dashboard() {
  const [runs, setRuns] = useState<Run[]>([])
  const [status, setStatus] = useState('')
  const [trigger, setTrigger] = useState('')
  const [query, setQuery] = useState('')
  const { toast, setToast } = useToast()

  useEffect(() => {
    api<Run[]>('/api/runs').then(setRuns).catch(() => {})
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return runs.filter((r) => {
      if (status && r.status !== status) return false
      if (trigger && r.triggerType !== trigger) return false
      if (q && !(r.ref || '').toLowerCase().includes(q) && !(r.commitShort || '').toLowerCase().includes(q) && !String(r.number).includes(q)) return false
      return true
    })
  }, [runs, status, trigger, query])

  const stats = useMemo(() => {
    const total = runs.length
    const finished = runs.filter((r) => r.status === 'success' || r.status === 'failed' || r.status === 'rejected' || r.status === 'cancelled')
    const success = runs.filter((r) => r.status === 'success').length
    const running = runs.filter((r) => r.status === 'running' || r.status === 'pending' || r.status === 'awaiting_approval').length
    const failed = runs.filter((r) => r.status === 'failed' || r.status === 'rejected').length
    const rate = finished.length > 0 ? Math.round((success / finished.length) * 100) : 0
    return { total, success, running, failed, rate }
  }, [runs])

  function isActive(r: Run) {
    return r.status === 'running' || r.status === 'pending' || r.status === 'awaiting_approval'
  }
  async function cancelRun(id: number) {
    try {
      await api('/api/runs/' + id + '/stop', { method: 'POST' })
      setToast({ type: 'success', text: '已请求取消' })
      setRuns((await api<Run[]>('/api/runs')))
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '取消失败' })
    }
  }

  return (
    <div>
      <PageHeader title="Dashboard" description="最近的流水线运行记录" />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="总运行" value={stats.total} icon={<Layers size={18} />} hint="最近 50 条" tone="default" />
        <StatCard label="成功" value={stats.success || 0} hint={'成功率 ' + stats.rate + '%'} tone="success" icon={<CheckCircle2 size={18} />} />
        <StatCard label="进行中" value={stats.running} hint="含等待与待审批" tone="info" icon={<Activity size={18} />} />
        <StatCard label="失败" value={stats.failed} hint="含被拒绝" tone="danger" icon={<XCircle size={18} />} />
      </div>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-700">最近运行</h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索分支/commit/编号…" className="!w-48 !py-1.5 pl-8 text-xs" />
            </div>
            <Select value={trigger} onChange={(e) => setTrigger(e.target.value)} className="!w-28 !py-1.5 text-xs">
              {triggerOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="!w-28 !py-1.5 text-xs">
              {statusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </div>
        </div>
        {filtered.length === 0 ? (
          <EmptyState
            title={runs.length === 0 ? '暂无运行记录' : '没有匹配的运行'}
            description={runs.length === 0 ? '创建流水线并触发一次运行后，这里会展示状态与结果。' : '换个筛选条件试试。'}
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3">流水线</th>
                <th className="px-4 py-3">编号</th>
                <th className="px-4 py-3">触发</th>
                <th className="px-4 py-3">分支</th>
                <th className="px-4 py-3">commit</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-medium text-slate-900">#{r.pipelineId}</td>
                  <td className="px-4 py-3 text-slate-500">#{r.number}</td>
                  <td className="px-4 py-3 text-slate-600">{r.triggerType}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{r.ref}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{r.commitShort}</td>
                  <td className="px-4 py-3"><Status value={r.status} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      {isActive(r) ? (
                        <Button variant="danger" size="sm" onClick={() => cancelRun(r.id)}>
                          <Square size={13} />
                          取消
                        </Button>
                      ) : null}
                      <Link to={'/runs/' + r.id} className="text-sm text-indigo-600 hover:underline">查看详情</Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Toast toast={toast} />
    </div>
  )
}
