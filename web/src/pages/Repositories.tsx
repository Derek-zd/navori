import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, FileCode2, GitBranch, KeyRound, Pencil, Plus, RefreshCw, ScanLine, Search, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import type { Credential, Repository } from '../lib/types'
import { Button, Card, Drawer, EmptyState, Field, FormSection, Input, PageHeader, Status, Toast, useToast } from '../components/ui'
import { CredentialSelect } from '../components/CredentialSelect'

export default function Repositories() {
  const [repos, setRepos] = useState<Repository[]>([])
  const [creds, setCreds] = useState<Credential[]>([])
  const [showDrawer, setShowDrawer] = useState(false)
  const [editing, setEditing] = useState<Repository | null>(null)
  const [name, setName] = useState('')
  const [gitUrl, setGitUrl] = useState('')
  const [credentialId, setCredentialId] = useState(0)
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [scanningId, setScanningId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const { toast, setToast } = useToast()

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return repos
    return repos.filter((r) => r.name.toLowerCase().includes(q) || r.gitUrl.toLowerCase().includes(q))
  }, [repos, query])

  const discovered = repos.filter((r) => r.dockerfilePath).length
  const failed = repos.filter((r) => r.scanStatus === 'error').length
  const withCred = repos.filter((r) => r.credentialId).length

  async function load() {
    const [rs, cs] = await Promise.all([
      api<Repository[]>('/api/repositories'),
      api<Credential[]>('/api/credentials'),
    ])
    setRepos(rs)
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

  function resetForm() {
    setName('')
    setGitUrl('')
    setCredentialId(0)
  }

  function openCreate() {
    resetForm()
    setEditing(null)
    setShowDrawer(true)
  }

  function openEdit(r: Repository) {
    setEditing(r)
    setName(r.name)
    setGitUrl(r.gitUrl)
    setCredentialId(r.credentialId || 0)
    setShowDrawer(true)
  }

  function handleCredentialCreated(c: Credential) {
    setCreds((prev) => [c, ...prev])
  }

  async function save() {
    setBusy(true)
    try {
      const body: Record<string, unknown> = { name, gitUrl, credentialId }
      if (editing) {
        await api('/api/repositories/' + editing.id, {
          method: 'PATCH',
          body: JSON.stringify(body),
        })
        setToast({ type: 'success', text: '仓库已更新' })
      } else {
        await api('/api/repositories', {
          method: 'POST',
          body: JSON.stringify(body),
        })
        setToast({ type: 'success', text: '仓库已添加，正在扫描 Dockerfile' })
      }
      setShowDrawer(false)
      await load()
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '保存失败' })
    } finally {
      setBusy(false)
    }
  }

  async function remove(r: Repository) {
    if (!confirm('确认删除仓库「' + r.name + '」？')) return
    try {
      await api('/api/repositories/' + r.id, { method: 'DELETE' })
      setToast({ type: 'success', text: '已删除' })
      await load()
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '删除失败' })
    }
  }

  async function scan(r: Repository) {
    setScanningId(r.id)
    try {
      await api('/api/repositories/' + r.id + '/scan', { method: 'POST' })
      setToast({ type: 'success', text: '已触发扫描' })
      setTimeout(() => load().catch(() => {}), 1800)
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '扫描失败' })
    } finally {
      setScanningId(null)
    }
  }

  const credName = (id?: number) => creds.find((c) => c.id === id)?.name || (id ? '#' + id : '')

  return (
    <div>
      <PageHeader
        eyebrow="资源"
        title="代码仓库"
        description="接入任意 git 仓库，扫描默认分支与 Dockerfile；构建凭证按仓库隔离。"
        action={
          <>
            <Button variant="secondary" onClick={refresh} disabled={refreshing}>
              <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
              刷新
            </Button>
            <Button onClick={openCreate}>
              <Plus size={15} />
              添加仓库
            </Button>
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-4">
        {[
          { label: '仓库总数', value: repos.length, note: '已接入的 git 仓库' },
          { label: '已发现 Dockerfile', value: discovered, note: '可用于构建' },
          { label: '扫描异常', value: failed, note: '需要检查凭证或路径' },
          { label: '使用凭证', value: withCred, note: '私有仓库' },
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
        {repos.length === 0 ? (
          <EmptyState
            icon={<GitBranch size={32} />}
            title="还没有代码仓库"
            description="接入任意 git 仓库并扫描 Dockerfile，然后创建流水线开始构建。"
            action={<Button onClick={openCreate}><Plus size={15} />添加仓库</Button>}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
              <div className="relative min-w-0 flex-1 sm:max-w-xs">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索名称 / 地址…" className="!py-1.5 pl-8 text-xs" />
              </div>
              <span className="text-[10px] text-faint">{filtered.length} / {repos.length} 个仓库</span>
            </div>

            {filtered.length === 0 ? (
              <EmptyState title="没有匹配的仓库" description="换个关键词试试。" />
            ) : (
              <>
                <div className="hidden w-full overflow-x-auto md:block">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-[10px] font-medium uppercase tracking-[0.12em] text-faint">
                        <th className="px-5 py-3 font-medium">仓库</th>
                        <th className="px-5 py-3 font-medium">凭证</th>
                        <th className="px-5 py-3 font-medium">Dockerfile</th>
                        <th className="px-5 py-3 font-medium">扫描状态</th>
                        <th className="px-5 py-3 text-right font-medium">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((r) => (
                        <tr key={r.id} className="border-b border-line/70 last:border-0 hover:bg-surface-2/60">
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-3">
                              <span className="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-surface-2 text-muted">
                                <GitBranch size={14} />
                              </span>
                              <div className="min-w-0">
                                <div className="truncate text-xs font-medium text-ink">{r.name}</div>
                                <div className="mt-0.5 max-w-[320px] truncate font-mono text-[10px] text-faint" title={r.gitUrl}>{r.gitUrl}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-3">
                            {r.credentialId ? (
                              <span className="inline-flex items-center gap-1.5 text-[11px] text-ink">
                                <KeyRound size={12} className="text-faint" />
                                {credName(r.credentialId)}
                              </span>
                            ) : (
                              <span className="text-[11px] text-faint">公开仓库</span>
                            )}
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-1.5 font-mono text-[11px] text-ink">
                              <FileCode2 size={12} className="text-faint" />
                              {r.dockerfilePath || '—'}
                            </div>
                            <div className="mt-0.5 font-mono text-[10px] text-faint">{r.defaultBranch || '分支未探测'}</div>
                          </td>
                          <td className="max-w-[260px] px-5 py-3">
                            <Status value={r.scanStatus} />
                            {r.scanMessage && r.scanStatus === 'error' ? (
                              <div className="mt-1 flex items-start gap-1 text-[10px] leading-4 text-danger">
                                <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                                <span className="line-clamp-2">{r.scanMessage}</span>
                              </div>
                            ) : null}
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex justify-end gap-0.5">
                              <Button variant="ghost" size="sm" onClick={() => scan(r)} disabled={scanningId === r.id}>
                                <ScanLine size={14} className={scanningId === r.id ? 'animate-pulse' : ''} />
                                <span className="hidden xl:inline">{scanningId === r.id ? '扫描中' : '扫描'}</span>
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
                            <GitBranch size={13} />
                          </span>
                          <div className="min-w-0">
                            <div className="truncate text-xs font-medium text-ink">{r.name}</div>
                            <div className="mt-0.5 truncate font-mono text-[10px] text-faint">{r.gitUrl}</div>
                          </div>
                        </div>
                        <Status value={r.scanStatus} />
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
                        <div>
                          <div className="text-[10px] text-faint">凭证</div>
                          <div className="mt-0.5 truncate text-ink">{r.credentialId ? credName(r.credentialId) : '公开仓库'}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-faint">Dockerfile</div>
                          <div className="mt-0.5 truncate font-mono text-ink">{r.dockerfilePath || '—'}</div>
                          <div className="mt-0.5 truncate font-mono text-[10px] text-faint">{r.defaultBranch || '分支未探测'}</div>
                        </div>
                      </div>
                      {r.scanMessage && r.scanStatus === 'error' ? (
                        <div className="mt-2 text-[10px] leading-4 text-danger">{r.scanMessage}</div>
                      ) : null}
                      <div className="mt-3 flex items-center justify-end gap-1">
                        <Button variant="secondary" size="sm" onClick={() => scan(r)} disabled={scanningId === r.id}>
                          <ScanLine size={13} />
                          {scanningId === r.id ? '扫描中' : '扫描'}
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
        title={editing ? '编辑仓库' : '添加仓库'}
        description="仓库地址与凭证用于拉取代码；保存后会自动扫描默认分支和 Dockerfile。"
        footer={
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] text-faint">扫描结果会覆盖已有 Dockerfile 路径</span>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setShowDrawer(false)}>取消</Button>
              <Button onClick={save} disabled={busy || !name || !gitUrl}>
                {busy ? '保存中…' : editing ? '保存修改' : '添加仓库'}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-7">
          <FormSection title="仓库来源" description="支持 HTTPS 与 SSH 地址，默认分支由扫描自动探测。">
            <div className="space-y-4">
              <Field label="名称">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如 orders-api" />
              </Field>
              <Field label="Git 地址" hint="私有仓库请选择下方的拉取凭证。">
                <Input value={gitUrl} onChange={(e) => setGitUrl(e.target.value)} placeholder="https://github.com/org/repo.git" />
              </Field>
            </div>
          </FormSection>

          <FormSection title="拉取凭证" description="凭证加密保存在服务端，不会回显明文。">
            <CredentialSelect
              value={credentialId}
              onChange={setCredentialId}
              credentials={creds}
              onCreated={handleCredentialCreated}
              filter={(c) => c.type === 'https' || c.type === 'ssh'}
              allowedTypes={['https', 'ssh']}
            />
          </FormSection>
        </div>
      </Drawer>
      <Toast toast={toast} />
    </div>
  )
}
