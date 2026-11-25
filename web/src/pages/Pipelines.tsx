import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ChevronDown,
  ChevronUp,
  Copy,
  GitBranch,
  Play,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { api } from '../lib/api'
import type { Agent, DeployTarget, NotifyChannel, Pipeline, Registry, Repository, Variable } from '../lib/types'
import {
  Button,
  Card,
  Drawer,
  EmptyState,
  Field,
  FormSection,
  Input,
  PageHeader,
  Select,
  Status,
  Toast,
  useToast,
} from '../components/ui'
import { timeAgo } from '../lib/format'

const WORKLOAD_KINDS = ['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob']
const NOTIFY_EVENTS: [string, string][] = [
  ['success', '成功'],
  ['failed', '失败'],
  ['cancelled', '取消'],
  ['rejected', '拒绝'],
]
const ALL_NOTIFY_EVENTS = NOTIFY_EVENTS.map(([ev]) => ev)
type BranchDraft = {
  branch: string
  overrides: Record<string, any>
  buildOn: boolean
  deployOn: boolean
}

const TAG_VARS: Record<string, string> = {
  branch: 'main',
  branch_raw: 'main',
  commit: 'abcdef0123456789',
  commit_short: 'abcdef0',
  timestamp: '20260818-120000',
  unix: '1755500000',
  build_number: '42',
}

