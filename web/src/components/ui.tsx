import { useEffect, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { X } from 'lucide-react'

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
}) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 disabled:cursor-not-allowed disabled:opacity-45'
  const sizes: Record<string, string> = {
    sm: 'px-2.5 py-1.5 text-xs',
    md: 'px-3.5 py-2 text-sm',
  }
  const variants: Record<string, string> = {
    primary: 'bg-brand text-on-brand hover:bg-brand-strong',
    secondary: 'border border-line-strong bg-surface text-ink hover:bg-surface-2',
    ghost: 'text-muted hover:bg-surface-2 hover:text-ink',
    danger: 'bg-danger text-on-brand hover:opacity-90',
  }
  return <button className={base + ' ' + sizes[size] + ' ' + variants[variant] + ' ' + className} {...props} />
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={
        'w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15 ' + className
      }
      {...props}
    />
  )
}

export function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={
        'w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15 ' + className
      }
      {...props}
    />
  )
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={
        'w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink transition-colors focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15 ' + className
      }
      {...props}
    />
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={'rounded-lg border border-line bg-surface ' + className}>{children}</div>
}

export function PageHeader({
  title,
  description,
  action,
  eyebrow,
}: {
  title: string
  description?: string
  action?: ReactNode
  eyebrow?: string
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? (
          <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-faint">{eyebrow}</div>
        ) : null}
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.015em] text-ink">{title}</h1>
        {description ? <p className="mt-1.5 max-w-2xl text-[13px] leading-5 text-muted">{description}</p> : null}
      </div>
      {action ? <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end">{action}</div> : null}
    </div>
  )
}

type StatusTone = 'success' | 'danger' | 'warning' | 'brand' | 'copper' | 'muted' | 'info'

const STATUS: Record<string, { label: string; tone: StatusTone; hollow?: boolean }> = {
  success: { label: '成功', tone: 'success' },
  done: { label: '完成', tone: 'success' },
  healthy: { label: '健康', tone: 'success' },
  failed: { label: '失败', tone: 'danger' },
  error: { label: '失败', tone: 'danger' },
  rejected: { label: '已拒绝', tone: 'danger' },
  degraded: { label: '降级', tone: 'warning' },
  running: { label: '运行中', tone: 'copper' },
  scanning: { label: '扫描中', tone: 'copper' },
  pending: { label: '等待中', tone: 'muted', hollow: true },
  waiting: { label: '等待', tone: 'muted', hollow: true },
  queued: { label: '排队中', tone: 'muted', hollow: true },
  skipped: { label: '跳过', tone: 'muted', hollow: true },
  cancelled: { label: '已取消', tone: 'muted', hollow: true },
  awaiting_approval: { label: '待审批', tone: 'warning' },
  online: { label: '在线', tone: 'success' },
  offline: { label: '离线', tone: 'muted', hollow: true },
  disabled: { label: '已禁用', tone: 'danger' },
}

const TONE_DOT: Record<StatusTone, string> = {
  success: 'bg-success',
  danger: 'bg-danger',
  warning: 'bg-warning',
  brand: 'bg-brand',
  copper: 'bg-copper animate-pulse',
  muted: 'bg-faint',
  info: 'bg-info',
}

const TONE_TEXT: Record<StatusTone, string> = {
  success: 'text-ink',
  danger: 'text-danger',
  warning: 'text-warning',
  brand: 'text-brand',
  copper: 'text-ink',
  muted: 'text-muted',
  info: 'text-info',
}

export function Status({ value }: { value: string }) {
  const s = STATUS[value] || { label: value, tone: 'muted' as StatusTone, hollow: true }
  return (
    <span className={'inline-flex items-center gap-1.5 text-xs font-medium ' + TONE_TEXT[s.tone]}>
      <span
        className={
          'h-1.5 w-1.5 shrink-0 rounded-full ' +
          (s.hollow ? 'border border-faint bg-transparent' : TONE_DOT[s.tone])
        }
      />
      {s.label}
    </span>
  )
}

let drawerSeq = 0
const drawerStack: number[] = []

