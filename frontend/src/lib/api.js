/* ── API helpers ────────────────────────────────────────────────────────── */

const API = (import.meta.env.VITE_API_BASE_URL || window.location.origin).replace(/\/$/, '')

export async function fetchJSON(path, opts = {}) {
  try {
    const token = safeLocalStorage.getItem('aqify_auth_token')
    const headers = new Headers(opts.headers || {})

    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`)
    }

    if (opts.body && !headers.has('Content-Type') && !(opts.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json')
    }

    const res = await fetch(`${API}${path}`, { ...opts, headers })
    if (!res.ok) throw new Error(res.statusText)
    return await res.json()
  } catch (err) {
    console.error(`API ${path}:`, err)
    return null
  }
}

export const safeLocalStorage = {
  getItem(key) {
    try {
      return window.localStorage.getItem(key)
    } catch {
      return null
    }
  },
  setItem(key, value) {
    try {
      window.localStorage.setItem(key, value)
    } catch {
      // Storage unavailable (private mode / blocked) — ignore
    }
  },
  removeItem(key) {
    try {
      window.localStorage.removeItem(key)
    } catch {
      // Storage unavailable (private mode / blocked) — ignore
    }
  },
}
