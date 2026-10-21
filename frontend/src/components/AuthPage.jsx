import { useMemo, useState } from 'react'
import { safeLocalStorage } from '../lib/api'

const API = (import.meta.env.VITE_API_BASE_URL || window.location.origin).replace(/\/$/, '')
const AUTH_TIMEOUT_MS = 15000
const RESERVED_SYSTEM_EMAILS = new Set([
  'admin@aqify.local',
  'authority@aqify.local',
  'inspector@aqify.local',
])
const RESERVED_ACCOUNT_MESSAGE = 'This email is reserved for an AQIfy system account, so public registration is disabled. Use Login with the account provisioned by your administrator.'

const initialForm = {
  full_name: '',
  email: '',
  password: '',
  role: 'Citizen',
}

export default function AuthPage({ onAuth, initialMode = 'login', onBack }) {
  const [mode, setMode] = useState(initialMode)
  const [form, setForm] = useState(initialForm)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [errorAction, setErrorAction] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const isLogin = mode === 'login'

  const title = useMemo(() => isLogin ? 'Sign In' : 'Create Account', [isLogin])
  const subtitle = useMemo(() => isLogin
    ? 'Access AQIfy and continue monitoring the city air quality.'
    : 'Create your AQIfy account to receive intervention access and alerts.', [isLogin])

  const handleChange = (event) => {
    const { name, value } = event.target
    setForm(prev => ({ ...prev, [name]: value }))
    if (error) {
      setError('')
      setErrorAction('')
    }
  }

  const showError = (message, action = '') => {
    setError(message)
    setErrorAction(action)
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    const email = form.email.trim().toLowerCase()
    if (!email || !email.includes('@')) {
      showError('Enter a valid email address.')
      return
    }
    if (!isLogin && RESERVED_SYSTEM_EMAILS.has(email)) {
      showError(RESERVED_ACCOUNT_MESSAGE, 'login')
      return
    }
    if (form.password.length < 8) {
      showError('Password must be at least 8 characters.')
      return
    }
    if (!isLogin && !form.full_name.trim()) {
      showError('Enter your full name.')
      return
    }
    setLoading(true)
    showError('')
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS)

    try {
      const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register'
      const payload = isLogin
        ? { email, password: form.password }
        : { full_name: form.full_name.trim(), email, password: form.password, role: form.role }

      const res = await fetch(`${API}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        const detail = Array.isArray(data.detail)
          ? data.detail.map(item => item.msg).filter(Boolean).join(', ')
          : data.detail
        if (!isLogin && (RESERVED_SYSTEM_EMAILS.has(email) || (typeof detail === 'string' && detail.toLowerCase().includes('reserved')))) {
          showError(RESERVED_ACCOUNT_MESSAGE, 'login')
          return
        }
        throw new Error(detail || `Request failed (${res.status})`)
      }

      const user = data.user
      if (!user) {
        throw new Error('No session returned from the server')
      }

      // The backend stores the JWT in an HttpOnly cookie. Keep only the
      // non-sensitive profile locally so credentials cannot be read from
      // localStorage by injected page scripts.
      safeLocalStorage.removeItem('aqify_auth_token')
      safeLocalStorage.setItem('aqify_user', JSON.stringify(user))
      onAuth({ token: null, user })
    } catch (err) {
      if (err.name === 'AbortError') {
        showError('The authentication service took too long to respond. Please try again.')
      } else if (err instanceof TypeError) {
        showError('Unable to reach the authentication service. Check that the backend is running.')
      } else {
        showError(err.message || 'Unable to authenticate. Please try again.')
      }
    } finally {
      window.clearTimeout(timeoutId)
      setLoading(false)
    }
  }

  return (
    <div className="auth-page" style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'radial-gradient(circle at 12% 8%, rgba(56, 189, 248, 0.18), transparent 32%), linear-gradient(135deg, #08111f 0%, #0f172a 48%, #172554 100%)',
      padding: '32px 24px',
      color: '#e2e8f0',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <div className="auth-page-layout">
        <section className="auth-brand-panel">
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, color: '#f8fafc', fontSize: 25, fontWeight: 850, letterSpacing: '-0.04em' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: 12, color: '#082f49', background: '#7dd3fc', boxShadow: '0 10px 24px rgba(56, 189, 248, 0.25)' }}>AQ</span>
            AQIfy
          </div>
          <div style={{ marginTop: 42, color: '#7dd3fc', fontSize: 11, fontWeight: 800, letterSpacing: '0.16em' }}>AIR QUALITY, MADE ACTIONABLE</div>
          <h2 style={{ margin: '14px 0 16px', maxWidth: 520, color: '#f8fafc', fontSize: 'clamp(32px, 5vw, 58px)', lineHeight: 1.05, letterSpacing: '-0.06em' }}>
            Make every air-quality decision count.
          </h2>
          <p style={{ maxWidth: 500, color: '#cbd5e1', fontSize: 16, lineHeight: 1.7 }}>
            Sign in to monitor live AQI, understand pollution patterns, and move from a reading to a responsible response.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, maxWidth: 500, marginTop: 32 }}>
            {[
              ['72h', 'Forecast view'],
              ['24/7', 'Live monitoring'],
              ['1 view', 'From signal to action'],
            ].map(([value, label]) => (
              <div key={label} style={{ borderTop: '1px solid rgba(148, 163, 184, 0.28)', paddingTop: 12 }}>
                <strong style={{ display: 'block', color: '#f8fafc', fontSize: 20 }}>{value}</strong>
                <span style={{ display: 'block', marginTop: 3, color: '#94a3b8', fontSize: 11, lineHeight: 1.4 }}>{label}</span>
              </div>
            ))}
          </div>
        </section>

      <div style={{
        width: '100%',
        maxWidth: 460,
        background: 'rgba(15, 23, 42, 0.86)',
        border: '1px solid rgba(148, 163, 184, 0.22)',
        borderRadius: 22,
        boxShadow: '0 24px 90px rgba(0, 0, 0, 0.32)',
        padding: 28,
      }}>
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 13, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#38bdf8', fontWeight: 700 }}>
            AQIfy
          </div>
          <h1 style={{ margin: '10px 0 8px', fontSize: 30, color: '#f8fafc' }}>{title}</h1>
          <p style={{ margin: 0, color: '#cbd5e1', lineHeight: 1.6 }}>{subtitle}</p>
          {onBack && (
            <button type="button" onClick={onBack} style={{ marginTop: 14, padding: 0, border: 0, background: 'transparent', color: '#7dd3fc', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
              ← Back to AQIfy home
            </button>
          )}
        </div>

        <div style={{ display: 'flex', background: '#111827', borderRadius: 14, padding: 6, marginBottom: 20 }}>
          {['login', 'register'].map(option => {
            const active = option === mode
            return (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setMode(option)
                  showError('')
                }}
                style={{
                  flex: 1,
                  border: 'none',
                  borderRadius: 10,
                  background: active ? '#2563eb' : 'transparent',
                  color: active ? '#fff' : '#cbd5e1',
                  fontWeight: 700,
                  padding: '10px 12px',
                  cursor: 'pointer',
                }}
              >
                {option === 'login' ? 'Login' : 'Register'}
              </button>
            )
          })}
        </div>

        <form onSubmit={handleSubmit}>
          {!isLogin && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 8, color: '#cbd5e1', fontSize: 13, fontWeight: 600 }}>Full Name</label>
              <input
                name="full_name"
                value={form.full_name}
                onChange={handleChange}
                placeholder="Jane Doe"
                style={fieldStyle}
              />
            </div>
          )}

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', marginBottom: 8, color: '#cbd5e1', fontSize: 13, fontWeight: 600 }}>Email</label>
            <input
              name="email"
              type="email"
              value={form.email}
              onChange={handleChange}
              placeholder="you@example.com"
              style={fieldStyle}
            />
          </div>

          <div style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <label style={{ color: '#cbd5e1', fontSize: 13, fontWeight: 600 }}>Password</label>
              <button
                type="button"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword(prev => !prev)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: '#cbd5e1',
                  cursor: 'pointer',
                  fontSize: 16,
                  display: 'flex',
                  alignItems: 'center',
                  padding: 0,
                }}
              >
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>
            <input
              name="password"
              type={showPassword ? 'text' : 'password'}
              value={form.password}
              onChange={handleChange}
              placeholder="Enter password"
              style={{ ...fieldStyle, paddingRight: 42 }}
            />
          </div>

          {!isLogin && (
            <div style={{ marginBottom: 18, color: '#94a3b8', fontSize: 12, lineHeight: 1.5 }}>
              New accounts start with Citizen access. Elevated roles are assigned securely by an administrator.
            </div>
          )}

          {error && (
            <div style={{
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              borderRadius: 12,
              color: '#fecaca',
              padding: '10px 12px',
              marginBottom: 16,
              fontSize: 14,
              lineHeight: 1.5,
            }} role="alert" aria-live="polite">
              <div>{error}</div>
              {errorAction === 'login' && (
                <button
                  type="button"
                  onClick={() => {
                    setMode('login')
                    showError('')
                  }}
                  style={{
                    marginTop: 10,
                    border: '1px solid rgba(125, 211, 252, 0.5)',
                    borderRadius: 8,
                    background: 'rgba(14, 116, 144, 0.2)',
                    color: '#bae6fd',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 700,
                    padding: '7px 10px',
                  }}
                >
                  Go to Login
                </button>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              border: 'none',
              borderRadius: 12,
              background: loading ? '#475569' : 'linear-gradient(135deg, #2563eb 0%, #38bdf8 100%)',
              color: '#fff',
              fontWeight: 800,
              padding: '13px 14px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: 15,
              boxShadow: '0 10px 24px rgba(37, 99, 235, 0.35)',
            }}
          >
            {loading ? 'Please wait...' : isLogin ? 'Login to AQIfy' : 'Create Account'}
          </button>
        </form>
      </div>
      </div>
    </div>
  )
}

const fieldStyle = {
  width: '100%',
  boxSizing: 'border-box',
  background: '#0f172a',
  border: '1px solid rgba(148, 163, 184, 0.26)',
  borderRadius: 12,
  color: '#f8fafc',
  padding: '12px 14px',
  fontSize: 14,
  outline: 'none',
}
