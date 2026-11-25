import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Play, Square } from 'lucide-react'
import { api } from '../lib/api'
import type { Agent, DeployTarget, Pipeline, Repository, Run, Step } from '../lib/types'
import { StageRail, type Stage } from '../components/StageRail'
import { Button, Card, EmptyState, PageHeader, Status, Toast, useToast } from '../components/ui'
import { formatDateTime, formatDuration, timeAgo } from '../lib/format'

const STAGES = [
  { key: 'pull', label: '拉取' },
  { key: 'build', label: '构建' },
  { key: 'push', label: '推送' },
  { key: 'approve', label: '审批' },
  { key: 'deploy', label: '部署' },
]

export default function PipelinesDetail() {
  const { id } = useParams()
  const [pipeline, setPipeline] = useState<Pipeline | null>(null)
  const [repo, setRepo] = useState<Repository | null>(null)
  const [runs, setRuns] = useState<Run[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [deployTargets, setDeployTargets] = useState<DeployTarget[]>([])
  const [starting, setStarting] = useState(false)
  const { toast, setToast } = useToast()

  async function loadRuns() {
    const rs = await api<Run[]>('/api/runs?pipelineId=' + id)
    setRuns([...rs].sort((a, b) => b.id - a.id))
  }

  useEffect(() => {
    if (!id) return
    Promise.all([
      api<Pipeline>('/api/pipelines/' + id),
      api<Run[]>('/api/runs?pipelineId=' + id),
    ])
      .then(async ([p, rs]) => {
        setPipeline(p)
        setRuns([...rs].sort((a, b) => b.id - a.id))
        if (p.repoId) {
          try {
            setRepo(await api<Repository>('/api/repositories/' + p.repoId))
          } catch {
            setRepo(null)
          }
        }
      })
      .catch(() => {})
    api<Agent[]>('/api/agents').then(setAgents).catch(() => {})
    api<DeployTarget[]>('/api/deploy-targets').then(setDeployTargets).catch(() => {})
  }, [id])

  useEffect(() => {
    if (!id) return
    const t = setInterval(() => loadRuns().catch(() => {}), 5000)
    return () => clearInterval(t)
  }, [id])

  async function startRun() {
    setStarting(true)
    try {
      await api('/api/pipelines/' + id + '/run', { method: 'POST', body: '{}' })
      setToast({ type: 'success', text: '已触发运行' })
      await loadRuns()
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '触发失败' })
    } finally {
      setStarting(false)
    }
  }

  async function cancelRun(runId: number) {
    if (!confirm('确认取消这次运行？')) return
    try {
      await api('/api/runs/' + runId + '/stop', { method: 'POST' })
      setToast({ type: 'success', text: '已请求取消' })
      await loadRuns()
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '取消失败' })
    }
  }

  function isActive(r: Run) {
    return r.status === 'running' || r.status === 'pending' || r.status === 'queued' || r.status === 'awaiting_approval'
  }

  const latest = runs[0]
  const cfg = (pipeline?.config || {}) as Record<string, any>
  const firstBranch = ((pipeline?.branchRules?.[0]?.overrides || {}) as Record<string, any>)
  const deploy = { ...(cfg.deploy || {}), ...(firstBranch.deploy || {}) } as Record<string, any>
  const exec = { ...(cfg.execution || {}), ...(firstBranch.execution || {}) } as Record<string, string>

  function executionName(selector?: string) {
    if (!selector) return '服务端本机'
    const match = /(?:^|,)agent=(\d+)(?:,|$)/.exec(selector)
    if (!match) return '标签 ' + selector
    const id = Number(match[1])
    return agents.find((a) => a.id === id)?.name || ('执行器 #' + id)
  }
  const approval = Boolean(deploy.approval)
  const hasDeploy = Boolean(deploy.name)
  const deployTarget = deployTargets.find((t) => t.id === Number(deploy.targetId || 0))
  const deployAgentName = deployTarget ? (deployTarget.agentName || '服务端本机') : '未配置'

  function branchTargetLabel(overrides?: Record<string, unknown>) {
    const dep = overrides?.deploy as { targetId?: number; name?: string } | undefined
    if (!dep) return ''
    if (dep.targetId === 0) return '不部署'
    const target = deployTargets.find((t) => t.id === dep.targetId)
    return target?.name || '未指定目标'
  }

  const stages = useMemo<Stage[]>(() => {
    const byName = new Map<string, Step>((latest?.steps || []).map((s) => [s.name, s]))
    return STAGES.map(({ key, label }) => {
      const step = byName.get(key)
      let status = step?.status || 'pending'
      const selected = key === 'approve' ? '' : exec.buildAgent
      let note = step?.agentName || (key === 'approve' ? '服务端' : key === 'deploy' ? deployAgentName : executionName(selected))
      if (key === 'approve' && !approval) {
        status = 'skipped'
        note = '未启用'
      }
      if (key === 'deploy' && !hasDeploy) {
        status = 'skipped'
        note = '未配置'
      }
      if (!latest && key !== 'approve' && key !== 'deploy') note = '尚未运行'
      return { key, label, status, note }
    })
  }, [latest, approval, hasDeploy, exec.buildAgent, agents, deployAgentName])

  if (!pipeline) {
    return <p className="text-sm text-muted">加载中…</p>
  }

  const duration = latest ? formatDuration(latest.startedAt, latest.finishedAt) : ''

  return (
    <div>
      <div className="mb-5">
        <Link to="/pipelines" className="inline-flex items-center gap-1.5 text-xs text-faint transition-colors hover:text-ink">
          <ArrowLeft size={14} />
          返回流水线
        </Link>
      </div>

      <PageHeader
        eyebrow={'流水线 #' + pipeline.id}
        title={repo?.name || '仓库 #' + pipeline.repoId}
        description={repo?.gitUrl || '未绑定仓库地址'}
        action={
          <>
            <Button variant="secondary" onClick={() => loadRuns().catch(() => {})}>刷新</Button>
            <Button onClick={startRun} disabled={starting}>
              <Play size={15} />
              {starting ? '触发中…' : '运行'}
            </Button>
          </>
        }
      />

      <Card className="mb-5 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-faint">阶段轨道</span>
            {latest ? <Status value={latest.status} /> : <span className="text-xs text-faint">尚未运行</span>}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-faint">
            <span>构建 <span className="text-muted">{executionName(exec.buildAgent)}</span></span>
            <span>部署 <span className="text-muted">{deployAgentName}</span></span>
            <Link to="/agents" className="text-brand hover:underline">管理执行器</Link>
          </div>
        </div>
        <StageRail stages={stages} />
      </Card>

      <div className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="overflow-hidden">
          <div className="border-b border-line px-5 py-3">
            <h2 className="text-sm font-semibold text-ink">最近运行</h2>
            <p className="mt-0.5 text-[11px] text-faint">最近 50 次运行，点击编号查看日志与步骤。</p>
          </div>
          {runs.length === 0 ? (
            <EmptyState
              icon={<Play size={28} />}
              title="还没有运行记录"
              description="点击右上角「运行」触发第一次构建。"
              action={<Button onClick={startRun}><Play size={15} />运行一次</Button>}
            />
          ) : (
            <>
            <div className="hidden w-full overflow-x-auto md:block">
              <table className="w-full min-w-[700px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[10px] font-medium uppercase tracking-[0.12em] text-faint">
                    <th className="px-5 py-2.5 font-medium">运行</th>
                    <th className="px-5 py-2.5 font-medium">状态</th>
                    <th className="hidden px-5 py-2.5 font-medium md:table-cell">分支 / commit</th>
                    <th className="hidden px-5 py-2.5 font-medium lg:table-cell">镜像</th>
                    <th className="hidden px-5 py-2.5 font-medium sm:table-cell">开始</th>
                    <th className="px-5 py-2.5 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="border-b border-line/70 last:border-0 hover:bg-surface-2/60">
                      <td className="px-5 py-3">
                        <Link to={'/runs/' + r.id} className="font-medium text-ink hover:text-brand">#{r.number}</Link>
                        <div className="mt-0.5 text-[10px] text-faint">{r.triggerType}</div>
                      </td>
                      <td className="px-5 py-3"><Status value={r.status} /></td>
                      <td className="hidden px-5 py-3 md:table-cell">
                        <div className="font-mono text-[11px] text-muted">{r.ref}</div>
                        <div className="mt-0.5 font-mono text-[10px] text-faint">{r.commitShort}</div>
                      </td>
                      <td className="hidden max-w-[240px] truncate px-5 py-3 font-mono text-[11px] text-muted lg:table-cell" title={r.imageTag}>{r.imageTag || '—'}</td>
                      <td className="hidden px-5 py-3 text-[11px] text-faint sm:table-cell" title={formatDateTime(r.startedAt)}>{timeAgo(r.startedAt)}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {isActive(r) ? (
                            <Button variant="ghost" size="sm" onClick={() => cancelRun(r.id)} className="text-danger hover:bg-danger/10">
                              <Square size={12} />
                              取消
                            </Button>
                          ) : null}
                          <Link to={'/runs/' + r.id} className="rounded-md px-2 py-1.5 text-xs font-medium text-brand hover:bg-brand/10">详情</Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {runs.length > 0 ? (
              <div className="md:hidden">
                {runs.map((r) => (
                  <div key={r.id} className="border-b border-line/70 px-4 py-3 last:border-0">
                    <div className="flex items-center justify-between gap-3">
                      <Link to={'/runs/' + r.id} className="font-mono text-sm font-medium text-ink">#{r.number}</Link>
                      <Status value={r.status} />
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-faint">
                      <span>{r.triggerType}</span>
                      <span>·</span>
                      <span className="font-mono">{r.ref}</span>
                      <span>·</span>
                      <span className="font-mono">{r.commitShort || '—'}</span>
                      <span>·</span>
                      <span>{timeAgo(r.startedAt)}</span>
                    </div>
                    {r.imageTag ? <div className="mt-1.5 truncate font-mono text-[10px] text-muted" title={r.imageTag}>{r.imageTag}</div> : null}
                    <div className="mt-2 flex items-center justify-end gap-1">
                      {isActive(r) ? (
                        <Button variant="ghost" size="sm" onClick={() => cancelRun(r.id)} className="text-danger hover:bg-danger/10">
                          <Square size={12} />取消
                        </Button>
                      ) : null}
                      <Link to={'/runs/' + r.id} className="rounded-md px-2 py-1.5 text-xs font-medium text-brand hover:bg-brand/10">详情</Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            </>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-faint">最近一次</div>
            {latest ? (
              <>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="font-mono text-2xl font-semibold text-ink">#{latest.number}</span>
                  <Status value={latest.status} />
                </div>
                <dl className="mt-4 space-y-2.5 text-xs">
                  <div className="flex justify-between gap-3"><dt className="text-faint">耗时</dt><dd className="text-ink">{duration || '—'}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-faint">开始</dt><dd className="text-right text-ink">{formatDateTime(latest.startedAt)}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-faint">触发</dt><dd className="text-ink">{latest.triggerType}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-faint">镜像</dt><dd className="max-w-[170px] truncate text-right font-mono text-[11px] text-ink" title={latest.imageTag}>{latest.imageTag || '—'}</dd></div>
                </dl>
              </>
            ) : (
              <p className="mt-3 text-xs leading-5 text-muted">还没有运行记录。触发一次后，这里会显示耗时、镜像和阶段结果。</p>
            )}
          </Card>

          <Card className="p-5">
            <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-faint">配置</div>
            <dl className="mt-3 space-y-2.5 text-xs">
              <div className="flex justify-between gap-3"><dt className="text-faint">镜像名</dt><dd className="font-mono text-ink">{cfg.imageName || '—'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-faint">Tag 模板</dt><dd className="max-w-[180px] truncate font-mono text-[11px] text-ink" title={cfg.tagTemplate}>{cfg.tagTemplate || '—'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-faint">部署</dt><dd className="text-right text-ink">{hasDeploy ? `${deploy.kind || 'Deployment'} / ${deploy.name}` : '仅构建'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-faint">部署执行器</dt><dd className="max-w-[170px] truncate text-right text-ink" title={deployAgentName}>{hasDeploy ? deployAgentName : '—'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-faint">审批</dt><dd className="text-ink">{approval ? '需要' : '不需要'}</dd></div>
              <div className="flex justify-between gap-3">
                <dt className="shrink-0 text-faint">分支规则</dt>
                <dd className="max-w-[190px] space-y-1 text-right font-mono text-[10px] text-ink">
                  {(pipeline.branchRules || []).length === 0 ? '—' : (pipeline.branchRules || []).map((b) => (
                    <div key={b.branch}>
                      {b.branch}
                      {branchTargetLabel(b.overrides) ? <span className="text-faint"> → {branchTargetLabel(b.overrides)}</span> : null}
                    </div>
                  ))}
                </dd>
              </div>
              <div className="flex justify-between gap-3"><dt className="text-faint">定时</dt><dd className="font-mono text-[11px] text-ink">{pipeline.schedule || '—'}</dd></div>
            </dl>
          </Card>
        </div>
      </div>
      <Toast toast={toast} />
    </div>
  )
}
