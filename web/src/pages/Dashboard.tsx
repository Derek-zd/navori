import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, RefreshCw, Search, Square } from 'lucide-react'
import { api } from '../lib/api'
import type { Run } from '../lib/types'
import { Card, EmptyState, Input, PageHeader, Select, Status, Toast, useToast } from '../components/ui'

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
  { value: 'queued', label: '排队中' },
  { value: 'awaiting_approval', label: '待审批' },
  { value: 'cancelled', label: '已取消' },
  { value: 'rejected', label: '已拒绝' },
]

const triggerLabel: Record<string, string> = {
  manual: '手动',
  webhook: 'Webhook',
  cron: '定时',
}

function isActive(r: Run) {
  return ['running', 'pending', 'queued', 'awaiting_approval'].includes(r.status)
}

function durationLabel(ms: number) {
  if (ms < 1000) return '<1s'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

function timeAgo(iso?: string) {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '—'
  const diff = Math.max(0, Date.now() - t)
  if (diff < 60_000) return '刚刚'
  const min = Math.floor(diff / 60_000)
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  return `${day} 天前`
}

function RouteMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 48" className={className} fill="none" aria-hidden="true">
      <circle cx="12" cy="13" r="4" stroke="rgb(var(--copper) / 0.55)" strokeWidth="1.5" />
      <path
        d="M16 13h26a10 10 0 0 1 10 10v2a10 10 0 0 0 10 10h26"
        stroke="rgb(var(--line-strong))"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="96" cy="35" r="4" fill="rgb(var(--brand) / 0.7)" />
      <circle cx="53" cy="23" r="2" fill="rgb(var(--faint))" />
    </svg>
  )
}

function Metric({ label, value, hint, index }: {
  label: string
  value: string
  hint: string
  index: number
}) {
  const borders = [
    index % 2 === 1 ? 'border-l border-line' : '',
    index >= 2 ? 'border-t border-line lg:border-t-0' : '',
    index > 0 ? 'lg:border-l lg:border-line' : '',
  ].join(' ')
  return (
    <div className={'px-5 py-4 ' + borders}>
      <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-faint">{label}</div>
      <div className="mt-2 text-[26px] font-semibold leading-none tracking-[-0.02em] text-ink tabular">{value}</div>
      <div className="mt-2 text-[11px] text-faint">{hint}</div>
    </div>
  )
}

