/* ═══════════════════════════════════════════════════════════════════════════
   AQIfy — Air Quality Intervention Platform
   ═══════════════════════════════════════════════════════════════════════════ */

import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { fetchJSON, safeLocalStorage } from './lib/api'
import Header from './components/Header'
import CommandCenter from './views/CommandCenter'
import CitizensAdvisoryPopup from './components/widgets/CitizensAdvisoryPopup'
import PersonalAlertSubscriptionPopup from './components/widgets/PersonalAlertSubscriptionPopup'
import EvidenceModal from './components/widgets/EvidenceModal'

const EnforcementView = lazy(() => import('./views/EnforcementView'))

const FORECAST_HOURS = 72

export default function App() {
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

  // Advisory state
  const [advisory, setAdvisory] = useState(null)
  const [advLang, setAdvLang] = useState(() => safeLocalStorage.getItem('aqify_lang') || 'en')
  const [advProfile, setAdvProfile] = useState('healthy_adult')
  const [isAdvisoryOpen, setIsAdvisoryOpen] = useState(false)
  const [isAlertSubscriptionOpen, setIsAlertSubscriptionOpen] = useState(false)

  // Refs for closing popups on clicking outside
  const advisoryRef = useRef(null)
  const subscriptionRef = useRef(null)

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
    if (tab !== 'enforcement') return
    let cancelled = false
    fetchJSON('/api/agents/dispatch?city=all', { method: 'POST' }).then((data) => {
      if (data && !cancelled) setDispatches(data)
    })
    return () => { cancelled = true }
  }, [tab])

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
      />

      <main className="main-content">
        {tab === 'command' && (
          <>
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
        {tab === 'enforcement' && (
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
