export default function Brand({ dark = false }: { dark?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="h-[34px] w-[34px] shrink-0" aria-hidden="true">
        <rect
          x="4.25"
          y="5.25"
          width="8.5"
          height="8.5"
          rx="2"
          fill="none"
          stroke="rgb(var(--copper))"
          strokeWidth="1.5"
        />
        <path
          d="M12.75 9.5h3.25a2.75 2.75 0 0 1 2.75 2.75v7.5a2.75 2.75 0 0 0 2.75 2.75h.25"
          fill="none"
          stroke="rgb(var(--ink) / 0.48)"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <rect x="19.25" y="18.25" width="8.5" height="8.5" rx="2" fill="rgb(var(--brand))" />
        <circle cx="8.5" cy="9.5" r="1.5" fill="rgb(var(--copper))" />
      </svg>
      <div className="leading-none">
        <div className={'text-[16px] font-semibold tracking-[-0.015em] ' + (dark ? 'text-white' : 'text-ink')}>
          Navori
        </div>
        <div className="mt-1 text-[9px] font-medium tracking-[0.14em] text-faint">交付控制台</div>
      </div>
    </div>
  )
}
