/* ── API helpers ────────────────────────────────────────────────────────── */

const API = (import.meta.env.VITE_API_BASE_URL || window.location.origin).replace(/\/$/, '')
const DEFAULT_TIMEOUT_MS = 15000
const inFlightGets = new Map()

export async function fetchJSON(path, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase()
  const headers = new Headers(opts.headers || {})
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchOpts } = opts

  if (fetchOpts.body && !headers.has('Content-Type') && !(fetchOpts.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }

  // StrictMode, visibility changes, and multiple widgets can request the same
  // read at once. Share only requests without a caller-owned AbortSignal; a
  // caller that owns cancellation must retain control of its request.
  const requestKey = method === 'GET' && !fetchOpts.signal
    ? `${method}:${API}${path}`
    : null
  if (requestKey && inFlightGets.has(requestKey)) {
    return inFlightGets.get(requestKey)
  }

  let requestPromise
  requestPromise = (async () => {
    const controller = new AbortController()
    let timeoutId
    let removeAbortListener
    try {
      if (fetchOpts.signal) {
        if (fetchOpts.signal.aborted) controller.abort()
        else {
          const onAbort = () => controller.abort()
          fetchOpts.signal.addEventListener('abort', onAbort, { once: true })
          removeAbortListener = () => fetchOpts.signal.removeEventListener('abort', onAbort)
        }
      }
      timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)
      const res = await fetch(`${API}${path}`, {
        ...fetchOpts,
        headers,
        credentials: fetchOpts.credentials || 'include',
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`.trim())
      return await res.json()
    } catch (err) {
      if (err?.name !== 'AbortError') console.error(`API ${path}:`, err)
      return null
    } finally {
      window.clearTimeout(timeoutId)
      removeAbortListener?.()
      if (requestKey && inFlightGets.get(requestKey) === requestPromise) {
        inFlightGets.delete(requestKey)
      }
    }
  })()

  if (requestKey) inFlightGets.set(requestKey, requestPromise)
  return requestPromise
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
