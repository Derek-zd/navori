import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Clock3, RefreshCw, ShieldCheck, X } from 'lucide-react'
import { api } from '../lib/api'
import type { Run } from '../lib/types'
import { Button, Card, EmptyState, PageHeader, Status, Toast, useToast } from '../components/ui'
import { formatDateTime, timeAgo } from '../lib/format'

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
    const t = setInterval(() => load().catch(() => {}), 15000)
    return () => clearInterval(t)
  }, [])

  async function decide(id: number, decision: 'approve' | 'reject') {
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

  const approved = history.filter((h) => h.action === 'approve').length
  const rejected = history.filter((h) => h.action === 'reject').length
  const recent = [...history].sort((a, b) => b.id - a.id).slice(0, 50)

  return (
    <div>
      <PageHeader
        eyebrow="交付"
        title="审批中心"
        description="部署前的最后一道人工确认。审批始终在服务端执行，不会下发到执行器。"
        action={
          <Button variant="secondary" onClick={() => load().catch(() => {})}>
            <RefreshCw size={15} />
            刷新
          </Button>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
        {[
          { label: '待审批', value: runs.length, note: '等待处理' },
          { label: '审批记录', value: history.length, note: '最近全部' },
          { label: '已通过', value: approved, note: '历史累计' },
          { label: '已拒绝', value: rejected, note: '历史累计' },
        ].map((s) => (
          <div key={s.label} className="bg-surface px-4 py-2.5 sm:px-5 sm:py-3.5">
            <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-faint">{s.label}</div>
            <div className="mt-1 text-lg font-semibold tabular text-ink sm:mt-1.5 sm:text-xl">{s.value}</div>
            <div className="mt-0.5 hidden text-[10px] text-faint sm:block">{s.note}</div>
          </div>
        ))}
      </div>

      <div className="mb-6">
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck size={15} className="text-copper" />
          <h2 className="text-sm font-semibold text-ink">待审批</h2>
          <span className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] text-faint">{runs.length}</span>
        </div>

        {runs.length === 0 ? (
          <Card>
            <EmptyState
              icon={<ShieldCheck size={30} />}
              title="没有待审批的运行"
              description="当流水线配置了部署前审批，运行进入等待时会出现在这里。"
            />
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {runs.map((r) => (
              <Card key={r.id} className="overflow-hidden">
                <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Link to={'/runs/' + r.id} className="font-mono text-sm font-semibold text-ink hover:text-brand">#{r.number}</Link>
                      <Status value={r.status} />
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-[11px] text-faint">
                      <span>流水线 #{r.pipelineId}</span>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1"><Clock3 size={11} />开始于 {timeAgo(r.startedAt)}</span>
                    </div>
                  </div>
                  <span className="rounded border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">部署前审批</span>
                </div>
                <div className="space-y-2.5 px-5 py-4 text-xs">
                  <div className="flex justify-between gap-3">
                    <span className="text-faint">镜像</span>
                    <span className="max-w-[260px] truncate text-right font-mono text-[11px] text-ink" title={r.imageTag}>{r.imageTag || '—'}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-faint">分支 / commit</span>
                    <span className="max-w-[260px] truncate text-right font-mono text-[11px] text-ink">{r.ref} · {r.commitShort || '—'}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-faint">触发</span>
                    <span className="text-ink">{r.triggerType}</span>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 border-t border-line bg-surface-2/40 px-5 py-3">
                  <Link to={'/runs/' + r.id} className="mr-auto text-[11px] text-faint hover:text-ink">查看运行详情</Link>
                  <Button variant="danger" size="sm" onClick={() => decide(r.id, 'reject')} disabled={pendingId === r.id}>
                    <X size={13} />
                    {pendingId === r.id ? '处理中…' : '拒绝'}
                  </Button>
                  <Button size="sm" onClick={() => decide(r.id, 'approve')} disabled={pendingId === r.id}>
                    <Check size={13} />
                    {pendingId === r.id ? '处理中…' : '通过'}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold text-ink">审批记录</h2>
            <p className="mt-0.5 text-[11px] text-faint">来自审计日志，保留最近 50 条。</p>
          </div>
        </div>
        {recent.length === 0 ? (
          <EmptyState title="暂无审批记录" description="通过或拒绝部署后，这里会留下审计记录。" />
        ) : (
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[10px] font-medium uppercase tracking-[0.12em] text-faint">
                  <th className="px-5 py-2.5 font-medium">时间</th>
                  <th className="px-5 py-2.5 font-medium">结果</th>
                  <th className="px-5 py-2.5 font-medium">审批人</th>
                  <th className="px-5 py-2.5 text-right font-medium">运行</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((h) => {
                  const rid = runIdFromTarget(h.target)
                  const pass = h.action === 'approve'
                  return (
                    <tr key={h.id} className="border-b border-line/70 last:border-0 hover:bg-surface-2/60">
                      <td className="px-5 py-3 text-[11px] text-muted" title={formatDateTime(h.createdAt)}>{formatDateTime(h.createdAt)}</td>
                      <td className="px-5 py-3">
                        <span className={'inline-flex items-center gap-1.5 text-xs font-medium ' + (pass ? 'text-success' : 'text-danger')}>
                          <span className={'h-1.5 w-1.5 rounded-full ' + (pass ? 'bg-success' : 'bg-danger')} />
                          {pass ? '通过' : '拒绝'}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-xs text-ink">{h.username || '—'}</td>
                      <td className="px-5 py-3 text-right">
                        {rid ? (
                          <Link to={'/runs/' + rid} className="text-xs font-medium text-brand hover:underline">#{rid}</Link>
                        ) : (
                          <span className="text-[11px] text-faint">{h.target}</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Toast toast={toast} />
    </div>
  )
}
