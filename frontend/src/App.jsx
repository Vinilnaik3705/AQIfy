/* ═══════════════════════════════════════════════════════════════════════════
   AQIfy — Air Quality Intervention Platform
   ═══════════════════════════════════════════════════════════════════════════ */

import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { fetchJSON, safeLocalStorage } from './lib/api'
import Header from './components/Header'
import AuthPage from './components/AuthPage'
import CommandCenter from './views/CommandCenter'
import CitizensAdvisoryPopup from './components/widgets/CitizensAdvisoryPopup'
import PersonalAlertSubscriptionPopup from './components/widgets/PersonalAlertSubscriptionPopup'
import EvidenceModal from './components/widgets/EvidenceModal'

const EnforcementView = lazy(() => import('./views/EnforcementView'))

const FORECAST_HOURS = 72

function InspectorAssignmentsPanel({ work, selectedWard }) {
  if (!work || work.length === 0) {
    return (
      <div style={{
        margin: '18px 0 12px',
        padding: '18px 20px',
        borderRadius: '16px',
        border: '1px solid rgba(148, 163, 184, 0.25)',
        background: 'rgba(15, 23, 42, 0.8)',
        color: '#cbd5e1',
      }}>
        No assigned inspection work is active right now.
      </div>
    )
  }

  const selectedAqi = selectedWard?.aqi_in ?? selectedWard?.current_aqi ?? selectedWard?.aqi ?? null
  const selectedPollutants = selectedWard?.pollutants || {}

  return (
    <div style={{
      margin: '18px 0 12px',
      padding: '18px 20px',
      borderRadius: '16px',
      border: '1px solid rgba(59, 130, 246, 0.28)',
      background: 'rgba(15, 23, 42, 0.8)',
      color: '#e2e8f0',
      boxShadow: '0 18px 44px rgba(15, 23, 42, 0.18)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#f8fafc' }}>Assigned Work</h3>
        <span style={{ fontSize: '12px', color: '#93c5fd', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Inspector View
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '12px' }}>
        {work.map((item) => (
          <div key={item.id} style={{
            background: 'rgba(15, 118, 110, 0.08)',
            border: '1px solid rgba(45, 212, 191, 0.18)',
            borderRadius: '12px',
            padding: '12px 14px',
          }}>
            <div style={{ fontWeight: 800, color: '#f8fafc', marginBottom: 6 }}>{item.location_name || item.location?.name || 'Assigned Location'}</div>
            <div style={{ color: '#cbd5e1', fontSize: '12px', marginBottom: 8 }}>
              {item.suspected_source || 'Source under review'} · {item.severity || 'moderate'}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ color: '#93c5fd', fontSize: '12px' }}>AQI</span>
              <strong style={{ color: '#f8fafc' }}>{Math.round(item.aqi || selectedAqi || 0)}</strong>
            </div>
            <div style={{ color: '#cbd5e1', fontSize: '12px', lineHeight: 1.6 }}>
              {item.description || 'Inspection required for this location.'}
            </div>
          </div>
        ))}
      </div>

      {selectedWard && (
        <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid rgba(148, 163, 184, 0.2)' }}>
          <div style={{ fontSize: '12px', color: '#93c5fd', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10, fontWeight: 700 }}>
            Current Area Conditions
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '12px' }}>
            <div style={{ background: 'rgba(30, 41, 59, 0.7)', borderRadius: '10px', padding: '10px 12px' }}>
              <div style={{ color: '#94a3b8', fontSize: '11px' }}>AQI</div>
              <strong style={{ color: '#f8fafc', fontSize: '18px' }}>{Math.round(selectedAqi || 0)}</strong>
            </div>
            <div style={{ background: 'rgba(30, 41, 59, 0.7)', borderRadius: '10px', padding: '10px 12px' }}>
              <div style={{ color: '#94a3b8', fontSize: '11px' }}>PM2.5</div>
              <strong style={{ color: '#f8fafc', fontSize: '18px' }}>{Math.round(selectedPollutants.pm25 || 0)}</strong>
            </div>
            <div style={{ background: 'rgba(30, 41, 59, 0.7)', borderRadius: '10px', padding: '10px 12px' }}>
              <div style={{ color: '#94a3b8', fontSize: '11px' }}>PM10</div>
              <strong style={{ color: '#f8fafc', fontSize: '18px' }}>{Math.round(selectedPollutants.pm10 || 0)}</strong>
            </div>
            <div style={{ background: 'rgba(30, 41, 59, 0.7)', borderRadius: '10px', padding: '10px 12px' }}>
              <div style={{ color: '#94a3b8', fontSize: '11px' }}>NO₂</div>
              <strong style={{ color: '#f8fafc', fontSize: '18px' }}>{Math.round(selectedPollutants.no2 || 0)}</strong>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function App() {
  const [auth, setAuth] = useState(() => {
    const token = safeLocalStorage.getItem('aqify_auth_token')
    const user = safeLocalStorage.getItem('aqify_user')
    if (!token || !user) return null
    try {
      return { token, user: JSON.parse(user) }
    } catch {
      return null
    }
  })
  const [tab, setTab] = useState('command')
  const [state, setState] = useState(null)
  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState(0)
  const [selectedWard, setSelectedWard] = useState(null)

  // Global search and dynamic places state
  const [customPlaces, setCustomPlaces] = useState([])
  const [targetCenter, setTargetCenter] = useState(null)
  const [targetZoom, setTargetZoom] = useState(3)

  // Forecast state
  const [forecast, setForecast] = useState(null)

  // Enforcement state
  const [dispatches, setDispatches] = useState(null)
  const [evidenceModal, setEvidenceModal] = useState(null)
  const [assignedWork, setAssignedWork] = useState([])

  // Advisory state
  const [advisory, setAdvisory] = useState(null)
  const [advLang, setAdvLang] = useState('en')
  const [advProfile, setAdvProfile] = useState('healthy_adult')
  const [isAdvisoryOpen, setIsAdvisoryOpen] = useState(false)
  const [isAlertSubscriptionOpen, setIsAlertSubscriptionOpen] = useState(false)

  // Refs for closing popups on clicking outside
  const advisoryRef = useRef(null)
  const subscriptionRef = useRef(null)

  const roleName = auth?.user?.role || 'Citizen'
  const canViewEnforcement = roleName === 'Authority' || roleName === 'Admin'

  const handleAuthenticate = useCallback((nextAuth) => {
    setAuth(nextAuth)
  }, [])

  const handleLogout = useCallback(() => {
    safeLocalStorage.removeItem?.('aqify_auth_token')
    safeLocalStorage.removeItem?.('aqify_user')
    setAuth(null)
  }, [])

  const handleToggleAdvisory = useCallback(() => {
    setIsAdvisoryOpen(prev => {
      const next = !prev
      if (next) setIsAlertSubscriptionOpen(false)
      return next
    })
  }, [])

  const handleToggleAlert = useCallback(() => {
    setIsAlertSubscriptionOpen(prev => {
      const next = !prev
      if (next) setIsAdvisoryOpen(false)
      return next
    })
  }, [])

  useEffect(() => {
    function handleClickOutside(event) {
      if (isAdvisoryOpen && advisoryRef.current && !advisoryRef.current.contains(event.target)) {
        setIsAdvisoryOpen(false)
      }
      if (isAlertSubscriptionOpen && subscriptionRef.current && !subscriptionRef.current.contains(event.target)) {
        setIsAlertSubscriptionOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isAdvisoryOpen, isAlertSubscriptionOpen])

  // ── Data Fetching ────────────────────────────────────────────────────

  // Background refresh of live state (does not touch selection)
  const refreshState = useCallback(async () => {
    const data = await fetchJSON('/api/state?city=all')
    if (data) setState(data)
  }, [])

  // Simulated progress bar effect
  useEffect(() => {
    if (!loading) return
    const interval = setInterval(() => {
      setProgress(prev => {
        if (prev < 99) {
          const step = prev < 60 ? Math.floor(Math.random() * 8) + 4 : Math.floor(Math.random() * 3) + 1
          return Math.min(prev + step, 99)
        }
        return prev
      })
    }, 60)
    return () => clearInterval(interval)
  }, [loading])

  // Complete progress bar and release loading screen once API has returned data
  useEffect(() => {
    if (!state || !loading) return
    let release
    const interval = setInterval(() => {
      setProgress(prev => {
        if (prev < 100) return prev + 2
        clearInterval(interval)
        release = setTimeout(() => setLoading(false), 300)
        return prev
      })
    }, 15)
    return () => {
      clearInterval(interval)
      clearTimeout(release)
    }
  }, [state, loading])

  useEffect(() => {
    if (!state) return
    let cancelled = false
    fetchJSON(`/api/forecast?city=all&hours=${FORECAST_HOURS}`).then((data) => {
      if (data && !cancelled) setForecast(data)
    })
    return () => { cancelled = true }
  }, [state])

  useEffect(() => {
    let cancelled = false
    fetchJSON('/api/state?city=all').then((data) => {
      if (!data || cancelled) return
      setState(data)
      if (data.wards?.length) {
        setSelectedWard(data.wards[0])
        setTargetCenter(data.wards[0].center)
        setTargetZoom(5)
      }
    })
    return () => { cancelled = true }
  }, [])

  // Auto-refresh every 30 seconds — paused while the browser tab is hidden
  useEffect(() => {
    const iv = setInterval(() => {
      if (!document.hidden) refreshState()
    }, 30000)
    const onVisible = () => {
      if (!document.hidden) refreshState()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(iv)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refreshState])

  const loadDispatches = useCallback(async () => {
    const data = await fetchJSON('/api/agents/dispatch?city=all', { method: 'POST' })
    if (data) setDispatches(data)
  }, [])

  useEffect(() => {
    if (!auth?.user) return
    if (roleName === 'Inspector' || roleName === 'Authority' || roleName === 'Admin') {
      let cancelled = false
      fetchJSON('/api/interventions').then((data) => {
        if (!cancelled && Array.isArray(data)) {
          setAssignedWork(data)
        }
      })
      return () => { cancelled = true }
    }
    setAssignedWork([])
  }, [auth?.user, roleName])

  useEffect(() => {
    if (!canViewEnforcement || tab !== 'enforcement') return
    let cancelled = false
    fetchJSON('/api/agents/dispatch?city=all', { method: 'POST' }).then((data) => {
      if (data && !cancelled) setDispatches(data)
    })
    return () => { cancelled = true }
  }, [tab, canViewEnforcement])

  const loadAdvisory = useCallback(async (wardId, lang, profile = 'healthy_adult') => {
    const data = await fetchJSON(`/api/agents/advisory?city=all&ward_id=${wardId}&lang=${lang}&profile=${profile}`, { method: 'POST' })
    if (data) setAdvisory(data)
  }, [])

  useEffect(() => {
    if (!isAdvisoryOpen || !selectedWard) return
    let cancelled = false
    fetchJSON(`/api/agents/advisory?city=all&ward_id=${selectedWard.id}&lang=${advLang}&profile=${advProfile}`, { method: 'POST' }).then((data) => {
      if (data && !cancelled) setAdvisory(data)
    })
    return () => { cancelled = true }
  }, [isAdvisoryOpen, selectedWard, advLang, advProfile])

  const handleSelectPlace = async (place) => {
    const data = await fetchJSON(`/api/aqi-details?lat=${place.lat}&lng=${place.lng}&name=${encodeURIComponent(place.name)}&country=${encodeURIComponent(place.country)}&state=${encodeURIComponent(place.state)}`)
    if (data) {
      setCustomPlaces(prev => {
        if (!prev.some(p => p.id === data.id)) {
          return [...prev, data]
        }
        return prev
      })
      setSelectedWard(data)
      setTargetCenter([place.lat, place.lng])
      setTargetZoom(10)
    }
  }

  const handleSelectWard = useCallback(async (ward) => {
    if (!ward) {
      setSelectedWard(null)
      return
    }
    // Set basic info first so the UI responds instantly
    setSelectedWard({
      ...ward,
      weather: { temperature_c: null, wind_speed_kmh: null, loading: true },
    })

    if (ward.center) {
      setTargetCenter(ward.center)
      setTargetZoom(10)
    }

    const data = await fetchJSON(`/api/aqi-details?lat=${ward.center[0]}&lng=${ward.center[1]}&name=${encodeURIComponent(ward.name)}&country=${encodeURIComponent(ward.country || '')}&state=${encodeURIComponent(ward.state || '')}`)
    if (data) {
      // Preserve the original ward id (e.g. "hyderabad_lb_nagar") so forecast
      // lookups can still match ward_id in the forecast wards array.
      setSelectedWard({
        ...data,
        id: ward.id, // keep original ward key for forecast lookup
        ward_key: ward.id,
      })
    }
  }, [])

  // ── Render ───────────────────────────────────────────────────────────

  if (!auth) {
    return <AuthPage onAuth={handleAuthenticate} />
  }

  if (loading) {
    return (
      <div className="aqify-loading-screen">
        <div className="aqify-loader-wrapper">
          <div className="aqify-logo-container">
            <div className="aqify-text-bg">AQIfy</div>
            <div
              className="aqify-text-fg"
              style={{ backgroundPositionY: `${120 - progress * 1.6}px` }}
            >
              AQIfy
            </div>
          </div>
          <div className="aqify-loading-text">loading... {progress}%</div>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <Header
        tab={tab}
        setTab={setTab}
        onSelectPlace={handleSelectPlace}
        wards={state?.wards || []}
        onSelectWard={handleSelectWard}
        onLanguageChange={setAdvLang}
        user={auth.user}
        onLogout={handleLogout}
      />

      <main className="main-content">
        {tab === 'command' && (
          <>
            {roleName === 'Inspector' && (
              <InspectorAssignmentsPanel work={assignedWork} selectedWard={selectedWard} />
            )}
            <div className="title-section">
              <h1 className="main-title">Live Air Quality Map</h1>
              <p className="subtitle">Real-time air quality metrics and AI-driven source analysis.</p>
            </div>
            <CommandCenter
              state={state}
              selectedWard={selectedWard}
              forecast={forecast}
              onSelectWard={handleSelectWard}
              customPlaces={customPlaces}
              targetCenter={targetCenter}
              targetZoom={targetZoom}
              onSelectPlace={handleSelectPlace}
            />
          </>
        )}
        {tab === 'enforcement' && canViewEnforcement && (
          <Suspense
            fallback={
              <div className="view-loading" role="status" aria-live="polite">
                <div className="view-loading-spinner" />
                <span>Loading EnforceHub…</span>
              </div>
            }
          >
            <EnforcementView
              dispatches={dispatches}
              onRefresh={loadDispatches}
              onViewEvidence={setEvidenceModal}
            />
          </Suspense>
        )}
        {tab === 'enforcement' && !canViewEnforcement && (
          <div style={{ padding: '32px 20px', textAlign: 'center', color: '#cbd5e1' }}>
            EnforceHub is available only to authority-level users.
          </div>
        )}
      </main>

      {/* ── Citizens Health Advisory Floating Widget ─────────────────── */}
      <div ref={advisoryRef}>
        <CitizensAdvisoryPopup
          state={state}
          advisory={advisory}
          lang={advLang}
          selectedWard={selectedWard}
          isOpen={isAdvisoryOpen}
          onToggle={handleToggleAdvisory}
        />
      </div>

      {/* ── Personal Alert Subscription Floating Widget ─────────────── */}
      <div ref={subscriptionRef}>
        <PersonalAlertSubscriptionPopup
          state={state}
          profile={advProfile}
          onChangeProfile={setAdvProfile}
          selectedWard={selectedWard}
          lang={advLang}
          isOpen={isAlertSubscriptionOpen}
          onToggle={handleToggleAlert}
          onLoadAdvisory={loadAdvisory}
        />
      </div>

      {/* ── Evidence Modal ───────────────────────────────────────────── */}
      {evidenceModal && (
        <EvidenceModal data={evidenceModal} onClose={() => setEvidenceModal(null)} />
      )}
    </div>
  )
}
