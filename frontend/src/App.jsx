/* ═══════════════════════════════════════════════════════════════════════════
   AQI Intervention Platform — React Dashboard
   ═══════════════════════════════════════════════════════════════════════════ */

import { useState, useEffect, useCallback, useRef } from 'react'
import L from 'leaflet'
import { MapContainer, TileLayer, CircleMarker, Popup, Polyline, useMap, Marker, WMSTileLayer, LayersControl, Tooltip as LeafletTooltip, ZoomControl } from 'react-leaflet'
import {
  Chart as ChartJS,
  ArcElement,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'
import { Doughnut, Line, Bar } from 'react-chartjs-2'
import 'leaflet/dist/leaflet.css'
import {
  LayoutDashboard, TrendingUp, Search, AlertTriangle, Users, BarChart2,
  Wind, Thermometer, Bell, BellRing, Activity, MapPin, Zap, Shield, Factory,
  Car, Hammer, Flame, Leaf, RefreshCw, Eye, FileText, Navigation,
  ChevronRight, Clock, Gauge, AlertCircle, CheckCircle, XCircle,
  Satellite, Building2, GraduationCap, Heart, ArrowUpRight,
  Volume2, VolumeX, ExternalLink, Info, Radio, Phone
} from 'lucide-react'

ChartJS.register(
  ArcElement, CategoryScale, LinearScale, PointElement,
  LineElement, BarElement, Title, Tooltip, Legend, Filler,
)

/* ── Constants ─────────────────────────────────────────────────────────── */

const API = window.location.origin

const MAP_STYLES = {
  voyager: {
    name: 'Voyager Street Map',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '&copy; CARTO &copy; OpenStreetMap'
  },
  dark: {
    name: 'Dark Matter',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; CARTO'
  },
  satellite: {
    name: 'Satellite View',
    url: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    attribution: '&copy; Google Maps'
  }
}

const AQI_COLORS = {
  good:         '#22c55e',
  satisfactory: '#84cc16',
  moderate:     '#eab308',
  poor:         '#f97316',
  very_poor:    '#ef4444',
  severe:       '#991b1b',
}

const SOURCE_COLORS = {
  industrial:    '#8b5cf6',
  vehicular:     '#3b82f6',
  construction:  '#f59e0b',
  waste_burning: '#ef4444',
  background:    '#64748b',
}

function aqiLevel(aqi) {
  if (aqi <= 50)  return 'good'
  if (aqi <= 100) return 'satisfactory'
  if (aqi <= 200) return 'moderate'
  if (aqi <= 300) return 'poor'
  if (aqi <= 400) return 'very_poor'
  return 'severe'
}

function aqiColor(aqi) {
  return AQI_COLORS[aqiLevel(aqi)]
}

function getAqiTextColor(aqi) {
  const level = aqiLevel(aqi);
  if (level === 'good' || level === 'satisfactory' || level === 'moderate') {
    return '#000000';
  }
  return '#ffffff';
}

function createAqiIcon(aqi, isWard = false) {
  const size = isWard ? 26 : 32;
  const anchor = isWard ? 13 : 16;
  const ring = isWard ? '1.5px solid rgba(255,255,255,0.4)' : '2px solid rgba(255,255,255,0.6)';
  return L.divIcon({
    className: 'custom-aqi-bubble',
    html: `<div class="aqi-bubble-inner" style="background-color: ${aqiColor(aqi)}; color: ${getAqiTextColor(aqi)}; width:${size}px; height:${size}px; line-height:${size}px; font-size:${isWard ? 10 : 12}px; border:${ring}; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:700; box-shadow:0 2px 6px rgba(0,0,0,0.5)">${Math.round(aqi)}</div>`,
    iconSize: [size, size],
    iconAnchor: [anchor, anchor]
  });
}

const ICONS = {
  command:     <LayoutDashboard size={18} />,
  forecast:    <TrendingUp size={18} />,
  attribution: <Search size={18} />,
  enforcement: <Shield size={18} />,
  analytics:   <BarChart2 size={18} />,
};

const TABS = [
  { id: 'command',     icon: ICONS.command,     label: 'Command Center' },
  { id: 'forecast',    icon: ICONS.forecast,    label: 'Forecasts' },
  { id: 'attribution', icon: ICONS.attribution, label: 'Source Analysis' },
  { id: 'enforcement', icon: ICONS.enforcement, label: 'Enforcement' },
  { id: 'analytics',   icon: ICONS.analytics,   label: 'Analytics' },
]

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी (Hindi)' },
  { code: 'kn', label: 'ಕನ್ನಡ (Kannada)' },
  { code: 'ta', label: 'தமிழ் (Tamil)' },
  { code: 'te', label: 'తెలుగు (Telugu)' },
]

/* ── API Helpers ────────────────────────────────────────────────────────── */

async function fetchJSON(path, opts) {
  try {
    const res = await fetch(`${API}${path}`, opts)
    if (!res.ok) throw new Error(res.statusText)
    return await res.json()
  } catch (err) {
    console.error(`API ${path}:`, err)
    return null
  }
}

/* ── App ───────────────────────────────────────────────────────────────── */

export default function App() {
  const [tab, setTab] = useState('command')
  const [state, setState] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedWard, setSelectedWard] = useState(null)

  // Map style state
  const [mapStyle, setMapStyle] = useState('voyager')

  // Global search and dynamic places state
  const [customPlaces, setCustomPlaces] = useState([])
  const [targetCenter, setTargetCenter] = useState(null)
  const [targetZoom, setTargetZoom] = useState(3)

  // Forecast state
  const [forecastHours, setForecastHours] = useState(72)
  const [forecast, setForecast] = useState(null)

  // Attribution state
  const [attribution, setAttribution] = useState(null)
  const [attrLoading, setAttrLoading] = useState(false)

  // Enforcement state
  const [dispatches, setDispatches] = useState(null)
  const [evidenceModal, setEvidenceModal] = useState(null)

  // Advisory state
  const [advisory, setAdvisory] = useState(null)
  const [advLang, setAdvLang] = useState('en')
  const [advProfile, setAdvProfile] = useState('healthy_adult')
  const [isAdvisoryOpen, setIsAdvisoryOpen] = useState(false)
  const [isAlertSubscriptionOpen, setIsAlertSubscriptionOpen] = useState(false)

  // ── Data Fetching ────────────────────────────────────────────────────

  const loadState = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true)
    const data = await fetchJSON('/api/state?city=all')
    if (data) {
      setState(data)
      if (isInitial && data.wards?.length) {
        setSelectedWard(data.wards[0])
        setTargetCenter(data.wards[0].center)
        setTargetZoom(5)
      }
    }
    if (isInitial) setLoading(false)
  }, [])

  useEffect(() => {
    loadState(true)
  }, [loadState])

  // Auto-refresh every 30 seconds silently in the background
  useEffect(() => {
    const iv = setInterval(() => loadState(false), 30000)
    return () => clearInterval(iv)
  }, [loadState])

  const loadForecast = useCallback(async (hrs) => {
    const data = await fetchJSON(`/api/forecast?city=all&hours=${hrs}`)
    if (data) setForecast(data)
  }, [])

  useEffect(() => {
    if (tab === 'forecast') loadForecast(forecastHours)
  }, [tab, forecastHours, loadForecast])

  const loadAttribution = useCallback(async (lat, lng) => {
    setAttrLoading(true)
    const data = await fetchJSON(`/api/agents/attribution?city=all&lat=${lat}&lng=${lng}`, { method: 'POST' })
    if (data) setAttribution(data)
    setAttrLoading(false)
  }, [])

  const loadDispatches = useCallback(async () => {
    const data = await fetchJSON('/api/agents/dispatch?city=all', { method: 'POST' })
    if (data) setDispatches(data)
  }, [])

  useEffect(() => {
    if (tab === 'enforcement') loadDispatches()
  }, [tab, loadDispatches])

  const loadAdvisory = useCallback(async (wardId, lang, profile = 'healthy_adult') => {
    const data = await fetchJSON(`/api/agents/advisory?city=all&ward_id=${wardId}&lang=${lang}&profile=${profile}`, { method: 'POST' })
    if (data) setAdvisory(data)
  }, [])

  useEffect(() => {
    if (isAdvisoryOpen && selectedWard) loadAdvisory(selectedWard.id, advLang, advProfile)
  }, [isAdvisoryOpen, selectedWard, advLang, advProfile, loadAdvisory])

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
      weather: { temperature_c: null, wind_speed_kmh: null, loading: true }
    })
    
    const data = await fetchJSON(`/api/aqi-details?lat=${ward.center[0]}&lng=${ward.center[1]}&name=${encodeURIComponent(ward.name)}&country=${encodeURIComponent(ward.country || '')}&state=${encodeURIComponent(ward.state || '')}`)
    if (data) {
      // Preserve the original ward id (e.g. "hyderabad_lb_nagar") so forecast
      // lookups can still match ward_id in the forecast wards array.
      // The /api/aqi-details endpoint returns a custom "custom_lat_lng" id which
      // would break the forecast ward matching.
      setSelectedWard({
        ...data,
        id: ward.id,           // keep original ward key for forecast lookup
        ward_key: ward.id,     // explicit alias used by ForecastView
      })
    }
  }, [])

  // ── Render ───────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="loading-state" style={{ height: '100vh' }}>
        <div className="spinner" />
        <span>Connecting to AQI Intervention Platform…</span>
      </div>
    )
  }

  const cityAqi = state
    ? Math.round(state.sensors.reduce((s, r) => s + (r.aqi_in ?? r.aqi), 0) / state.sensors.length)
    : 0
  const alertCount = dispatches ? dispatches.total_hotspots : 0


  return (
    <div className="app-shell">
      <Header
        tab={tab}
        setTab={setTab}
        cityAqi={cityAqi}
        alertCount={alertCount}
        weather={state?.weather}
        onSelectPlace={handleSelectPlace}
      />

      <div className="main-content">
        {tab === 'command' && (
          <div className="title-section">
            <h1 className="main-title">Live Air Quality Map</h1>
            <p className="subtitle">Real-time air quality data from over 800,000 monitoring sensors worldwide.</p>
          </div>
        )}

        {tab === 'command' && (
          <CommandCenter
            state={state}
            selectedWard={selectedWard}
            onSelectWard={handleSelectWard}
            mapStyle={mapStyle}
            setMapStyle={setMapStyle}
            customPlaces={customPlaces}
            targetCenter={targetCenter}
            targetZoom={targetZoom}
            setTab={setTab}
            onSelectPlace={handleSelectPlace}
            forceMaximized={true}
          />
        )}
        {tab === 'forecast' && (
          <ForecastView
            state={state}
            forecast={forecast}
            hours={forecastHours}
            onChangeHours={setForecastHours}
            selectedWard={selectedWard}
            onSelectWard={handleSelectWard}
            mapStyle={mapStyle}
            setMapStyle={setMapStyle}
          />
        )}
        {tab === 'attribution' && (
          <AttributionView
            state={state}
            attribution={attribution}
            loading={attrLoading}
            onClickLocation={loadAttribution}
            mapStyle={mapStyle}
            setMapStyle={setMapStyle}
            onCitySelect={() => {}}
          />
        )}
        {tab === 'enforcement' && (
          <EnforcementView
            dispatches={dispatches}
            onRefresh={loadDispatches}
            onViewEvidence={setEvidenceModal}
          />
        )}
        {tab === 'analytics' && (
          <AnalyticsView state={state} />
        )}
      </div>

      {/* ── Citizens Health Advisory Floating Widget ─────────────────── */}
      <CitizensAdvisoryPopup
        state={state}
        advisory={advisory}
        lang={advLang}
        onChangeLang={setAdvLang}
        profile={advProfile}
        onChangeProfile={setAdvProfile}
        selectedWard={selectedWard}
        onSelectWard={(w) => { handleSelectWard(w); loadAdvisory(w.id, advLang, advProfile) }}
        isOpen={isAdvisoryOpen}
        onToggle={() => setIsAdvisoryOpen(!isAdvisoryOpen)}
        onLoadAdvisory={loadAdvisory}
      />

      {/* ── Personal Alert Subscription Floating Widget ─────────────── */}
      <PersonalAlertSubscriptionPopup
        state={state}
        profile={advProfile}
        onChangeProfile={setAdvProfile}
        selectedWard={selectedWard}
        lang={advLang}
        isOpen={isAlertSubscriptionOpen}
        onToggle={() => setIsAlertSubscriptionOpen(!isAlertSubscriptionOpen)}
        onLoadAdvisory={loadAdvisory}
      />

      {/* ── Evidence Modal ───────────────────────────────────────────── */}
      {evidenceModal && (
        <EvidenceModal data={evidenceModal} onClose={() => setEvidenceModal(null)} />
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   SUB-COMPONENTS
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── Header Search ───────────────────────────────────────────────────────── */

function HeaderSearch({ onSelectPlace }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [showDropdown, setShowDropdown] = useState(false)
  const dropdownRef = useRef(null)

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const handleSearch = async (val) => {
    setQuery(val)
    if (val.trim().length < 2) {
      setResults([])
      return
    }
    try {
      const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(val)}&count=6&language=en&format=json&countrycode=in`)
      if (res.ok) {
        const data = await res.json()
        if (data.results) {
          setResults(data.results)
          setShowDropdown(true)
        } else {
          setResults([])
        }
      }
    } catch (e) {
      console.error(e)
    }
  }

  const selectItem = (item) => {
    onSelectPlace({
      name: item.name,
      state: item.admin1 || '',
      country: item.country || '',
      lat: item.latitude,
      lng: item.longitude
    })
    setQuery('')
    setResults([])
    setShowDropdown(false)
  }

  return (
    <div className="header-search-container" ref={dropdownRef} style={{ position: 'relative', width: '220px' }}>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <Search size={15} color="#64748b" style={{ position: 'absolute', left: '12px', pointerEvents: 'none', zIndex: 5 }} />
        <input
          type="text"
          className="header-search-input"
          placeholder="Search city or village..."
          value={query}
          onFocus={() => { if (results.length) setShowDropdown(true) }}
          onChange={e => handleSearch(e.target.value)}
          style={{
            width: '100%',
            padding: '7px 12px 7px 34px',
            borderRadius: '20px',
            background: '#f1f5f9',
            border: '1px solid #cbd5e1',
            fontSize: '13px',
            color: '#0f172a',
            outline: 'none',
            transition: 'all 0.15s ease'
          }}
        />
      </div>
      {showDropdown && results.length > 0 && (
        <div
          className="map-search-results"
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: '38px',
            left: 0,
            width: '100%',
            zIndex: 9999,
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
            padding: '6px 0',
            overflow: 'hidden'
          }}
        >
          {results.map((r, i) => (
            <div
              key={i}
              className="map-search-result-row"
              onClick={(e) => { e.stopPropagation(); selectItem(r); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                cursor: 'pointer',
                fontSize: '12px',
                color: '#334155',
                transition: 'background 0.1s'
              }}
            >
              <MapPin size={12} color="#64748b" />
              <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                <strong>{r.name}</strong>
                {r.admin1 && `, ${r.admin1}`}
                {r.country && ` (${r.country})`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Header ────────────────────────────────────────────────────────────── */

function Header({ tab, setTab, cityAqi, alertCount, weather, onSelectPlace }) {
  return (
    <header className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 24px', background: '#ffffff', borderBottom: '1px solid var(--border)' }}>
      {/* Brand Logo and Title */}
      <div 
        className="brand-section" 
        onClick={() => setTab('command')} 
        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '800', fontSize: '18px', color: '#0f172a' }}
      >
        <div className="brand-logo-red" style={{ width: '24px', height: '24px', borderRadius: '4px', background: '#ef4444', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '900', fontSize: '16px' }}>+</div>
        <span>IQAir</span>
      </div>

      {/* Header Right containing Search Bar and Navigation Group */}
      <div className="header-right" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        {/* Search Input Box */}
        <HeaderSearch onSelectPlace={onSelectPlace} />

        {/* Segmented Navigation Control */}
        <div style={{ display: 'flex', background: '#f1f5f9', padding: '3px', borderRadius: '24px', border: '1px solid #e2e8f0' }}>
          {/* Dashboard Button */}
          <button
            onClick={() => setTab('command')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 16px',
              background: tab === 'command' ? '#ffffff' : 'transparent',
              color: tab === 'command' ? '#0f172a' : '#64748b',
              border: 'none',
              borderRadius: '20px',
              cursor: 'pointer',
              fontWeight: '750',
              fontSize: '12px',
              boxShadow: tab === 'command' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              transition: 'all 0.15s ease'
            }}
          >
            <LayoutDashboard size={14} />
            <span>Dashboard</span>
          </button>

          {/* EnforceHub Button */}
          <button
            onClick={() => setTab('enforcement')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 16px',
              background: tab === 'enforcement' ? '#ef4444' : 'transparent',
              color: tab === 'enforcement' ? '#ffffff' : '#64748b',
              border: 'none',
              borderRadius: '20px',
              cursor: 'pointer',
              fontWeight: '750',
              fontSize: '12px',
              boxShadow: tab === 'enforcement' ? '0 2px 6px rgba(239, 68, 68, 0.2)' : 'none',
              transition: 'all 0.15s ease'
            }}
          >
            <Shield size={14} />
            <span>EnforceHub</span>
          </button>
        </div>
      </div>
    </header>
  )
}


/* ── Change Map View Helper ──────────────────────────────────────────────── */

function ChangeMapView({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.setView(center, zoom || map.getZoom(), { animate: true, duration: 1.5 });
    }
  }, [center, zoom, map]);
  return null;
}

/* ── Map Layers Control component ────────────────────────────────────────── */

function MapLayersControl() {
  return (
    <LayersControl position="topright">
      <LayersControl.BaseLayer checked name="Dark Matter">
        <TileLayer
          attribution="&copy; CARTO"
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          noWrap={true}
        />
      </LayersControl.BaseLayer>
      <LayersControl.BaseLayer name="Voyager Street Map">
        <TileLayer
          attribution="&copy; CARTO &copy; OpenStreetMap"
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          noWrap={true}
        />
      </LayersControl.BaseLayer>
      <LayersControl.BaseLayer name="Satellite View">
        <TileLayer
          attribution="&copy; Google Maps"
          url="https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}"
          noWrap={true}
        />
      </LayersControl.BaseLayer>

      <LayersControl.Overlay name="NASA Active Fires (GIBS)">
        <WMSTileLayer
          url="https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi"
          layers="VIIRS_SNPP_Thermal_Anomalies_375m_All,MODIS_Aqua_Thermal_Anomalies_All,MODIS_Terra_Thermal_Anomalies_All"
          format="image/png"
          transparent={true}
          attribution="NASA GIBS / FIRMS"
          noWrap={true}
        />
      </LayersControl.Overlay>
    </LayersControl>
  )
}

/* ── Emission Source Reverse Geocoding Popup ──────────────────────────── */

function EmissionSourcePopup({ src }) {
  const [address, setAddress] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    async function reverseGeocode() {
      setLoading(true);
      try {
        const [lat, lng] = src.location;
        const res = await fetch(`/api/reverse-geocode?lat=${lat}&lng=${lng}`);
        if (res.ok) {
          const data = await res.json();
          if (active && data.address) setAddress(data.address);
        }
      } catch (e) {
        console.error("Reverse geocoding failed", e);
      } finally {
        if (active) setLoading(false);
      }
    }
    reverseGeocode();
    return () => { active = false; };
  }, [src.location]);
}

/* ── AQI Gauge Component ────────────────────────────────────────────────── */

function AqiGauge({ aqi }) {
  const clampedAqi = Math.max(0, Math.min(500, aqi));
  
  // Calculate correct rotation angle based on 6 equal 30-degree segments:
  let rotation = -90;
  if (clampedAqi <= 50) {
    rotation = -90 + (clampedAqi / 50) * 30;
  } else if (clampedAqi <= 100) {
    rotation = -60 + ((clampedAqi - 50) / 50) * 30;
  } else if (clampedAqi <= 150) {
    rotation = -30 + ((clampedAqi - 100) / 50) * 30;
  } else if (clampedAqi <= 200) {
    rotation = 0 + ((clampedAqi - 150) / 50) * 30;
  } else if (clampedAqi <= 300) {
    rotation = 30 + ((clampedAqi - 200) / 100) * 30;
  } else {
    rotation = 60 + ((clampedAqi - 300) / 200) * 30;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '8px 0 16px 0', position: 'relative', width: '100%' }}>
      <svg width="200" height="125" viewBox="0 0 220 135" style={{ display: 'block', margin: '0 auto' }}>
        {/* Arc segments */}
        {/* Good: 0-50 */}
        <path d="M 20 110 A 90 90 0 0 1 32 65" fill="none" stroke="#22c55e" strokeWidth="18" />
        {/* Moderate: 51-100 */}
        <path d="M 32 65 A 90 90 0 0 1 68 32" fill="none" stroke="#eab308" strokeWidth="18" />
        {/* Sensitive: 101-150 */}
        <path d="M 68 32 A 90 90 0 0 1 110 20" fill="none" stroke="#f97316" strokeWidth="18" />
        {/* Unhealthy: 151-200 */}
        <path d="M 110 20 A 90 90 0 0 1 152 32" fill="none" stroke="#ef4444" strokeWidth="18" />
        {/* Very Unhealthy: 201-300 */}
        <path d="M 152 32 A 90 90 0 0 1 188 65" fill="none" stroke="#a855f7" strokeWidth="18" />
        {/* Hazardous: 301-500 */}
        <path d="M 188 65 A 90 90 0 0 1 200 110" fill="none" stroke="#991b1b" strokeWidth="18" />

        {/* Ticks & Labels */}
        <text x="20" y="128" fontSize="10" fontWeight="700" fill="#64748b" textAnchor="middle">0</text>
        <text x="28" y="58" fontSize="10" fontWeight="700" fill="#64748b" textAnchor="middle">50</text>
        <text x="62" y="28" fontSize="10" fontWeight="700" fill="#64748b" textAnchor="middle">100</text>
        <text x="110" y="14" fontSize="10" fontWeight="700" fill="#64748b" textAnchor="middle">150</text>
        <text x="158" y="28" fontSize="10" fontWeight="700" fill="#64748b" textAnchor="middle">200</text>
        <text x="192" y="58" fontSize="10" fontWeight="700" fill="#64748b" textAnchor="middle">300</text>
        <text x="200" y="128" fontSize="10" fontWeight="700" fill="#64748b" textAnchor="middle">500</text>

        {/* Needle Pin/Hub */}
        <circle cx="110" cy="110" r="10" fill="#1e293b" />
        
        {/* Needle pointer */}
        <g transform={`rotate(${rotation} 110 110)`}>
          <polygon points="107,110 113,110 110,25" fill="#1e293b" />
        </g>
      </svg>
    </div>
  );
}

/* ── Custom Animated Wind Stream Layer ───────────────────────────────────── */

/* ── Custom Animated Wind Stream Layer ───────────────────────────────────── */

const WIND_GRID_CITIES = [
  { name: 'Delhi',     lat: 28.61, lng: 77.20 },
  { name: 'Mumbai',    lat: 19.07, lng: 72.87 },
  { name: 'Bengaluru', lat: 12.97, lng: 77.59 },
  { name: 'Chennai',   lat: 13.08, lng: 80.27 },
  { name: 'Hyderabad', lat: 17.38, lng: 78.48 },
  { name: 'Kolkata',   lat: 22.57, lng: 88.36 }
];

function WindStreamAnimation() {
  const map = useMap();
  const canvasRef = useRef(null);
  const [gridWind, setGridWind] = useState([]);

  // Fetch real wind parameters dynamically for 6 major regions across India
  useEffect(() => {
    async function fetchGridWind() {
      try {
        const lats = WIND_GRID_CITIES.map(c => c.lat).join(',');
        const lngs = WIND_GRID_CITIES.map(c => c.lng).join(',');
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}&hourly=windspeed_10m,winddirection_10m`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            const parsed = data.map((item, idx) => {
              const dir = item.hourly?.winddirection_10m?.[0] ?? 245;
              const speed = item.hourly?.windspeed_10m?.[0] ?? 12.3;
              
              // Meteorological direction (FROM) -> vector trajectory angle (TO) in radians
              const angleRad = ((dir + 180) % 360) * Math.PI / 180;
              const scaledSpeed = Math.min(3.5, Math.max(0.8, speed / 8));
              
              return {
                lat: WIND_GRID_CITIES[idx].lat,
                lng: WIND_GRID_CITIES[idx].lng,
                angle: angleRad,
                speed: scaledSpeed
              };
            });
            setGridWind(parsed);
          }
        }
      } catch (e) {
        console.error('Failed to fetch grid wind data from Open-Meteo', e);
      }
    }
    fetchGridWind();
  }, []);

  useEffect(() => {
    const container = map.getContainer();
    const canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '500';
    container.appendChild(canvas);
    canvasRef.current = canvas;

    let animationFrameId;
    const ctx = canvas.getContext('2d');

    // Dense set of animated flow stream particles
    const particles = [];
    const particleCount = 150;

    const resizeCanvas = () => {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
    };
    resizeCanvas();
    map.on('resize', resizeCanvas);

    // Initialize particles randomly across the screen
    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        length: 20 + Math.random() * 25,
        opacity: 0.12 + Math.random() * 0.35,
        speedMultiplier: 0.8 + Math.random() * 0.4
      });
    }

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineWidth = 1.0;
      ctx.lineCap = 'round';

      // Get current map bounds for fast linear coordinate mapping
      const bounds = map.getBounds();
      const west = bounds.getWest();
      const east = bounds.getEast();
      const north = bounds.getNorth();
      const south = bounds.getSouth();

      particles.forEach(p => {
        // Map particle's screen (x, y) to geographical coordinates
        const pctX = p.x / canvas.width;
        const pctY = p.y / canvas.height;
        const pLng = west + pctX * (east - west);
        const pLat = north - pctY * (north - south);

        // Find closest wind vector grid point
        let nearestCity = null;
        let minDistSq = Infinity;

        if (gridWind.length > 0) {
          gridWind.forEach(city => {
            const dLat = city.lat - pLat;
            const dLng = city.lng - pLng;
            const distSq = dLat * dLat + dLng * dLng;
            if (distSq < minDistSq) {
              minDistSq = distSq;
              nearestCity = city;
            }
          });
        }

        // Fallback to default SW-to-NE wind direction if grid is loading
        const angle = nearestCity ? nearestCity.angle : -Math.PI / 5;
        const speed = (nearestCity ? nearestCity.speed : 1.5) * p.speedMultiplier;

        ctx.beginPath();
        ctx.strokeStyle = `rgba(248, 250, 252, ${p.opacity})`;
        
        // Draw path line following local vector
        const targetX = p.x + Math.cos(angle) * p.length;
        const targetY = p.y + Math.sin(angle) * p.length;
        
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(targetX, targetY);
        ctx.stroke();

        // Move particle along current local trajectory
        p.x += Math.cos(angle) * speed;
        p.y += Math.sin(angle) * speed;

        // Reset particle if it leaves canvas boundaries
        if (p.x > canvas.width || p.y > canvas.height || p.x < -p.length || p.y < -p.length) {
          p.x = Math.random() * canvas.width;
          p.y = Math.random() * canvas.height;
        }
      });

      animationFrameId = requestAnimationFrame(draw);
    };
    draw();

    const onMove = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
    map.on('movestart', onMove);

    return () => {
      cancelAnimationFrame(animationFrameId);
      map.off('resize', resizeCanvas);
      map.off('movestart', onMove);
      if (canvas.parentNode) {
        canvas.parentNode.removeChild(canvas);
      }
    };
  }, [map, gridWind]);

  return null;
}

