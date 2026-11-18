import { ConfigProvider } from '@arco-design/web-react'
import zhCN from '@arco-design/web-react/es/locale/zh-CN'
import { ThemeProvider, useTheme } from 'next-themes'
import { useEffect, type ReactNode } from 'react'

function ArcoThemeBridge() {
  const { resolvedTheme } = useTheme()

  useEffect(() => {
    const dark = resolvedTheme === 'dark'
    document.documentElement.classList.toggle('dark', dark)
    document.body.setAttribute('arco-theme', dark ? 'dark' : 'light')
  }, [resolvedTheme])

  return null
}

export function AppThemeProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
      storageKey="navori-theme"
    >
      <ConfigProvider locale={zhCN}>
        <ArcoThemeBridge />
        {children}
      </ConfigProvider>
    </ThemeProvider>
  )
}
