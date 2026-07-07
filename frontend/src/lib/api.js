/* ── API helpers ────────────────────────────────────────────────────────── */

// Use Vercel serverless API routes (which proxy to Render backend)
const API = '/api'

export async function fetchJSON(path, opts) {
  try {
    const res = await fetch(`${API}${path}`, opts)
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
}