export function Drawer({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  width = 'max-w-[720px]',
}: {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: string
}) {
  const idRef = useRef(0)
  const panelRef = useRef<HTMLDivElement>(null)
  if (idRef.current === 0) idRef.current = ++drawerSeq
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const id = idRef.current
    const previous = document.body.style.overflow
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.body.style.overflow = 'hidden'
    drawerStack.push(id)
    const panel = panelRef.current
    const focusableSelector =
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const focusFirst = () => {
      // Prefer the first form control over the header close button.
      const field = panel?.querySelector<HTMLElement>('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])')
      const first = field || panel?.querySelector<HTMLElement>(focusableSelector)
      ;(first || panel)?.focus()
    }
    const raf = requestAnimationFrame(focusFirst)
    const onKey = (e: KeyboardEvent) => {
      // Only the topmost drawer should react to Escape or trap Tab.
      if (drawerStack[drawerStack.length - 1] !== id) return
      if (e.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab' || !panel) return
      const items = Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector)).filter((el) => el.offsetParent !== null)
      if (items.length === 0) {
        e.preventDefault()
        panel.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(raf)
      const i = drawerStack.lastIndexOf(id)
      if (i >= 0) drawerStack.splice(i, 1)
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
      previousFocus?.focus?.()
    }
  }, [open])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/35 animate-[fade-in_160ms_ease-out]" onClick={() => onCloseRef.current()} />
      <div ref={panelRef} tabIndex={-1} className={'absolute inset-y-0 right-0 flex w-full flex-col border-l border-line bg-surface shadow-overlay outline-none animate-[drawer-in_200ms_ease-out] ' + width}>
        <div className="flex shrink-0 items-start justify-between gap-6 border-b border-line px-6 py-5">
          <div>
            <h2 className="text-base font-semibold text-ink">{title}</h2>
            {description ? <p className="mt-1 text-xs leading-5 text-muted">{description}</p> : null}
          </div>
          <button onClick={() => onCloseRef.current()} className="rounded-md p-1 text-faint transition-colors hover:bg-surface-2 hover:text-ink" aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">{children}</div>
        {footer ? <div className="shrink-0 border-t border-line bg-surface px-6 py-4">{footer}</div> : null}
      </div>
    </div>
  )
}

export function Field({
  label,
  hint,
  children,
  className = '',
}: {
  label: string
  hint?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-xs font-medium text-muted">{label}</label>
      {children}
      {hint ? <p className="mt-1.5 text-[11px] leading-4 text-faint">{hint}</p> : null}
    </div>
  )
}

export function FormSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="border-b border-line pb-7 last:border-0 last:pb-0">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {description ? <p className="mt-1 text-[11px] leading-4 text-faint">{description}</p> : null}
      </div>
      {children}
    </section>
  )
}

export function Modal({
  open,
  title,
  onClose,
  children,
  width = 'max-w-lg',
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  width?: string
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/35" onClick={onClose} />
      <div className={'relative w-full ' + width + ' rounded-xl border border-line bg-surface p-6 shadow-overlay'}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-faint transition-colors hover:bg-surface-2 hover:text-muted">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export interface ToastMsg {
  type: 'success' | 'error'
  text: string
}

export function useToast() {
  const [toast, setToast] = useState<ToastMsg | null>(null)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])
  return { toast, setToast }
}

export function Toast({ toast }: { toast: ToastMsg | null }) {
  if (!toast) return null
  const cls = toast.type === 'success'
    ? 'border border-brand/20 bg-brand text-on-brand'
    : 'border border-danger/20 bg-danger text-on-brand'
  return (
    <div className="fixed left-1/2 top-6 z-50 -translate-x-1/2">
      <div className={'rounded-md px-4 py-2.5 text-sm font-medium shadow-overlay ' + cls}>
        {toast.text}
      </div>
    </div>
  )
}


export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center sm:py-16">
      {icon ? <div className="mb-4 text-faint">{icon}</div> : null}
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {description ? <p className="mt-1 max-w-sm text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
  icon,
}: {
  label: string
  value: string | number
  hint?: string
  tone?: 'default' | 'success' | 'danger' | 'warning' | 'info'
  icon?: ReactNode
}) {
  const tones: Record<string, string> = {
    default: 'text-ink',
    success: 'text-emerald-600',
    danger: 'text-red-600',
    warning: 'text-amber-600',
    info: 'text-blue-600',
  }
  return (
    <div className="rounded-lg border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-faint">{label}</div>
        {icon ? <div className="text-faint">{icon}</div> : null}
      </div>
      <div className={'mt-3 text-2xl font-semibold tabular ' + (tones[tone] || tones.default)}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-faint">{hint}</div> : null}
    </div>
  )
}
