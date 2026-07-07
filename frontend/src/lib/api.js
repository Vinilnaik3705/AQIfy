/* ── API helpers ────────────────────────────────────────────────────────── */

// In split deployments (Vercel frontend + Render backend), set the
// VITE_API_URL env var in Vercel project settings to your Render URL,
// e.g. "https://aqify-backend.onrender.com".
// Falls back to same-origin for monolithic (Docker / HF Spaces) mode.
const API = (import.meta.env.VITE_API_URL || window.location.origin).replace(/\/+$/, '')

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
