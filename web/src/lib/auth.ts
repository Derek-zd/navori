import { useEffect, useState } from 'react'

export interface User {
  id: number
  username: string
  role: string
}

let cached: User | null = null

export function useAuth() {
  const [user, setUser] = useState<User | null>(cached)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((b) => {
        cached = b.data.user
        setUser(b.data.user)
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  return { user, loading, setUser }
}
