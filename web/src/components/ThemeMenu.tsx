import { Dropdown, Menu } from '@arco-design/web-react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'

const options = [
  { key: 'light', label: '浅色', icon: Sun },
  { key: 'system', label: '跟随系统', icon: Monitor },
  { key: 'dark', label: '深色', icon: Moon },
]

export default function ThemeMenu({ className = '' }: { className?: string }) {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const current = theme ?? 'light'
  const Icon = current === 'dark' ? Moon : current === 'system' ? Monitor : Sun

  return (
    <Dropdown
      trigger="click"
      position="br"
      droplist={
        <Menu selectedKeys={[current]} onClickMenuItem={(key) => setTheme(key)}>
          {options.map(({ key, label, icon: ItemIcon }) => (
            <Menu.Item key={key}>
              <span className="flex items-center gap-2.5">
                <ItemIcon size={14} strokeWidth={1.8} />
                <span>{label}</span>
              </span>
            </Menu.Item>
          ))}
        </Menu>
      }
    >
      <button
        type="button"
        aria-label="切换主题"
        title={current === 'dark' ? '深色（点击切换）' : current === 'system' ? '跟随系统' : '浅色'}
        className={
          'inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 ' +
          className
        }
      >
        <Icon size={16} strokeWidth={1.8} />
        <span className="sr-only">切换主题，当前 {resolvedTheme === 'dark' ? '深色' : '浅色'}</span>
      </button>
    </Dropdown>
  )
}
