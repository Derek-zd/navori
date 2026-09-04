import { useEffect, useState } from 'react'
import { KeyRound, Pencil, Plus, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import type { Credential, Variable } from '../lib/types'
import { Button, Card, EmptyState, Input, Modal, PageHeader, Select, Toast, useToast } from '../components/ui'

const CREDENTIAL_TYPES = [
  { value: 'https', label: 'Git HTTPS（用户名 + Token/密码）' },
  { value: 'ssh', label: 'Git SSH（私钥）' },
  { value: 'registry', label: '镜像仓库（用户名 + 密码）' },
]

export default function Variables() {
  const [vars, setVars] = useState<Variable[]>([])
  const [creds, setCreds] = useState<Credential[]>([])
  const { toast, setToast } = useToast()

  // variable form
  const [showVarModal, setShowVarModal] = useState(false)
  const [editingVar, setEditingVar] = useState<Variable | null>(null)
  const [vKey, setVKey] = useState('')
  const [vValue, setVValue] = useState('')
  const [vSecret, setVSecret] = useState(false)
  const [vDesc, setVDesc] = useState('')
  const [varBusy, setVarBusy] = useState(false)

  // credential form
  const [showCredModal, setShowCredModal] = useState(false)
  const [editingCred, setEditingCred] = useState<Credential | null>(null)
  const [cName, setCName] = useState('')
  const [cType, setCType] = useState('https')
  const [cUsername, setCUsername] = useState('')
  const [cSecret, setCSecret] = useState('')
  const [credBusy, setCredBusy] = useState(false)

  async function load() {
    const [vs, cs] = await Promise.all([
      api<Variable[]>('/api/variables'),
      api<Credential[]>('/api/credentials'),
    ])
    setVars(vs)
    setCreds(cs)
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
    setShowVarModal(true)
  }
  function openVarEdit(v: Variable) {
    setEditingVar(v)
    setVKey(v.key)
    setVValue('')
    setVSecret(v.secret)
    setVDesc(v.description)
    setShowVarModal(true)
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
      setShowVarModal(false)
      await load()
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '保存失败' })
    } finally {
      setVarBusy(false)
    }
  }
  async function removeVar(id: number) {
    if (!confirm('确认删除该变量？')) return
    try {
      await api('/api/variables/' + id, { method: 'DELETE' })
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
    setShowCredModal(true)
  }
  function openCredEdit(c: Credential) {
    setEditingCred(c)
    setCName(c.name)
    setCType(c.type)
    setCUsername(c.username || '')
    setCSecret('')
    setShowCredModal(true)
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
      setShowCredModal(false)
      await load()
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '保存失败' })
    } finally {
      setCredBusy(false)
    }
  }
  async function removeCred(id: number) {
    if (!confirm('确认删除该凭证？')) return
    try {
      await api('/api/credentials/' + id, { method: 'DELETE' })
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
        title="环境变量与凭证"
        description="全局变量供 tag 模板引用；凭证供代码仓库/镜像仓库引用"
      />
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Variables */}
        <Card>
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-700">环境变量</h2>
            <Button onClick={openVarCreate} size="sm">
              <Plus size={14} />添加变量
            </Button>
          </div>
          {vars.length === 0 ? (
            <EmptyState
              title="还没有环境变量"
              description="添加全局变量后，可在 tag 模板中以 {var.KEY} 引用。"
              action={<Button onClick={openVarCreate} size="sm"><Plus size={14} />添加环境变量</Button>}
            />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3">Key</th>
                  <th className="px-4 py-3">类型</th>
                  <th className="px-4 py-3">描述</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {vars.map((v) => (
                  <tr key={v.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">{v.key}</td>
                    <td className="px-4 py-3 text-slate-500">{v.secret ? '敏感' : '公开'}</td>
                    <td className="px-4 py-3 text-slate-400">{v.description || ''}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        <Button variant="ghost" onClick={() => openVarEdit(v)}><Pencil size={15} /></Button>
                        <Button variant="ghost" onClick={() => removeVar(v.id)} className="text-red-600 hover:bg-red-50"><Trash2 size={15} /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {/* Credentials */}
        <Card>
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700"><KeyRound size={15} />凭证</h2>
            <Button onClick={openCredCreate} size="sm">
              <Plus size={14} />添加凭证
            </Button>
          </div>
          {creds.length === 0 ? (
            <EmptyState
              title="还没有凭证"
              description="可添加 Git 或镜像仓库凭证，在添加代码仓库/镜像仓库时引用。"
              action={<Button onClick={openCredCreate} size="sm"><Plus size={14} />添加凭证</Button>}
            />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3">名称</th>
                  <th className="px-4 py-3">类型</th>
                  <th className="px-4 py-3">用户名</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {creds.map((c) => (
                  <tr key={c.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-medium text-slate-700">{c.name}</td>
                    <td className="px-4 py-3 text-slate-500">{credTypeLabel(c.type)}</td>
                    <td className="px-4 py-3 text-slate-500">{c.username || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        <Button variant="ghost" onClick={() => openCredEdit(c)}><Pencil size={15} /></Button>
                        <Button variant="ghost" onClick={() => removeCred(c.id)} className="text-red-600 hover:bg-red-50"><Trash2 size={15} /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {/* Variable modal */}
      <Modal open={showVarModal} onClose={() => setShowVarModal(false)} title={editingVar ? '编辑变量' : '添加变量'}>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">Key</label>
            <Input value={vKey} onChange={(e) => setVKey(e.target.value)} placeholder="如 VERSION" disabled={!!editingVar} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">值</label>
            <Input value={vValue} onChange={(e) => setVValue(e.target.value)} placeholder={editingVar ? '留空不修改' : '变量值'} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">描述</label>
            <Input value={vDesc} onChange={(e) => setVDesc(e.target.value)} placeholder="可选" />
          </div>
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input type="checkbox" checked={vSecret} onChange={(e) => setVSecret(e.target.checked)} />
            敏感（不回显值）
          </label>
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button variant="secondary" onClick={() => setShowVarModal(false)}>取消</Button>
            <Button onClick={saveVar} disabled={varBusy || (!editingVar && (!vKey || !vValue))}>
              {varBusy ? '保存中…' : editingVar ? '保存修改' : '添加'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Credential modal */}
      <Modal open={showCredModal} onClose={() => setShowCredModal(false)} title={editingCred ? '编辑凭证' : '添加凭证'}>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">名称</label>
            <Input value={cName} onChange={(e) => setCName(e.target.value)} placeholder="如 github-token / dockerhub" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">类型</label>
            <Select value={cType} onChange={(e) => setCType(e.target.value)}>
              {CREDENTIAL_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">用户名</label>
            <Input value={cUsername} onChange={(e) => setCUsername(e.target.value)} placeholder="Git 用户名或镜像仓库用户名（可选）" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">Secret / 令牌 / 密码</label>
            <Input type="password" value={cSecret} onChange={(e) => setCSecret(e.target.value)} placeholder={editingCred ? '留空不修改' : 'Token、密码或私钥内容'} />
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button variant="secondary" onClick={() => setShowCredModal(false)}>取消</Button>
            <Button onClick={saveCred} disabled={credBusy || !cName || (!editingCred && !cSecret)}>
              {credBusy ? '保存中…' : editingCred ? '保存修改' : '添加'}
            </Button>
          </div>
        </div>
      </Modal>
      <Toast toast={toast} />
    </div>
  )
}
