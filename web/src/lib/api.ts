export class ApiError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const code = body?.error?.code || 'E_INTERNAL'
    const message = body?.error?.message || '请求失败'
    throw new ApiError(code, message)
  }
  return body?.data as T
}
