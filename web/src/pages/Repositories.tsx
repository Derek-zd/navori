import { useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, ScanLine, Search, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import type { Credential, Repository } from '../lib/types'
import { Button, Card, EmptyState, Input, Modal, PageHeader, Status, Toast, useToast } from '../components/ui'
import { CredentialSelect } from '../components/CredentialSelect'

export default function Repositories() {
  const [repos, setRepos] = useState<Repository[]>([])
  const [creds, setCreds] = useState<Credential[]>([])
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Repository | null>(null)
  const [name, setName] = useState('')
  const [gitUrl, setGitUrl] = useState('')
  const [credentialId, setCredentialId] = useState(0)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const { toast, setToast } = useToast()

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return repos
    return repos.filter((r) => r.name.toLowerCase().includes(q) || r.gitUrl.toLowerCase().includes(q))
  }, [repos, query])

  async function load() {
    const [rs, cs] = await Promise.all([
      api<Repository[]>('/api/repositories'),
      api<Credential[]>('/api/credentials'),
    ])
    setRepos(rs)
    setCreds(cs)
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
    setShowModal(true)
  }

  function openEdit(r: Repository) {
    setEditing(r)
    setName(r.name)
    setGitUrl(r.gitUrl)
    setCredentialId(r.credentialId || 0)
    setShowModal(true)
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
        setToast({ type: 'success', text: '仓库已添加' })
      }
      setShowModal(false)
      await load()
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '保存失败' })
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: number) {
    if (!confirm('确认删除该仓库？')) return
    try {
      await api('/api/repositories/' + id, { method: 'DELETE' })
      setToast({ type: 'success', text: '已删除' })
      await load()
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '删除失败' })
    }
  }

  async function scan(id: number) {
    await api('/api/repositories/' + id + '/scan', { method: 'POST' })
    setToast({ type: 'success', text: '已触发扫描' })
    setTimeout(() => load().catch(() => {}), 2000)
  }

  const credName = (id?: number) => creds.find((c) => c.id === id)?.name || (id ? '#' + id : '')

  return (
    <div>
      <PageHeader
        title="代码仓库"
        description="接入任意 git 仓库，扫描 Dockerfile"
        action={
          <Button onClick={openCreate}>
            <Plus size={16} />
            添加仓库
          </Button>
        }
      />
      <Card>
        {repos.length > 0 ? (
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="relative max-w-xs">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索名称/地址…" className="!py-1.5 pl-8 text-xs" />
            </div>
          </div>
        ) : null}
        {repos.length === 0 ? (
          <EmptyState
            title="还没有代码仓库"
            description="接入任意 git 仓库并扫描 Dockerfile，然后创建流水线开始构建。"
            action={<Button onClick={openCreate}><Plus size={16} />添加仓库</Button>}
          />
        ) : filtered.length === 0 ? (
          <EmptyState title="没有匹配的仓库" description="换个关键词试试。" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3">名称</th>
                <th className="px-4 py-3">地址</th>
                <th className="px-4 py-3">凭证</th>
                <th className="px-4 py-3">Dockerfile</th>
                <th className="px-4 py-3">扫描状态</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {repos.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-medium text-slate-900">{r.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{r.gitUrl}</td>
                  <td className="px-4 py-3 text-slate-500">{credName(r.credentialId) || '公开'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{r.dockerfilePath}</td>
                  <td className="px-4 py-3">
                    <Status value={r.scanStatus} />
                    {r.scanMessage && r.scanStatus === 'error' ? <div className="mt-1 text-xs text-red-400">{r.scanMessage}</div> : null}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      <Button variant="ghost" onClick={() => scan(r.id)}>
                        <ScanLine size={15} />
                        扫描
                      </Button>
                      <Button variant="ghost" onClick={() => openEdit(r)}>
                        <Pencil size={15} />
                      </Button>
                      <Button variant="ghost" onClick={() => remove(r.id)} className="text-red-600 hover:bg-red-50">
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? '编辑仓库' : '添加仓库'}>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">名称</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="仓库名称" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">Git 地址</label>
            <Input value={gitUrl} onChange={(e) => setGitUrl(e.target.value)} placeholder="https 或 ssh 地址" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">拉取凭证</label>
            <CredentialSelect
              value={credentialId}
              onChange={setCredentialId}
              credentials={creds}
              onCreated={handleCredentialCreated}
              filter={(c) => c.type === 'https' || c.type === 'ssh'}
              allowedTypes={['https', 'ssh']}
            />
            <p className="mt-1 text-xs text-slate-400">默认分支会在扫描时自动探测并保存，无需手动填写。</p>
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button variant="secondary" onClick={() => setShowModal(false)}>取消</Button>
            <Button onClick={save} disabled={busy || !name || !gitUrl}>
              {busy ? '保存中…' : editing ? '保存修改' : '添加'}
            </Button>
          </div>
        </div>
      </Modal>
      <Toast toast={toast} />
    </div>
  )
}