export default function Pipelines() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [repos, setRepos] = useState<Repository[]>([])
  const [regs, setRegs] = useState<Registry[]>([])
  const [dts, setDts] = useState<DeployTarget[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [globalVars, setGlobalVars] = useState<Variable[]>([])
  const [pipeVars, setPipeVars] = useState<{ key: string; value: string }[]>([])
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Pipeline | null>(null)

  const [repoId, setRepoId] = useState(0)
  const [registryId, setRegistryId] = useState(0)
  const [imageName, setImageName] = useState('')
  const [tagTemplate, setTagTemplate] = useState('{branch}-{commit_short}')
  const [deployTargetId, setDeployTargetId] = useState(0)
  const [deployName, setDeployName] = useState('')
  const [deployNamespace, setDeployNamespace] = useState('')
  const [deployKind, setDeployKind] = useState('Deployment')
  const [approval, setApproval] = useState(false)
  const [buildAgent, setBuildAgent] = useState('')
  const [dockerfilePath, setDockerfilePath] = useState('')
  const [buildContext, setBuildContext] = useState('')
  const [branches, setBranches] = useState<BranchDraft[]>([{ branch: '**', overrides: {}, buildOn: false, deployOn: false }])
  const [formTab, setFormTab] = useState<'default' | 'branches'>('default')
  const [group, setGroup] = useState('')
  const [scheduleCron, setScheduleCron] = useState('')
  const [notifyChannels, setNotifyChannels] = useState<NotifyChannel[]>([])
  const [notifyBindings, setNotifyBindings] = useState<{ channelId: number; events: string[] }[]>([])
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')
  const [runMenu, setRunMenu] = useState<number | null>(null)
  const { toast, setToast } = useToast()

  async function load() {
    const [ps, rs, gs, ds, vs, chs, ags] = await Promise.all([
      api<Pipeline[]>('/api/pipelines'),
      api<Repository[]>('/api/repositories'),
      api<Registry[]>('/api/registries'),
      api<DeployTarget[]>('/api/deploy-targets'),
      api<Variable[]>('/api/variables'),
      api<NotifyChannel[]>('/api/notify-channels'),
      api<Agent[]>('/api/agents').catch(() => []),
    ])
    setPipelines(ps)
    setRepos(rs)
    setRegs(gs)
    setDts(ds)
    setGlobalVars(vs)
    setNotifyChannels(chs)
    setAgents(ags)
  }

  useEffect(() => {
    load().catch(() => {})
  }, [])

  useEffect(() => {
    if (runMenu === null) return
    const close = () => setRunMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [runMenu])

  function repoName(id: number) {
    return repos.find((r) => r.id === id)?.name || ('#' + id)
  }

  function deployTargetName(id: number) {
    return dts.find((t) => t.id === id)?.name || ''
  }

  function branchRuleLabel(r: { branch: string; overrides?: Record<string, unknown> }) {
    const dep = r.overrides?.deploy as { targetId?: number; name?: string } | undefined
    if (!dep) return r.branch
    if (dep.targetId === 0) return r.branch + ' → 不部署'
    const target = deployTargetName(dep.targetId || 0)
    return r.branch + (target ? ' → ' + target : '')
  }

  function runMenuItems(p: Pipeline) {
    return (
      <>
        <button
          type="button"
          onClick={() => { setRunMenu(null); run(p.id) }}
          className="flex w-full items-center justify-between rounded px-2.5 py-2 text-left text-xs text-ink hover:bg-surface-2"
        >
          <span>默认分支</span>
          <span className="font-mono text-[10px] text-faint">{p.branchRules?.[0]?.branch || '**'}</span>
        </button>
        {(p.branchRules || []).map((r) => (
          <button
            key={r.branch}
            type="button"
            onClick={() => { setRunMenu(null); run(p.id, r.branch) }}
            className="flex w-full items-center justify-between gap-3 rounded px-2.5 py-2 text-left text-xs text-ink hover:bg-surface-2"
          >
            <span className="truncate">{branchRuleLabel(r)}</span>
            <Play size={11} className="shrink-0 text-faint" />
          </button>
        ))}
      </>
    )
  }

  function selectorAgentID(selector: string): number | null {
    const match = /(?:^|,)agent=(\d+)(?:,|$)/.exec(selector)
    return match ? Number(match[1]) : null
  }

  function executionName(selector: string): string {
    if (!selector) return '服务端本机'
    const id = selectorAgentID(selector)
    if (!id) return '标签 ' + selector
    return agents.find((a) => a.id === id)?.name || ('执行器 #' + id)
  }

  function executionShort(selector: string): string {
    if (!selector) return '服务端本机'
    const id = selectorAgentID(selector)
    if (!id) return '自定义标签'
    return agents.find((a) => a.id === id)?.name || ('执行器 #' + id)
  }

  function deployAgentName(targetId: number): string {
    const target = dts.find((t) => t.id === targetId)
    if (!target) return '未配置'
    return target.agentName || '服务端本机'
  }

  function executionSummary(build: string, targetId: number): string {
    let text = '构建 ' + executionShort(build)
    if (targetId) text += ' · 部署 ' + deployAgentName(targetId)
    return text
  }

  function executionDetail(build: string, targetId: number): string {
    return `构建：${build || '服务端本机'}；部署：${deployTargetName(targetId) || '未配置'} → ${deployAgentName(targetId)}`
  }

  function executionField(label: string, value: string, onChange: (v: string) => void, hint: string) {
    const id = selectorAgentID(value)
    const known = id !== null && agents.some((a) => a.id === id)
    return (
      <Field label={label} hint={hint}>
        <Select
          value={id !== null ? String(id) : value ? '__custom__' : ''}
          onChange={(e) => {
            const next = e.target.value
            if (next === '__custom__') return
            onChange(next ? 'agent=' + next : '')
          }}
        >
          <option value="">服务端本机</option>
          {agents.map((a) => (
            <option key={a.id} value={String(a.id)}>
              {a.name}{a.status === 'offline' ? '（离线）' : a.status === 'disabled' ? '（已禁用）' : ''}
            </option>
          ))}
          {id !== null && !known ? <option value={String(id)} disabled>执行器 #{id}（不可用）</option> : null}
          {id === null && value ? <option value="__custom__" disabled>自定义标签：{value}</option> : null}
        </Select>
      </Field>
    )
  }

  async function copyText(text: string): Promise<boolean> {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text)
        return true
      }
    } catch {
      // fall through
    }
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }

  async function copyWebhook(url: string) {
    const ok = await copyText(url)
    setToast(ok ? { type: 'success', text: '已复制完整 Webhook URL' } : { type: 'error', text: '复制失败，请手动选择' })
  }

  const filteredPipelines = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return pipelines
    return pipelines.filter((p) => String(p.id).includes(q) || repoName(p.repoId).toLowerCase().includes(q))
  }, [pipelines, repos, query])

  const groups = useMemo(() => {
    const map: Record<string, Pipeline[]> = {}
    for (const p of filteredPipelines) {
      const g = (p.group || '').trim() || '__ungrouped__'
      if (!map[g]) map[g] = []
      map[g].push(p)
    }
    return Object.entries(map)
  }, [filteredPipelines])

  function resetForm() {
    setRepoId(0)
    setRegistryId(0)
    setImageName('')
    setTagTemplate('{branch}-{commit_short}')
    setDeployTargetId(0)
    setDeployName('')
    setDeployNamespace('')
    setDeployKind('Deployment')
    setApproval(false)
    setBuildAgent('')
    setDockerfilePath('')
    setBuildContext('')
    setBranches([{ branch: '**', overrides: {}, buildOn: false, deployOn: false }])
    setFormTab('default')
    setGroup('')
    setScheduleCron('')
    setPipeVars([])
    setNotifyBindings([])
  }

  function openCreate() {
    resetForm()
    setEditing(null)
    setShowModal(true)
  }

  function openEdit(p: Pipeline) {
    setEditing(p)
    setRepoId(p.repoId)
    const cfg = (p.config || {}) as Record<string, any>
    setRegistryId(Number(cfg.registryId || 0))
    setImageName(String(cfg.imageName || ''))
    setTagTemplate(String(cfg.tagTemplate || '{branch}-{commit_short}'))
    const d = (cfg.deploy || {}) as Record<string, any>
    setDeployTargetId(Number(d.targetId || 0))
    setDeployName(String(d.name || ''))
    setDeployNamespace(String(d.namespace || ''))
    setDeployKind(String(d.kind || 'Deployment'))
    setApproval(Boolean(d.approval))
    const ex = (cfg.execution || {}) as Record<string, any>
    setBuildAgent(String(ex.buildAgent || ''))
    setDockerfilePath(String(cfg.dockerfilePath || ''))
    setBuildContext(String(cfg.buildContext || ''))
    setBranches((p.branchRules || []).map((r) => {
      const o = (r.overrides || {}) as Record<string, any>
      const exec = (o.execution || {}) as Record<string, any>
      const dep = (o.deploy || {}) as Record<string, any>
      return {
        branch: r.branch,
        overrides: o,
        buildOn: Boolean(o.dockerfilePath || o.buildContext || exec.buildAgent),
        deployOn: Boolean(dep.targetId !== undefined || dep.name !== undefined),
      }
    }))
    setFormTab('default')
    setGroup(p.group || '')
    setScheduleCron(p.schedule || '')
    const pv = (cfg.variables || {}) as Record<string, string>
    setPipeVars(Object.entries(pv).map(([k, v]) => ({ key: k, value: v })))
    const nf = (p.notify || {}) as Record<string, any>
    const chans = (nf.channels || []) as { id: number; events?: string[] }[]
    setNotifyBindings(chans.map((c) => ({
      channelId: Number(c.id),
      events: c.events && c.events.length > 0 ? c.events : [...ALL_NOTIFY_EVENTS],
    })))
    setShowModal(true)
  }

  function moveBranch(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= branches.length) return
    const n = [...branches]
    ;[n[i], n[j]] = [n[j], n[i]]
    setBranches(n)
  }

  function patchBranch(i: number, patch: Partial<BranchDraft>) {
    setBranches((prev) => prev.map((b, j) => (j === i ? { ...b, ...patch } : b)))
  }

  function setBranchOverride(i: number, updater: (o: Record<string, any>) => void) {
    setBranches((prev) => prev.map((b, j) => {
      if (j !== i) return b
      const o = JSON.parse(JSON.stringify(b.overrides || {})) as Record<string, any>
      updater(o)
      return { ...b, overrides: o }
    }))
  }

  function toggleBuildOverride(i: number, on: boolean) {
    patchBranch(i, { buildOn: on })
    if (!on) {
      setBranchOverride(i, (o) => {
        delete o.dockerfilePath
        delete o.buildContext
        if (o.execution) {
          delete o.execution.buildAgent
          if (Object.keys(o.execution).length === 0) delete o.execution
        }
      })
    }
  }

  function toggleDeployOverride(i: number, on: boolean) {
    patchBranch(i, { deployOn: on })
    if (!on) {
      setBranchOverride(i, (o) => { delete o.deploy })
    }
  }

  function tagPreview() {
    let text = tagTemplate
    for (const [k, v] of Object.entries(TAG_VARS)) text = text.split('{' + k + '}').join(v)
    const unresolved = text.match(/\{[^}]+\}/g)
    return { text, unresolved }
  }

  async function save() {
    setCreating(true)
    try {
      const branchRules = branches
        .filter((b) => b.branch.trim())
        .map((b) => ({ branch: b.branch.trim(), overrides: b.overrides }))
      const config: Record<string, unknown> = { imageName, registryId, tagTemplate }
      if (dockerfilePath.trim()) config.dockerfilePath = dockerfilePath.trim()
      if (buildContext.trim()) config.buildContext = buildContext.trim()
      const pipelineGroup = group.trim()
      const cronVal = scheduleCron.trim()
      const notifyConfig = { channels: notifyBindings.map((b) => ({ id: b.channelId, events: b.events })) }
      const varsObj: Record<string, string> = {}
      for (const v of pipeVars) {
        if (v.key.trim()) varsObj[v.key.trim()] = v.value
      }
      if (Object.keys(varsObj).length > 0) config.variables = varsObj
      if (deployName) {
        config.deploy = {
          targetId: deployTargetId,
          name: deployName,
          namespace: deployNamespace,
          kind: deployKind,
          approval,
        }
      }
      const execution: Record<string, string> = {}
      if (buildAgent.trim()) execution.buildAgent = buildAgent.trim()
      if (Object.keys(execution).length > 0) config.execution = execution
      if (editing) {
        await api('/api/pipelines/' + editing.id, {
          method: 'PATCH',
          body: JSON.stringify({ config, branchRules, group: pipelineGroup, schedule: cronVal, notify: notifyConfig }),
        })
        setToast({ type: 'success', text: '流水线已更新' })
      } else {
        await api('/api/pipelines', {
          method: 'POST',
          body: JSON.stringify({ repoId, config, branchRules, group: pipelineGroup, schedule: cronVal, notify: notifyConfig }),
        })
        setToast({ type: 'success', text: '流水线已创建' })
      }
      setShowModal(false)
      await load()
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '保存失败' })
    } finally {
      setCreating(false)
    }
  }

  async function remove(id: number) {
    if (!confirm('确认删除该流水线？')) return
    try {
      await api('/api/pipelines/' + id, { method: 'DELETE' })
      setToast({ type: 'success', text: '已删除' })
      await load()
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '删除失败' })
    }
  }

  async function run(id: number, ref?: string) {
    try {
      await api('/api/pipelines/' + id + '/run', { method: 'POST', body: JSON.stringify(ref ? { ref } : {}) })
      setToast({ type: 'success', text: '已触发运行' })
      await load()
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '触发失败' })
    }
  }

  const preview = tagPreview()
  const invalidImage = Boolean(imageName) && !/^[a-z0-9][a-z0-9_.-]*$/.test(imageName.trim())

  return (
    <div>
      <PageHeader
        eyebrow="交付"
        title="流水线"
        description="一个仓库对应一条流水线。按分支规则触发构建、推送，并在需要时部署到 Kubernetes。"
        action={
          <>
            {pipelines.length > 0 ? (
              <div className="relative hidden sm:block">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索流水线 / 仓库…"
                  className="!w-56 !py-1.5 pl-8 text-xs"
                />
              </div>
            ) : null}
            <Button onClick={openCreate}>
              <Plus size={16} />
              新建流水线
            </Button>
          </>
        }
      />

      {pipelines.length === 0 ? (
        <Card>
          <EmptyState
            icon={<GitBranch size={32} />}
            title="还没有流水线"
            description="先从代码仓库创建一条流水线，配置镜像与部署目标后即可运行。"
            action={<Button onClick={openCreate}><Plus size={16} />新建流水线</Button>}
          />
        </Card>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 sm:hidden">
            <div className="relative w-full">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索流水线 / 仓库…" className="!py-1.5 pl-8 text-xs" />
            </div>
          </div>
          <Card className="overflow-hidden">
            {filteredPipelines.length === 0 ? (
              <EmptyState title="没有匹配的流水线" description="换个关键词试试。" />
            ) : (
              <div className="hidden w-full overflow-x-auto md:block">
                <table className="w-full min-w-[860px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-[10px] font-medium uppercase tracking-[0.12em] text-faint">
                      <th className="px-4 py-3 font-medium">流水线</th>
                      <th className="px-4 py-3 font-medium">最近运行</th>
                      <th className="hidden px-4 py-3 font-medium md:table-cell">分支</th>
                      <th className="hidden px-4 py-3 font-medium lg:table-cell">交付</th>
                      <th className="hidden px-4 py-3 font-medium xl:table-cell">Webhook</th>
                      <th className="px-4 py-3 text-right font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map(([gname, items]) => (
                      <Fragment key={gname}>
                        <tr className="bg-surface-2/60">
                          <td colSpan={6} className="px-4 py-2">
                            <div className="flex items-center gap-2 text-[11px] font-medium text-muted">
                              <span className="h-1 w-1 rounded-full bg-copper" />
                              {gname === '__ungrouped__' ? '未分组' : gname}
                              <span className="font-normal text-faint">{items.length}</span>
                            </div>
                          </td>
                        </tr>
                        {items.map((p) => {
                          const cfg = (p.config || {}) as Record<string, any>
                          const d = (cfg.deploy || {}) as Record<string, any>
                          const ex = (cfg.execution || {}) as Record<string, string>
                          return (
                            <tr key={p.id} className="group border-b border-line/70 last:border-0 hover:bg-surface-2/60">
                              <td className="px-4 py-3">
                                <Link to={'/pipelines/' + p.id} className="flex items-center gap-3">
                                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 font-mono text-[11px] text-muted">
                                    #{p.id}
                                  </span>
                                  <span className="min-w-0">
                                    <span className="block truncate font-medium text-ink">{repoName(p.repoId)}</span>
                                    <span className="mt-0.5 block text-[11px] text-faint">
                                      {d.name ? `${d.kind || 'Deployment'} · ${d.name}` : '仅构建与推送'}
                                    </span>
                                  </span>
                                </Link>
                              </td>
                              <td className="whitespace-nowrap px-4 py-3">
                                {p.lastRun ? (
                                  <div className="flex items-center gap-2">
                                    <Status value={p.lastRun.status} />
                                    <span className="text-[11px] text-faint">
                                      #{p.lastRun.number} · {timeAgo(p.lastRun.startedAt || p.lastRun.finishedAt)}
                                    </span>
                                  </div>
                                ) : (
                                  <span className="text-xs text-faint">未运行</span>
                                )}
                              </td>
                              <td className="hidden px-4 py-3 md:table-cell">
                                <div className="flex flex-wrap gap-1">
                                  {(p.branchRules || []).map((r) => (
                                    <span key={r.branch} title={branchRuleLabel(r)} className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted">
                                      {r.branch}
                                    </span>
                                  ))}
                                </div>
                              </td>
                              <td className="hidden px-4 py-3 lg:table-cell">
                                <div className="text-xs text-muted">
                                  {d.name ? (
                                    <>
                                      <div className="font-mono text-[11px] text-ink">{d.namespace ? d.namespace + ' / ' : ''}{d.kind || 'Deployment'}:{d.name}</div>
                                      <div className="mt-0.5 text-[10px] text-faint">
                                        {deployTargetName(d.targetId) || '未指定目标'}
                                        {d.approval ? ' · 需审批' : ''}
                                      </div>
                                    </>
                                  ) : (
                                    <span className="text-faint">无部署</span>
                                  )}
                                  <div className="mt-1 truncate text-[10px] text-faint" title={executionDetail(ex.buildAgent || '', d.targetId || 0)}>
                                  执行 {executionSummary(ex.buildAgent || '', d.targetId || 0)}
                                </div>
                                </div>
                              </td>
                              <td className="hidden px-4 py-3 xl:table-cell">
                                <div className="flex items-center gap-1.5">
                                  <span className="max-w-[13rem] truncate font-mono text-[10px] text-faint" title={p.webhookUrl}>{p.webhookUrl}</span>
                                  <button
                                    type="button"
                                    onClick={() => copyWebhook(p.webhookUrl)}
                                    title="复制完整 URL"
                                    className="shrink-0 rounded p-1 text-faint transition-colors hover:bg-surface-2 hover:text-ink"
                                  >
                                    <Copy size={12} />
                                  </button>
                                </div>
                              </td>
                              <td className="whitespace-nowrap px-4 py-3">
                                <div className="flex items-center justify-end gap-0.5">
                                  <div className="relative inline-flex items-center">
                                    <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); run(p.id) }} title="运行默认分支">
                                      <Play size={14} />
                                      <span className="hidden sm:inline">运行</span>
                                    </Button>
                                    <Button variant="ghost" size="sm" className="px-1" onClick={(e) => { e.stopPropagation(); setRunMenu(runMenu === p.id ? null : p.id) }} title="选择分支">
                                      <ChevronDown size={11} />
                                    </Button>
                                    {runMenu === p.id ? (
                                      <div className="absolute bottom-full right-0 z-20 mb-1 w-56 rounded-md border border-line bg-surface p-1 shadow-overlay">
                                        {runMenuItems(p)}
                                      </div>
                                    ) : null}
                                  </div>
                                  <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>编辑</Button>
                                  <Button variant="ghost" size="sm" onClick={() => remove(p.id)} className="text-danger hover:bg-danger/10" title="删除">
                                    <Trash2 size={14} />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {filteredPipelines.length > 0 ? (
              <div className="md:hidden">
                {groups.map(([gname, items]) => (
                  <div key={gname}>
                    <div className="flex items-center gap-2 border-b border-line bg-surface-2/60 px-4 py-2 text-[11px] font-medium text-muted">
                      <span className="h-1 w-1 rounded-full bg-copper" />
                      {gname === '__ungrouped__' ? '未分组' : gname}
                      <span className="font-normal text-faint">{items.length}</span>
                    </div>
                    {items.map((p) => {
                      const cfg = (p.config || {}) as Record<string, any>
                      const d = (cfg.deploy || {}) as Record<string, any>
                      const ex = (cfg.execution || {}) as Record<string, string>
                      return (
                        <div key={p.id} className="border-b border-line/70 px-4 py-4 last:border-0">
                          <div className="flex items-start justify-between gap-3">
                            <Link to={'/pipelines/' + p.id} className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-line bg-surface-2 font-mono text-[10px] text-muted">#{p.id}</span>
                                <span className="truncate text-sm font-medium text-ink">{repoName(p.repoId)}</span>
                              </div>
                              <div className="mt-1 text-[11px] text-faint">{d.name ? `${d.kind || 'Deployment'} · ${d.name}` : '仅构建与推送'}</div>
                            </Link>
                            {p.lastRun ? <Status value={p.lastRun.status} /> : <span className="text-[11px] text-faint">未运行</span>}
                          </div>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            {(p.branchRules || []).map((r) => (
                              <span key={r.branch} className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted">{branchRuleLabel(r)}</span>
                            ))}
                            {p.lastRun ? <span className="text-[10px] text-faint">#{p.lastRun.number} · {timeAgo(p.lastRun.startedAt || p.lastRun.finishedAt)}</span> : null}
                          </div>
                          <div className="mt-3 rounded-md border border-line bg-surface-2/50 px-3 py-2 text-[11px]">
                            <div className="font-mono text-ink">{d.name ? `${d.namespace ? d.namespace + ' / ' : ''}${d.kind || 'Deployment'}:${d.name}` : '无部署'}</div>
                            <div className="mt-0.5 text-[10px] text-faint">
                              {d.name ? `${deployTargetName(d.targetId) || '未指定目标'}${d.approval ? ' · 需审批' : ''}` : '只构建与推送镜像'}
                            </div>
                            <div className="mt-1 truncate text-[10px] text-faint">执行 {executionSummary(ex.buildAgent || '', d.targetId || 0)}</div>
                          </div>
                          <div className="mt-3 flex items-center gap-1">
                            <div className="relative inline-flex items-center">
                              <Button variant="secondary" size="sm" className="rounded-r-none" onClick={(e) => { e.stopPropagation(); run(p.id) }} title="运行默认分支">
                                <Play size={13} />运行
                              </Button>
                              <Button variant="secondary" size="sm" className="rounded-l-none border-l-0 px-2" onClick={(e) => { e.stopPropagation(); setRunMenu(runMenu === p.id ? null : p.id) }} title="选择分支">
                                <ChevronDown size={11} />
                              </Button>
                              {runMenu === p.id ? (
                                <div className="absolute bottom-full left-0 z-20 mb-1 w-56 rounded-md border border-line bg-surface p-1 shadow-overlay">
                                  {runMenuItems(p)}
                                </div>
                              ) : null}
                            </div>
                            <Link to={'/pipelines/' + p.id} className="rounded-md px-2.5 py-1.5 text-xs font-medium text-muted hover:bg-surface-2 hover:text-ink">详情</Link>
                            <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>编辑</Button>
                            <Button variant="ghost" size="sm" onClick={() => remove(p.id)} className="ml-auto text-danger hover:bg-danger/10" title="删除">
                              <Trash2 size={14} />
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            ) : null}
          </Card>
          <div className="mt-3 text-[11px] text-faint">{filteredPipelines.length} 条流水线 · {groups.length} 个分组</div>
        </>
      )}

      <Drawer
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? '编辑流水线' : '新建流水线'}
        description={editing ? '修改构建、部署与触发配置。' : '选择仓库，配置镜像与可选的部署目标。'}
        footer={
          <div className="flex items-center justify-between gap-3">
            <span className="hidden text-[11px] text-faint sm:block">保存后立即生效</span>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setShowModal(false)}>取消</Button>
              <Button onClick={save} disabled={!repoId || !registryId || !imageName || invalidImage || creating}>
                {creating ? '保存中…' : editing ? '保存修改' : '创建流水线'}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-7">
          <div className="-mt-1 flex gap-1 border-b border-line">
            {[
              { key: 'default', label: '默认配置' },
              { key: 'branches', label: `分支覆盖 ${branches.length}` },
            ].map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setFormTab(t.key as 'default' | 'branches')}
                className={`-mb-px border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                  formTab === t.key ? 'border-brand text-ink' : 'border-transparent text-muted hover:text-ink'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className={formTab === 'default' ? 'space-y-7' : 'hidden'}>
          <FormSection title="来源" description="一条流水线绑定一个仓库，仓库地址与凭据在「代码仓库」中维护。">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="代码仓库">
                <Select value={repoId} onChange={(e) => setRepoId(Number(e.target.value))} disabled={!!editing}>
                  <option value={0}>选择仓库…</option>
                  {repos.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </Select>
              </Field>
              <Field label="分组" hint="用于在列表中归类，例如 team-payments。">
                <Input value={group} onChange={(e) => setGroup(e.target.value)} placeholder="未分组" />
              </Field>
            </div>
            <div className="mt-4">
              <Field label="定时触发" hint="标准 cron 表达式；留空表示只由 Webhook 或手动触发。">
                <Input value={scheduleCron} onChange={(e) => setScheduleCron(e.target.value)} placeholder="如 */5 * * * *" className="font-mono text-xs" />
              </Field>
            </div>
          </FormSection>

          <FormSection title="构建与推送" description="镜像名只允许小写字母、数字、点、下划线和连字符。">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="镜像仓库">
                <Select value={registryId} onChange={(e) => setRegistryId(Number(e.target.value))}>
                  <option value={0}>选择镜像仓库…</option>
                  {regs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </Select>
              </Field>
              <Field label="镜像名" hint={invalidImage ? '格式不合法：需小写字母/数字/点/下划线/连字符' : undefined}>
                <Input
                  value={imageName}
                  onChange={(e) => setImageName(e.target.value)}
                  placeholder="如 myapp"
                  className={invalidImage ? '!border-danger' : ''}
                />
              </Field>
            </div>
            <div className="mt-4">
              <Field label="Tag 模板" hint={preview.unresolved ? '含未解析变量：' + preview.unresolved.join('、') : '可用变量：branch / branch_raw / commit / commit_short / timestamp / unix / build_number / var.KEY'}>
                <Input value={tagTemplate} onChange={(e) => setTagTemplate(e.target.value)} placeholder="{branch}-{commit_short}" className="font-mono text-xs" />
              </Field>
              <div className="mt-2 rounded-md border border-line bg-surface-2 px-3 py-2 font-mono text-[11px] text-muted">
                预览：{preview.text}
              </div>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Dockerfile 路径" hint="相对仓库根目录；留空使用仓库扫描到的 Dockerfile。">
                <Input value={dockerfilePath} onChange={(e) => setDockerfilePath(e.target.value)} placeholder="Dockerfile" className="font-mono text-xs" />
              </Field>
              <Field label="构建上下文" hint="相对仓库根目录；留空使用仓库根目录。">
                <Input value={buildContext} onChange={(e) => setBuildContext(e.target.value)} placeholder="." className="font-mono text-xs" />
              </Field>
            </div>
            <div className="mt-4">
              {executionField('构建执行器', buildAgent, setBuildAgent, 'pull / build / push 由该执行器执行；未选择时由服务端本机执行；选中后若执行器不在线，步骤会排队等待。')}
              <div className="mt-2 text-[11px] text-faint">
                <Link to="/agents" className="text-brand hover:underline">管理执行器</Link>
                <span className="ml-2">· 执行器需在线且具备对应能力</span>
              </div>
            </div>
          </FormSection>

          <FormSection title="部署" description="留空名称则只构建推送，不执行部署。">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="部署目标">
                <Select value={deployTargetId} onChange={(e) => setDeployTargetId(Number(e.target.value))}>
                  <option value={0}>选择部署目标…</option>
                  {dts.map((t) => <option key={t.id} value={t.id}>{t.name}{t.agentName ? ' · ' + t.agentName : ''}</option>)}
                </Select>
              </Field>
              <Field label="Workload 类型">
                <Select value={deployKind} onChange={(e) => setDeployKind(e.target.value)}>
                  {WORKLOAD_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </Select>
              </Field>
              <Field label="Workload 名称">
                <Input value={deployName} onChange={(e) => setDeployName(e.target.value)} placeholder="workload 名称" />
              </Field>
              <Field label="命名空间" hint="留空使用部署目标的默认命名空间。">
                <Input value={deployNamespace} onChange={(e) => setDeployNamespace(e.target.value)} placeholder="default" />
              </Field>
            </div>
            <div className="mt-2 text-[11px] text-faint">部署执行器由所选部署环境绑定；未绑定执行器时由服务端本机执行。</div>
            <label className="mt-4 flex items-start gap-2 text-xs text-muted">
              <input type="checkbox" checked={approval} onChange={(e) => setApproval(e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand" />
              <span>部署前需要审批<span className="ml-1 text-faint">审批始终在服务端执行，不会下发到执行器。</span></span>
            </label>
          </FormSection>

          </div>
          <div className={formTab === 'branches' ? 'space-y-7' : 'hidden'}>
          <FormSection title="分支覆盖" description="按顺序匹配，首个命中的规则生效；未覆盖的字段继承默认配置。">
            <div className="space-y-3">
              {branches.map((b, i) => {
                const o = b.overrides || {}
                const exec = (o.execution || {}) as Record<string, any>
                const dep = (o.deploy || {}) as Record<string, any>
                const noDeploy = dep.targetId === 0 && dep.name === ''
                const target = dep.targetId ? dts.find((t) => t.id === Number(dep.targetId)) : undefined
                const deployValue = noDeploy ? -1 : Number(dep.targetId || 0)
                const summary = [
                  b.buildOn ? '构建覆盖' : '',
                  noDeploy ? '不部署' : target ? '部署 ' + target.name : dep.name ? '部署 ' + dep.name : '',
                ].filter(Boolean).join(' · ') || '继承默认'
                return (
                  <div key={i} className="rounded-md border border-line bg-surface-2/40 p-3">
                    <div className="flex items-center gap-1.5">
                      <Input
                        value={b.branch}
                        onChange={(e) => patchBranch(i, { branch: e.target.value })}
                        placeholder="** 或 release/*"
                        className="flex-1 font-mono text-xs"
                      />
                      <Button type="button" variant="ghost" size="sm" onClick={() => moveBranch(i, -1)} disabled={i === 0} title="上移">
                        <ChevronUp size={14} />
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => moveBranch(i, 1)} disabled={i === branches.length - 1} title="下移">
                        <ChevronDown size={14} />
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setBranches(branches.filter((_, j) => j !== i))} title="删除">
                        <X size={14} />
                      </Button>
                    </div>
                    <div className="mt-2 text-[11px] text-faint">{summary}</div>
                    <div className="mt-3 flex flex-wrap gap-4">
                      <label className="flex items-center gap-2 text-xs text-muted">
                        <input type="checkbox" checked={b.buildOn} onChange={(e) => toggleBuildOverride(i, e.target.checked)} className="h-4 w-4 accent-brand" />
                        覆盖构建
                      </label>
                      <label className="flex items-center gap-2 text-xs text-muted">
                        <input type="checkbox" checked={b.deployOn} onChange={(e) => toggleDeployOverride(i, e.target.checked)} className="h-4 w-4 accent-brand" />
                        覆盖部署
                      </label>
                    </div>
                    {b.buildOn && (
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <Field label="Dockerfile 路径">
                          <Input
                            value={String(o.dockerfilePath || '')}
                            onChange={(e) => setBranchOverride(i, (x) => { if (e.target.value) x.dockerfilePath = e.target.value; else delete x.dockerfilePath })}
                            placeholder={dockerfilePath || '继承默认'}
                            className="font-mono text-xs"
                          />
                        </Field>
                        <Field label="构建上下文">
                          <Input
                            value={String(o.buildContext || '')}
                            onChange={(e) => setBranchOverride(i, (x) => { if (e.target.value) x.buildContext = e.target.value; else delete x.buildContext })}
                            placeholder={buildContext || '继承默认'}
                            className="font-mono text-xs"
                          />
                        </Field>
                        <div className="sm:col-span-2">
                          <Field label="构建执行器" hint="留空继承默认构建执行器。">
                            <Select
                              value={String(exec.buildAgent || '')}
                              onChange={(e) => {
                                const v = e.target.value
                                setBranchOverride(i, (x) => {
                                  if (!v) {
                                    if (x.execution) {
                                      delete x.execution.buildAgent
                                      if (Object.keys(x.execution).length === 0) delete x.execution
                                    }
                                  } else {
                                    x.execution = { ...(x.execution || {}), buildAgent: v }
                                  }
                                })
                              }}
                            >
                              <option value="">继承默认</option>
                              {agents.map((a) => (
                                <option key={a.id} value={'agent=' + a.id}>
                                  {a.name}{a.status !== 'online' ? `（${a.status === 'disabled' ? '已禁用' : '离线'}）` : ''}
                                </option>
                              ))}
                            </Select>
                          </Field>
                        </div>
                      </div>
                    )}
                    {b.deployOn && (
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <Field label="部署目标">
                          <Select
                            value={deployValue}
                            onChange={(e) => {
                              const v = Number(e.target.value)
                              setBranchOverride(i, (x) => {
                                if (v === 0) delete x.deploy
                                else if (v === -1) x.deploy = { targetId: 0, name: '' }
                                else x.deploy = { ...(x.deploy || {}), targetId: v, name: '' }
                              })
                            }}
                          >
                            <option value={0}>继承默认部署</option>
                            <option value={-1}>不部署</option>
                            {dts.map((t) => <option key={t.id} value={t.id}>{t.name}{t.agentName ? ' · ' + t.agentName : ''}</option>)}
                          </Select>
                        </Field>
                        <Field label="Workload 类型">
                          <Input
                            value={String(dep.kind || '')}
                            onChange={(e) => setBranchOverride(i, (x) => { x.deploy = { ...(x.deploy || {}), kind: e.target.value } })}
                            placeholder={'继承：' + deployKind}
                            className="font-mono text-xs"
                          />
                        </Field>
                        <Field label="Workload 名称">
                          <Input
                            value={String(dep.name === '' ? '' : dep.name || '')}
                            onChange={(e) => setBranchOverride(i, (x) => { x.deploy = { ...(x.deploy || {}), name: e.target.value } })}
                            placeholder={'继承：' + (deployName || '不设置')}
                          />
                        </Field>
                        <Field label="命名空间" hint="切换部署目标时留空会使用新目标的默认命名空间。">
                          <Input
                            value={String(dep.namespace || '')}
                            onChange={(e) => setBranchOverride(i, (x) => { x.deploy = { ...(x.deploy || {}), namespace: e.target.value } })}
                            placeholder={'继承：' + (target?.defaultNamespace || deployNamespace || 'default')}
                            className="font-mono text-xs"
                          />
                        </Field>
                        <label className="flex items-center gap-2 text-xs text-muted sm:col-span-2">
                          <input
                            type="checkbox"
                            checked={Boolean(dep.approval)}
                            onChange={(e) => setBranchOverride(i, (x) => { x.deploy = { ...(x.deploy || {}), approval: e.target.checked } })}
                            className="h-4 w-4 accent-brand"
                          />
                          该分支部署前需要审批
                        </label>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setBranches([...branches, { branch: '', overrides: {}, buildOn: false, deployOn: false }])} className="mt-3">
              <Plus size={14} />
              添加分支
            </Button>
          </FormSection>
          </div>
          <div className={formTab === 'default' ? 'space-y-7' : 'hidden'}>

          <FormSection title="流水线变量" description="覆盖同名全局变量；敏感值不会回显。">
            <div className="space-y-2">
              {pipeVars.map((v, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <Input
                    value={v.key}
                    onChange={(e) => {
                      const n = [...pipeVars]
                      n[i] = { ...n[i], key: e.target.value }
                      setPipeVars(n)
                    }}
                    placeholder="KEY"
                    className="!w-32 shrink-0 font-mono text-xs"
                  />
                  <Input
                    value={v.value}
                    onChange={(e) => {
                      const n = [...pipeVars]
                      n[i] = { ...n[i], value: e.target.value }
                      setPipeVars(n)
                    }}
                    placeholder="值"
                    className="flex-1"
                  />
                  <Button type="button" variant="ghost" size="sm" onClick={() => setPipeVars(pipeVars.filter((_, j) => j !== i))}>
                    <X size={14} />
                  </Button>
                </div>
              ))}
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setPipeVars([...pipeVars, { key: '', value: '' }])} className="mt-2">
              <Plus size={14} />
              添加变量
            </Button>
            <div className="mt-3 rounded-md border border-line bg-surface-2 p-3">
              <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-faint">最终生效变量</div>
              <div className="flex flex-wrap gap-1.5">
                {(() => {
                  const m = new Map<string, string>()
                  for (const g of globalVars) m.set(g.key, g.secret ? '******' : (g.valueSet ? '已设置(全局)' : '—'))
                  for (const pv of pipeVars) if (pv.key.trim()) m.set(pv.key.trim(), pv.value)
                  return Array.from(m.entries()).map(([k, val]) => (
                    <span key={k} className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted">{k}={val || '—'}</span>
                  ))
                })()}
              </div>
            </div>
          </FormSection>

          <FormSection title="通知" description="运行进入终态后，向选定通道发送消息。">
            <div className="space-y-3">
              {notifyBindings.map((b, i) => (
                <div key={i} className="rounded-md border border-line bg-surface-2/50 p-3">
                  <div className="flex items-center gap-2">
                    <Select
                      value={b.channelId}
                      onChange={(e) => {
                        const n = [...notifyBindings]
                        n[i] = { ...n[i], channelId: Number(e.target.value) }
                        setNotifyBindings(n)
                      }}
                    >
                      <option value={0}>选择通道…</option>
                      {notifyChannels.map((c) => <option key={c.id} value={c.id}>{c.name}（{c.type}）</option>)}
                    </Select>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setNotifyBindings(notifyBindings.filter((_, j) => j !== i))}>
                      <X size={14} />
                    </Button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-4">
                    {NOTIFY_EVENTS.map(([ev, label]) => (
                      <label key={ev} className="flex items-center gap-1.5 text-xs text-muted">
                        <input
                          type="checkbox"
                          checked={(b.events || []).includes(ev)}
                          onChange={(e) => {
                            const n = [...notifyBindings]
                            const cur = b.events || []
                            n[i] = { ...n[i], events: e.target.checked ? [...cur, ev] : cur.filter((x) => x !== ev) }
                            setNotifyBindings(n)
                          }}
                          className="h-3.5 w-3.5 accent-brand"
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setNotifyBindings([...notifyBindings, { channelId: 0, events: [...ALL_NOTIFY_EVENTS] }])} className="mt-2">
              <Plus size={14} />
              添加通道
            </Button>
          </FormSection>
          </div>
        </div>
      </Drawer>
      <Toast toast={toast} />
    </div>
  )
}