export default function Dashboard() {
  const [runs, setRuns] = useState<Run[]>([])
  const [loaded, setLoaded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [status, setStatus] = useState('')
  const [trigger, setTrigger] = useState('')
  const [query, setQuery] = useState('')
  const { toast, setToast } = useToast()

  async function load() {
    try {
      setRuns(await api<Run[]>('/api/runs'))
    } catch {
      /* keep the last good snapshot */
    } finally {
      setLoaded(true)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return runs.filter((r) => {
      if (status && r.status !== status) return false
      if (trigger && r.triggerType !== trigger) return false
      if (
        q &&
        !(r.ref || '').toLowerCase().includes(q) &&
        !(r.commitShort || '').toLowerCase().includes(q) &&
        !String(r.number).includes(q) &&
        !String(r.pipelineId).includes(q)
      ) {
        return false
      }
      return true
    })
  }, [runs, status, trigger, query])

  const stats = useMemo(() => {
    const finished = runs.filter((r) => ['success', 'failed', 'rejected', 'cancelled'].includes(r.status))
    const success = runs.filter((r) => r.status === 'success').length
    const running = runs.filter(isActive).length
    const failed = runs.filter((r) => r.status === 'failed' || r.status === 'rejected').length
    const rate = finished.length > 0 ? Math.round((success / finished.length) * 100) : 0
    const durations = runs
      .filter((r) => r.startedAt && r.finishedAt)
      .map((r) => new Date(r.finishedAt as string).getTime() - new Date(r.startedAt as string).getTime())
      .filter((n) => Number.isFinite(n) && n >= 0)
      .sort((a, b) => a - b)
    const p50 = durations.length ? durations[Math.floor(durations.length / 2)] : null
    return { total: runs.length, success, running, failed, rate, p50 }
  }, [runs])

  const attention = useMemo(
    () =>
      runs
        .filter((r) => ['failed', 'rejected', 'awaiting_approval'].includes(r.status))
        .slice(0, 4),
    [runs],
  )

  async function cancelRun(id: number) {
    try {
      await api('/api/runs/' + id + '/stop', { method: 'POST' })
      setToast({ type: 'success', text: '已请求取消' })
      await load()
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '取消失败' })
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="运行"
        title="运行总览"
        description="最近 50 次流水线运行。先看异常与等待审批的事项，再进入具体运行排查。"
        action={
          <>
            <Link
              to="/pipelines"
              className="inline-flex h-8 items-center justify-center rounded-md border border-line-strong bg-surface px-3 text-xs font-medium text-ink transition-colors hover:bg-surface-2"
            >
              管理流水线
            </Link>
            <button
              type="button"
              onClick={() => {
                setRefreshing(true)
                load()
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line-strong bg-surface text-muted transition-colors hover:bg-surface-2 hover:text-ink"
              aria-label="刷新运行记录"
              title="刷新"
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-surface lg:grid-cols-4">
        <Metric index={0} label="成功率" value={stats.total ? `${stats.rate}%` : '—'} hint={`${stats.success} 次成功`} />
        <Metric index={1} label="运行总数" value={String(stats.total)} hint="最近 50 条记录" />
        <Metric index={2} label="P50 时长" value={stats.p50 === null ? '—' : durationLabel(stats.p50)} hint="从开始到结束的中位数" />
        <Metric index={3} label="进行中" value={String(stats.running)} hint="含排队与待审批" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <h2 className="text-[13px] font-semibold text-ink">最近运行</h2>
              <p className="mt-0.5 text-[11px] text-faint">{filtered.length} 条记录</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="分支 / commit / 编号"
                  className="!h-8 !w-44 !py-1 pl-8 text-xs"
                />
              </div>
              <Select value={trigger} onChange={(e) => setTrigger(e.target.value)} className="!h-8 !w-[104px] !py-1 text-xs">
                {triggerOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
              <Select value={status} onChange={(e) => setStatus(e.target.value)} className="!h-8 !w-[104px] !py-1 text-xs">
                {statusOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            </div>
          </div>

          {!loaded ? (
            <div className="px-4 py-16 text-center text-xs text-faint">正在读取运行记录…</div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<RouteMark className="w-36" />}
              title={runs.length === 0 ? '还没有运行记录' : '没有匹配的运行'}
              description={
                runs.length === 0
                  ? '创建流水线并触发一次运行后，这里会展示每一步的状态与结果。'
                  : '调整分支、状态或触发方式再试一次。'
              }
              action={
                runs.length === 0 ? (
                  <Link to="/pipelines" className="text-xs font-medium text-brand hover:underline">
                    去创建流水线
                  </Link>
                ) : null
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm sm:min-w-[560px]">
                <thead>
                  <tr className="border-b border-line text-left text-[10px] font-medium uppercase tracking-[0.12em] text-faint">
                    <th className="px-4 py-2.5">运行</th>
                    <th className="hidden px-4 py-2.5 sm:table-cell">触发</th>
                    <th className="hidden px-4 py-2.5 md:table-cell">分支</th>
                    <th className="hidden px-4 py-2.5 lg:table-cell">Commit</th>
                    <th className="px-4 py-2.5">状态</th>
                    <th className="hidden px-4 py-2.5 xl:table-cell">开始</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} className="group border-b border-line/70 last:border-0 hover:bg-surface-2/55">
                      <td className="px-4 py-3">
                        <Link to={'/runs/' + r.id} className="block">
                          <span className="font-medium text-ink tabular">#{r.number}</span>
                          <span className="ml-2 text-[11px] text-faint">流水线 #{r.pipelineId}</span>
                        </Link>
                      </td>
                      <td className="hidden px-4 py-3 text-xs text-muted sm:table-cell">{triggerLabel[r.triggerType] || r.triggerType}</td>
                      <td className="hidden max-w-[180px] truncate px-4 py-3 font-mono text-[11px] text-muted md:table-cell" title={r.ref}>
                        {r.ref}
                      </td>
                      <td className="hidden px-4 py-3 font-mono text-[11px] text-faint lg:table-cell">{r.commitShort || '—'}</td>
                      <td className="px-4 py-3"><Status value={r.status} /></td>
                      <td className="hidden whitespace-nowrap px-4 py-3 text-[11px] text-faint xl:table-cell">{timeAgo(r.startedAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {isActive(r) ? (
                            <button
                              type="button"
                              onClick={() => cancelRun(r.id)}
                              className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium text-danger transition-colors hover:bg-danger-soft"
                            >
                              <Square size={11} />
                              取消
                            </button>
                          ) : null}
                          <Link
                            to={'/runs/' + r.id}
                            className="inline-flex h-6 w-6 items-center justify-center rounded text-faint transition-colors hover:bg-surface-2 hover:text-ink"
                            aria-label={'查看运行 #' + r.number}
                          >
                            <ArrowUpRight size={14} />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="h-fit overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <h2 className="text-[13px] font-semibold text-ink">需要关注</h2>
              <p className="mt-0.5 text-[11px] text-faint">失败、拒绝与待审批</p>
            </div>
            {attention.length ? (
              <span className="rounded-full bg-copper/10 px-2 py-0.5 font-mono text-[10px] text-copper">
                {attention.length}
              </span>
            ) : null}
          </div>
          {attention.length === 0 ? (
            <div className="px-5 py-9">
              <RouteMark className="w-28" />
              <p className="mt-4 text-[13px] font-medium text-ink">队列平稳</p>
              <p className="mt-1 text-[11px] leading-5 text-faint">
                没有失败或待审批的运行。新的异常会出现在这里。
              </p>
            </div>
          ) : (
            <div className="divide-y divide-line">
              {attention.map((r) => (
                <Link key={r.id} to={'/runs/' + r.id} className="block px-4 py-3 transition-colors hover:bg-surface-2/60">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Status value={r.status} />
                        <span className="text-[11px] text-faint">#{r.number}</span>
                      </div>
                      <div className="mt-1.5 truncate font-mono text-[11px] text-muted">{r.ref}</div>
                      <div className="mt-1 truncate text-[11px] text-faint">
                        {r.error || (r.status === 'awaiting_approval' ? '等待人工审批后继续' : '运行未成功完成')}
                      </div>
                    </div>
                    <ArrowUpRight size={13} className="mt-1 shrink-0 text-faint" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>
      <Toast toast={toast} />
    </div>
  )
}
