import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Play,
  Search,
  Square,
  X,
} from 'lucide-react'
import { api } from '../lib/api'
import type { Run } from '../lib/types'
import { Button, Card, Input, PageHeader, Status, Toast, useToast } from '../components/ui'
import { formatDateTime, formatDuration } from '../lib/format'

interface LogLine {
  step: string
  line: string
}

function stepDot(status: string) {
  if (status === 'success' || status === 'done') return 'border-brand bg-brand'
  if (status === 'running') return 'border-copper bg-copper animate-pulse'
  if (status === 'failed' || status === 'rejected' || status === 'error') return 'border-danger bg-danger'
  if (status === 'awaiting_approval') return 'border-warning bg-warning'
  return 'border-line-strong bg-surface'
}

function stepLine(status: string) {
  if (status === 'success' || status === 'done') return 'bg-brand/40'
  if (status === 'running') return 'bg-copper/40'
  return 'bg-line'
}

export default function RunDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [run, setRun] = useState<Run | null>(null)
  const [logs, setLogs] = useState<LogLine[]>([])
  const [query, setQuery] = useState('')
  const [onlyFailed, setOnlyFailed] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [approving, setApproving] = useState(false)
  const { toast, setToast } = useToast()
  const logRef = useRef<HTMLDivElement>(null)

  async function load() {
    setRun(await api<Run>('/api/runs/' + id))
  }

  useEffect(() => {
    load().catch(() => {})
    const es = new EventSource('/api/runs/' + id + '/logs')
    es.addEventListener('step', (e) => {
      const d = JSON.parse(e.data) as LogLine
      setLogs((prev) => [...prev, d])
    })
    es.addEventListener('end', () => {
      es.close()
      load().catch(() => {})
    })
    return () => es.close()
  }, [id])

  useEffect(() => {
    if (!run) return
    const active = run.status === 'running' || run.status === 'pending' || run.status === 'queued' || run.status === 'awaiting_approval'
    if (!active) return
    const t = setInterval(() => load().catch(() => {}), 3000)
    return () => clearInterval(t)
  }, [run?.status, id])

  useEffect(() => {
    if (!autoScroll) return
    const el = logRef.current
    if (!el) return
    const frame = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
    return () => cancelAnimationFrame(frame)
  }, [logs, autoScroll, run?.steps.length])

  const stepOrder = useMemo(() => (run ? run.steps.map((s) => s.name) : []), [run])

  const groupedLogs = useMemo(() => {
    const byStep = new Map<string, string[]>()
    for (const l of logs) {
      const arr = byStep.get(l.step) || []
      arr.push(l.line)
      byStep.set(l.step, arr)
    }
    const names = stepOrder.length > 0 ? stepOrder : Array.from(new Set(logs.map((l) => l.step)))
    return names.map((name) => {
      let lines = byStep.get(name) || []
      if (query.trim()) {
        const q = query.trim().toLowerCase()
        lines = lines.filter((line) => line.toLowerCase().includes(q))
      }
      return { step: name, lines }
    })
  }, [logs, stepOrder, query])

  const displayGroups = useMemo(() => {
    if (!onlyFailed) return groupedLogs
    return groupedLogs.filter((g) => {
      const st = run?.steps.find((s) => s.name === g.step)
      return !!st && (st.status === 'failed' || st.status === 'rejected' || st.status === 'error')
    })
  }, [groupedLogs, onlyFailed, run])

  const visibleSteps = useMemo(() => {
    if (!run) return []
    if (!onlyFailed) return run.steps
    return run.steps.filter((s) => s.status === 'failed' || s.status === 'rejected' || s.status === 'error')
  }, [run, onlyFailed])

  function toggleStep(name: string) {
    setCollapsed((prev) => ({ ...prev, [name]: !prev[name] }))
  }

  function scrollToStep(name: string) {
    const container = logRef.current
    const el = document.getElementById('log-' + name)
    if (!container || !el) return
    const top = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 8
    container.scrollTo({ top, behavior: 'smooth' })
    setCollapsed((prev) => ({ ...prev, [name]: false }))
  }

  async function copyLogs() {
    const text = groupedLogs
      .filter((g) => visibleSteps.some((s) => s.name === g.step))
      .flatMap((g) => g.lines.map((line) => `[${g.step}] ${line}`))
      .join('\n')
    const content = text || '(empty)'
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(content)
      } else {
        const ta = document.createElement('textarea')
        ta.value = content
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        if (!ok) throw new Error('execCommand copy failed')
      }
      setToast({ type: 'success', text: '日志已复制' })
    } catch {
      setToast({ type: 'error', text: '复制失败，请手动选择' })
    }
  }

  async function rerun() {
    try {
      await api('/api/runs/' + id + '/rerun', { method: 'POST' })
      setToast({ type: 'success', text: '已触发重跑' })
      await load()
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '重跑失败' })
    }
  }

  async function stop() {
    if (!confirm('确认取消这次运行？')) return
    try {
      await api('/api/runs/' + id + '/stop', { method: 'POST' })
      setToast({ type: 'success', text: '已请求取消' })
      await load()
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '取消失败' })
    }
  }

  async function decide(decision: 'approve' | 'reject') {
    setApproving(true)
    try {
      await api('/api/runs/' + id + '/' + decision, { method: 'POST' })
      setToast({ type: 'success', text: decision === 'approve' ? '已通过' : '已拒绝' })
      await load()
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '操作失败' })
    } finally {
      setApproving(false)
    }
  }

  const running = run && ['running', 'pending', 'queued', 'awaiting_approval'].includes(run.status)
  const duration = run ? formatDuration(run.startedAt, run.finishedAt) : ''

  return (
    <div>
      <div className="mb-5">
        <button
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate(run ? '/pipelines/' + run.pipelineId : '/'))}
          className="inline-flex items-center gap-1.5 text-xs text-faint transition-colors hover:text-ink"
        >
          <ArrowLeft size={14} />
          返回
        </button>
      </div>

      {run ? (
        <>
          <PageHeader
            eyebrow="运行详情"
            title={'运行 #' + run.number}
            description={`流水线 #${run.pipelineId} · ${run.triggerType} · ${formatDateTime(run.startedAt)}`}
            action={
              <div className="flex gap-2">
                <Link to={'/pipelines/' + run.pipelineId} className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-surface-2">
                  流水线
                  <ExternalLink size={13} />
                </Link>
                <Button variant="secondary" onClick={rerun}>
                  <Play size={15} />
                  重跑
                </Button>
                {running ? (
                  <Button variant="danger" onClick={stop}>
                    <Square size={15} />
                    取消
                  </Button>
                ) : null}
              </div>
            }
          />

          {run.error ? (
            <div className="mb-5 rounded-md border border-danger/25 bg-danger/10 px-4 py-3 text-xs leading-5 text-danger">
              {run.error}
            </div>
          ) : null}

          <Card className="mb-5 p-5">
            <div className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3 xl:grid-cols-6">
              <div>
                <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-faint">状态</div>
                <div className="mt-1.5"><Status value={run.status} /></div>
              </div>
              <div>
                <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-faint">耗时</div>
                <div className="mt-1.5 text-sm tabular text-ink">{duration || '—'}</div>
              </div>
              <div>
                <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-faint">分支</div>
                <div className="mt-1.5 truncate font-mono text-[11px] text-ink" title={run.ref}>{run.ref || '—'}</div>
              </div>
              <div>
                <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-faint">Commit</div>
                <div className="mt-1.5 font-mono text-[11px] text-ink">{run.commitShort || '—'}</div>
              </div>
              <div>
                <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-faint">触发</div>
                <div className="mt-1.5 text-sm text-ink">{run.triggerType || '—'}</div>
              </div>
              <div>
                <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-faint">镜像</div>
                <div className="mt-1.5 truncate font-mono text-[11px] text-ink" title={run.imageTag}>{run.imageTag || '—'}</div>
              </div>
            </div>
          </Card>

          <div className="grid items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold text-ink">步骤</h2>
                  <p className="mt-0.5 text-[10px] text-faint">点击步骤定位日志</p>
                </div>
                <span className="font-mono text-[10px] text-faint">{run.steps.filter((s) => s.status === 'success').length}/{run.steps.length}</span>
              </div>
              <div className="px-4 py-4">
                {run.steps.map((s, i) => {
                  const dur = formatDuration(s.startedAt, s.finishedAt)
                  const isApprove = s.name === 'approve'
                  const isAwaiting = run.status === 'awaiting_approval' && isApprove
                  return (
                    <div key={s.name} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <button
                          onClick={() => scrollToStep(s.name)}
                          className={'mt-0.5 h-3 w-3 shrink-0 rounded-full border-2 transition-transform hover:scale-110 ' + stepDot(s.status)}
                          aria-label={'定位 ' + s.name + ' 日志'}
                        />
                        {i < run.steps.length - 1 ? <div className={'w-px flex-1 ' + stepLine(s.status)} /> : null}
                      </div>
                      <div className={'min-w-0 flex-1 ' + (i < run.steps.length - 1 ? 'pb-5' : '')}>
                        <div className="flex flex-wrap items-center gap-2">
                          <button onClick={() => scrollToStep(s.name)} className="font-mono text-xs font-medium text-ink hover:text-brand">{s.name}</button>
                          <Status value={s.status} />
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-faint">
                          {dur ? <span className="tabular">{dur}</span> : null}
                          {s.status === 'queued' ? <span>等待执行器…</span> : null}
                          {s.agentName ? <span>执行器 {s.agentName}</span> : (!s.agentSelector && !isApprove && ['running', 'success', 'failed', 'cancelled', 'rejected'].includes(s.status) ? <span>本机执行</span> : null)}
                          {s.attempt ? <span className="text-warning">第 {s.attempt + 1} 次尝试</span> : null}
                        </div>
                        {isAwaiting ? (
                          <div className="mt-2 flex gap-1.5">
                            <Button size="sm" onClick={() => decide('approve')} disabled={approving}>
                              <Check size={13} />
                              通过
                            </Button>
                            <Button variant="danger" size="sm" onClick={() => decide('reject')} disabled={approving}>
                              <X size={13} />
                              拒绝
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>

            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-ink">执行日志</h2>
                  <span className="text-[10px] text-faint">{logs.length} 行</span>
                </div>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
                    <Input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="搜索日志…"
                      className="!w-44 !py-1.5 pl-8 text-xs"
                    />
                  </div>
                  <label className="flex items-center gap-1.5 text-[11px] text-muted">
                    <input type="checkbox" checked={onlyFailed} onChange={(e) => setOnlyFailed(e.target.checked)} className="h-3.5 w-3.5 accent-brand" />
                    仅失败
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] text-muted">
                    <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} className="h-3.5 w-3.5 accent-brand" />
                    自动滚动
                  </label>
                  <Button variant="secondary" onClick={copyLogs} className="!px-2.5 !py-1.5 text-xs">
                    <Copy size={13} />
                    复制
                  </Button>
                </div>
              </div>

              <div ref={logRef} className="h-[calc(100vh-460px)] min-h-[360px] max-h-[560px] overflow-auto bg-[#101210] p-3 font-mono text-[11px] leading-relaxed text-[#d5d8cf]">
                {logs.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-[11px] text-[#777c73]">暂无日志输出</div>
                ) : displayGroups.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-[11px] text-[#777c73]">没有匹配的日志</div>
                ) : displayGroups.map((g) => {
                  const st = run.steps.find((s) => s.name === g.step)
                  if (onlyFailed && st && st.status !== 'failed' && st.status !== 'rejected' && st.status !== 'error') return null
                  const isCollapsed = collapsed[g.step]
                  return (
                    <div key={g.step} id={'log-' + g.step} className="mb-2 rounded bg-white/[0.04]">
                      <button
                        onClick={() => toggleStep(g.step)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[#a4a89e] hover:text-white"
                      >
                        {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                        <span className="font-semibold">[{g.step}]</span>
                        <span className="text-[#777c73]">{g.lines.length} 行</span>
                      </button>
                      {!isCollapsed ? (
                        <div className="border-t border-white/10 px-3 py-2">
                          {g.lines.length === 0 ? (
                            <span className="text-[#777c73]">{query ? '（无匹配日志）' : '（暂无输出）'}</span>
                          ) : (
                            g.lines.map((line, i) => (
                              <div key={i} className="whitespace-pre-wrap break-all">{line}</div>
                            ))
                          )}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
                {visibleSteps.length === 0 && logs.length > 0 ? <span className="text-[#777c73]">（没有失败步骤）</span> : null}
              </div>
            </Card>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted">加载中…</p>
      )}
      <Toast toast={toast} />
    </div>
  )
}
