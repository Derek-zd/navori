import { useEffect, useState } from 'react'
import { Mail, Pencil, Plus, Trash2, Webhook } from 'lucide-react'
import { api } from '../lib/api'
import type { NotifyChannel } from '../lib/types'
import { Button, Card, EmptyState, Input, Modal, PageHeader, Select, Toast, useToast } from '../components/ui'

const TYPES = [
  { value: 'rest', label: '通用 REST API' },
  { value: 'email', label: '邮件（SMTP）' },
  { value: 'feishu', label: '飞书机器人' },
  { value: 'dingtalk', label: '钉钉机器人' },
  { value: 'wecom', label: '企业微信机器人' },
]

export default function NotifyChannels() {
  const [channels, setChannels] = useState<NotifyChannel[]>([])
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<NotifyChannel | null>(null)
  const [busy, setBusy] = useState(false)
  // form
  const [name, setName] = useState('')
  const [type, setType] = useState('rest')
  const [cfg, setCfg] = useState<Record<string, string>>({})
  const { toast, setToast } = useToast()

  async function load() {
    setChannels(await api<NotifyChannel[]>('/api/notify-channels'))
  }
  useEffect(() => { load().catch(() => {}) }, [])

  function reset() {
    setName('')
    setType('rest')
    setCfg({})
  }

  function openCreate() {
    reset()
    setEditing(null)
    setShowModal(true)
  }

  function openEdit(c: NotifyChannel) {
    setEditing(c)
    setName(c.name)
    setType(c.type)
    setCfg(typeof c.config === 'object' && c.config ? c.config : {})
    setShowModal(true)
  }

  function setField(key: string, val: string) {
    setCfg((prev) => ({ ...prev, [key]: val }))
  }

  async function save() {
    setBusy(true)
    try {
      const body = { name, type, config: cfg }
      if (editing) {
        await api('/api/notify-channels/' + editing.id, { method: 'PATCH', body: JSON.stringify(body) })
        setToast({ type: 'success', text: '通道已更新' })
      } else {
        await api('/api/notify-channels', { method: 'POST', body: JSON.stringify(body) })
        setToast({ type: 'success', text: '通道已添加' })
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
    if (!confirm('确认删除该通知通道？')) return
    try {
      await api('/api/notify-channels/' + id, { method: 'DELETE' })
      setToast({ type: 'success', text: '已删除' })
      await load()
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '删除失败' })
    }
  }

  const typeLabel = (t: string) => TYPES.find((x) => x.value === t)?.label || t

  return (
    <div>
      <PageHeader
        title="通知通道"
        description="可复用的通知目的地（REST / 邮件 / IM），流水线里选择使用"
        action={<Button onClick={openCreate}><Plus size={16} />添加通道</Button>}
      />
      <Card>
        {channels.length === 0 ? (
          <EmptyState title="还没有通知通道" description="添加一个 REST / 邮件 / 飞书 / 钉钉 / 企微通道，供流水线通知使用。" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3">名称</th>
                <th className="px-4 py-3">类型</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((c) => (
                <tr key={c.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-medium text-slate-900">{c.name}</td>
                  <td className="px-4 py-3 text-slate-600">{typeLabel(c.type)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      <Button variant="ghost" onClick={() => openEdit(c)}><Pencil size={15} /></Button>
                      <Button variant="ghost" onClick={() => remove(c.id)} className="text-red-600 hover:bg-red-50"><Trash2 size={15} /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? '编辑通道' : '添加通道'}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-600">名称</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如 部署通知" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-600">类型</label>
              <Select value={type} onChange={(e) => setType(e.target.value)}>
                {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            </div>
          </div>

          {type === 'rest' ? (
            <>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">Webhook URL</label>
                <Input value={cfg.url || ''} onChange={(e) => setField('url', e.target.value)} placeholder="https://..." />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">Secret（可选，HMAC 签名）</label>
                <Input type="password" value={cfg.secret || ''} onChange={(e) => setField('secret', e.target.value)} placeholder={editing && cfg.secret === 'already-set' ? '留空不修改' : '留空则不签名'} />
              </div>
            </>
          ) : type === 'email' ? (
            <>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">收件人（逗号分隔）</label>
                <Input value={cfg.to || ''} onChange={(e) => setField('to', e.target.value)} placeholder="a@x.com,b@x.com" />
              </div>
              <p className="text-xs text-slate-400">发件邮箱（SMTP）在「系统设置」中配置。</p>
            </>
) : (
            <>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">机器人 Webhook</label>
                <Input value={cfg.webhook || ''} onChange={(e) => setField('webhook', e.target.value)} placeholder="机器人 webhook 地址" />
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button variant="secondary" onClick={() => setShowModal(false)}>取消</Button>
            <Button onClick={save} disabled={busy || !name || !type}>{busy ? '保存中…' : editing ? '保存修改' : '添加'}</Button>
          </div>
        </div>
      </Modal>
      <Toast toast={toast} />
    </div>
  )
}
