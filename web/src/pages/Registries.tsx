import { useEffect, useState } from 'react'
import { Pencil, Plus, Plug, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import type { Credential, Registry } from '../lib/types'
import { Button, Card, EmptyState, Input, Modal, PageHeader, Select, Toast, useToast } from '../components/ui'
import { CredentialSelect } from '../components/CredentialSelect'

type TestStatus = 'success' | 'error'

export default function Registries() {
  const [regs, setRegs] = useState<Registry[]>([])
  const [creds, setCreds] = useState<Credential[]>([])
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Registry | null>(null)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [namespace, setNamespace] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [credentialId, setCredentialId] = useState(0)
  const [busy, setBusy] = useState(false)
  const [testResults, setTestResults] = useState<Record<number, TestStatus>>({})
  const [modalTest, setModalTest] = useState<{ state: 'idle' | 'testing' | 'success' | 'error'; message?: string }>({ state: 'idle' })
  const { toast, setToast } = useToast()

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
    setShowModal(true)
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
    setShowModal(true)
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
      setShowModal(false)
      await load()
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '保存失败' })
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: number) {
    if (!confirm('确认删除该镜像仓库？')) return
    try {
      await api('/api/registries/' + id, { method: 'DELETE' })
      setToast({ type: 'success', text: '已删除' })
      await load()
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '删除失败' })
    }
  }

  async function testSaved(id: number) {
    try {
      await api('/api/registries/' + id + '/test', { method: 'POST' })
      setTestResults((prev) => ({ ...prev, [id]: 'success' }))
      setToast({ type: 'success', text: '连通正常' })
    } catch (e) {
      setTestResults((prev) => ({ ...prev, [id]: 'error' }))
      setToast({ type: 'error', text: e instanceof Error ? e.message : '连接失败' })
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
  const registryCreds = creds.filter((c) => c.type === 'registry')
  const testBadge = (id: number) => {
    const s = testResults[id]
    if (s === 'success') return <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />正常</span>
    if (s === 'error') return <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700"><span className="h-1.5 w-1.5 rounded-full bg-red-500" />失败</span>
    return <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500"><span className="h-1.5 w-1.5 rounded-full bg-slate-400" />未测</span>
  }

  return (
    <div>
      <PageHeader
        title="镜像仓库"
        description="构建产物推送的目标 registry"
        action={
          <Button onClick={openCreate}>
            <Plus size={16} />
            添加镜像仓库
          </Button>
        }
      />
      <Card>
        {regs.length === 0 ? (
          <EmptyState
            title="还没有镜像仓库"
            description="添加构建产物要推送的 registry，流水线构建成功后会自动推送。"
            action={<Button onClick={openCreate}><Plus size={16} />添加镜像仓库</Button>}
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3">名称</th>
                <th className="px-4 py-3">地址</th>
                <th className="px-4 py-3">命名空间</th>
                <th className="px-4 py-3">认证</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {regs.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-medium text-slate-900">{r.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{r.url}</td>
                  <td className="px-4 py-3 text-slate-600">{r.namespace || '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{r.credentialId ? credName(r.credentialId) : (r.username ? r.username : '匿名')}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">{testBadge(r.id)}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      <Button variant="ghost" onClick={() => testSaved(r.id)}>
                        <Plug size={15} />
                        测试
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

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? '编辑镜像仓库' : '添加镜像仓库'}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-600">名称</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如 dockerhub" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-600">地址</label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="host:port" />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">命名空间</label>
            <Input value={namespace} onChange={(e) => setNamespace(e.target.value)} placeholder="可选" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">使用已有凭证（可选）</label>
            <CredentialSelect
              value={credentialId}
              onChange={setCredentialId}
              credentials={creds}
              onCreated={handleCredentialCreated}
              filter={(c) => c.type === 'registry'}
              allowedTypes={['registry']}
            />
            <p className="mt-1 text-xs text-slate-400">选择后将优先使用凭证登录。</p>
          </div>
          {credentialId === 0 ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">用户名</label>
                <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="未选凭证时填写" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">密码</label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={editing ? '留空不修改' : '未选凭证时填写'} />
              </div>
            </div>
          ) : (
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
              已选择凭证「{credName(credentialId)}」，将以凭证信息登录；输入的用户名/密码不会生效，也不会自动写入凭证。
            </div>
          )}

          <div className="flex items-center justify-between border-t border-slate-100 pt-4">
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" onClick={testCurrent} disabled={!url || modalTest.state === 'testing'}>
                <Plug size={15} />
                {modalTest.state === 'testing' ? '测试中…' : '测试连接'}
              </Button>
              {modalTest.state === 'success' ? <span className="text-sm text-emerald-600">连通正常</span> : null}
              {modalTest.state === 'error' ? <span className="text-sm text-red-600">{modalTest.message || '连接失败'}</span> : null}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setShowModal(false)}>取消</Button>
              <Button onClick={save} disabled={busy || !name || !url}>
                {busy ? '保存中…' : editing ? '保存修改' : '添加'}
              </Button>
            </div>
          </div>
        </div>
      </Modal>
      <Toast toast={toast} />
    </div>
  )
}