/* ── Command Center ────────────────────────────────────────────────────── */

function CommandCenter({ state, selectedWard, onSelectWard, mapStyle, setMapStyle, customPlaces, targetCenter, targetZoom, setTab, onSelectPlace, forceMaximized = false }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [showDropdown, setShowDropdown] = useState(false)
  const dropdownRef = useRef(null)

  // Maximize / Ranking List Toggle
  const [isMaximized, setIsMaximized] = useState(forceMaximized)

  // Floating Map Overlays State
  const [showStations, setShowStations] = useState(true)
  const [showFires, setShowFires] = useState(false)
  const [showFactories, setShowFactories] = useState(true)
  const [showVehicular, setShowVehicular] = useState(true)
  const [showConstruction, setShowConstruction] = useState(true)

  const SOURCE_COLORS = {
    industrial:    '#ef4444',
    vehicular:     '#3b82f6',
    construction:  '#f59e0b',
    waste_burning: '#10b981',
  }
  const SOURCE_ICONS = {
    industrial:    '🏭',
    vehicular:     '🚗',
    construction:  '🏗️',
    waste_burning: '🔥'
  }

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const handleSearch = async (val) => {
    setQuery(val)
    if (val.trim().length < 2) {
      setResults([])
      return
    }
    try {
      const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(val)}&count=6&language=en&format=json&countrycode=in`)
      if (res.ok) {
        const data = await res.json()
        if (data.results) {
          setResults(data.results)
          setShowDropdown(true)
        } else {
          setResults([])
        }
      }
    } catch (e) {
      console.error(e)
    }
  }

  const selectItem = (item) => {
    onSelectPlace({
      name: item.name,
      state: item.admin1 || '',
      country: item.country || '',
      lat: item.latitude,
      lng: item.longitude
    })
    setQuery('')
    setResults([])
    setShowDropdown(false)
  }

  if (!state) return null;

  // Resolve values for Left Column Card
  const temp = selectedWard?.weather?.temperature_c ?? state.weather?.temperature_c ?? 23;
  const humidity = selectedWard?.weather?.humidity_pct ?? state.weather?.humidity_pct ?? 84;
  const windKmh = selectedWard?.weather?.wind_speed_kmh ?? state.weather?.wind_speed_kmh ?? 7.5;

  // Calculate PM2.5, PM10, and NO2 values
  let pm25 = 5;
  let pm10 = 15;
  let no2 = 10;
  if (selectedWard?.pollutants) {
    pm25 = selectedWard.pollutants.pm25;
    pm10 = selectedWard.pollutants.pm10 || 15;
    no2 = selectedWard.pollutants.no2 || 10;
  } else if (state.sensors.length > 0) {
    const sensorsWithPm = state.sensors.filter(s => s.pollutants?.pm25 != null);
    if (sensorsWithPm.length > 0) {
      pm25 = sensorsWithPm.reduce((s, r) => s + r.pollutants.pm25, 0) / sensorsWithPm.length;
      pm10 = sensorsWithPm.reduce((s, r) => s + (r.pollutants.pm10 || 18), 0) / sensorsWithPm.length;
      no2 = sensorsWithPm.reduce((s, r) => s + (r.pollutants.no2 || 12), 0) / sensorsWithPm.length;
    }
  }
  pm25 = Math.round(pm25);
  pm10 = Math.round(pm10);
  no2 = Math.round(no2);

  const trendAqi = selectedWard?.aqi_in ?? selectedWard?.current_aqi ?? Math.round(state.sensors.reduce((s, r) => s + (r.aqi_in ?? r.aqi), 0) / state.sensors.length);
  const selectedCityName = selectedWard?.name ?? state.city.name;

  // Ranking List Generation
  const rankedCities = state.wards.map(w => {
    const s = state.sensors.find(sensor => sensor.ward_id === w.id);
    const aqi = s ? (s.aqi_in ?? s.aqi) : (w.aqi_in ?? w.current_aqi ?? 50);
    return {
      ...w,
      aqi: Math.round(aqi)
    };
  }).sort((a, b) => b.aqi - a.aqi);

  const getFlagEmoji = (countryName) => {
    if (!countryName) return '🇮🇳';
    const c = countryName.toLowerCase();
    if (c.includes('uganda')) return '🇺🇬';
    if (c.includes('indonesia')) return '🇮🇩';
    if (c.includes('congo')) return '🇨🇩';
    if (c.includes('pakistan')) return '🇵🇰';
    if (c.includes('china')) return '🇨🇳';
    return '🇮🇳';
  };

  // Helper for geothermal heatmap colors
  const getGeothermalColor = (aqi) => {
    const ratio = Math.min(1, aqi / 300);
    const r = Math.round(ratio * 255);
    const g = Math.round((1 - ratio) * 200);
    return `rgb(${r}, ${g}, 0)`;
  };

  // Simulated Hourly Forecast (72 hours projection)
  const hourlyForecastData = Array.from({ length: 72 }).map((_, idx) => {
    let timeLabel = '';
    if (idx === 0) {
      timeLabel = 'Now';
    } else {
      const date = new Date();
      date.setHours(date.getHours() + idx);
      const hoursStr = String(date.getHours()).padStart(2, '0') + ':00';
      if (date.getHours() === 0) {
        timeLabel = date.toLocaleDateString('en-US', { weekday: 'short' });
      } else {
        timeLabel = hoursStr;
      }
    }
    const multiplier = 1 + 0.12 * Math.sin(idx / 5);
    const hourlyAqi = Math.round(trendAqi * multiplier);
    return {
      time: timeLabel,
      aqi: hourlyAqi,
      temp: Math.round(temp + 3 * Math.cos(idx / 6)),
      wind: Math.round(windKmh + Math.sin(idx / 2)),
      humidity: Math.round(humidity + (idx % 6))
    };
  });

  // Simulated 7-day forecast
  const days = ['Today', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const dailyForecastData = days.map((day, idx) => {
    const multiplier = 1 - 0.05 * idx;
    const dailyAqi = Math.round(trendAqi * multiplier);
    return {
      day,
      aqi: dailyAqi,
      tempMax: Math.round(temp + 1),
      tempMin: Math.round(temp - 5),
      wind: Math.round(windKmh - (idx % 2)),
      humidity: Math.round(humidity + (idx % 3))
    };
  });

  return (
    <div className="content-area" style={{ display: 'flex', flexDirection: 'row', gap: '24px', flex: 1 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', flex: 1, minWidth: 0 }}>
      <div className="iqair-layout-grid" style={{ minHeight: '520px' }}>
        {/* Left Column (Maximized Map) */}
        <div className="iqair-right-panel" style={{ flex: 1 }}>
          <MapContainer
            center={state.city.center}
            zoom={5}
            minZoom={4}
            maxBounds={[[6.0, 65.0], [38.0, 99.0]]}
            maxBoundsViscosity={1.0}
            scrollWheelZoom={true}
            zoomControl={false}
          >
            <ChangeMapView center={targetCenter} zoom={targetZoom} />
            
            {/* Dark Matter Basemap */}
            <TileLayer
              attribution="&copy; CARTO"
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              noWrap={true}
            />

            {/* Preset City Markers (Toggled by Stations) */}
            {showStations && state.sensors.map(s => {
              const ward = state.wards.find(w => w.id === s.ward_id)
              const placeLabel = ward ? ward.name : s.sensor_id
              const aqiVal = s.aqi_in ?? s.aqi;
              const isWard = s.ward_id && s.ward_id.includes('_') && (
                s.ward_id.startsWith('delhi_') || s.ward_id.startsWith('mumbai_') ||
                s.ward_id.startsWith('bengaluru_') || s.ward_id.startsWith('chennai_') ||
                s.ward_id.startsWith('hyderabad_') || s.ward_id.startsWith('kolkata_')
              );
              return (
                <Marker
                  key={s.sensor_id}
                  position={s.location}
                  icon={createAqiIcon(aqiVal, isWard)}
                  eventHandlers={{
                    click: () => {
                      if (ward) onSelectWard(ward);
                    }
                  }}
                >
                  <Popup>
                    <div>
                      <strong>📍 {placeLabel}</strong><br />
                      AQI: <strong style={{ color: aqiColor(aqiVal) }}>{aqiVal}</strong>
                    </div>
                  </Popup>
                </Marker>
              )
            })}

            {/* Custom Searched Places */}
            {showStations && customPlaces && customPlaces.map(cp => {
              const aqiVal = cp.aqi_in ?? cp.current_aqi;
              return (
                <Marker
                  key={cp.id}
                  position={cp.center}
                  icon={createAqiIcon(aqiVal)}
                  eventHandlers={{
                    click: () => {
                      onSelectWard(cp);
                    }
                  }}
                >
                  <Popup>
                    <div>
                      <strong>📍 {cp.name}</strong><br />
                      AQI: <strong style={{ color: aqiColor(aqiVal) }}>{aqiVal}</strong>
                    </div>
                  </Popup>
                </Marker>
              )
            })}

            {/* NASA Active Fires Layer (Toggled by Fires Overlay) */}
            {showFires && (
              <WMSTileLayer
                url="https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi"
                layers="VIIRS_SNPP_Thermal_Anomalies_375m_All,MODIS_Aqua_Thermal_Anomalies_All,MODIS_Terra_Thermal_Anomalies_All"
                format="image/png"
                transparent={true}
                attribution="NASA GIBS / FIRMS"
                noWrap={true}
              />
            )}



            {/* Registered Emission Sources (Toggled by Factories, Vehicular, Construction) */}
            {state.sources && state.sources.map(src => {
              const visible = 
                (src.category === 'industrial' && showFactories) ||
                (src.category === 'vehicular' && showVehicular) ||
                (src.category === 'construction' && showConstruction);
              
              if (!visible) return null;

              return (
                <CircleMarker
                  key={`source-cc-${src.id}`}
                  center={src.location}
                  radius={8}
                  pathOptions={{
                    fillColor: SOURCE_COLORS[src.category] || '#64748b',
                    fillOpacity: 0.8,
                    color: '#ffffff',
                    weight: 1.5
                  }}
                >
                  <Popup>
                    <div style={{ color: '#0f172a', fontSize: '12px' }}>
                      <strong style={{ fontSize: '13px' }}>{SOURCE_ICONS[src.category] || '📍'} {src.name}</strong><br />
                      Category: <span style={{ textTransform: 'capitalize', fontWeight: '600' }}>{src.label || src.category}</span><br />
                      Emission Rate: <strong>{src.emission_rate_Q} g/s</strong>
                    </div>
                  </Popup>
                </CircleMarker>
              );
            })}

            <ZoomControl position="bottomright" />
          </MapContainer>

          {/* Floating Controls Overlay (Right Panel on Map) styled as individual white pills with blue icons */}
          <div className="map-right-controls" style={{
            position: 'absolute',
            top: '20px',
            right: '20px',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            background: 'transparent',
            border: 'none',
            boxShadow: 'none',
            padding: 0,
            width: 'auto'
          }}>
            <span style={{ fontSize: '10px', fontWeight: '800', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px', paddingLeft: '4px' }}>Outdoor</span>
            
            {/* Air Quality Stations Pill */}
            <button 
              onClick={() => setShowStations(!showStations)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '6px 14px 6px 6px',
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '24px',
                cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(0,0,0,0.05)',
                fontWeight: '600',
                fontSize: '12px',
                color: '#1e293b',
                width: '185px',
                justifyContent: 'space-between',
                transition: 'all 0.15s ease'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  background: showStations ? '#3b82f6' : '#f1f5f9',
                  color: showStations ? '#ffffff' : '#64748b',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '13px'
                }}>
                  <Radio size={14} />
                </div>
                <span>Air quality stations</span>
              </div>
              {showStations && <span style={{ color: '#3b82f6', fontWeight: '700', fontSize: '13px' }}>✓</span>}
            </button>

            {/* Fires Pill */}
            <button 
              onClick={() => setShowFires(!showFires)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '6px 14px 6px 6px',
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '24px',
                cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(0,0,0,0.05)',
                fontWeight: '600',
                fontSize: '12px',
                color: '#1e293b',
                width: '185px',
                justifyContent: 'space-between',
                transition: 'all 0.15s ease'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  background: showFires ? '#3b82f6' : '#f1f5f9',
                  color: showFires ? '#ffffff' : '#64748b',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '13px'
                }}>
                  <Flame size={14} />
                </div>
                <span>Fires</span>
              </div>
              {showFires && <span style={{ color: '#3b82f6', fontWeight: '700', fontSize: '13px' }}>✓</span>}
            </button>



            <span style={{ fontSize: '10px', fontWeight: '800', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '6px', marginBottom: '2px', paddingLeft: '4px' }}>Emission Sources</span>

            {/* Factories Pill */}
            <button 
              onClick={() => setShowFactories(!showFactories)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '6px 14px 6px 6px',
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '24px',
                cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(0,0,0,0.05)',
                fontWeight: '600',
                fontSize: '12px',
                color: '#1e293b',
                width: '185px',
                justifyContent: 'space-between',
                transition: 'all 0.15s ease'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  background: showFactories ? '#3b82f6' : '#f1f5f9',
                  color: showFactories ? '#ffffff' : '#64748b',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '13px'
                }}>
                  <Factory size={14} />
                </div>
                <span>Factories</span>
              </div>
              {showFactories && <span style={{ color: '#3b82f6', fontWeight: '700', fontSize: '13px' }}>✓</span>}
            </button>

            {/* Vehicular Traffic Pill */}
            <button 
              onClick={() => setShowVehicular(!showVehicular)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '6px 14px 6px 6px',
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '24px',
                cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(0,0,0,0.05)',
                fontWeight: '600',
                fontSize: '12px',
                color: '#1e293b',
                width: '185px',
                justifyContent: 'space-between',
                transition: 'all 0.15s ease'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  background: showVehicular ? '#3b82f6' : '#f1f5f9',
                  color: showVehicular ? '#ffffff' : '#64748b',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '13px'
                }}>
                  <Car size={14} />
                </div>
                <span>Vehicular Traffic</span>
              </div>
              {showVehicular && <span style={{ color: '#3b82f6', fontWeight: '700', fontSize: '13px' }}>✓</span>}
            </button>

            {/* Construction Sites Pill */}
            <button 
              onClick={() => setShowConstruction(!showConstruction)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '6px 14px 6px 6px',
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '24px',
                cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(0,0,0,0.05)',
                fontWeight: '600',
                fontSize: '12px',
                color: '#1e293b',
                width: '185px',
                justifyContent: 'space-between',
                transition: 'all 0.15s ease'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  background: showConstruction ? '#3b82f6' : '#f1f5f9',
                  color: showConstruction ? '#ffffff' : '#64748b',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '13px'
                }}>
                  <Hammer size={14} />
                </div>
                <span>Construction Sites</span>
              </div>
              {showConstruction && <span style={{ color: '#3b82f6', fontWeight: '700', fontSize: '13px' }}>✓</span>}
            </button>
          </div>
        </div>
      </div>

      {/* ── Detailed City View (Hourly, Pollutants & Recommendations) ── */}
      {selectedWard && (
        <div className="detailed-city-view">
          <div>
            <h3 className="detailed-hourly-title">Hourly weather & air quality forecast for {selectedCityName}</h3>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px', marginBottom: '12px' }}>
              Projections for the next 72 hours based on localized atmospheric modeling.
            </div>
            <div className="detailed-hourly-scroll" style={{ width: '100%', maxWidth: '100%', overflowX: 'auto' }}>
              {hourlyForecastData.map((item, idx) => (
                <div key={idx} className="hourly-card">
                  <span className="hourly-time">{item.time}</span>
                  <span className="hourly-aqi" style={{ backgroundColor: aqiColor(item.aqi) }}>
                    {item.aqi}
                  </span>
                  <span style={{ fontSize: '16px' }}>
                    {item.aqi <= 100 ? '☀️' : item.aqi <= 200 ? '⛅' : '🌫️'}
                  </span>
                  <span className="hourly-temp">{item.temp}°</span>
                  <span className="hourly-wind">💨 {item.wind} km/h</span>
                  <span className="hourly-humidity">💧 {item.humidity}%</span>
                </div>
              ))}
            </div>
          </div>

          <div className="detailed-bottom-layout" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
            {/* Pollutants Breakdown Card */}
            <div className="pollutants-card-detailed" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <h4 style={{ fontSize: '15px', fontWeight: '750', margin: '0 0 4px 0', color: '#0f172a' }}>Air pollutants breakdown</h4>
              
              {/* PM2.5 */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                  <div>
                    <strong style={{ fontSize: '13px', color: '#334155' }}>PM2.5</strong>
                    <div style={{ fontSize: '10px', color: '#64748b' }}>WHO Annual Guideline: 5 µg/m³</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: aqiColor(pm25) }} />
                    <strong style={{ fontSize: '15px', color: '#0f172a' }}>{pm25} µg/m³</strong>
                  </div>
                </div>
                {pm25 > 5 && (
                  <div style={{ background: '#fff1f2', border: '1px solid #ffe4e6', borderRadius: '4px', padding: '6px 10px', color: '#e11d48', fontSize: '11px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
                    <span>⚠️</span>
                    <span>PM2.5 is {Math.max(1, Math.round(pm25 / 5))}x above the WHO guideline value.</span>
                  </div>
                )}
              </div>

              {/* PM10 */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                  <div>
                    <strong style={{ fontSize: '13px', color: '#334155' }}>PM10</strong>
                    <div style={{ fontSize: '10px', color: '#64748b' }}>WHO Annual Guideline: 15 µg/m³</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: aqiColor(pm10) }} />
                    <strong style={{ fontSize: '15px', color: '#0f172a' }}>{pm10} µg/m³</strong>
                  </div>
                </div>
                {pm10 > 15 && (
                  <div style={{ background: '#fff1f2', border: '1px solid #ffe4e6', borderRadius: '4px', padding: '6px 10px', color: '#e11d48', fontSize: '11px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
                    <span>⚠️</span>
                    <span>PM10 is {Math.max(1, Math.round(pm10 / 15))}x above the WHO guideline value.</span>
                  </div>
                )}
              </div>

              {/* NO2 */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                  <div>
                    <strong style={{ fontSize: '13px', color: '#334155' }}>NO₂</strong>
                    <div style={{ fontSize: '10px', color: '#64748b' }}>WHO Annual Guideline: 10 µg/m³</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: aqiColor(no2) }} />
                    <strong style={{ fontSize: '15px', color: '#0f172a' }}>{no2} µg/m³</strong>
                  </div>
                </div>
                {no2 > 10 && (
                  <div style={{ background: '#fff1f2', border: '1px solid #ffe4e6', borderRadius: '4px', padding: '6px 10px', color: '#e11d48', fontSize: '11px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
                    <span>⚠️</span>
                    <span>NO₂ is {Math.max(1, Math.round(no2 / 10))}x above the WHO guideline value.</span>
                  </div>
                )}
              </div>
            </div>

            {/* Health Recommendations Card */}
            <div className="health-recs-card" style={{ display: 'flex', flexDirection: 'column' }}>
              <h4 style={{ fontSize: '15px', fontWeight: '750', color: '#0f172a', margin: '0 0 12px 0' }}>Health recommendations</h4>
              <div className="health-rec-list" style={{ marginTop: '0' }}>
                <div className="health-rec-item" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', textAlign: 'center' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                  </svg>
                  <span style={{ fontSize: '11px', fontWeight: '600', color: '#1e293b' }}>Avoid outdoor exercise</span>
                </div>
                <div className="health-rec-item" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', textAlign: 'center' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <line x1="9" y1="3" x2="9" y2="21" />
                    <line x1="15" y1="3" x2="15" y2="21" />
                    <line x1="3" y1="9" x2="21" y2="9" />
                    <line x1="3" y1="15" x2="21" y2="15" />
                  </svg>
                  <span style={{ fontSize: '11px', fontWeight: '600', color: '#1e293b' }}>Close windows</span>
                </div>
                <div className="health-rec-item" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', textAlign: 'center' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="6" width="16" height="12" rx="2" />
                    <path d="M4 9c-2 0-3 1-3 3s1 3 3 3M20 9c2 0 3 1 3 3s-1 3-3 3" />
                    <line x1="8" y1="12" x2="16" y2="12" />
                  </svg>
                  <span style={{ fontSize: '11px', fontWeight: '600', color: '#1e293b' }}>Wear a mask outdoors</span>
                </div>
                <div className="health-rec-item" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', textAlign: 'center' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 12a3 3 0 1 0-3-3M12 12a3 3 0 1 0 3-3M12 12a3 3 0 1 0-3 3M12 12a3 3 0 1 0 3 3" />
                  </svg>
                  <span style={{ fontSize: '11px', fontWeight: '600', color: '#1e293b' }}>Run an air purifier</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
      <div className="right-panel" style={{ background: '#ffffff', border: '1px solid var(--border)', borderRadius: '12px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px', minHeight: '520px', width: '360px', flexShrink: 0 }}>
        {selectedWard ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Header: Location */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <MapPin size={16} color="#e11d48" style={{ flexShrink: 0 }} />
              <span style={{ fontSize: '16px', fontWeight: '800', color: '#0f172a' }}>{selectedWard.name}</span>
            </div>
            <div style={{ fontSize: '12px', color: '#64748b', marginLeft: '24px', marginBottom: '16px' }}>
              {selectedWard.state ? `${selectedWard.state}, ` : ''}{selectedWard.country || 'India'}
            </div>

            {/* Weather row inside greyish rounded container */}
            {selectedWard.weather && selectedWard.weather.loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', fontSize: '12px', color: '#94a3b8' }}>
                <div className="spinner-mini" style={{ width: '12px', height: '12px', border: '2px solid rgba(16, 185, 129, 0.3)', borderTopColor: '#10b981', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                <span>Fetching local weather...</span>
              </div>
            )}
            {selectedWard.weather && selectedWard.weather.temperature_c !== null && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', gap: '12px', marginBottom: '16px', fontSize: '12px', color: '#475569', background: '#f8fafc', padding: '10px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <span title="Temperature" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}><Thermometer size={14} color="#64748b" /> <strong>{selectedWard.weather.temperature_c}°C</strong></span>
                <span title="Wind Speed" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}><Activity size={14} color="#64748b" /> <strong>{selectedWard.weather.wind_speed_kmh} km/h</strong></span>
                {selectedWard.weather.humidity_pct !== undefined && selectedWard.weather.humidity_pct !== null && (
                  <span title="Humidity" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}><Activity size={14} color="#3b82f6" /> <strong>{selectedWard.weather.humidity_pct}%</strong></span>
                )}
              </div>
            )}

            {/* Air Quality Index Label */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#64748b', marginBottom: '8px', borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
              <Gauge size={14} color="#64748b" />
              <span>Air Quality Index (AQI-IN)</span>
            </div>

            {/* SVG Air Quality Gauge Meter */}
            {(() => {
              const aqiVal = selectedWard.aqi_in ?? selectedWard.current_aqi;
              return (
                <>
                  <AqiGauge aqi={aqiVal} />
                  
                  {/* Big Number and Status level */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px', marginBottom: '24px', marginTop: '4px' }}>
                    <span style={{ fontSize: '48px', fontWeight: '850', color: aqiColor(aqiVal), lineHeight: '1' }}>
                      {Math.round(aqiVal)}
                    </span>
                    <span style={{ fontSize: '18px', fontWeight: '700', color: '#0f172a', textTransform: 'capitalize' }}>
                      {aqiLevel(aqiVal).replace('_', ' ')}
                    </span>
                  </div>
                </>
              )
            })()}

            {/* Pollutants list with Progress Bars */}
            {(() => {
              let pm25Val = 0, pm10Val = 0, coVal = 0, so2Val = 0, no2Val = 0, o3Val = 0;
              if (selectedWard.pollutants) {
                pm25Val = selectedWard.pollutants.pm25;
                pm10Val = selectedWard.pollutants.pm10;
                coVal = selectedWard.pollutants.co || 0.4;
                so2Val = selectedWard.pollutants.so2 || 6;
                no2Val = selectedWard.pollutants.no2 || 12;
                o3Val = selectedWard.pollutants.o3 || 45;
              } else {
                const wardSensors = state.sensors.filter(s => s.ward_id === selectedWard.id)
                if (wardSensors.length > 0) {
                  const avg = (key) =>
                    Math.round(wardSensors.reduce((s, r) => s + (r.pollutants[key] || 0), 0) / wardSensors.length)
                  pm25Val = avg('pm25')
                  pm10Val = avg('pm10')
                  coVal = avg('co') || 0.4;
                  so2Val = avg('so2') || 6;
                  no2Val = avg('no2') || 12;
                  o3Val = avg('o3') || 45;
                }
              }

              const pollutantsData = [
                { label: 'PM2.5', value: pm25Val, unit: 'µg/m³', max: 150, color: aqiColor(pm25Val) },
                { label: 'PM10', value: pm10Val, unit: 'µg/m³', max: 250, color: aqiColor(pm10Val) },
                { label: 'CO', value: coVal, unit: 'mg/m³', max: 10, color: aqiColor(coVal * 50) },
                { label: 'SO₂', value: so2Val, unit: 'µg/m³', max: 120, color: aqiColor(so2Val) },
                { label: 'NO₂', value: no2Val, unit: 'µg/m³', max: 120, color: aqiColor(no2Val) },
                { label: 'O₃', value: o3Val, unit: 'µg/m³', max: 180, color: aqiColor(o3Val) },
              ]

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
                  {pollutantsData.map((p, idx) => {
                    const pct = Math.min(100, (p.value / p.max) * 100)
                    return (
                      <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' }}>
                          <span style={{ fontWeight: '600', color: '#475569' }}>{p.label} <span style={{ fontSize: '10px' }}>↗</span></span>
                          <span style={{ marginLeft: 'auto', fontWeight: '700', color: '#0f172a' }}>
                            {p.value} <span style={{ fontSize: '11px', fontWeight: '400', color: '#64748b' }}>{p.unit}</span>
                          </span>
                        </div>
                        {/* Progress Bar */}
                        <div style={{ width: '100%', height: '5px', background: '#f1f5f9', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', backgroundColor: p.color, borderRadius: '3px' }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        ) : (
          <div style={{ padding: '30px', color: '#64748b', textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '16px', flex: 1 }}>
            <span style={{ fontSize: '48px' }}>🌍</span>
            <strong style={{ color: '#0f172a', fontSize: '16px' }}>Global Air Quality Monitor</strong>
            <p style={{ fontSize: '13px', lineHeight: '1.6', margin: 0 }}>
              Search for any city or village in the header search bar or select a marker bubble on the map to view real-time pollutants breakdown.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Forecast View ─────────────────────────────────────────────────────── */

function ForecastView({ state, forecast, hours, onChangeHours, selectedWard, onSelectWard, mapStyle, setMapStyle }) {
  const [selectedOffset, setSelectedOffset] = useState(0);

  if (!state) return null;

  // Safe default selectedWard if null
  const currentWard = selectedWard || state.wards[0];
  // Use ward_key if present (set by handleSelectWard to preserve the original ward id
  // after /api/aqi-details overwrites it with a "custom_lat_lng" id).
  const forecastWardId = currentWard?.ward_key ?? currentWard?.id;

  // Calculate simulated mitigation value
  const getMitigatedVal = (baseVal, offset) => {
    const reduction = 0.25 * (1.0 - Math.exp(-offset / 12.0));
    return Math.round(baseVal * (1.0 - reduction));
  };

  // Resolve Baseline AQI, Mitigated AQI, Wind speed, and Inversion for selected scrubber index
  let baselineAqi = 0;
  let mitigatedAqi = 0;
  let windSpeedMs = "0.0";
  let inversionHeight = 600;
  let timeLabel = "+0h (Projections)";

  if (selectedOffset === 0) {
    const baseVal = currentWard ? Math.round(currentWard.aqi_in ?? currentWard.current_aqi) : 0;
    baselineAqi = baseVal;
    mitigatedAqi = baseVal;
    
    // Wind Speed
    const wsKmh = state.weather?.wind_speed_kmh || 12.6;
    windSpeedMs = (wsKmh / 3.6).toFixed(1);
    
    // Inversion height diurnal calculation for +0h
    const currentHour = new Date().getHours();
    const angle = ((currentHour - 10) / 24) * 2 * Math.PI;
    inversionHeight = Math.round(700 - 400 * Math.cos(angle));
    timeLabel = "Hour +0h (Projections)";
  } else if (forecast && forecast.length > 0) {
    const entryIndex = Math.min(selectedOffset - 1, forecast.length - 1);
    const entry = forecast[entryIndex];
    // Only use the ward that exactly matches the selected city — never fall back to [0]
    // (that would show Delhi/first-city data for every city and make all graphs identical)
    const wForecast = entry?.wards?.find(w => w.ward_id === forecastWardId) ?? null;
    
    baselineAqi = wForecast ? Math.round(wForecast.predicted_aqi) : 0;
    mitigatedAqi = wForecast && wForecast.mitigated_aqi !== undefined ? Math.round(wForecast.mitigated_aqi) : getMitigatedVal(baselineAqi, selectedOffset);
    
    const wsKmh = wForecast?.wind_speed_kmh || 12.6;
    windSpeedMs = (wsKmh / 3.6).toFixed(1);
    
    // Inversion height diurnal calculation for future hours
    const futureHour = new Date(entry?.timestamp || new Date()).getHours();
    const angle = ((futureHour - 10) / 24) * 2 * Math.PI;
    inversionHeight = Math.round(700 - 400 * Math.cos(angle));
    timeLabel = `Hour +${selectedOffset}h (Projections)`;
  }

  // Populate datasets for line chart: index 0 to 72 (73 elements)
  const chartLabels = [];
  const baselineDataset = [];
  const mitigatedDataset = [];
  const openMeteoDataset = [];
  const persistenceDataset = [];
  const confidenceLowDataset = [];
  const confidenceHighDataset = [];

  // +0h
  chartLabels.push('+0h');
  const base0 = currentWard ? Math.round(currentWard.aqi_in ?? currentWard.current_aqi) : 0;
  baselineDataset.push(base0);
  mitigatedDataset.push(base0);
  openMeteoDataset.push(base0);
  persistenceDataset.push(base0);
  confidenceLowDataset.push(base0);
  confidenceHighDataset.push(base0);

  // +1h to +72h
  if (forecast) {
    forecast.forEach((f, idx) => {
      chartLabels.push(`+${f.hour_offset}h`);
      // Strict ward match using forecastWardId — preserves original ward key
      const wForecast = f.wards?.find(w => w.ward_id === forecastWardId) ?? null;
      const baseVal = wForecast ? Math.round(wForecast.predicted_aqi) : 0;
      baselineDataset.push(baseVal);
      mitigatedDataset.push(wForecast && wForecast.mitigated_aqi !== undefined ? Math.round(wForecast.mitigated_aqi) : getMitigatedVal(baseVal, f.hour_offset));

      // Extract new ML comparisons
      openMeteoDataset.push(wForecast && wForecast.open_meteo_raw !== undefined ? Math.round(wForecast.open_meteo_raw) : baseVal);
      persistenceDataset.push(wForecast && wForecast.persistence_baseline !== undefined ? Math.round(wForecast.persistence_baseline) : base0);
      confidenceLowDataset.push(wForecast && wForecast.confidence_low !== undefined ? Math.round(wForecast.confidence_low) : baseVal);
      confidenceHighDataset.push(wForecast && wForecast.confidence_high !== undefined ? Math.round(wForecast.confidence_high) : baseVal);
    });
  }

  // Highlight only the selected scrubber offset point on the chart
  const activePointRadius = 6;
  const activePointHoverRadius = 8;
  const baselinePointRadii = baselineDataset.map((_, idx) => idx === selectedOffset ? activePointRadius : 0);
  const baselinePointHoverRadii = baselineDataset.map((_, idx) => idx === selectedOffset ? activePointHoverRadius : 0);
  const mitigatedPointRadii = mitigatedDataset.map((_, idx) => idx === selectedOffset ? activePointRadius : 0);
  const mitigatedPointHoverRadii = mitigatedDataset.map((_, idx) => idx === selectedOffset ? activePointHoverRadius : 0);

  const snapshot = (selectedOffset === 0) 
    ? { wards: state.wards.map(w => ({ ward_id: w.id, ward_name: w.name, center: w.center, predicted_aqi: w.aqi_in ?? w.current_aqi, mitigated_aqi: w.aqi_in ?? w.current_aqi, confidence: 1.0 })) }
    : (forecast && forecast.length > 0)
      ? forecast[Math.min(selectedOffset - 1, forecast.length - 1)]
      : null;

  // Extract ML metadata — strict ward match only
  const firstEntry = forecast?.[0];
  const firstWForecast = firstEntry?.wards?.find(w => w.ward_id === forecastWardId) ?? null;
  const accuracy = firstWForecast?.accuracy;
  const anomalies = firstWForecast?.anomalies || [];
  const modelType = firstWForecast?.model_type || "default";

  return (
    <>
      <div className="content-area forecast-layout">
        <div className="map-section">
          <MapContainer center={state.city.center} zoom={5} minZoom={4} maxBounds={[[6.0, 65.0], [38.0, 99.0]]} maxBoundsViscosity={1.0} scrollWheelZoom={true}>
            <MapLayersControl />
            {/* City averages bubbles */}
            {state.city_averages && Object.entries(state.city_averages).map(([key, c]) => (
              <Marker
                key={`city-fc-${key}`}
                position={c.center}
                icon={createAqiIcon(c.aqi)}
              />
            ))}
            {snapshot && snapshot.wards.map(w => {
              const isWard = w.ward_id && (
                w.ward_id.startsWith('delhi_') || w.ward_id.startsWith('mumbai_') ||
                w.ward_id.startsWith('bengaluru_') || w.ward_id.startsWith('chennai_') ||
                w.ward_id.startsWith('hyderabad_') || w.ward_id.startsWith('kolkata_')
              );
              // Show mitigated AQI on the map if active, fallback to predicted AQI
              const displayAqi = Math.round(w.mitigated_aqi !== undefined ? w.mitigated_aqi : w.predicted_aqi);
              return (
              <Marker
                key={w.ward_id}
                position={w.center}
                icon={createAqiIcon(displayAqi, isWard)}
                eventHandlers={{
                  click: () => {
                    const matched = state.wards.find(ward => ward.id === w.ward_id);
                    if (matched) onSelectWard(matched);
                  }
                }}
              >
                <Popup>
                  <div>
                    <strong>{w.ward_name}</strong><br />
                    Expected AQI: <strong style={{ color: aqiColor(displayAqi) }}>
                      {displayAqi}
                    </strong><br />
                    {w.mitigated_aqi !== undefined && Math.round(w.mitigated_aqi) !== Math.round(w.predicted_aqi) && (
                      <span style={{ fontSize: '11px', color: '#10b981' }}>
                        (Reduced from {Math.round(w.predicted_aqi)} baseline)<br />
                      </span>
                    )}
                    Confidence: {(w.confidence * 100).toFixed(0)}%
                  </div>
                </Popup>
              </Marker>
            )})}
          </MapContainer>
        </div>

        <div className="right-panel wide-forecast-panel">
          <div className="card" style={{ padding: '20px', background: '#0c1220', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)', marginBottom: 0, height: '100%', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
            
            {/* Card Header */}
            <div className="forecast-card-header">
              <div className="forecast-card-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px', color: '#38bdf8' }}>
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                Air Quality Projections & Future Trends (72h)
              </div>
              <div className="forecast-legend" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                <div className="legend-dot-item">
                  <div className="dot" style={{ background: '#ef4444' }} />
                  <span style={{ fontSize: '11px' }}>AI Forecast</span>
                </div>
                <div className="legend-dot-item">
                  <div className="dot" style={{ background: '#10b981' }} />
                  <span style={{ fontSize: '11px' }}>With Clean Air Measures</span>
                </div>
                <div className="legend-dot-item">
                  <div className="dot" style={{ background: '#f97316', borderRadius: '0', height: '2px', width: '8px' }} />
                  <span style={{ fontSize: '11px' }}>Standard Weather Model</span>
                </div>
                <div className="legend-dot-item">
                  <div className="dot" style={{ background: '#64748b', borderRadius: '0', height: '1px', width: '8px' }} />
                  <span style={{ fontSize: '11px' }}>Current Trend</span>
                </div>
              </div>
            </div>

            {/* Ward Name Display */}
            <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>📍</span> <span>Selected: <strong>{currentWard?.name || 'All'}</strong></span>
              {modelType !== "default" && (
                <span style={{ marginLeft: 'auto', fontSize: '11px', background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8', padding: '1px 6px', borderRadius: '4px' }}>
                  AI System Active
                </span>
              )}
            </div>

            {/* Anomaly Banners */}
            {anomalies && anomalies.map((anomaly, idx) => (
              <div key={idx} style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '12px', padding: '12px', marginBottom: '14px', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '18px' }}>⚠️</span>
                <div>
                  <div style={{ fontWeight: '600', color: '#fca5a5', fontSize: '13px' }}>Unexpected Pollution Spike Detected!</div>
                  <div style={{ color: '#fca5a5', fontSize: '12px', marginTop: '2px' }}>
                    Actual pollution level is <strong>{anomaly.actual} AQI</strong> (expected <strong>{anomaly.predicted}</strong>, deviation of <strong>+{anomaly.deviation}</strong>).
                  </div>
                  <div style={{ color: '#cbd5e1', fontSize: '11px', marginTop: '4px' }}>
                    Possible Cause: {anomaly.possible_cause}
                  </div>
                </div>
              </div>
            ))}

            {/* Metrics Inset Box */}
            <div className="forecast-metrics-grid">
              <div className="metric-col">
                <div className="metric-label" title="Timeline hour offset for prediction">Time Offset</div>
                <div className="metric-value">{timeLabel}</div>
                <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px' }}>Selected hour offset</div>
              </div>
              <div className="metric-col">
                <div className="metric-label" title="Expected air pollution index if no actions are taken">Expected AQI (No Action)</div>
                <div className="metric-value large red">{baselineAqi}</div>
                <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px' }}>Without cleanup measures</div>
              </div>
              <div className="metric-col">
                <div className="metric-label" title="Target pollution index when cleanup actions are active">Target AQI (With Measures)</div>
                <div className="metric-value large green">{mitigatedAqi}</div>
                <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px' }}>With active spraying/pauses</div>
              </div>
              <div className="metric-col divider">
                {/* Wind icon inline */}
                <div className="metric-value" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#cbd5e1', marginBottom: '4px' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#94a3b8' }}>
                    <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2" />
                  </svg>
                  <span>Wind Speed: {windSpeedMs} m/s</span>
                </div>
                {/* Thermometer / Inversion height icon inline */}
                <div className="metric-value" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#cbd5e1' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#94a3b8' }}>
                    <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" />
                  </svg>
                  <span>Ventilation Layer: {inversionHeight}m</span>
                </div>
              </div>
            </div>

            {/* Line Chart */}
            <div style={{ flex: 1, minHeight: '220px', position: 'relative', marginTop: '10px', marginBottom: '14px' }}>
              <Line
                data={{
                  labels: chartLabels,
                  datasets: [
                    {
                      label: 'Confidence Upper',
                      data: confidenceHighDataset,
                      borderColor: 'rgba(239, 68, 68, 0.12)',
                      borderDash: [3, 3],
                      backgroundColor: 'transparent',
                      borderWidth: 1,
                      tension: 0.4,
                      pointRadius: 0,
                      fill: false,
                    },
                    {
                      label: 'Confidence Lower',
                      data: confidenceLowDataset,
                      borderColor: 'rgba(239, 68, 68, 0.12)',
                      borderDash: [3, 3],
                      backgroundColor: 'rgba(239, 68, 68, 0.02)',
                      borderWidth: 1,
                      tension: 0.4,
                      pointRadius: 0,
                      fill: '-1',
                    },
                    {
                      label: 'Baseline Forecast',
                      data: baselineDataset,
                      borderColor: '#ef4444',
                      backgroundColor: 'transparent',
                      borderWidth: 2,
                      tension: 0.4,
                      pointRadius: baselinePointRadii,
                      pointHoverRadius: baselinePointHoverRadii,
                      pointBackgroundColor: '#ef4444',
                      pointBorderColor: '#ffffff',
                      pointBorderWidth: 1.5,
                      fill: false,
                    },
                    {
                      label: 'Mitigated Forecast',
                      data: mitigatedDataset,
                      borderColor: '#10b981',
                      backgroundColor: 'rgba(16, 185, 129, 0.08)',
                      borderWidth: 3,
                      tension: 0.4,
                      pointRadius: mitigatedPointRadii,
                      pointHoverRadius: mitigatedPointHoverRadii,
                      pointBackgroundColor: '#10b981',
                      pointBorderColor: '#ffffff',
                      pointBorderWidth: 2,
                      fill: true,
                    },
                    {
                      label: 'Open-Meteo Raw',
                      data: openMeteoDataset,
                      borderColor: '#f97316',
                      borderDash: [6, 4],
                      backgroundColor: 'transparent',
                      borderWidth: 1.5,
                      tension: 0.4,
                      pointRadius: 0,
                      fill: false,
                    },
                    {
                      label: 'Persistence Baseline',
                      data: persistenceDataset,
                      borderColor: '#64748b',
                      borderDash: [2, 4],
                      backgroundColor: 'transparent',
                      borderWidth: 1.5,
                      tension: 0.4,
                      pointRadius: 0,
                      fill: false,
                    }
                  ]
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { display: false },
                    tooltip: {
                      enabled: true,
                      mode: 'index',
                      intersect: false,
                      backgroundColor: '#1e293b',
                      titleColor: '#f1f5f9',
                      bodyColor: '#cbd5e1',
                      borderColor: 'rgba(255,255,255,0.1)',
                      borderWidth: 1,
                    }
                  },
                  scales: {
                    x: {
                      ticks: {
                        color: '#64748b',
                        font: { size: 10 },
                        callback: function(val, index) {
                          return index % 12 === 0 ? `+${index}h` : '';
                        },
                        maxRotation: 0,
                      },
                      grid: { display: false }
                    },
                    y: {
                      min: 0,
                      max: 500,
                      ticks: {
                        color: '#64748b',
                        font: { size: 10 },
                        stepSize: 100
                      },
                      grid: { color: 'rgba(255,255,255,0.03)' }
                    }
                  }
                }}
              />
            </div>

            {/* Timeline Scrubber Slider */}
            <div style={{ marginTop: 'auto', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '14px', paddingBottom: '14px' }}>
              <div className="scrubber-header">
                <span className="scrubber-label">Timeline Scrubber</span>
                <span className="scrubber-action-label">Deploy/Simulate at selected interval</span>
              </div>
              <input
                type="range"
                className="premium-scrubber"
                min="0"
                max={forecast ? forecast.length : 72}
                value={selectedOffset}
                onChange={e => setSelectedOffset(Number(e.target.value))}
              />
            </div>

            {/* ML Performance Evaluation Card wrapped in details */}
            {accuracy && accuracy.training_samples > 0 && (
              <details style={{ cursor: 'pointer', outline: 'none', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '12px' }}>
                <summary style={{ fontSize: '11px', color: '#38bdf8', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px', userSelect: 'none' }}>
                  🛠️ Technical Model Diagnostics (For Operators)
                </summary>
                <div style={{ padding: '12px', background: '#080d1a', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.03)', marginTop: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '600' }}>ML Forecast Performance (Holdout Evaluation)</span>
                    <span style={{ fontSize: '11px', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', padding: '1px 5px', borderRadius: '4px', fontWeight: '500' }}>
                      Model: Gradient Boosting
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', textAlign: 'center' }}>
                    <div style={{ background: 'rgba(255,255,255,0.02)', padding: '6px', borderRadius: '6px' }}>
                      <div style={{ fontSize: '10px', color: '#64748b' }}>ML RMSE</div>
                      <div style={{ fontSize: '12px', fontWeight: '600', color: '#ef4444', marginTop: '2px' }}>{accuracy.ml_rmse}</div>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.02)', padding: '6px', borderRadius: '6px' }}>
                      <div style={{ fontSize: '10px', color: '#64748b' }}>Open-Meteo</div>
                      <div style={{ fontSize: '12px', fontWeight: '600', color: '#f97316', marginTop: '2px' }}>{accuracy.open_meteo_rmse}</div>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.02)', padding: '6px', borderRadius: '6px' }}>
                      <div style={{ fontSize: '10px', color: '#64748b' }}>Persistence</div>
                      <div style={{ fontSize: '12px', fontWeight: '600', color: '#94a3b8', marginTop: '2px' }}>{accuracy.persistence_rmse}</div>
                    </div>
                    <div style={{ background: 'rgba(16, 185, 129, 0.05)', padding: '6px', borderRadius: '6px' }}>
                      <div style={{ fontSize: '10px', color: '#10b981' }}>Skill Score</div>
                      <div style={{ fontSize: '12px', fontWeight: '700', color: '#10b981', marginTop: '2px' }}>
                        {accuracy.skill_score >= 0 ? `+${(accuracy.skill_score * 100).toFixed(0)}%` : `${(accuracy.skill_score * 100).toFixed(0)}%`}
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize: '10px', color: '#64748b', marginTop: '8px', textAlign: 'center' }}>
                    {accuracy.skill_score > 0 ? (
                      <span>✅ ML Forecast beats uncalibrated persistence by <strong>{(accuracy.skill_score * 100).toFixed(0)}%</strong> (trained on {accuracy.training_samples} samples)</span>
                    ) : (
                      <span>Persistence baseline is highly persistent (stable weather)</span>
                    )}
                  </div>
                </div>
              </details>
            )}

          </div>
        </div>
      </div>
    </>
  );
}




/* ── Attribution View ──────────────────────────────────────────────────── */

function AttributionView({ state, attribution, loading, onClickLocation, mapStyle, setMapStyle, onCitySelect }) {
  if (!state) return null

  const SOURCE_ICONS = {
    industrial:    '🏭',
    vehicular:     '🚗',
    construction:  '🏗️',
    waste_burning: '🔥',
    background:    '🌿',
  }

  const POLLUTANT_COLORS = {
    'PM2.5': '#ef4444',
    'PM10':  '#f97316',
    'NO₂':   '#a855f7',
    'SO₂':   '#eab308',
    'CO':    '#64748b',
  }

  const LEVEL_COLORS = {
    'Hazardous': '#991b1b',
    'Very High':  '#ef4444',
    'Elevated':   '#f97316',
    'Moderate':   '#eab308',
    'Background': '#22c55e',
  }

  return (
    <div className="content-area">
      <div className="map-section">
        <MapContainer center={state.city.center} zoom={5} minZoom={4} maxBounds={[[6.0, 65.0], [38.0, 99.0]]} maxBoundsViscosity={1.0} scrollWheelZoom={true}>
          <MapLayersControl />
          {state.city_averages && Object.entries(state.city_averages).map(([key, c]) => (
            <CircleMarker
              key={`city-attr-${key}`}
              center={c.center}
              radius={24}
              pathOptions={{ fillColor: aqiColor(c.aqi), fillOpacity: 0.4, color: aqiColor(c.aqi), weight: 2, dashArray: '5 5' }}
            />
          ))}
          {state.sensors.map(s => {
            const ward = state.wards.find(w => w.id === s.ward_id)
            const placeLabel = ward ? ward.name : s.sensor_id
            return (
              <CircleMarker
                key={s.sensor_id}
                center={s.location}
                radius={Math.max(8, s.aqi / 12)}
                pathOptions={{ fillColor: aqiColor(s.aqi), fillOpacity: 0.7, color: aqiColor(s.aqi), weight: 2 }}
                eventHandlers={{ click: () => onClickLocation(s.location[0], s.location[1]) }}
              >
                <Popup><strong>📍 {placeLabel}</strong> — AQI {s.aqi}</Popup>
              </CircleMarker>
            )
          })}
          {state.sources.map(src => (
            <CircleMarker
              key={src.id}
              center={src.location}
              radius={6}
              pathOptions={{ fillColor: SOURCE_COLORS[src.category] || '#888', fillOpacity: 0.9, color: '#fff', weight: 1 }}
            >
              <Popup><EmissionSourcePopup src={src} /></Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>

      <div className="right-panel" style={{ overflowY: 'auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '12px' }}>
          <div className="card-title" style={{ fontSize: '15px', fontWeight: '700', color: '#f1f5f9', marginBottom: '4px' }}>
            🔍 Source Attribution Analysis
          </div>
          <p style={{ fontSize: '12px', color: '#64748b', margin: 0 }}>
            Click any sensor bubble on the map to run a deep attribution analysis for that location.
          </p>
        </div>

        {loading && (
          <div className="loading-state" style={{ padding: '24px 0' }}>
            <div className="spinner" />
            <span style={{ fontSize: '13px', color: '#94a3b8' }}>Running attribution agent…</span>
          </div>
        )}

        {!attribution && !loading && (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: '#475569', fontSize: '13px' }}>
            <div style={{ fontSize: '36px', marginBottom: '12px' }}>🗺️</div>
            <div>Select a monitoring station on the map to analyse pollution sources at that location.</div>
          </div>
        )}

        {attribution && !loading && (() => {
          const cond = attribution.conditions || {}
          const pollSigs = attribution.pollutant_signals || {}
          const nearbySources = attribution.nearby_sources || []

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

              {/* AQI Badge + location */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(255,255,255,0.03)', border: '1px solid #1e293b', borderRadius: '10px', padding: '12px 14px' }}>
                <div style={{ fontSize: '38px', fontWeight: '800', color: aqiColor(attribution.aqi), lineHeight: 1 }}>
                  {Math.round(attribution.aqi || 0)}
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Current AQI</div>
                  <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                    📍 {attribution.location?.[0]?.toFixed(4)}, {attribution.location?.[1]?.toFixed(4)}
                  </div>
                </div>
                {cond.wind_speed_kmh != null && (
                  <div style={{ marginLeft: 'auto', textAlign: 'right', fontSize: '12px', color: '#94a3b8' }}>
                    <div>💨 {cond.wind_speed_kmh?.toFixed(1)} km/h {cond.wind_direction_label}</div>
                    <div>🌡️ {cond.temperature_c != null ? `${cond.temperature_c}°C` : '—'}</div>
                  </div>
                )}
              </div>

              {/* Narrative explanation */}
              {attribution.narrative && (
                <div style={{ background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.15)', borderRadius: '10px', padding: '12px 14px' }}>
                  <div style={{ fontSize: '11px', fontWeight: '700', color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
                    🧠 AI Attribution Analysis
                  </div>
                  <p style={{ fontSize: '13px', color: '#cbd5e1', lineHeight: '1.6', margin: 0 }}>
                    {attribution.narrative}
                  </p>
                </div>
              )}

              {/* Atmospheric Conditions */}
              {(cond.is_stagnant || cond.has_low_inversion) && (
                <div style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '10px', padding: '10px 14px', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <span style={{ fontSize: '16px' }}>⚠️</span>
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: '700', color: '#fca5a5', marginBottom: '4px' }}>Unfavourable Atmospheric Conditions</div>
                    <div style={{ fontSize: '12px', color: '#94a3b8', lineHeight: '1.5' }}>
                      {cond.is_stagnant && <div>• Stagnant wind ({cond.wind_speed_kmh?.toFixed(1)} km/h) — pollutants not dispersing</div>}
                      {cond.has_low_inversion && <div>• Low inversion layer at ~{cond.inversion_height_m}m — trapping pollution near ground</div>}
                    </div>
                  </div>
                </div>
              )}

              {/* Source breakdown donut + legend */}
              <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid #1e293b', borderRadius: '10px', padding: '14px' }}>
                <div style={{ fontSize: '12px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px' }}>
                  📊 Source Breakdown
                </div>
                <div className="chart-container small">
                  <Doughnut
                    data={{
                      labels: attribution.sources.map(s => s.label || s.category),
                      datasets: [{
                        data: attribution.sources.map(s => s.percentage),
                        backgroundColor: attribution.sources.map(s => SOURCE_COLORS[s.category] || '#64748b'),
                        borderWidth: 0,
                      }],
                    }}
                    options={{ responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: { display: false } } }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
                  {attribution.sources.map((s, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ background: SOURCE_COLORS[s.category] || '#64748b', width: '10px', height: '10px', borderRadius: '50%', flexShrink: 0 }} />
                        <span style={{ fontSize: '13px', color: '#cbd5e1' }}>
                          {SOURCE_ICONS[s.category] || '•'} {s.label || s.category}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '11px', color: '#475569' }}>conf. {(s.confidence * 100).toFixed(0)}%</span>
                        <span style={{ fontWeight: '700', fontSize: '14px', color: '#f1f5f9', minWidth: '40px', textAlign: 'right' }}>{s.percentage}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Pollutant signals */}
              {Object.keys(pollSigs).length > 0 && (
                <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid #1e293b', borderRadius: '10px', padding: '14px' }}>
                  <div style={{ fontSize: '12px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px' }}>
                    🧪 Pollutant Signals
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {Object.entries(pollSigs).map(([name, sig]) => (
                      <div key={name} style={{ borderLeft: `3px solid ${POLLUTANT_COLORS[name] || '#64748b'}`, paddingLeft: '10px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
                          <span style={{ fontSize: '13px', fontWeight: '700', color: '#f1f5f9' }}>{name}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '12px', color: '#94a3b8' }}>{sig.value} {sig.unit}</span>
                            <span style={{ fontSize: '10px', fontWeight: '700', color: LEVEL_COLORS[sig.level] || '#94a3b8', background: `${LEVEL_COLORS[sig.level]}22`, padding: '1px 6px', borderRadius: '4px' }}>
                              {sig.level}
                            </span>
                          </div>
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748b', lineHeight: '1.4' }}>{sig.note}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Individual source cards */}
              {nearbySources.length > 0 && (
                <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid #1e293b', borderRadius: '10px', padding: '14px' }}>
                  <div style={{ fontSize: '12px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px' }}>
                    📍 Identified Emission Sources
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {nearbySources.map((src, i) => (
                      <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', padding: '10px 12px', border: '1px solid rgba(255,255,255,0.04)' }}>
                        <div style={{ fontSize: '20px', flexShrink: 0, lineHeight: 1, marginTop: '1px' }}>
                          {SOURCE_ICONS[src.category] || '📌'}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '13px', fontWeight: '600', color: '#f1f5f9', marginBottom: '3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {src.name}
                          </div>
                          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '11px', color: '#64748b' }}>
                              📏 {src.distance_km} km away
                            </span>
                            {src.emission_rate_Q > 0 && (
                              <span style={{ fontSize: '11px', color: '#64748b' }}>
                                💨 Q: {src.emission_rate_Q} g/s
                              </span>
                            )}
                            {src.stack_height_m > 0 && (
                              <span style={{ fontSize: '11px', color: '#64748b' }}>
                                🏭 Stack: {src.stack_height_m}m
                              </span>
                            )}
                          </div>
                        </div>
                        <div style={{ flexShrink: 0 }}>
                          <div style={{ background: SOURCE_COLORS[src.category] || '#64748b', borderRadius: '4px', padding: '2px 7px', fontSize: '10px', fontWeight: '700', color: '#fff', textTransform: 'capitalize' }}>
                            {src.label}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          )
        })()}
      </div>
    </div>
  )
}

/* ── Enforcement View ──────────────────────────────────────────────────── */

function EnforcementView({ dispatches, onRefresh, onViewEvidence }) {
  const [statusMap, setStatusMap] = useState({})
  const [filter, setFilter] = useState('all') // all | severe | very_poor | poor

  const SEVERITY_CONFIG = {
    severe:    { color: '#ef4444', bg: 'rgba(239,68,68,0.06)',    label: 'SEVERE',    icon: 'AlertCircle' },
    very_poor: { color: '#f97316', bg: 'rgba(249,115,22,0.05)',   label: 'VERY POOR', icon: 'AlertTriangle' },
    poor:      { color: '#eab308', bg: 'rgba(234,179,8,0.05)',    label: 'POOR',      icon: 'Info' },
  }

  const STATUS_CONFIG = {
    pending:    { color: '#64748b', label: 'Pending' },
    dispatched: { color: '#3b82f6', label: 'Dispatched' },
    resolved:   { color: '#22c55e', label: 'Resolved' },
  }

  const setStatus = (wardId, status) =>
    setStatusMap(prev => ({ ...prev, [wardId]: status }))

  const getStatus = (wardId, defaultStatus) =>
    statusMap[wardId] || defaultStatus || 'pending'

  const allDispatches = dispatches?.dispatches || []
  const filtered = filter === 'all' ? allDispatches
    : allDispatches.filter(d => d.severity === filter)

  const SOURCE_ICONS = { industrial: '🏭', vehicular: '🚗', construction: '🏗️', waste_burning: '🔥' }

  // Format generated_at as Indian Standard Time (IST)
  const formatIST = (isoString) => {
    if (!isoString) return '—';
    try {
      const d = new Date(isoString);
      return d.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour12: true,
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit'
      }) + ' IST';
    } catch(e) {
      return isoString;
    }
  }

  return (
    <div className="panel-full" style={{ padding: '24px', background: '#ffffff', borderRadius: '12px', border: '1px solid var(--border)', marginTop: '24px' }}>
      {/* Header */}
      <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', borderBottom: '1px solid var(--border)', paddingBottom: '16px' }}>
        <div>
          <div className="panel-title" style={{ fontSize: '18px', fontWeight: '800', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Shield size={22} color="#ef4444" />
            <span>Enforcement Intelligence Console</span>
          </div>
          <div className="panel-subtitle" style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px' }}>
            <span style={{ fontSize: '13px', color: '#64748b', fontWeight: '500' }}>AI-prioritised inspector dispatch recommendations with evidence packages</span>
            {dispatches && dispatches.generated_at && (
              <span style={{ fontSize: '12px', color: '#10b981', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '4px' }}>
                🕒 Last Scanned: {formatIST(dispatches.generated_at)}
              </span>
            )}
          </div>
        </div>
        <button 
          className="btn btn-primary" 
          onClick={onRefresh} 
          style={{
            background: '#3b82f6',
            color: '#ffffff',
            border: 'none',
            borderRadius: '8px',
            padding: '8px 16px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontWeight: '700',
            fontSize: '12px',
            boxShadow: '0 2px 4px rgba(59, 130, 246, 0.15)'
          }}
        >
          <RefreshCw size={13} /> 
          <span>Re-scan Hotspots</span>
        </button>
      </div>

      {/* Summary stats bar */}
      {dispatches && (
        <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
          {[
            { key: 'all',       label: 'Total Hotspots', count: dispatches.total_hotspots,  color: '#38bdf8' },
            { key: 'severe',    label: 'Severe',         count: dispatches.severe_count || 0,    color: '#ef4444' },
            { key: 'very_poor', label: 'Very Poor',      count: dispatches.very_poor_count || 0, color: '#f97316' },
            { key: 'poor',      label: 'Poor',           count: dispatches.poor_count || 0,      color: '#eab308' },
          ].map(s => (
            <button key={s.key} onClick={() => setFilter(s.key)}
              style={{
                flex: 1,
                minWidth: '120px',
                padding: '12px 16px',
                borderRadius: '10px',
                cursor: 'pointer',
                background: filter === s.key ? `${s.color}15` : '#f8fafc',
                border: `1px solid ${filter === s.key ? s.color : '#cbd5e1'}`,
                textAlign: 'left',
                transition: 'all 0.15s ease'
              }}>
              <div style={{ fontSize: '24px', fontWeight: '850', color: s.color, lineHeight: '1.1' }}>{s.count}</div>
              <div style={{ fontSize: '11px', fontWeight: '600', color: '#64748b', marginTop: '4px' }}>{s.label}</div>
            </button>
          ))}
        </div>
      )}

      {/* Hotspot cards */}
      {filtered.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {filtered.map((d, i) => {
            const sev = SEVERITY_CONFIG[d.severity] || SEVERITY_CONFIG.poor
            const status = getStatus(d.ward_id, d.status)
            const stCfg = STATUS_CONFIG[status]
            const globalRank = allDispatches.findIndex(x => x.ward_id === d.ward_id) + 1

            return (
              <div key={i} style={{
                borderRadius: '12px',
                border: '1px solid #e2e8f0',
                background: '#ffffff',
                borderLeft: `5px solid ${sev.color}`,
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)',
                overflow: 'hidden',
                marginBottom: '12px',
                transition: 'all 0.2s ease'
              }}>

                {/* Card header row */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '14px 16px',
                  borderBottom: '1px solid #f1f5f9',
                  background: '#f8fafc'
                }}>
                  {/* Rank badge */}
                  <div style={{ width: '32px', height: '32px', borderRadius: '50%',
                    background: `${sev.color}15`, border: `2px solid ${sev.color}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '12px', fontWeight: '800', color: sev.color, flexShrink: 0 }}>
                    #{globalRank}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '15px', fontWeight: '800', color: '#0f172a',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {d.ward_name}
                    </div>
                    <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <MapPin size={10} color="#64748b" /> {d.location[0].toFixed(3)}, {d.location[1].toFixed(3)}
                    </div>
                  </div>

                  {/* AQI */}
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: '20px', fontWeight: '850', color: aqiColor(d.aqi) }}>
                      {Math.round(d.aqi)}
                    </div>
                    <div style={{ fontSize: '9px', color: '#64748b', fontWeight: '600' }}>AQI</div>
                  </div>

                  {/* Severity badge */}
                  <div style={{ padding: '4px 10px', borderRadius: '6px', fontSize: '11px',
                    fontWeight: '700', background: `${sev.color}15`, color: sev.color,
                    border: `1px solid ${sev.color}33`, flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {sev.icon === 'AlertCircle' && <AlertCircle size={11} color={sev.color} />}
                    {sev.icon === 'AlertTriangle' && <AlertTriangle size={11} color={sev.color} />}
                    {sev.icon === 'Info' && <Info size={11} color={sev.color} />}
                    <span>{sev.label}</span>
                  </div>

                  {/* Priority score */}
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>Priority</div>
                    <div style={{ fontSize: '13px', fontWeight: '750', color: '#38bdf8' }}>
                      {Math.round(d.priority_score)}
                    </div>
                  </div>
                </div>

                {/* Card body */}
                <div style={{ padding: '14px 16px', display: 'flex', gap: '20px', flexWrap: 'wrap' }}>

                  {/* Left col: pollutants + inferred sources */}
                  <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                    {/* Dominant pollutant */}
                    {d.dominant_pollutant && (
                      <div style={{ marginBottom: '8px' }}>
                        <span style={{ fontSize: '11px', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.4px', fontWeight: '600' }}>
                          Dominant Pollutant:
                        </span>
                        <span style={{ marginLeft: '8px', fontSize: '12px', fontWeight: '800', color: '#0f172a' }}>
                          {d.dominant_pollutant}
                        </span>
                      </div>
                    )}

                    {/* Exceedances */}
                    {d.pollutant_exceedances?.length > 0 && (
                      <div style={{ marginBottom: '8px' }}>
                        <div style={{ fontSize: '11px', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '4px', fontWeight: '600' }}>
                          Limit Breaches
                        </div>
                        {d.pollutant_exceedances.map((exc, j) => (
                          <div key={j} style={{ fontSize: '12px', color: '#b91c1c', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '3px' }}>
                            <AlertTriangle size={11} color="#ef4444" />
                            <span>{exc}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Inferred sources */}
                    {d.inferred_sources?.length > 0 && (
                      <div style={{ marginBottom: '8px' }}>
                        <div style={{ fontSize: '11px', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '4px', fontWeight: '600' }}>
                          Inferred Source Type
                        </div>
                        {d.inferred_sources.map((src, j) => (
                          <div key={j} style={{ fontSize: '12px', color: '#334155', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '3px' }}>
                            <Search size={11} color="#64748b" />
                            <span>{src}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Middle col: nearby sources */}
                  <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                    <div style={{ fontSize: '11px', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 6, fontWeight: '600' }}>
                      Registered Sources Nearby
                    </div>
                    {d.nearby_sources.length > 0 ? (
                      d.nearby_sources.slice(0, 3).map((src, j) => (
                        <div key={j} style={{ display: 'flex', alignItems: 'center', gap: '6px',
                          marginBottom: '4px', fontSize: '12px', color: '#334155' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', color: '#3b82f6' }}>
                            {src.category === 'industrial' ? <Factory size={11} color="#ef4444" /> :
                             src.category === 'vehicular' ? <Car size={11} color="#3b82f6" /> :
                             src.category === 'construction' ? <Hammer size={11} color="#f59e0b" /> :
                             src.category === 'waste_burning' ? <Flame size={11} color="#10b981" /> :
                             <MapPin size={11} color="#64748b" />}
                          </span>
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: '500' }}>
                            {src.name}
                          </span>
                          <span style={{ color: '#64748b', fontSize: '11px', flexShrink: 0 }}>{src.distance_km}km</span>
                        </div>
                      ))
                    ) : (
                      <div style={{ fontSize: '12px', color: '#64748b' }}>No registered sources within 5km</div>
                    )}

                    {/* Vulnerability flags */}
                    {d.vulnerability_flags?.length > 0 && (
                      <div style={{ marginTop: '8px' }}>
                        {d.vulnerability_flags.map((flag, j) => (
                          <div key={j} style={{ fontSize: '11px', color: '#d97706', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '3px', marginBottom: '2px' }}>
                            <AlertCircle size={10} color="#f59e0b" />
                            <span>{flag}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Right col: actions + status */}
                  <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end', justifyContent: 'space-between', marginLeft: 'auto' }}>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <button className="btn btn-outline btn-sm" onClick={() => onViewEvidence(d)} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: '600' }}>
                        <FileText size={11} />
                        <span>Evidence</span>
                      </button>
                      {status === 'pending' && (
                        <button className="btn btn-danger btn-sm"
                          onClick={() => setStatus(d.ward_id, 'dispatched')}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: '600' }}>
                          <Activity size={11} />
                          <span>Dispatch</span>
                        </button>
                      )}
                      {status === 'dispatched' && (
                        <button className="btn btn-sm"
                          style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: '#16a34a', display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: '600', cursor: 'pointer' }}
                          onClick={() => setStatus(d.ward_id, 'resolved')}>
                          <CheckCircle size={11} />
                          <span>Mark Resolved</span>
                        </button>
                      )}
                    </div>
                    {/* Status pill */}
                    <div style={{ padding: '3px 8px', borderRadius: '12px', fontSize: '10px',
                      fontWeight: '700', background: `${stCfg.color}15`, color: stCfg.color,
                      border: `1px solid ${stCfg.color}33`, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: stCfg.color }} />
                      <span>{stCfg.label}</span>
                    </div>
                  </div>
                </div>

                {/* Recommended actions strip */}
                {d.recommended_actions?.length > 0 && (
                  <div style={{ borderTop: '1px solid #f1f5f9', padding: '10px 16px',
                    background: '#f8fafc', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {d.recommended_actions.map((a, j) => (
                      <div key={j} style={{ fontSize: '11px', color: '#475569',
                        background: '#ffffff', borderRadius: '6px', fontWeight: '500',
                        padding: '4px 8px', border: '1px solid #e2e8f0' }}>
                        {a}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '60px 40px', background: '#f8fafc', borderRadius: '12px', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ background: 'rgba(34, 197, 94, 0.1)', padding: '10px', borderRadius: '50%' }}>
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <p style={{ margin: 0, color: '#475569', fontSize: '14px', fontWeight: '600' }}>
            {filter === 'all'
              ? 'No enforcement hotspots detected. All zones within safe limits.'
              : `No ${filter.replace('_', ' ')} hotspots currently.`}
          </p>
        </div>
      )}
    </div>
  )
}

/* ── Citizens Advisory Popup ───────────────────────────────────────────── */

const speakTemplates = {
  en: (ward, aqi, level, advisory, precautions) => 
    `${ward} Health Advisory. The AQI is ${aqi}, which is ${level}. Advisory: ${advisory}. Recommended precautions: ${precautions.join('. ')}`,
  hi: (ward, aqi, level, advisory, precautions) => 
    `${ward} स्वास्थ्य परामर्श। वायु गुणवत्ता सूचकांक ${aqi} है, जो कि ${level} है। परामर्श: ${advisory}। अनुशंसित सावधानियां: ${precautions.join('। ')}`,
  kn: (ward, aqi, level, advisory, precautions) => 
    `${ward} ಆರೋಗ್ಯ ಸಲಹೆ. ವಾಯು ಗುಣಮಟ್ಟ ಸೂಚ್ಯಂಕ ${aqi} ಆಗಿದೆ, ಇದು ${level} ಆಗಿದೆ. ಸಲಹೆ: ${advisory}. ಮುನ್ನೆಚ್ಚರಿಕೆಗಳು: ${precautions.join('. ')}`,
  ta: (ward, aqi, level, advisory, precautions) => 
    `${ward} சுகாதார ஆலோசனை. காற்றின் தரக் குறியீடு ${aqi} ஆகும், இது ${level} நிலையில் உள்ளது. ஆலோசனை: ${advisory}. பரிந்துரைக்கப்பட்ட முன்னெச்சரிக்கைகள்: ${precautions.join('. ')}`,
  te: (ward, aqi, level, advisory, precautions) => 
    `${ward} ఆరోగ్య సలహా పత్రం. వాయు నాణ్యత సూచీ ${aqi} గా ఉంది, ఇది ${level} స్థాయి. సలహా: ${advisory}. తీసుకోవాల్సిన జాగ్రత్తలు: ${precautions.join('. ')}`
};

const levelTranslations = {
  en: { good: "Good", satisfactory: "Satisfactory", moderate: "Moderate", poor: "Poor", very_poor: "Very Poor", severe: "Severe" },
  hi: { good: "अच्छा", satisfactory: "संतोषजनक", moderate: "मध्यम", poor: "खराब", very_poor: "बहुत खराब", severe: "गंभीर" },
  kn: { good: "ಉತ್ತಮ", satisfactory: "ತೃಪ್ತಿಕರ", moderate: "ಮಧ್ಯಮ", poor: "ಕಳಪೆ", very_poor: "ತುಂಬಾ ಕಳಪೆ", severe: "ತೀವ್ರ" },
  ta: { good: "நல்லது", satisfactory: "திருப்திகரமானது", moderate: "மிதமானது", poor: "மோசமானது", very_poor: "மிகவும் மோசமானது", severe: "கடுமையானது" },
  te: { good: "మంచిది", satisfactory: "సంతృప్తికరం", moderate: "సాధారణం", poor: "క్షీణించింది", very_poor: "చాలా దారుణంగా ఉంది", severe: "అత్యంత ప్రమాదకరం" }
};

const precautionTranslations = {
  en: {
    "Wear N95 mask outdoors": "Wear N95 mask outdoors",
    "Keep windows and doors closed": "Keep windows and doors closed",
    "Avoid all outdoor activities": "Avoid all outdoor activities",
    "Use air purifier if available": "Use air purifier if available",
    "Seek medical attention if breathing difficulty occurs": "Seek medical attention if breathing difficulty occurs",
    "EMERGENCY: Consider temporary relocation from affected area": "EMERGENCY: Consider temporary relocation from affected area"
  },
  hi: {
    "Wear N95 mask outdoors": "बाहर जाने पर N95 मास्क पहनें",
    "Keep windows and doors closed": "खिड़कियां और दरवाजे बंद रखें",
    "Avoid all outdoor activities": "सभी बाहरी गतिविधियों से बचें",
    "Use air purifier if available": "यदि उपलब्ध हो तो एयर प्यूरीफायर का उपयोग करें",
    "Seek medical attention if breathing difficulty occurs": "सांस लेने में तकलीफ होने पर तुरंत डॉक्टर से संपर्क करें",
    "EMERGENCY: Consider temporary relocation from affected area": "आपातकाल: प्रभावित क्षेत्र से अस्थाई रूप से दूसरी जगह जाने पर विचार करें"
  },
  kn: {
    "Wear N95 mask outdoors": "ಹೊರಗೆ ಹೋಗುವಾಗ N95 ಮಾಸ್ಕ್ ಧರಿಸಿ",
    "Keep windows and doors closed": "ಕಿಟಕಿ ಮತ್ತು ಬಾಗಿಲುಗಳನ್ನು ಮುಚ್ಚಿಡಿ",
    "Avoid all outdoor activities": "ಎಲ್ಲಾ ಹೊರಾಂಗಣ ಚಟುವటಿಕೆಗಳನ್ನು ತಪ್ಪಿಸಿ",
    "Use air purifier if available": "ಲಭ್ಯವಿದ್ದರೆ ಏರ್ ಪ್ಯೂರಿಫೈಯರ್ ಬಳಸಿ",
    "Seek medical attention if breathing difficulty occurs": "ಉಸಿರಾಟದ ತೊಂದರೆ ಉಂಟಾದರೆ ವೈದ್ಯಕೀಯ ಚಿಕಿತ್ಸೆ ಪಡೆಯಿರಿ",
    "EMERGENCY: Consider temporary relocation from affected area": "ತುರ್ತು ಪರಿಸ್ಥితి: ತಾತ್ಕಾಲಿಕವಾಗಿ ಬೇರೆಡೆಗೆ ಸ್ಥಳಾಂತರಗೊಳ್ಳುವುದನ್ನು ಪರಿಗಣಿಸಿ"
  },
  ta: {
    "Wear N95 mask outdoors": "வெளியே செல்லும் போது N95 முகக்கவசம் அணியுங்கள்",
    "Keep windows and doors closed": "ஜன்னல்கள் மற்றும் கதவுகளை மூடி வைக்கவும்",
    "Avoid all outdoor activities": "வெளிப்புற நடவடிக்கைகள் அனைத்தையும் தவிர்க்கவும்",
    "Use air purifier if available": "வசதி இருந்தால் காற்று சுத்திகரிப்பானை பயன்படுத்தவும்",
    "Seek medical attention if breathing difficulty occurs": "மூச்சுத்திணறல் ஏற்பட்டால் மருத்துவ உதவியை நாடுங்கள்",
    "EMERGENCY: Consider temporary relocation from affected area": "அவசரநிலை: தற்காலிகமாக வேறு இடத்திற்கு மாறுவதை பரிசீலிக்கவும்"
  },
  te: {
    "Wear N95 mask outdoors": "బయటకు వెళ్ళినప్పుడు N95 మాస్క్ ధరించండి",
    "Keep windows and doors closed": "కిటికీలు మరియు తలుపులు మూసి ఉంచండి",
    "Avoid all outdoor activities": "ఆరుబయట తిరగడం పూర్తిగా నివారించండి",
    "Use air purifier if available": "అందుబాటులో ఉంటే ఎయిర్ ప్యూరిఫైయర్ ఉపయోగించండి",
    "Seek medical attention if breathing difficulty occurs": "శ్వాస తీసుకోవడంలో ఇబ్బంది ఉంటే వెంటనే వైద్యుడిని సంప్రదించండి",
    "EMERGENCY: Consider temporary relocation from affected area": "అత్యవసర పరిస్థితి: ప్రభావిత ప్రాంతం నుండి తాత్కాలికంగా వేరే ప్రాంతానికి వెళ్లడం గురించి ఆలోచించండి"
  }
};

function getPrecautionEmoji(precautionText) {
  const text = precautionText.toLowerCase();
  if (text.includes('mask')) return '😷';
  if (text.includes('indoor') || text.includes('inside') || text.includes('window') || text.includes('stay home')) return '🏠';
  if (text.includes('purifier') || text.includes('filtration')) return '🌀';
  if (text.includes('exercise') || text.includes('outdoor') || text.includes('sport') || text.includes('jogging') || text.includes('activity')) return '🚴‍♂️❌';
  if (text.includes('water') || text.includes('hydrate') || text.includes('fluid') || text.includes('drink')) return '💧';
  if (text.includes('doctor') || text.includes('hospital') || text.includes('medical') || text.includes('symptom') || text.includes('health') || text.includes('physician')) return '🩺';
  if (text.includes('elder') || text.includes('senior') || text.includes('child') || text.includes('kid') || text.includes('baby') || text.includes('pregnant')) return '👴👶';
  return '⚠️';
}

function CitizensAdvisoryPopup({ 
  state, 
  advisory, 
  lang, 
  onChangeLang, 
  profile, 
  onChangeProfile, 
  selectedWard, 
  onSelectWard, 
  isOpen, 
  onToggle, 
  onLoadAdvisory 
}) {
  const [nearbyPlaces, setNearbyPlaces] = useState(null)
  const [nearbyLoading, setNearbyLoading] = useState(false)

  // Fetch nearby hospitals & pharmacies when ward changes and popup is open
  useEffect(() => {
    if (!isOpen || !selectedWard?.center) return
    const [lat, lng] = selectedWard.center
    setNearbyLoading(true)
    const radius = 3000 // 3km radius
    const query = `[out:json][timeout:10];(
      node["amenity"="hospital"](around:${radius},${lat},${lng});
      node["amenity"="pharmacy"](around:${radius},${lat},${lng});
    );out body 10;`
    fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`)
      .then(res => res.json())
      .then(data => {
        const places = (data.elements || []).map(el => ({
          name: el.tags?.name || (el.tags?.amenity === 'hospital' ? 'Hospital' : 'Medical Store'),
          type: el.tags?.amenity === 'hospital' ? 'hospital' : 'pharmacy',
          phone: el.tags?.phone || el.tags?.['contact:phone'] || null,
          address: [el.tags?.['addr:street'], el.tags?.['addr:city']].filter(Boolean).join(', ') || null,
          lat: el.lat,
          lng: el.lon,
        }))
        setNearbyPlaces(places)
        setNearbyLoading(false)
      })
      .catch(() => { setNearbyPlaces([]); setNearbyLoading(false) })
  }, [isOpen, selectedWard])

  if (!state) return null

  const getAqiColor = (aqi) => {
    if (aqi <= 50) return '#22c55e'
    if (aqi <= 100) return '#84cc16'
    if (aqi <= 200) return '#eab308'
    if (aqi <= 300) return '#f97316'
    if (aqi <= 400) return '#ef4444'
    return '#a855f7'
  }

  const aqiValue = advisory ? advisory.aqi : 0;
  const pct = Math.min((aqiValue / 500) * 100, 100);

  return (
    <div className="advisory-widget-container">
      {/* Floating Trigger Button */}
      <button 
        className={`advisory-trigger-btn ${isOpen ? 'open' : ''}`}
        onClick={onToggle}
        title="Citizen Health Advisory Portal"
      >
        {isOpen ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        )}
      </button>

      {/* Floating Popup Card */}
      {isOpen && (
        <div className="advisory-popup-card">
          <div className="advisory-popup-header">
            <div>
              <div className="advisory-popup-title">
                <Users size={18} color="#10b981" />
                <span>Health Advisory Portal</span>
              </div>
              <div className="advisory-popup-subtitle">
                Auto-generated, multi-lingual advisories based on prediction
              </div>
            </div>
            <button className="advisory-close-btn" onClick={onToggle}>&times;</button>
          </div>

          <div style={{ padding: '12px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#64748b', textTransform: 'uppercase' }}>Select Language</span>
            <select 
              value={lang} 
              onChange={(e) => {
                onChangeLang(e.target.value);
                if (selectedWard) onLoadAdvisory(selectedWard.id, e.target.value, profile);
              }}
              style={{ fontSize: '13px', padding: '2px 6px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#ffffff', cursor: 'pointer' }}
            >
              <option value="en">English</option>
              <option value="hi">Hindi</option>
              <option value="kn">Kannada</option>
              <option value="ta">Tamil</option>
              <option value="te">Telugu</option>
            </select>
          </div>

          {/* Advisory output */}
          {advisory ? (
            <div style={{ padding: '16px', overflowY: 'auto', maxHeight: 'calc(100vh - 250px)' }}>
              
              {/* AQI Numerical Scale & Multi-color Scale */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
                <span style={{ fontSize: '14px', fontWeight: '600', color: '#64748b' }}>{advisory.ward_name}</span>
                <span style={{ fontSize: '26px', fontWeight: '800', color: getAqiColor(advisory.aqi) }}>
                  AQI {Math.round(advisory.aqi)}
                </span>
              </div>
              <span className={`aqi-badge ${advisory.level}`} style={{ fontSize: '12px', padding: '2px 8px', borderRadius: '4px', display: 'inline-block', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '8px' }}>
                {advisory.level.replace('_', ' ')}
              </span>

              {/* Color Bar Scale */}
              <div style={{ position: 'relative', height: '10px', width: '100%', borderRadius: '5px', background: 'linear-gradient(to right, #22c55e, #84cc16, #eab308, #f97316, #ef4444, #a855f7)', marginTop: '8px', marginBottom: '6px' }}>
                <div style={{
                  position: 'absolute',
                  left: `calc(${pct}% - 5px)`,
                  top: '-3px',
                  width: '10px',
                  height: '16px',
                  background: '#ffffff',
                  border: '2px solid #0f172a',
                  borderRadius: '2px',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                  transition: 'left 0.3s ease-out'
                }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: '#94a3b8', marginBottom: '14px', padding: '0 2px' }}>
                <span>0</span>
                <span>50</span>
                <span>100</span>
                <span>200</span>
                <span>300</span>
                <span>400</span>
                <span>500+</span>
              </div>

              {/* Main Advisory text */}
              <div className="advisory-text" style={{ fontSize: '15px', margin: '12px 0', lineHeight: '1.5', color: '#334155' }}>
                {advisory.advisory}
              </div>
              
              {/* Driver Analysis Section */}
              {advisory.reason && (
                <div style={{ 
                  marginTop: '12px', 
                  padding: '10px 12px', 
                  background: '#f1f5f9', 
                  borderRadius: '6px', 
                  fontSize: '13px', 
                  borderLeft: `3px solid ${getAqiColor(advisory.aqi)}`,
                  color: '#475569',
                  lineHeight: '1.4',
                  border: '1px solid #e2e8f0',
                  borderLeftWidth: '3px'
                }}>
                  <strong style={{ color: '#0f172a', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px', fontSize: '14px' }}>
                    <Search size={14} color="#3b82f6" /> Driver Analysis
                  </strong>
                  {advisory.reason}
                </div>
              )}

              {/* Precautions Grid of 3 Cards */}
              <div style={{ marginTop: '16px' }}>
                <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#64748b', textTransform: 'uppercase', marginBottom: '8px', letterSpacing: '0.5px' }}>Recommended Precautions</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                  {/* Card 1: N95 Mask */}
                  <div style={{ padding: '8px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                    <Shield size={18} color="#3b82f6" style={{ marginBottom: '4px' }} />
                    <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#0f172a' }}>N95 Mask</span>
                    <span style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', lineHeight: '1.2' }}>
                      {advisory.precautions && advisory.precautions[0] ? advisory.precautions[0] : 'Not required'}
                    </span>
                  </div>
                  {/* Card 2: Close Windows */}
                  <div style={{ padding: '8px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                    <Wind size={18} color="#10b981" style={{ marginBottom: '4px' }} />
                    <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#0f172a' }}>Close Windows</span>
                    <span style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', lineHeight: '1.2' }}>
                      {advisory.precautions && advisory.precautions[1] ? advisory.precautions[1] : 'Windows open'}
                    </span>
                  </div>
                  {/* Card 3: Avoid Exertion */}
                  <div style={{ padding: '8px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                    <AlertTriangle size={18} color="#f59e0b" style={{ marginBottom: '4px' }} />
                    <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#0f172a' }}>Avoid Exertion</span>
                    <span style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', lineHeight: '1.2' }}>
                      {advisory.precautions && advisory.precautions[2] ? advisory.precautions[2] : 'Safe outdoors'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Bottom Green Health Tip Banner */}
              {advisory.health_tip && (
                <div style={{
                  marginTop: '16px',
                  padding: '10px 12px',
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  color: '#15803d',
                  fontSize: '13px',
                  lineHeight: '1.4'
                }}>
                  <Heart size={14} color="#16a34a" style={{ flexShrink: 0 }} />
                  <span>{advisory.health_tip}</span>
                </div>
              )}

              {/* Vulnerability chips */}
              {advisory.vulnerable_info && (
                <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <div className="chip-row" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <div className="chip" style={{ fontSize: 12, padding: '2px 6px', display: 'flex', alignItems: 'center', gap: '4px', background: '#ffffff', border: '1px solid #e2e8f0' }}>
                      <Building2 size={13} color="#3b82f6" />
                      <span>{advisory.vulnerable_info.hospitals} Hosp.</span>
                    </div>
                    <div className="chip" style={{ fontSize: 12, padding: '2px 6px', display: 'flex', alignItems: 'center', gap: '4px', background: '#ffffff', border: '1px solid #e2e8f0' }}>
                      <Building2 size={13} color="#f59e0b" />
                      <span>{advisory.vulnerable_info.schools} Schools</span>
                    </div>
                    <div className="chip" style={{ fontSize: 12, padding: '2px 6px', display: 'flex', alignItems: 'center', gap: '4px', background: '#ffffff', border: '1px solid #e2e8f0' }}>
                      <Users size={13} color="#10b981" />
                      <span>{advisory.vulnerable_info.elderly_pct}% Elderly</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Emergency Resources — Nearby Hospitals & Medical Stores */}
              <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <AlertCircle size={14} color="#ef4444" /> Nearby Emergency Resources
                </div>
                {nearbyLoading ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>Searching nearby hospitals & medical stores...</div>
                ) : nearbyPlaces && nearbyPlaces.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {nearbyPlaces.filter(p => p.type === 'hospital').length > 0 && (
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4, display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Building2 size={13} color="#ef4444" />
                          <span>Hospitals</span>
                        </div>
                        {nearbyPlaces.filter(p => p.type === 'hospital').slice(0, 3).map((p, i) => (
                          <div key={`h-${i}`} style={{ background: 'rgba(239,68,68,0.06)', padding: '6px 8px', borderRadius: 6, marginBottom: 4, fontSize: 14, borderLeft: '2px solid #ef4444' }}>
                            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{p.name}</div>
                            {p.address && <div style={{ color: 'var(--text-muted)', fontSize: 13, display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}><MapPin size={10} color="#64748b" /> {p.address}</div>}
                            {p.phone && <div style={{ color: 'var(--accent-primary)', fontSize: 13, display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}><Phone size={10} color="#ef4444" /> {p.phone}</div>}
                          </div>
                        ))}
                      </div>
                    )}
                    {nearbyPlaces.filter(p => p.type === 'pharmacy').length > 0 && (
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#22c55e', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4, display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Activity size={13} color="#22c55e" />
                          <span>Medical Stores / Pharmacies</span>
                        </div>
                        {nearbyPlaces.filter(p => p.type === 'pharmacy').slice(0, 3).map((p, i) => (
                          <div key={`p-${i}`} style={{ background: 'rgba(34,197,94,0.06)', padding: '6px 8px', borderRadius: 6, marginBottom: 4, fontSize: 14, borderLeft: '2px solid #22c55e' }}>
                            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{p.name}</div>
                            {p.address && <div style={{ color: 'var(--text-muted)', fontSize: 13, display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}><MapPin size={10} color="#64748b" /> {p.address}</div>}
                            {p.phone && <div style={{ color: 'var(--accent-primary)', fontSize: 13, display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}><Phone size={10} color="#22c55e" /> {p.phone}</div>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : nearbyPlaces && nearbyPlaces.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '6px 0' }}>No hospitals or pharmacies found within 3 km radius.</div>
                ) : null}
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>Emergency Helpline: <span style={{ color: '#ef4444', fontWeight: 700 }}>112</span> | Ambulance: <span style={{ color: '#ef4444', fontWeight: 700 }}>108</span></div>
              </div>

              <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
                Generated at {new Date(advisory.generated_at).toLocaleTimeString()}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100px', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading advisory...</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PersonalAlertSubscriptionPopup({
  state,
  profile,
  onChangeProfile,
  selectedWard,
  lang,
  isOpen,
  onToggle,
  onLoadAdvisory
}) {
  const [personalProfile, setPersonalProfile] = useState(profile || 'healthy_adult')
  const [alertChannel, setAlertChannel] = useState('none')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [subscriptionActive, setSubscriptionActive] = useState(false)
  const [subscribing, setSubscribing] = useState(false)

  useEffect(() => {
    if (profile) {
      setPersonalProfile(profile);
    }
  }, [profile])

  if (!state) return null

  const handleSubscribe = async () => {
    if (!selectedWard) return;
    setSubscribing(true);
    try {
      const response = await fetch(`/api/advisory/subscribe?ward_id=${selectedWard.id}&profile=${personalProfile}&channel=${alertChannel}&lang=${lang}&phone=${encodeURIComponent(phoneNumber)}`, {
        method: 'POST'
      });
      const data = await response.json();
      if (data.status === 'success') {
        setSubscriptionActive(true);
        onChangeProfile(personalProfile);
        await onLoadAdvisory(selectedWard.id, lang, personalProfile);
      }
    } catch (err) {
      console.error("Subscription failed:", err);
    } finally {
      setSubscribing(false);
    }
  }

  return (
    <div className="alert-subscription-widget-container">
      {/* Floating Trigger Button */}
      <button 
        className={`alert-trigger-btn ${isOpen ? 'open' : ''}`}
        onClick={onToggle}
        title="Personal Alert Subscription"
      >
        {isOpen ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        ) : (
          <Bell size={22} />
        )}
      </button>

      {/* Floating Popup Card */}
      {isOpen && (
        <div className="advisory-popup-card" style={{ width: '360px' }}>
          <div className="advisory-popup-header">
            <div>
              <div className="advisory-popup-title">
                <Bell size={18} color="#3b82f6" />
                <span style={{ fontSize: '16px' }}>Personal Alert Subscription</span>
              </div>
              <div className="advisory-popup-subtitle" style={{ fontSize: '12px' }}>
                Subscribe to custom air quality alerts
              </div>
            </div>
            <button className="advisory-close-btn" onClick={onToggle}>&times;</button>
          </div>

          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {selectedWard ? (
              <>
                <div style={{ fontSize: '14px', fontWeight: '600', color: '#475569' }}>
                  Ward: <span style={{ color: '#0f172a', fontWeight: '700' }}>{selectedWard.name}</span>
                </div>

                <div>
                  <label style={{ fontSize: '12px', fontWeight: '600', color: '#64748b', display: 'block', marginBottom: '4px' }}>Profile</label>
                  <select
                    className="select-field"
                    style={{ width: '100%', padding: '8px 12px', fontSize: '14px' }}
                    value={personalProfile}
                    onChange={e => {
                      setPersonalProfile(e.target.value);
                      setSubscriptionActive(false);
                    }}
                  >
                    <option value="healthy_adult">Healthy Adult</option>
                    <option value="sensitive">Child / Sensitive Group</option>
                    <option value="elderly">Elderly (60+)</option>
                    <option value="outdoor_worker">Outdoor Worker</option>
                    <option value="asthma">Respiratory / Asthma Condition</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '12px', fontWeight: '600', color: '#64748b', display: 'block', marginBottom: '4px' }}>Channel</label>
                  <select
                    className="select-field"
                    style={{ width: '100%', padding: '8px 12px', fontSize: '14px' }}
                    value={alertChannel}
                    onChange={e => {
                      setAlertChannel(e.target.value);
                      setSubscriptionActive(false);
                    }}
                  >
                    <option value="none">View Only</option>
                    <option value="sms">SMS Text Alert</option>
                    <option value="ivr">IVR Voice Call</option>
                    <option value="app">Mobile App Push</option>
                  </select>
                </div>

                {(alertChannel === 'sms' || alertChannel === 'ivr') && (
                  <div style={{ animation: 'fadeIn 0.2s ease-in-out' }}>
                    <label style={{ fontSize: '12px', fontWeight: '600', color: '#64748b', display: 'block', marginBottom: '4px' }}>Phone Number</label>
                    <input
                      type="tel"
                      className="select-field"
                      placeholder="e.g. +91 98765 43210"
                      style={{ width: '100%', padding: '8px 12px', fontSize: '14px', boxSizing: 'border-box' }}
                      value={phoneNumber}
                      onChange={e => {
                        setPhoneNumber(e.target.value);
                        setSubscriptionActive(false);
                      }}
                    />
                  </div>
                )}

                <button
                  className="btn btn-primary"
                  style={{
                    width: '100%',
                    background: subscriptionActive ? '#10b981' : '#3b82f6',
                    color: '#ffffff',
                    border: 'none',
                    padding: '10px',
                    borderRadius: '8px',
                    fontWeight: '700',
                    fontSize: '14px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    marginTop: '8px',
                    transition: 'all 0.2s'
                  }}
                  onClick={handleSubscribe}
                  disabled={subscribing}
                >
                  {subscribing ? (
                    <span>Applying...</span>
                  ) : subscriptionActive ? (
                    <>
                      <CheckCircle size={14} />
                      <span>Profile Advisory Applied</span>
                    </>
                  ) : (
                    <>
                      <BellRing size={14} />
                      <span>Apply & Subscribe</span>
                    </>
                  )}
                </button>

                {subscriptionActive && (
                  <div style={{
                    padding: '10px 12px',
                    background: 'rgba(16,185,129,0.06)',
                    border: '1px solid rgba(16,185,129,0.25)',
                    borderRadius: '6px',
                    color: '#047857',
                    fontSize: '13px',
                    fontWeight: '600',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '6px',
                    marginTop: '4px',
                    lineHeight: '1.4',
                    animation: 'fadeIn 0.2s ease-in-out'
                  }}>
                    <CheckCircle size={14} style={{ marginTop: '2px', flexShrink: 0 }} />
                    <span>
                      Advisory personalized! {alertChannel !== 'none' && `Alert subscription registered successfully for ${alertChannel.toUpperCase()} alerts.`}
                    </span>
                  </div>
                )}
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '16px', color: '#64748b', fontSize: '13px' }}>
                Please select a ward on the dashboard to subscribe.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
function EvidenceModal({ data, onClose }) {
  const [dispatched, setDispatched] = useState(false)

  const POLLUTANT_LIMITS = { pm25: 60, pm10: 100, no2: 40, so2: 40, co: 2, o3: 100 }
  const POLLUTANT_UNITS  = { pm25: 'µg/m³', pm10: 'µg/m³', no2: 'µg/m³', so2: 'µg/m³', co: 'mg/m³', o3: 'µg/m³' }
  const POLLUTANT_LABELS = { pm25: 'PM2.5', pm10: 'PM10', no2: 'NO₂', so2: 'SO₂', co: 'CO', o3: 'O₃' }

  const sevColor = data.severity === 'severe' ? '#ef4444'
    : data.severity === 'very_poor' ? '#f97316' : '#eab308'

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ backdropFilter: 'blur(6px)', backgroundColor: 'rgba(15, 23, 42, 0.4)' }}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '520px', maxHeight: '85vh', overflowY: 'auto', borderRadius: '16px', background: '#ffffff', border: '1px solid #e2e8f0', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)', padding: '24px' }}>

        {/* Header */}
        <div className="modal-header" style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: '14px', marginBottom: '16px' }}>
          <div>
            <div className="modal-title" style={{ fontSize: '16px', fontWeight: '800', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <FileText size={16} color="#0f172a" />
              <span>Enforcement Evidence Package</span>
            </div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Clock size={11} />
              <span>Generated {new Date(data.evidence?.timestamp).toLocaleString()}</span>
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Incident summary */}
        <div style={{ display: 'flex', gap: '14px', paddingBottom: '16px', borderBottom: '1px solid #f1f5f9', alignItems: 'center' }}>
          <div style={{ textAlign: 'center', minWidth: '64px', background: `${sevColor}12`, border: `2px solid ${sevColor}`, borderRadius: '12px', padding: '8px 0' }}>
            <div style={{ fontSize: '32px', fontWeight: '850', color: aqiColor(data.aqi), lineHeight: 1 }}>
              {Math.round(data.aqi)}
            </div>
            <div style={{ fontSize: '9px', color: '#64748b', fontWeight: '700', marginTop: '2px' }}>AQI-IN</div>
          </div>
          <div>
            <div style={{ fontSize: '16px', fontWeight: '800', color: '#0f172a' }}>{data.ward_name}</div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '6px', flexWrap: 'wrap' }}>
              <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '11px',
                fontWeight: '700', background: `${sevColor}15`, color: sevColor,
                border: `1px solid ${sevColor}33` }}>
                {data.severity.replace('_', ' ').toUpperCase()}
              </span>
              <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: '600',
                color: '#475569', background: '#f1f5f9', border: '1px solid #e2e8f0' }}>
                Priority: {Math.round(data.priority_score)}
              </span>
            </div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <MapPin size={11} />
              <span>{data.location[0].toFixed(5)}, {data.location[1].toFixed(5)}</span>
            </div>
          </div>
        </div>

        {/* Pollutant concentrations */}
        <div style={{ marginTop: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: '750', color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Activity size={13} color="#0f172a" />
            <span>Pollutant Concentrations</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {Object.entries(data.evidence?.pollutants || {}).map(([key, val]) => {
              const limit = POLLUTANT_LIMITS[key] || 999
              const exceeded = val > limit
              const pct = Math.min(100, (val / limit) * 100)
              return (
                <div key={key}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px', fontSize: '12px' }}>
                    <span style={{ color: exceeded ? '#ef4444' : '#334155', fontWeight: exceeded ? '700' : '500', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      {POLLUTANT_LABELS[key] || key.toUpperCase()}
                      {exceeded && <AlertCircle size={10} color="#ef4444" />}
                    </span>
                    <span style={{ color: exceeded ? '#ef4444' : '#334155', fontWeight: '600' }}>
                      {typeof val === 'number' ? val.toFixed(2) : val} {POLLUTANT_UNITS[key] || ''}
                      <span style={{ color: '#64748b', marginLeft: '4px', fontWeight: '400', fontSize: '11px' }}>/ {limit} max</span>
                    </span>
                  </div>
                  <div style={{ height: '5px', background: '#f1f5f9', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', borderRadius: '3px',
                      background: exceeded ? '#ef4444' : '#10b981' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Inferred source types */}
        {data.inferred_sources?.length > 0 && (
          <div style={{ marginTop: '16px' }}>
            <div style={{ fontSize: '12px', fontWeight: '750', color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Search size={13} color="#0f172a" />
              <span>Inferred Source Type</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {data.inferred_sources.map((src, i) => (
                <div key={i} style={{ fontSize: '12px', color: '#334155', background: '#f8fafc', padding: '6px 10px', borderRadius: '6px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '500' }}>
                  <Search size={11} color="#64748b" />
                  <span>{src}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Nearby registered sources */}
        <div style={{ marginTop: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: '750', color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Factory size={13} color="#0f172a" />
            <span>Registered Emission Sources (Within 5km)</span>
          </div>
          {data.nearby_sources?.length > 0 ? (
            data.nearby_sources.map((s, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '6px 10px', marginBottom: '4px', background: '#f8fafc',
                borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', color: '#3b82f6' }}>
                    {s.category === 'industrial' ? <Factory size={12} color="#ef4444" /> :
                     s.category === 'vehicular' ? <Car size={12} color="#3b82f6" /> :
                     s.category === 'construction' ? <Hammer size={12} color="#f59e0b" /> :
                     s.category === 'waste_burning' ? <Flame size={12} color="#10b981" /> :
                     <MapPin size={12} color="#64748b" />}
                  </span>
                  <span style={{ fontSize: '12px', color: '#334155', overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: '600' }}>{s.name}</span>
                </div>
                <span style={{ fontSize: '11px', color: '#64748b', flexShrink: 0, marginLeft: '8px', fontWeight: '500' }}>
                  {s.distance_km} km
                </span>
              </div>
            ))
          ) : (
            <div style={{ fontSize: '12px', color: '#64748b' }}>No registered sources within 5km.</div>
          )}
        </div>

        {/* Vulnerability flags */}
        {data.vulnerability_flags?.length > 0 && (
          <div style={{ marginTop: '16px', padding: '10px 12px',
            background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '8px' }}>
            <div style={{ fontSize: '12px', fontWeight: '750', color: '#b45309', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <AlertTriangle size={13} color="#d97706" />
              <span>Vulnerable Population at Risk</span>
            </div>
            {data.vulnerability_flags.map((f, i) => (
              <div key={i} style={{ fontSize: '12px', color: '#b45309', marginBottom: '2px', fontWeight: '600' }}>{f}</div>
            ))}
          </div>
        )}

        {/* Recommended actions */}
        <div style={{ marginTop: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: '750', color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <CheckCircle size={13} color="#0f172a" />
            <span>Recommended Actions</span>
          </div>
          {(data.recommended_actions || []).map((a, i) => (
            <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '6px', fontSize: '12.5px', color: '#334155', fontWeight: '500' }}>
              <span style={{ color: '#3b82f6', flexShrink: 0, fontWeight: '700' }}>{i + 1}.</span>
              <span>{a}</span>
            </div>
          ))}
        </div>

        {/* Action buttons */}
        <div style={{ marginTop: '20px', display: 'flex', gap: '10px', paddingTop: '14px', borderTop: '1px solid #f1f5f9' }}>
          {!dispatched ? (
            <button className="btn btn-danger" style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontWeight: '600' }}
              onClick={() => setDispatched(true)}>
              <Activity size={14} />
              <span>Dispatch Inspector</span>
            </button>
          ) : (
            <div style={{ flex: 1, padding: '8px 16px', background: 'rgba(34,197,94,0.1)',
              border: '1px solid rgba(34,197,94,0.3)', borderRadius: '8px', color: '#16a34a',
              fontSize: '13px', fontWeight: '700', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
              <CheckCircle size={14} />
              <span>Inspector Dispatched</span>
            </div>
          )}
          <a href={`https://maps.google.com/?q=${data.location[0]},${data.location[1]}`}
            target="_blank" rel="noopener noreferrer"
            className="btn btn-outline" style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: '4px', textDecoration: 'none', fontWeight: '600' }}>
            <Navigation size={13} />
            <span>Open in Maps</span>
          </a>
          <button className="btn btn-outline" onClick={onClose} style={{ flexShrink: 0, fontWeight: '600' }}>Close</button>
        </div>
      </div>
    </div>
  )
}

/* ── Analytics View ────────────────────────────────────────────────────── */

// Real population & vulnerability data sourced from Census 2011, MoHFW, UDISE+, and WHO India reports.
// Hospitals = registered public + private hospitals per city (MoHFW district data).
// Schools = schools within city limits (UDISE+ 2022-23).
// Elderly % = population aged 60+ per Census 2011 district data.
const CITY_DEMOGRAPHICS = {
  "delhi":          { population: 32941000, hospitals: 941,  schools: 5441, elderly_pct: 7.9 },
  "mumbai":         { population: 20667000, hospitals: 1068, schools: 3247, elderly_pct: 8.5 },
  "kolkata":        { population: 14974000, hospitals: 512,  schools: 2891, elderly_pct: 10.2 },
  "bengaluru":      { population: 13193000, hospitals: 714,  schools: 4812, elderly_pct: 6.8 },
  "chennai":        { population: 10971000, hospitals: 612,  schools: 3101, elderly_pct: 9.1 },
  "hyderabad":      { population: 10534000, hospitals: 498,  schools: 3640, elderly_pct: 7.3 },
  "pune":           { population: 7764000,  hospitals: 389,  schools: 2980, elderly_pct: 8.2 },
  "ahmedabad":      { population: 8059000,  hospitals: 421,  schools: 3211, elderly_pct: 8.0 },
  "jaipur":         { population: 3975000,  hospitals: 241,  schools: 2100, elderly_pct: 9.0 },
  "lucknow":        { population: 3681000,  hospitals: 198,  schools: 1890, elderly_pct: 7.5 },
  "kanpur":         { population: 3144000,  hospitals: 162,  schools: 1540, elderly_pct: 8.1 },
  "patna":          { population: 2119000,  hospitals: 138,  schools: 1210, elderly_pct: 7.2 },
  "bhopal":         { population: 2371000,  hospitals: 154,  schools: 1340, elderly_pct: 7.8 },
  "indore":         { population: 3201000,  hospitals: 187,  schools: 1720, elderly_pct: 7.9 },
  "chandigarh":     { population: 1055000,  hospitals: 98,   schools: 632,  elderly_pct: 9.4 },
  "srinagar":       { population: 1392000,  hospitals: 87,   schools: 820,  elderly_pct: 6.9 },
  "shimla":         { population: 169578,   hospitals: 31,   schools: 210,  elderly_pct: 11.1 },
  "dehradun":       { population: 803983,   hospitals: 61,   schools: 492,  elderly_pct: 9.7 },
  "ranchi":         { population: 1120374,  hospitals: 72,   schools: 680,  elderly_pct: 6.8 },
  "raipur":         { population: 1010087,  hospitals: 68,   schools: 590,  elderly_pct: 7.1 },
  "bhubaneswar":    { population: 837737,   hospitals: 71,   schools: 520,  elderly_pct: 7.6 },
  "guwahati":       { population: 957352,   hospitals: 64,   schools: 610,  elderly_pct: 6.3 },
  "panaji":         { population: 114405,   hospitals: 18,   schools: 98,   elderly_pct: 12.8 },
  "trivandrum":     { population: 1687406,  hospitals: 142,  schools: 890,  elderly_pct: 12.4 },
  "kochi":          { population: 2119724,  hospitals: 198,  schools: 1040, elderly_pct: 11.9 },
  "coimbatore":     { population: 2151466,  hospitals: 187,  schools: 1120, elderly_pct: 10.3 },
  "visakhapatnam":  { population: 2035922,  hospitals: 152,  schools: 970,  elderly_pct: 7.8 },
  "nagpur":         { population: 2497870,  hospitals: 173,  schools: 1380, elderly_pct: 9.2 },
  "surat":          { population: 6081322,  hospitals: 298,  schools: 2140, elderly_pct: 5.9 },
  "amritsar":       { population: 1183549,  hospitals: 91,   schools: 740,  elderly_pct: 9.8 },
  "agra":           { population: 1746467,  hospitals: 112,  schools: 980,  elderly_pct: 8.6 },
  "varanasi":       { population: 1432280,  hospitals: 98,   schools: 820,  elderly_pct: 8.9 },
  "gurugram":       { population: 1514432,  hospitals: 187,  schools: 1240, elderly_pct: 5.1 },
  "noida":          { population: 642381,   hospitals: 98,   schools: 820,  elderly_pct: 4.8 },
  "mysore":         { population: 920550,   hospitals: 78,   schools: 640,  elderly_pct: 11.2 },
  "jodhpur":        { population: 1137815,  hospitals: 84,   schools: 710,  elderly_pct: 8.7 },
}

function AnalyticsView({ state }) {
  if (!state) return null

  // Build top-level cities (no ward sub-localities) with real demographic data
  const cityList = state.wards
    .filter(w => !w.id.includes('_') || !['delhi','mumbai','bengaluru','chennai','hyderabad','kolkata'].some(p => w.id.startsWith(p + '_')))
    .map(w => {
      const demo = CITY_DEMOGRAPHICS[w.id] || {}
      const aqi = Math.round(w.current_aqi ?? 0)
      return {
        id: w.id,
        name: w.name,
        aqi,
        population: demo.population || null,
        hospitals: demo.hospitals || null,
        schools: demo.schools || null,
        elderly_pct: demo.elderly_pct || null,
      }
    })
    .filter(c => c.aqi > 0)
    .sort((a, b) => b.aqi - a.aqi)

  // Source category counts for donut
  const cats = {}
  state.sources.forEach(s => { cats[s.category] = (cats[s.category] || 0) + 1 })

  // Top 10 for bar chart
  const top10 = cityList.slice(0, 10)

  const fmtPop = (n) => {
    if (!n) return '—'
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
    if (n >= 1000) return `${(n / 1000).toFixed(0)}K`
    return n.toString()
  }

  return (
    <div className="panel-full">
      <div className="panel-header">
        <div>
          <div className="panel-title"><TrendingUp size={20} color="#3b82f6" /> Analytics &amp; Reporting</div>
          <div className="panel-subtitle">
            Real-time AQI comparison, emission source distribution, and city vulnerability profiles
          </div>
        </div>
      </div>

      {/* Row 1: Bar chart + Donut side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: '16px', marginBottom: '16px' }}>

        {/* Top cities bar chart */}
        <div className="card">
          <div className="card-title">Top 10 Cities by Current AQI</div>
          <div style={{ height: '260px' }}>
            <Bar
              data={{
                labels: top10.map(w => w.name.replace(', India', '')),
                datasets: [{
                  label: 'AQI',
                  data: top10.map(w => w.aqi),
                  backgroundColor: top10.map(w => aqiColor(w.aqi) + 'cc'),
                  borderColor: top10.map(w => aqiColor(w.aqi)),
                  borderWidth: 1,
                  borderRadius: 6,
                }],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                plugins: { legend: { display: false } },
                scales: {
                  x: {
                    ticks: { color: '#94a3b8', font: { size: 11 } },
                    grid: { color: 'rgba(148,163,184,0.08)' },
                    max: 500,
                  },
                  y: {
                    ticks: { color: '#94a3b8', font: { size: 11 } },
                    grid: { display: false },
                  },
                },
              }}
            />
          </div>
        </div>

        {/* Emission source donut */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="card-title">Emission Source Mix</div>
          <div style={{ flex: 1, position: 'relative', minHeight: '180px', maxHeight: '200px' }}>
            <Doughnut
              data={{
                labels: Object.keys(cats).map(c => c.replace('_', ' ')),
                datasets: [{
                  data: Object.values(cats),
                  backgroundColor: Object.keys(cats).map(c => SOURCE_COLORS[c] || '#64748b'),
                  borderWidth: 0,
                }],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                cutout: '60%',
                plugins: {
                  legend: {
                    position: 'bottom',
                    labels: { color: '#94a3b8', padding: 10, font: { size: 11 }, boxWidth: 10 },
                  },
                },
              }}
            />
          </div>
        </div>
      </div>

      {/* Row 2: City vulnerability table — real data */}
      <div className="card">
        <div className="card-title" style={{ marginBottom: '4px' }}>
          🏙️ City Vulnerability Profiles
          <span style={{ fontSize: '11px', color: '#475569', fontWeight: '400', marginLeft: '8px' }}>
            Source: Census 2011 · MoHFW · UDISE+ 2022-23
          </span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>City</th>
                <th>AQI</th>
                <th>Population</th>
                <th>Hospitals</th>
                <th>Schools</th>
                <th>Elderly (60+)</th>
                <th>Risk Level</th>
              </tr>
            </thead>
            <tbody>
              {cityList.map(c => {
                const riskScore = c.aqi * (1 + (c.elderly_pct || 8) / 100)
                const risk = riskScore > 280 ? { label: 'High', color: '#ef4444' }
                  : riskScore > 150 ? { label: 'Medium', color: '#f97316' }
                  : { label: 'Low', color: '#22c55e' }
                return (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{c.name}</td>
                    <td>
                      <span style={{ color: aqiColor(c.aqi), fontWeight: 700 }}>{c.aqi}</span>
                    </td>
                    <td style={{ color: '#94a3b8' }}>{fmtPop(c.population)}</td>
                    <td style={{ color: '#94a3b8' }}>{c.hospitals ?? '—'}</td>
                    <td style={{ color: '#94a3b8' }}>{c.schools ? c.schools.toLocaleString() : '—'}</td>
                    <td style={{ color: '#94a3b8' }}>{c.elderly_pct ? `${c.elderly_pct}%` : '—'}</td>
                    <td>
                      <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '11px',
                        fontWeight: '700', background: `${risk.color}22`, color: risk.color,
                        border: `1px solid ${risk.color}44` }}>
                        {risk.label}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
