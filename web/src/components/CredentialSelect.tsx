import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { api } from '../lib/api'
import type { Credential } from '../lib/types'
import { Button, Input, Modal, Toast, useToast } from './ui'

export function CredentialSelect({
  value,
  onChange,
  credentials,
  onCreated,
  filter,
  allowedTypes,
}: {
  value: number
  onChange: (id: number) => void
  credentials: Credential[]
  onCreated?: (cred: Credential) => void
  filter: (c: Credential) => boolean
  allowedTypes?: string[]
}) {
  const { toast, setToast } = useToast()
  const [open, setOpen] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState((allowedTypes && allowedTypes[0]) || 'https')
  const [username, setUsername] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const creds = credentials.filter(filter)
  const types = allowedTypes || ['https', 'ssh', 'registry']
  const current = creds.find((c) => c.id === value)

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [])

  function reset() {
    setName('')
    setUsername('')
    setSecret('')
    setType(types[0])
  }

  function openNew() {
    reset()
    setOpen(false)
    setShowModal(true)
  }

  async function create() {
    setBusy(true)
    try {
      const cred = await api<Credential>('/api/credentials', {
        method: 'POST',
        body: JSON.stringify({ name, type, username, secret }),
      })
      onCreated?.(cred)
      onChange(cred.id)
      setShowModal(false)
      setToast({ type: 'success', text: '凭证已添加' })
    } catch (e) {
      setToast({ type: 'error', text: e instanceof Error ? e.message : '添加失败' })
    } finally {
      setBusy(false)
    }
  }

  const label = current ? current.name + '（' + current.type + '）' : '不使用凭证（公开）'

  return (
    <>
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <span className={current ? 'text-slate-700' : 'text-slate-400'}>{label}</span>
          <ChevronDown size={15} className="text-slate-400" />
        </button>
        {open ? (
          <div className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
            <button
              type="button"
              onClick={() => { onChange(0); setOpen(false) }}
              className={'flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50 ' + (value === 0 ? 'text-indigo-600' : 'text-slate-700')}
            >
              不使用凭证（公开）
              {value === 0 ? <Check size={15} /> : null}
            </button>
            {creds.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => { onChange(c.id); setOpen(false) }}
                className={'flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50 ' + (value === c.id ? 'text-indigo-600' : 'text-slate-700')}
              >
                {c.name}（{c.type}）
                {value === c.id ? <Check size={15} /> : null}
              </button>
            ))}
            <div className="my-1 border-t border-slate-100" />
            <button
              type="button"
              onClick={openNew}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-indigo-600 hover:bg-indigo-50"
            >
              ＋ 新建凭证…
            </button>
          </div>
        ) : null}
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="新建凭证">
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">名称</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如 github-token" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">类型</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {types.map((t) => (
                <option key={t} value={t}>{t === 'https' ? 'Git HTTPS' : t === 'ssh' ? 'Git SSH' : '镜像仓库'}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">用户名</label>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="可选" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">Secret / 密码 / 私钥</label>
            <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Token、密码或私钥内容" />
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button variant="secondary" onClick={() => setShowModal(false)}>取消</Button>
            <Button onClick={create} disabled={busy || !name || !secret}>
              {busy ? '添加中…' : '添加'}
            </Button>
          </div>
        </div>
      </Modal>
      <Toast toast={toast} />
    </>
  )
}
