import { useEffect, useMemo, useState } from 'react'
import { Boxes, KeyRound, Pencil, Plug, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import type { Credential, Registry } from '../lib/types'
import { Button, Card, Drawer, EmptyState, Field, FormSection, Input, PageHeader, Select, Toast, useToast } from '../components/ui'
import { CredentialSelect } from '../components/CredentialSelect'

type TestStatus = 'success' | 'error'

export default function Registries() {
  const [regs, setRegs] = useState<Registry[]>([])
  const [creds, setCreds] = useState<Credential[]>([])
  const [showDrawer, setShowDrawer] = useState(false)
  const [editing, setEditing] = useState<Registry | null>(null)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [namespace, setNamespace] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [credentialId, setCredentialId] = useState(0)
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [testingId, setTestingId] = useState<number | null>(null)
  const [testResults, setTestResults] = useState<Record<number, TestStatus>>({})
  const [modalTest, setModalTest] = useState<{ state: 'idle' | 'testing' | 'success' | 'error'; message?: string }>({ state: 'idle' })
  const [query, setQuery] = useState('')
  const { toast, setToast } = useToast()

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return regs
    return regs.filter((r) => r.name.toLowerCase().includes(q) || r.url.toLowerCase().includes(q) || r.namespace.toLowerCase().includes(q))
  }, [regs, query])

  const authenticated = regs.filter((r) => r.credentialId || r.username).length
  const healthy = Object.values(testResults).filter((s) => s === 'success').length

  async function load() {
    const [rs, cs] = await Promise.all([
      api<Registry[]>('/api/registries'),
      api<Credential[]>('/api/credentials'),
    ])
    setRegs(rs)
    setCreds(cs)
    const initial: Record<number, TestStatus> = {}
    for (const r of rs) {
      if (r.lastTestStatus === 'success' || r.lastTestStatus === 'error') {
        initial[r.id] = r.lastTestStatus
      }
    }
    setTestResults(initial)
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

  function resetForm() {
    setName('')
    setUrl('')
    setNamespace('')
    setUsername('')
    setPassword('')
    setCredentialId(0)
    setModalTest({ state: 'idle' })
  }

  function openCreate() {
    resetForm()
    setEditing(null)
    setShowDrawer(true)
  }

  function openEdit(r: Registry) {
    setEditing(r)
    setName(r.name)
    setUrl(r.url)
    setNamespace(r.namespace)
    setUsername(r.username)
    setPassword('')
    setCredentialId(r.credentialId || 0)
    setModalTest({ state: 'idle' })
    setShowDrawer(true)
  }

  function handleCredentialCreated(c: Credential) {
    setCreds((prev) => [c, ...prev])
  }

  async function save() {
    setBusy(true)
    try {
      const body: Record<string, unknown> = { name, url, namespace, credentialId }
      if (credentialId === 0) {
        body.username = username
        if (password) body.password = password
      }
      if (editing) {
        await api('/api/registries/' + editing.id, {
          method: 'PATCH',
          body: JSON.stringify(body),
        })
        setToast({ type: 'success', text: '镜像仓库已更新' })
      } else {
        await api('/api/registries', {
          method: 'POST',
          body: JSON.stringify({ ...body, password }),
        })
        setToast({ type: 'success', text: '镜像仓库已添加' })
      }
      setShowDrawer(false)
      await load()
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '保存失败' })
    } finally {
      setBusy(false)
    }
  }

  async function remove(r: Registry) {
    if (!confirm('确认删除镜像仓库「' + r.name + '」？')) return
    try {
      await api('/api/registries/' + r.id, { method: 'DELETE' })
      setToast({ type: 'success', text: '已删除' })
      await load()
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '删除失败' })
    }
  }

  async function testSaved(r: Registry) {
    setTestingId(r.id)
    try {
      await api('/api/registries/' + r.id + '/test', { method: 'POST' })
      setTestResults((prev) => ({ ...prev, [r.id]: 'success' }))
      setToast({ type: 'success', text: '连通正常' })
    } catch (e) {
      setTestResults((prev) => ({ ...prev, [r.id]: 'error' }))
      setToast({ type: 'error', text: e instanceof Error ? e.message : '连接失败' })
    } finally {
      setTestingId(null)
    }
  }

  async function testCurrent() {
    setModalTest({ state: 'testing' })
    try {
      await api('/api/registries/test', {
        method: 'POST',
        body: JSON.stringify({ url, username, password, credentialId }),
      })
      setModalTest({ state: 'success' })
    } catch (e) {
      setModalTest({ state: 'error', message: e instanceof Error ? e.message : '连接失败' })
    }
  }

  const credName = (id?: number) => creds.find((c) => c.id === id)?.name || (id ? '#' + id : '')
  const testLabel = (id: number) => {
    const s = testResults[id]
    if (s === 'success') return <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-ink"><span className="h-1.5 w-1.5 rounded-full bg-success" />正常</span>
    if (s === 'error') return <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-danger"><span className="h-1.5 w-1.5 rounded-full bg-danger" />失败</span>
    return <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted"><span className="h-1.5 w-1.5 rounded-full border border-faint" />未测</span>
  }

  return (
    <div>
      <PageHeader
        eyebrow="资源"
        title="镜像仓库"
        description="构建产物推送的目标 registry；推送时使用临时 DOCKER_CONFIG，不写入全局登录态。"
        action={
          <>
            <Button variant="secondary" onClick={refresh} disabled={refreshing}>
              <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
              刷新
            </Button>
            <Button onClick={openCreate}>
              <Plus size={15} />
              添加镜像仓库
            </Button>
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-4">
        {[
          { label: '仓库总数', value: regs.length, note: '可推送目标' },
          { label: '已配置认证', value: authenticated, note: '凭证或用户名' },
          { label: '连接正常', value: healthy, note: '本次会话测试通过' },
          { label: '命名空间', value: new Set(regs.map((r) => r.namespace).filter(Boolean)).size, note: '不同 namespace' },
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

      <Card className="overflow-hidden">
        {regs.length === 0 ? (
          <EmptyState
            icon={<Boxes size={32} />}
            title="还没有镜像仓库"
            description="添加构建产物要推送的 registry，流水线构建成功后会自动推送。"
            action={<Button onClick={openCreate}><Plus size={15} />添加镜像仓库</Button>}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
              <div className="relative min-w-0 flex-1 sm:max-w-xs">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索名称 / 地址 / 命名空间…" className="!py-1.5 pl-8 text-xs" />
              </div>
              <span className="text-[10px] text-faint">{filtered.length} / {regs.length} 个仓库</span>
            </div>

            {filtered.length === 0 ? (
              <EmptyState title="没有匹配的镜像仓库" description="换个关键词试试。" />
            ) : (
              <>
                <div className="hidden w-full overflow-x-auto md:block">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-[10px] font-medium uppercase tracking-[0.12em] text-faint">
                        <th className="px-5 py-3 font-medium">仓库</th>
                        <th className="px-5 py-3 font-medium">命名空间</th>
                        <th className="px-5 py-3 font-medium">认证</th>
                        <th className="px-5 py-3 font-medium">连接</th>
                        <th className="px-5 py-3 text-right font-medium">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((r) => (
                        <tr key={r.id} className="border-b border-line/70 last:border-0 hover:bg-surface-2/60">
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-3">
                              <span className="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-surface-2 text-muted">
                                <Boxes size={14} />
                              </span>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="truncate text-xs font-medium text-ink">{r.name}</span>
                                  {r.isDefault ? <span className="rounded border border-copper/30 bg-copper/10 px-1 py-0.5 text-[9px] text-copper">默认</span> : null}
                                </div>
                                <div className="mt-0.5 max-w-[300px] truncate font-mono text-[10px] text-faint">{r.url}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-3 font-mono text-[11px] text-muted">{r.namespace || '—'}</td>
                          <td className="px-5 py-3">
                            {r.credentialId ? (
                              <span className="inline-flex items-center gap-1.5 text-[11px] text-ink">
                                <KeyRound size={12} className="text-faint" />
                                {credName(r.credentialId)}
                              </span>
                            ) : (
                              <span className="text-[11px] text-muted">{r.username || '匿名'}</span>
                            )}
                          </td>
                          <td className="px-5 py-3">{testLabel(r.id)}</td>
                          <td className="px-5 py-3">
                            <div className="flex justify-end gap-0.5">
                              <Button variant="ghost" size="sm" onClick={() => testSaved(r)} disabled={testingId === r.id}>
                                <Plug size={14} className={testingId === r.id ? 'animate-pulse' : ''} />
                                <span className="hidden xl:inline">{testingId === r.id ? '测试中' : '测试'}</span>
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => openEdit(r)} title="编辑">
                                <Pencil size={14} />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => remove(r)} className="text-danger hover:bg-danger/10" title="删除">
                                <Trash2 size={14} />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="divide-y divide-line md:hidden">
                  {filtered.map((r) => (
                    <div key={r.id} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 text-muted">
                            <Boxes size={13} />
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-xs font-medium text-ink">{r.name}</span>
                              {r.isDefault ? <span className="rounded border border-copper/30 bg-copper/10 px-1 py-0.5 text-[9px] text-copper">默认</span> : null}
                            </div>
                            <div className="mt-0.5 truncate font-mono text-[10px] text-faint">{r.url}</div>
                          </div>
                        </div>
                        {testLabel(r.id)}
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
                        <div>
                          <div className="text-[10px] text-faint">命名空间</div>
                          <div className="mt-0.5 truncate font-mono text-ink">{r.namespace || '—'}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-faint">认证</div>
                          <div className="mt-0.5 truncate text-ink">{r.credentialId ? credName(r.credentialId) : (r.username || '匿名')}</div>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-end gap-1">
                        <Button variant="secondary" size="sm" onClick={() => testSaved(r)} disabled={testingId === r.id}>
                          <Plug size={13} />
                          {testingId === r.id ? '测试中' : '测试'}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
                          <Pencil size={14} />
                          编辑
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => remove(r)} className="text-danger">
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </Card>

      <Drawer
        open={showDrawer}
        onClose={() => setShowDrawer(false)}
        title={editing ? '编辑镜像仓库' : '添加镜像仓库'}
        description="推送凭证优先使用已保存凭证；未选择凭证时才使用用户名/密码。"
        footer={
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Button variant="secondary" onClick={testCurrent} disabled={!url || modalTest.state === 'testing'}>
                <Plug size={14} />
                {modalTest.state === 'testing' ? '测试中…' : '测试连接'}
              </Button>
              {modalTest.state === 'success' ? <span className="text-[11px] text-success">连通正常</span> : null}
              {modalTest.state === 'error' ? <span className="max-w-[180px] truncate text-[11px] text-danger" title={modalTest.message}>{modalTest.message || '连接失败'}</span> : null}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setShowDrawer(false)}>取消</Button>
              <Button onClick={save} disabled={busy || !name || !url}>
                {busy ? '保存中…' : editing ? '保存修改' : '添加镜像仓库'}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-7">
          <FormSection title="基本信息" description="地址填 host:port，命名空间用于拼接镜像路径。">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="名称">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如 dockerhub" />
              </Field>
              <Field label="地址">
                <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="registry.example.com" />
              </Field>
              <Field label="命名空间" hint="留空则不添加 namespace 前缀。" className="sm:col-span-2">
                <Input value={namespace} onChange={(e) => setNamespace(e.target.value)} placeholder="如 team-a" />
              </Field>
            </div>
          </FormSection>

          <FormSection title="认证" description="优先使用凭证；凭证可在「环境变量」页统一管理。">
            <CredentialSelect
              value={credentialId}
              onChange={setCredentialId}
              credentials={creds}
              onCreated={handleCredentialCreated}
              filter={(c) => c.type === 'registry'}
              emptyLabel="不使用凭证（匿名访问）"
              allowedTypes={['registry']}
            />
            {credentialId === 0 ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="用户名">
                  <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="未选凭证时填写" />
                </Field>
                <Field label="密码">
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={editing ? '留空不修改' : '未选凭证时填写'} />
                </Field>
              </div>
            ) : (
              <div className="mt-4 rounded-md border border-line bg-surface-2 px-3 py-2 text-[11px] leading-5 text-muted">
                已选择凭证「{credName(credentialId)}」，将使用凭证信息登录；这里填写的用户名/密码不会生效。
              </div>
            )}
          </FormSection>

        </div>
      </Drawer>
      <Toast toast={toast} />
    </div>
  )
}
