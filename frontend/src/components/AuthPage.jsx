import { useMemo, useState } from 'react'

const API = window.location.origin

const initialForm = {
  full_name: '',
  email: '',
  password: '',
  role: 'Citizen',
}

export default function AuthPage({ onAuth }) {
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState(initialForm)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const isLogin = mode === 'login'

  const title = useMemo(() => isLogin ? 'Sign In' : 'Create Account', [isLogin])
  const subtitle = useMemo(() => isLogin
    ? 'Access AQIfy and continue monitoring the city air quality.'
    : 'Create your AQIfy account to receive intervention access and alerts.', [isLogin])

  const handleChange = (event) => {
    const { name, value } = event.target
    setForm(prev => ({ ...prev, [name]: value }))
    if (error) setError('')
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setLoading(true)
    setError('')

    try {
      const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register'
      const payload = isLogin
        ? { email: form.email, password: form.password }
        : { full_name: form.full_name, email: form.email, password: form.password, role: form.role }

      const res = await fetch(`${API}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(data.detail || 'Authentication failed')
      }

      const token = data.token
      const user = data.user
      if (!token || !user) {
        throw new Error('No session returned from the server')
      }

      localStorage.setItem('aqify_auth_token', token)
      localStorage.setItem('aqify_user', JSON.stringify(user))
      onAuth({ token, user })
    } catch (err) {
      setError(err.message || 'Unable to authenticate. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #0f172a 0%, #111827 30%, #1e293b 100%)',
      padding: '24px',
      color: '#e2e8f0',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
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
        </div>

        <div style={{ display: 'flex', background: '#111827', borderRadius: 14, padding: 6, marginBottom: 20 }}>
          {['login', 'register'].map(option => {
            const active = option === mode
            return (
              <button
                key={option}
                type="button"
                onClick={() => setMode(option)}
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
            <div style={{ marginBottom: 18 }}>
              <label style={{ display: 'block', marginBottom: 8, color: '#cbd5e1', fontSize: 13, fontWeight: 600 }}>Role</label>
              <select name="role" value={form.role} onChange={handleChange} style={fieldStyle}>
                <option value="Citizen">Citizen</option>
                <option value="Inspector">Inspector</option>
                <option value="Authority">Authority</option>
              </select>
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
            }}>
              {error}
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
