import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronUp, Play, Plus, Search, Trash2, X } from 'lucide-react'
import { api } from '../lib/api'
import type { DeployTarget, NotifyChannel, Pipeline, Registry, Repository, Variable } from '../lib/types'
import { Button, Card, EmptyState, Input, Modal, PageHeader, Select, Status, Toast, useToast } from '../components/ui'

const WORKLOAD_KINDS = ['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob']

export default function Pipelines() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [repos, setRepos] = useState<Repository[]>([])
  const [regs, setRegs] = useState<Registry[]>([])
  const [dts, setDts] = useState<DeployTarget[]>([])
  const [globalVars, setGlobalVars] = useState<Variable[]>([])
  const [pipeVars, setPipeVars] = useState<{ key: string; value: string }[]>([])
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Pipeline | null>(null)

  // form fields
  const [repoId, setRepoId] = useState(0)
  const [registryId, setRegistryId] = useState(0)
  const [imageName, setImageName] = useState('')
  const [tagTemplate, setTagTemplate] = useState('{branch}-{commit_short}')
  const [deployTargetId, setDeployTargetId] = useState(0)
  const [deployName, setDeployName] = useState('')
  const [deployNamespace, setDeployNamespace] = useState('')
  const [deployKind, setDeployKind] = useState('Deployment')
  const [approval, setApproval] = useState(false)
  const [branches, setBranches] = useState<string[]>(['**'])
  const [group, setGroup] = useState('')
  const [scheduleCron, setScheduleCron] = useState('')
  const [notifyChannels, setNotifyChannels] = useState<NotifyChannel[]>([])
  const [notifyBindings, setNotifyBindings] = useState<{ channelId: number; events: string[] }[]>([])
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')
  const { toast, setToast } = useToast()

  async function load() {
    const [ps, rs, gs, ds, vs, chs] = await Promise.all([
      api<Pipeline[]>('/api/pipelines'),
      api<Repository[]>('/api/repositories'),
      api<Registry[]>('/api/registries'),
      api<DeployTarget[]>('/api/deploy-targets'),
      api<Variable[]>('/api/variables'),
      api<NotifyChannel[]>('/api/notify-channels'),
    ])
    setPipelines(ps)
    setRepos(rs)
    setRegs(gs)
    setDts(ds)
    setGlobalVars(vs)
    setNotifyChannels(chs)
  }
  useEffect(() => {
    load().catch(() => {})
  }, [])

  function repoName(id: number) {
    return repos.find((r) => r.id === id)?.name || ('#' + id)
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
    setBranches(['**'])
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
    setBranches((p.branchRules || []).map((r) => r.branch))
    setGroup((p.group || ''))
    setScheduleCron((p.schedule || ''))
    const pv = (cfg.variables || {}) as Record<string, string>
    setPipeVars(Object.entries(pv).map(([k, v]) => ({ key: k, value: v })))
    const nf = (p.notify || {}) as Record<string, any>
    const chans = (nf.channels || []) as { id: number; events?: string[] }[]
    setNotifyBindings(chans.map((c) => ({ channelId: Number(c.id), events: c.events || [] })))
    setShowModal(true)
  }

  function moveBranch(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= branches.length) return
    const n = [...branches]
    ;[n[i], n[j]] = [n[j], n[i]]
    setBranches(n)
  }

  async function save() {
    setCreating(true)
    try {
      const branchRules = branches.filter((b) => b.trim()).map((b) => ({ branch: b.trim() }))
      const config: Record<string, unknown> = { imageName, registryId, tagTemplate }
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

  async function run(id: number) {
    try {
      await api('/api/pipelines/' + id + '/run', { method: 'POST', body: '{}' })
      setToast({ type: 'success', text: '已触发运行' })
      await load()
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '触发失败' })
    }
  }

  return (
    <div>
      <PageHeader
        title="流水线"
        description="一个仓库对应一条流水线，按分支规则触发构建推送"
        action={
          <Button onClick={openCreate}>
            <Plus size={16} />
            新建流水线
          </Button>
        }
      />
      <Card>
        {pipelines.length > 0 ? (
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="relative max-w-xs">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索流水线/仓库…" className="!py-1.5 pl-8 text-xs" />
            </div>
          </div>
        ) : null}
        {pipelines.length === 0 ? (
          <EmptyState
            title="还没有流水线"
            description="一个仓库对应一条流水线，配置构建推送和可选部署后即可触发。"
            action={<Button onClick={openCreate}><Plus size={16} />新建流水线</Button>}
          />
        ) : filteredPipelines.length === 0 ? (
          <EmptyState title="没有匹配的流水线" description="换个关键词试试。" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">仓库</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">分支规则</th>
                <th className="px-4 py-3">部署</th>
                <th className="px-4 py-3">webhook</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(([gname, items]) => (
                  <Fragment key={gname}>
                    <tr className="bg-slate-50/70">
                      <td colSpan={7} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{gname === '__ungrouped__' ? '未分组' : gname}</td>
                    </tr>
                    {items.map((p) => {
                const cfg = (p.config || {}) as Record<string, any>
                const d = (cfg.deploy || {}) as Record<string, any>
                return (
                  <tr key={p.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-medium text-slate-900">#{p.id}</td>
                    <td className="px-4 py-3 text-slate-600">{repoName(p.repoId)}</td>
                    <td className="px-4 py-3">
                      {p.lastRun ? <Status value={p.lastRun.status} /> : <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500">未运行</span>}
                    </td>
                    <td className="px-4 py-3">
                      {(p.branchRules || []).map((r) => (
                        <span key={r.branch} className="mr-1.5 rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600">{r.branch}</span>
                      ))}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {d.name ? (
                        <span>
                          {d.kind || 'Deployment'} · {d.name}
                          {d.namespace ? ' · ' + d.namespace : ''}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="max-w-xs truncate px-4 py-3 font-mono text-xs text-slate-500">{p.webhookUrl}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        <Button variant="secondary" onClick={() => run(p.id)}>
                          <Play size={15} />
                          运行
                        </Button>
                        <Link to={'/pipelines/' + p.id} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100">
                          详情
                        </Link>
                        <Button variant="ghost" onClick={() => openEdit(p)}>
                          编辑
                        </Button>
                        <Button variant="ghost" onClick={() => remove(p.id)} className="text-red-600 hover:bg-red-50">
                          <Trash2 size={15} />
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
        )}
      </Card>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? '编辑流水线' : '新建流水线'} width="max-w-2xl">
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">仓库</label>
            <Select value={repoId} onChange={(e) => setRepoId(Number(e.target.value))} disabled={!!editing}>
              <option value={0}>选择仓库…</option>
              {repos.map((r) => (<option key={r.id} value={r.id}>{r.name}</option>))}
            </Select>
          </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-600">分组（可选，把多个流水线归到一个产品/应用）</label>
              <Input value={group} onChange={(e) => setGroup(e.target.value)} placeholder="如 my-product" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-600">定时触发（cron，可选，如 */5 * * * *）</label>
              <Input value={scheduleCron} onChange={(e) => setScheduleCron(e.target.value)} placeholder="留空则不定时触发" />
            </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-600">镜像仓库</label>
              <Select value={registryId} onChange={(e) => setRegistryId(Number(e.target.value))}>
                <option value={0}>选择镜像仓库…</option>
                {regs.map((r) => (<option key={r.id} value={r.id}>{r.name}</option>))}
              </Select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-600">镜像名</label>
              <Input value={imageName} onChange={(e) => setImageName(e.target.value)} placeholder="如 myapp" className={imageName && !/^[a-z0-9][a-z0-9_.-]*$/.test(imageName.trim()) ? '!border-red-400' : ''} />
              {imageName && !/^[a-z0-9][a-z0-9_.-]*$/.test(imageName.trim()) ? <p className="mt-1 text-xs text-red-500">镜像名需小写字母/数字/点/下划线/连字符</p> : null}
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">tag 模板</label>
            <Input value={tagTemplate} onChange={(e) => setTagTemplate(e.target.value)} placeholder="{branch}-{commit_short}" />
            {(() => {
              const vars = { branch: 'main', branch_raw: 'main', commit: 'abcdef0123456789', commit_short: 'abcdef0', timestamp: '20260818-120000', unix: '1755500000', build_number: '42' }
              let text = tagTemplate
              for (const [k, v] of Object.entries(vars)) text = text.split('{' + k + '}').join(v)
              const unresolved = text.match(/\{[^}]+\}/g)
              return (
                <p className={'mt-1 text-xs ' + (unresolved ? 'text-amber-600' : 'text-slate-500')}>
                  预览：{text}{unresolved ? '（含未解析变量 ' + unresolved.join(', ') + '）' : ''}
                </p>
              )
            })()}
          </div>

          <div className="rounded-lg border border-slate-200 p-3">
            <div className="mb-2 text-sm font-medium text-slate-600">部署（可选）</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-500">部署目标</label>
                <Select value={deployTargetId} onChange={(e) => setDeployTargetId(Number(e.target.value))}>
                  <option value={0}>选择部署目标…</option>
                  {dts.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-500">Workload 类型</label>
                <Select value={deployKind} onChange={(e) => setDeployKind(e.target.value)}>
                  {WORKLOAD_KINDS.map((k) => (<option key={k} value={k}>{k}</option>))}
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-500">名称</label>
                <Input value={deployName} onChange={(e) => setDeployName(e.target.value)} placeholder="workload 名称" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-500">命名空间</label>
                <Input value={deployNamespace} onChange={(e) => setDeployNamespace(e.target.value)} placeholder="不填则用部署目标默认" />
              </div>
            </div>
            <label className="mt-3 flex items-center gap-1.5 text-sm text-slate-600">
              <input type="checkbox" checked={approval} onChange={(e) => setApproval(e.target.checked)} />
              部署前审批
            </label>
          </div>

          <div>
            <div className="mb-2 text-sm font-medium text-slate-600">分支规则（glob，按顺序首个命中生效）</div>
            <div className="space-y-2">
              {branches.map((b, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={b}
                    onChange={(e) => {
                      const n = [...branches]
                      n[i] = e.target.value
                      setBranches(n)
                    }}
                    placeholder="** 或 release/*"
                    className="flex-1"
                  />
                  <Button type="button" variant="ghost" onClick={() => moveBranch(i, -1)} disabled={i === 0}><ChevronUp size={15} /></Button>
                  <Button type="button" variant="ghost" onClick={() => moveBranch(i, 1)} disabled={i === branches.length - 1}><ChevronDown size={15} /></Button>
                  <Button type="button" variant="ghost" onClick={() => setBranches(branches.filter((_, j) => j !== i))}>
                    <X size={16} />
                  </Button>
                </div>
              ))}
            </div>
            <Button type="button" variant="ghost" onClick={() => setBranches([...branches, ''])} className="mt-2">
              <Plus size={15} />
              添加分支
            </Button>
          </div>

          <div>
            <div className="mb-2 text-sm font-medium text-slate-600">流水线变量（覆盖全局变量）</div>
            <div className="space-y-2">
              {pipeVars.map((v, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={v.key}
                    onChange={(e) => {
                      const n = [...pipeVars]
                      n[i] = { ...n[i], key: e.target.value }
                      setPipeVars(n)
                    }}
                    placeholder="KEY"
                    className="!w-28 shrink-0"
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
                  <Button type="button" variant="ghost" onClick={() => setPipeVars(pipeVars.filter((_, j) => j !== i))}>
                    <X size={16} />
                  </Button>
                </div>
              ))}
            </div>
            <Button type="button" variant="ghost" onClick={() => setPipeVars([...pipeVars, { key: '', value: '' }])} className="mt-2">
              <Plus size={15} />
              添加变量
            </Button>
            <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
              <div className="mb-1.5 text-xs font-medium text-slate-500">最终生效变量（tag 模板用 {'{var.KEY}'} 引用）</div>
              <div className="flex flex-wrap gap-1.5">
                {(() => {
                  const m = new Map<string, string>()
                  for (const g of globalVars) {
                    m.set(g.key, g.secret ? '******' : (g.valueSet ? '已设置(全局)' : '—'))
                  }
                  for (const pv of pipeVars) {
                    if (pv.key.trim()) m.set(pv.key.trim(), pv.value)
                  }
                  return Array.from(m.entries()).map(([k, val]) => (
                    <span key={k} className="rounded bg-white px-2 py-0.5 font-mono text-xs text-slate-600">{k}={val || '—'}</span>
                  ))
                })()}
              </div>
            </div>
          </div>

          <div>
            <div className="mb-2 text-sm font-medium text-slate-600">通知（可选，选择通道与触发事件）</div>
            <div className="space-y-2">
              {notifyBindings.map((b, i) => (
                <div key={i} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center gap-2">
                    <Select value={b.channelId} onChange={(e) => {
                      const n = [...notifyBindings]
                      n[i] = { ...n[i], channelId: Number(e.target.value) }
                      setNotifyBindings(n)
                    }}>
                      <option value={0}>选择通道…</option>
                      {notifyChannels.map((c) => <option key={c.id} value={c.id}>{c.name}（{c.type}）</option>)}
                    </Select>
                    <Button type="button" variant="ghost" onClick={() => setNotifyBindings(notifyBindings.filter((_, j) => j !== i))}>
                      <X size={16} />
                    </Button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-4">
                    {[
                      ['success', '成功'], ['failed', '失败'], ['cancelled', '取消'], ['rejected', '拒绝'],
                    ].map(([ev, label]) => (
                      <label key={ev} className="flex items-center gap-1.5 text-sm text-slate-600">
                        <input type="checkbox" checked={(b.events || []).includes(ev)} onChange={(e) => {
                          const n = [...notifyBindings]
                          const cur = b.events || []
                          n[i] = { ...n[i], events: e.target.checked ? [...cur, ev] : cur.filter((x) => x !== ev) }
                          setNotifyBindings(n)
                        }} />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <Button type="button" variant="ghost" onClick={() => setNotifyBindings([...notifyBindings, { channelId: 0, events: [] }])} className="mt-2">
              <Plus size={15} />
              添加通道
            </Button>
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button variant="secondary" onClick={() => setShowModal(false)}>取消</Button>
            <Button onClick={save} disabled={!repoId || !registryId || !imageName || creating}>
              {creating ? '保存中…' : editing ? '保存修改' : '创建流水线'}
            </Button>
          </div>
        </div>
      </Modal>
      <Toast toast={toast} />
    </div>
  )
}
