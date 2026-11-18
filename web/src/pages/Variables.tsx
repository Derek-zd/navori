import { useEffect, useState } from 'react'
import { KeyRound, Lock, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import type { Credential, Variable } from '../lib/types'
import { Button, Card, Drawer, EmptyState, Field, FormSection, Input, PageHeader, Select, Toast, useToast } from '../components/ui'

const CREDENTIAL_TYPES = [
  { value: 'https', label: 'Git HTTPS', hint: '用户名 + Token/密码' },
  { value: 'ssh', label: 'Git SSH', hint: '私钥内容' },
  { value: 'registry', label: '镜像仓库', hint: '用户名 + 密码' },
]

export default function Variables() {
  const [vars, setVars] = useState<Variable[]>([])
  const [creds, setCreds] = useState<Credential[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const { toast, setToast } = useToast()

  // variable form
  const [showVarDrawer, setShowVarDrawer] = useState(false)
  const [editingVar, setEditingVar] = useState<Variable | null>(null)
  const [vKey, setVKey] = useState('')
  const [vValue, setVValue] = useState('')
  const [vSecret, setVSecret] = useState(false)
  const [vDesc, setVDesc] = useState('')
  const [varBusy, setVarBusy] = useState(false)

  // credential form
  const [showCredDrawer, setShowCredDrawer] = useState(false)
  const [editingCred, setEditingCred] = useState<Credential | null>(null)
  const [cName, setCName] = useState('')
  const [cType, setCType] = useState('https')
  const [cUsername, setCUsername] = useState('')
  const [cSecret, setCSecret] = useState('')
  const [credBusy, setCredBusy] = useState(false)

  const secretVars = vars.filter((v) => v.secret).length

  async function load() {
    const [vs, cs] = await Promise.all([
      api<Variable[]>('/api/variables'),
      api<Credential[]>('/api/credentials'),
    ])
    setVars(vs)
    setCreds(cs)
  }

  async function refresh() {
    setRefreshing(true)
    try {
      await load()
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    load().catch(() => {})
  }, [])

  function resetVarForm() {
    setVKey('')
    setVValue('')
    setVSecret(false)
    setVDesc('')
  }
  function openVarCreate() {
    resetVarForm()
    setEditingVar(null)
    setShowVarDrawer(true)
  }
  function openVarEdit(v: Variable) {
    setEditingVar(v)
    setVKey(v.key)
    setVValue('')
    setVSecret(v.secret)
    setVDesc(v.description)
    setShowVarDrawer(true)
  }
  async function saveVar() {
    setVarBusy(true)
    try {
      const body: Record<string, unknown> = { value: vValue, secret: vSecret, description: vDesc }
      if (editingVar) {
        await api('/api/variables/' + editingVar.id, { method: 'PATCH', body: JSON.stringify(body) })
        setToast({ type: 'success', text: '变量已更新' })
      } else {
        await api('/api/variables', { method: 'POST', body: JSON.stringify({ key: vKey, ...body }) })
        setToast({ type: 'success', text: '变量已添加' })
      }
      setShowVarDrawer(false)
      await load()
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '保存失败' })
    } finally {
      setVarBusy(false)
    }
  }
  async function removeVar(v: Variable) {
    if (!confirm('确认删除变量「' + v.key + '」？')) return
    try {
      await api('/api/variables/' + v.id, { method: 'DELETE' })
      setToast({ type: 'success', text: '已删除' })
      await load()
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '删除失败' })
    }
  }

  function resetCredForm() {
    setCName('')
    setCType('https')
    setCUsername('')
    setCSecret('')
  }
  function openCredCreate() {
    resetCredForm()
    setEditingCred(null)
    setShowCredDrawer(true)
  }
  function openCredEdit(c: Credential) {
    setEditingCred(c)
    setCName(c.name)
    setCType(c.type)
    setCUsername(c.username || '')
    setCSecret('')
    setShowCredDrawer(true)
  }
  async function saveCred() {
    setCredBusy(true)
    try {
      const body: Record<string, unknown> = { name: cName, type: cType, username: cUsername }
      if (editingCred) {
        if (cSecret) body.secret = cSecret
        await api('/api/credentials/' + editingCred.id, { method: 'PATCH', body: JSON.stringify(body) })
        setToast({ type: 'success', text: '凭证已更新' })
      } else {
        await api('/api/credentials', { method: 'POST', body: JSON.stringify({ ...body, secret: cSecret }) })
        setToast({ type: 'success', text: '凭证已添加' })
      }
      setShowCredDrawer(false)
      await load()
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '保存失败' })
    } finally {
      setCredBusy(false)
    }
  }
  async function removeCred(c: Credential) {
    if (!confirm('确认删除凭证「' + c.name + '」？')) return
    try {
      await api('/api/credentials/' + c.id, { method: 'DELETE' })
      setToast({ type: 'success', text: '已删除' })
      await load()
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '删除失败' })
    }
  }

  const credTypeLabel = (t: string) => CREDENTIAL_TYPES.find((x) => x.value === t)?.label || t

  return (
    <div>
      <PageHeader
        eyebrow="资源"
        title="环境变量与凭证"
        description="全局变量供 tag 模板和部署参数引用；凭证供代码仓库、镜像仓库引用，加密保存且不回显。"
        action={
          <Button variant="secondary" onClick={refresh} disabled={refreshing}>
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
            刷新
          </Button>
        }
      />

      <div className="mb-5 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-line bg-line">
        {[
          { label: '变量', value: vars.length, note: '全局生效' },
          { label: '敏感变量', value: secretVars, note: '不回显值' },
          { label: '凭证', value: creds.length, note: '按类型引用' },
        ].map((s) => (
          <div key={s.label} className="bg-surface px-4 py-3.5 sm:px-5">
            <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-faint">{s.label}</div>
            <div className="mt-1.5 flex items-baseline gap-1.5">
              <span className="text-xl font-semibold tabular text-ink">{s.value}</span>
              <span className="hidden text-[10px] text-faint sm:inline">{s.note}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-5">
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-ink">环境变量</h2>
              <p className="mt-0.5 text-[10px] text-faint">在 tag 模板中用 {'{var.KEY}'} 引用；同名的流水线变量会覆盖全局值。</p>
            </div>
            <Button size="sm" onClick={openVarCreate}><Plus size={14} />添加变量</Button>
          </div>
          {vars.length === 0 ? (
            <EmptyState
              icon={<KeyRound size={30} />}
              title="还没有环境变量"
              description="添加全局变量后，可在 tag 模板中以 {var.KEY} 引用。"
              action={<Button onClick={openVarCreate} size="sm"><Plus size={14} />添加环境变量</Button>}
            />
          ) : (
            <>
              <div className="hidden w-full overflow-x-auto md:block">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-[10px] font-medium uppercase tracking-[0.12em] text-faint">
                      <th className="px-5 py-3 font-medium">Key</th>
                      <th className="px-5 py-3 font-medium">类型</th>
                      <th className="px-5 py-3 font-medium">状态</th>
                      <th className="px-5 py-3 font-medium">描述</th>
                      <th className="px-5 py-3 text-right font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vars.map((v) => (
                      <tr key={v.id} className="border-b border-line/70 last:border-0 hover:bg-surface-2/60">
                        <td className="px-5 py-3 font-mono text-xs text-ink">{v.key}</td>
                        <td className="px-5 py-3">
                          {v.secret ? (
                            <span className="inline-flex items-center gap-1 text-[11px] text-copper"><Lock size={11} />敏感</span>
                          ) : <span className="text-[11px] text-muted">公开</span>}
                        </td>
                        <td className="px-5 py-3 text-[11px] text-muted">{v.valueSet ? '已设置' : '未设置'}</td>
                        <td className="max-w-[320px] truncate px-5 py-3 text-[11px] text-muted">{v.description || '—'}</td>
                        <td className="px-5 py-3">
                          <div className="flex justify-end gap-0.5">
                            <Button variant="ghost" size="sm" onClick={() => openVarEdit(v)} title="编辑"><Pencil size={14} /></Button>
                            <Button variant="ghost" size="sm" onClick={() => removeVar(v)} className="text-danger hover:bg-danger/10" title="删除"><Trash2 size={14} /></Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="divide-y divide-line md:hidden">
                {vars.map((v) => (
                  <div key={v.id} className="flex items-start justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-mono text-xs text-ink">{v.key}</span>
                        {v.secret ? <span className="inline-flex items-center gap-1 text-[10px] text-copper"><Lock size={10} />敏感</span> : null}
                      </div>
                      <div className="mt-1 text-[10px] text-faint">{v.valueSet ? '已设置' : '未设置'} · {v.description || '无描述'}</div>
                    </div>
                    <div className="flex shrink-0 gap-0.5">
                      <Button variant="ghost" size="sm" onClick={() => openVarEdit(v)}><Pencil size={14} /></Button>
                      <Button variant="ghost" size="sm" onClick={() => removeVar(v)} className="text-danger"><Trash2 size={14} /></Button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>

        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-ink">凭证</h2>
              <p className="mt-0.5 text-[10px] text-faint">Git HTTPS、Git SSH 与镜像仓库凭证；页面只显示是否已设置。</p>
            </div>
            <Button size="sm" onClick={openCredCreate}><Plus size={14} />添加凭证</Button>
          </div>
          {creds.length === 0 ? (
            <EmptyState
              icon={<Lock size={30} />}
              title="还没有凭证"
              description="可添加 Git 或镜像仓库凭证，在添加代码仓库/镜像仓库时引用。"
              action={<Button onClick={openCredCreate} size="sm"><Plus size={14} />添加凭证</Button>}
            />
          ) : (
            <>
              <div className="hidden w-full overflow-x-auto md:block">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-[10px] font-medium uppercase tracking-[0.12em] text-faint">
                      <th className="px-5 py-3 font-medium">名称</th>
                      <th className="px-5 py-3 font-medium">类型</th>
                      <th className="px-5 py-3 font-medium">用户名</th>
                      <th className="px-5 py-3 font-medium">Secret</th>
                      <th className="px-5 py-3 text-right font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {creds.map((c) => (
                      <tr key={c.id} className="border-b border-line/70 last:border-0 hover:bg-surface-2/60">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <span className="flex h-7 w-7 items-center justify-center rounded-md border border-line bg-surface-2 text-muted"><Lock size={12} /></span>
                            <span className="text-xs font-medium text-ink">{c.name}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-[11px] text-muted">{credTypeLabel(c.type)}</td>
                        <td className="px-5 py-3 text-[11px] text-muted">{c.username || '—'}</td>
                        <td className="px-5 py-3 text-[11px]">
                          {c.secretSet ? <span className="text-ink">已设置</span> : <span className="text-danger">未设置</span>}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex justify-end gap-0.5">
                            <Button variant="ghost" size="sm" onClick={() => openCredEdit(c)} title="编辑"><Pencil size={14} /></Button>
                            <Button variant="ghost" size="sm" onClick={() => removeCred(c)} className="text-danger hover:bg-danger/10" title="删除"><Trash2 size={14} /></Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="divide-y divide-line md:hidden">
                {creds.map((c) => (
                  <div key={c.id} className="flex items-start justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-ink">{c.name}</div>
                      <div className="mt-1 text-[10px] text-faint">{credTypeLabel(c.type)} · {c.username || '未设置用户名'} · {c.secretSet ? 'Secret 已设置' : 'Secret 未设置'}</div>
                    </div>
                    <div className="flex shrink-0 gap-0.5">
                      <Button variant="ghost" size="sm" onClick={() => openCredEdit(c)}><Pencil size={14} /></Button>
                      <Button variant="ghost" size="sm" onClick={() => removeCred(c)} className="text-danger"><Trash2 size={14} /></Button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>

      <Drawer
        open={showVarDrawer}
        onClose={() => setShowVarDrawer(false)}
        title={editingVar ? '编辑变量' : '添加变量'}
        description="变量会注入构建和部署步骤；敏感变量的值不会回显。"
        width="max-w-[560px]"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowVarDrawer(false)}>取消</Button>
            <Button onClick={saveVar} disabled={varBusy || (!editingVar && (!vKey || !vValue))}>
              {varBusy ? '保存中…' : editingVar ? '保存修改' : '添加变量'}
            </Button>
          </div>
        }
      >
        <div className="space-y-7">
          <FormSection title="变量">
            <div className="space-y-4">
              <Field label="Key" hint={editingVar ? 'Key 创建后不可修改。' : '建议使用大写字母、数字和下划线。'}>
                <Input value={vKey} onChange={(e) => setVKey(e.target.value)} placeholder="如 VERSION" disabled={!!editingVar} className="font-mono" />
              </Field>
              <Field label="值" hint={editingVar ? '留空表示保持原值不变。' : undefined}>
                <Input value={vValue} onChange={(e) => setVValue(e.target.value)} placeholder={editingVar ? '留空不修改' : '变量值'} />
              </Field>
              <Field label="描述">
                <Input value={vDesc} onChange={(e) => setVDesc(e.target.value)} placeholder="可选" />
              </Field>
              <label className="flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" checked={vSecret} onChange={(e) => setVSecret(e.target.checked)} className="h-3.5 w-3.5 accent-brand" />
                敏感变量（日志与接口不回显值）
              </label>
            </div>
          </FormSection>
        </div>
      </Drawer>

      <Drawer
        open={showCredDrawer}
        onClose={() => setShowCredDrawer(false)}
        title={editingCred ? '编辑凭证' : '添加凭证'}
        description="凭证使用 AES-256-GCM 加密保存，创建后接口只返回是否已设置。"
        width="max-w-[560px]"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowCredDrawer(false)}>取消</Button>
            <Button onClick={saveCred} disabled={credBusy || !cName || (!editingCred && !cSecret)}>
              {credBusy ? '保存中…' : editingCred ? '保存修改' : '添加凭证'}
            </Button>
          </div>
        }
      >
        <div className="space-y-7">
          <FormSection title="基本信息">
            <div className="space-y-4">
              <Field label="名称">
                <Input value={cName} onChange={(e) => setCName(e.target.value)} placeholder="如 github-token / dockerhub" />
              </Field>
              <Field label="类型">
                <Select value={cType} onChange={(e) => setCType(e.target.value)}>
                  {CREDENTIAL_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}（{t.hint}）</option>)}
                </Select>
              </Field>
              <Field label="用户名" hint="Git SSH 可留空；镜像仓库通常为账号名。">
                <Input value={cUsername} onChange={(e) => setCUsername(e.target.value)} placeholder="可选" />
              </Field>
            </div>
          </FormSection>

          <FormSection title="密钥" description="Token、密码或 SSH 私钥内容，保存后不再回显。">
            <Field label="Secret">
              <Input type="password" value={cSecret} onChange={(e) => setCSecret(e.target.value)} placeholder={editingCred ? '留空不修改' : 'Token、密码或私钥内容'} />
            </Field>
          </FormSection>
        </div>
      </Drawer>
      <Toast toast={toast} />
    </div>
  )
}
