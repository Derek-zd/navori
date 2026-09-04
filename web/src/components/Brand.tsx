import { Rocket } from 'lucide-react'

export default function Brand({ dark = false }: { dark?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500 text-white shadow-sm shadow-indigo-500/30">
        <Rocket size={18} />
      </div>
      <span className={'text-base font-semibold tracking-tight ' + (dark ? 'text-white' : 'text-slate-900')}>Navori</span>
    </div>
  )
}
