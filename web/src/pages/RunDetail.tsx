import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, ChevronDown, ChevronRight, Copy, Play, Search, Square, X } from 'lucide-react'
import { api } from '../lib/api'
import type { Run } from '../lib/types'
import { Button, Card, Input, PageHeader, Status, Toast, useToast } from '../components/ui'

interface LogLine {
  step: string
  line: string
}

function stepSeconds(s?: string) {
  if (!s) return null
  return Math.max(0, Math.round((new Date(s).getTime() - Date.now()) / 1000))
}

function formatDuration(start?: string, end?: string) {
  if (!start || !end) return null
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (!(ms >= 0)) return null
  const s = Math.round(ms / 1000)
  if (s < 60) return s + 's'
  return Math.floor(s / 60) + 'm' + (s % 60) + 's'
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
  const [tab, setTab] = useState<'overview' | 'log'>('overview')
  const { toast, setToast } = useToast()
  const endRef = useRef<HTMLDivElement>(null)

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
    if (autoScroll) endRef.current?.scrollIntoView({ block: 'end' })
  }, [logs, autoScroll])

  const stepOrder = useMemo(() => {
    if (!run) return []
    return run.steps.map((s) => s.name)
  }, [run])

  const groupedLogs = useMemo(() => {
    const byStep = new Map<string, string[]>()
    for (const l of logs) {
      const arr = byStep.get(l.step) || []
      arr.push(l.line)
      byStep.set(l.step, arr)
    }
    const names = stepOrder.length > 0
      ? stepOrder
      : Array.from(new Set(logs.map((l) => l.step)))
    return names.map((name) => {
      let lines = byStep.get(name) || []
      if (query.trim()) {
        const q = query.trim().toLowerCase()
        lines = lines.filter((line) => line.toLowerCase().includes(q))
      }
      return { step: name, lines }
    })
  }, [logs, stepOrder, query])

  const visibleSteps = useMemo(() => {
    if (!run) return []
    if (!onlyFailed) return run.steps
    return run.steps.filter((s) => s.status === 'failed' || s.status === 'rejected' || s.status === 'error')
  }, [run, onlyFailed])

  function toggleStep(name: string) {
    setCollapsed((prev) => ({ ...prev, [name]: !prev[name] }))
  }

  async function copyLogs() {
    const text = groupedLogs
      .filter((g) => visibleSteps.some((s) => s.name === g.step))
      .flatMap((g) => g.lines.map((line) => `[${g.step}] ${line}`))
      .join('\n')
    try {
      await navigator.clipboard.writeText(text || '(empty)')
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

  const running = run && (run.status === 'running' || run.status === 'pending')

  return (
    <div>
      <div className="mb-4">
        <button
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate(run ? '/pipelines/' + run.pipelineId : '/'))}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft size={15} />
          返回
        </button>
      </div>
      {run ? (
        <>
          <PageHeader
            title={'运行 #' + run.number}
            description={'流水线 #' + run.pipelineId + ' · ' + run.triggerType}
            action={
              <div className="flex gap-2">
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
          <div className="mb-4 flex gap-2">
            <button onClick={() => setTab('overview')} className={"rounded-lg px-3 py-1.5 text-sm font-medium " + (tab === 'overview' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 border border-slate-200')}>概览</button>
            <button onClick={() => setTab('log')} className={"rounded-lg px-3 py-1.5 text-sm font-medium " + (tab === 'log' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 border border-slate-200')}>日志</button>
          </div>
          {tab === 'overview' && (
            <>
          <Card className="mb-4 p-4">
            <div className="flex flex-wrap gap-5 text-sm">
              <div>
                <span className="mr-2 text-slate-400">状态</span>
                <Status value={run.status} />
              </div>
              <div>
                <span className="mr-2 text-slate-400">镜像</span>
                <span className="font-mono text-xs">{run.imageTag || '—'}</span>
              </div>
              <div>
                <span className="mr-2 text-slate-400">分支</span>
                <span className="text-slate-600">{run.ref}</span>
              </div>
              <div>
                <span className="mr-2 text-slate-400">commit</span>
                <span className="font-mono text-xs text-slate-600">{run.commitShort}</span>
              </div>
            </div>
            {run.error ? <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{run.error}</div> : null}
          </Card>

          <Card className="mb-4 p-4">
            <div className="mb-3 text-sm font-semibold text-slate-700">步骤</div>
            <div className="space-y-1">
              {run.steps.map((s, i) => {
                const dur = formatDuration(s.startedAt, s.finishedAt)
                const isApprove = s.name === 'approve'
                const isAwaiting = run.status === 'awaiting_approval' && isApprove
                return (
                  <div key={s.name} className="flex items-start gap-3">
                    <div className="flex flex-col items-center self-stretch">
                      <div className={'mt-1.5 h-2.5 w-2.5 rounded-full ' + (s.status === 'success' || s.status === 'done' ? 'bg-emerald-500' : s.status === 'failed' || s.status === 'rejected' ? 'bg-red-500' : s.status === 'running' ? 'bg-blue-500 animate-pulse' : 'bg-slate-300')} />
                      {i < run.steps.length - 1 ? <div className="w-px flex-1 bg-slate-200" /> : null}
                    </div>
                    <div className="flex flex-1 flex-wrap items-center gap-2 pb-4">
                      <button
                        onClick={() => document.getElementById('log-' + s.name)?.scrollIntoView({ behavior: 'smooth' })}
                        className="text-sm font-medium text-slate-700 hover:text-indigo-600"
                      >
                        {s.name}
                      </button>
                      <Status value={s.status} />
                      {dur ? <span className="text-xs text-slate-400">{dur}</span> : null}
                      {isAwaiting ? (
                        <span className="ml-auto flex gap-2">
                          <Button size="sm" onClick={() => decide('approve')} disabled={approving} >
                            <Check size={14} />
                            通过
                          </Button>
                          <Button variant="danger" size="sm" onClick={() => decide('reject')} disabled={approving} >
                            <X size={14} />
                            拒绝
                          </Button>
                        </span>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>
            </>
          )}
        </>
      ) : (
        <p className="text-slate-500">加载中…</p>
      )}

          {tab === 'log' && (
            <>
      <Card className="mb-4 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">构建日志</div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索日志…"
                className="!w-52 !py-1.5 pl-8 text-xs"
              />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" checked={onlyFailed} onChange={(e) => setOnlyFailed(e.target.checked)} />
              仅看失败步骤
            </label>
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
              自动滚动
            </label>
            <Button variant="secondary" onClick={copyLogs} className="!px-2.5 !py-1.5 text-xs">
              <Copy size={14} />
              复制
            </Button>
          </div>
        </div>

        <div className="max-h-[480px] overflow-auto bg-slate-900 p-3 font-mono text-xs leading-relaxed text-slate-200">
          {groupedLogs.map((g) => {
            const st = run?.steps.find((s) => s.name === g.step)
            if (onlyFailed && st && st.status !== 'failed' && st.status !== 'rejected' && st.status !== 'error') return null
            const isCollapsed = collapsed[g.step]
            return (
              <div key={g.step} id={'log-' + g.step} className="mb-2 rounded bg-slate-800/40">
                <button
                  onClick={() => toggleStep(g.step)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-slate-300 hover:text-white"
                >
                  {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  <span className="font-semibold">[{g.step}]</span>
                  <span className="text-slate-500">{g.lines.length} 行</span>
                </button>
                {!isCollapsed ? (
                  <div className="border-t border-slate-700/60 px-3 py-2">
                    {g.lines.length === 0 ? (
                      <span className="text-slate-500">（无匹配日志）</span>
                    ) : (
                      g.lines.map((line, i) => (
                        <div key={i} className="whitespace-pre-wrap break-all">
                          {line}
                        </div>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            )
          })}
          {logs.length === 0 ? <span className="text-slate-500">（暂无日志输出）</span> : null}
          <div ref={endRef} />
        </div>
      </Card>
            </>
          )}
      <Toast toast={toast} />
    </div>
  )
}
