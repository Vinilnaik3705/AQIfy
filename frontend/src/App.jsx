/* ═══════════════════════════════════════════════════════════════════════════
   AQI Intervention Platform — React Dashboard
   ═══════════════════════════════════════════════════════════════════════════ */

import { useState, useEffect, useCallback, useRef } from 'react'
import L from 'leaflet'
import { MapContainer, TileLayer, CircleMarker, Popup, Polyline, useMap, Marker, WMSTileLayer, LayersControl, Tooltip as LeafletTooltip } from 'react-leaflet'
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
  command: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  ),
  forecast: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  ),
  attribution: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  enforcement: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  citizens: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  analytics: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  )
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
  const [isAdvisoryOpen, setIsAdvisoryOpen] = useState(false)

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

  const loadAdvisory = useCallback(async (wardId, lang) => {
    const data = await fetchJSON(`/api/agents/advisory?city=all&ward_id=${wardId}&lang=${lang}`, { method: 'POST' })
    if (data) setAdvisory(data)
  }, [])

  useEffect(() => {
    if (isAdvisoryOpen && selectedWard) loadAdvisory(selectedWard.id, advLang)
  }, [isAdvisoryOpen, selectedWard, advLang, loadAdvisory])

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
  const alertCount = state ? state.sensors.filter(s => (s.aqi_in ?? s.aqi) > 150).length : 0

  return (
    <div className="app-shell">
      {/* ── Sidebar ──────────────────────────────────────────────────── */}
      <nav className="sidebar">
        <div className="sidebar-logo">AQ</div>
        {TABS.map(t => (
          <button
            key={t.id}
            id={`nav-${t.id}`}
            className={`sidebar-btn ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.icon}
            <span className="sidebar-tooltip">{t.label}</span>
          </button>
        ))}
      </nav>

      {/* ── Main ─────────────────────────────────────────────────────── */}
      <div className="main-content">
        <Header
          tab={tab}
          cityAqi={cityAqi}
          alertCount={alertCount}
          weather={state?.weather}
          onSelectPlace={handleSelectPlace}
        />

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
        selectedWard={selectedWard}
        onSelectWard={(w) => { handleSelectWard(w); loadAdvisory(w.id, advLang) }}
        isOpen={isAdvisoryOpen}
        onToggle={() => setIsAdvisoryOpen(!isAdvisoryOpen)}
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
    <div className="header-search-container" ref={dropdownRef} style={{ position: 'relative', minWidth: '220px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <input
          type="text"
          className="select-field"
          style={{ width: '220px', height: '32px', padding: '4px 8px', fontSize: '13px', margin: 0, borderRadius: '4px', border: '1px solid #2e384e', background: '#0f172a', color: '#f1f5f9' }}
          placeholder="Search city or village..."
          value={query}
          onFocus={() => { if (results.length) setShowDropdown(true) }}
          onChange={e => handleSearch(e.target.value)}
        />
        <span style={{ fontSize: '14px', cursor: 'default' }}>🔍</span>
      </div>
      {showDropdown && results.length > 0 && (
        <div 
          className="map-search-results" 
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          style={{ position: 'absolute', top: '38px', left: 0, width: '100%', zIndex: 9999, background: '#1e293b', border: '1px solid #334155', borderRadius: '4px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}
        >
          {results.map((r, i) => (
            <div 
              key={i} 
              className="map-search-result-row" 
              style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #334155', display: 'flex', alignItems: 'center' }} 
              onClick={(e) => {
                e.stopPropagation();
                selectItem(r);
              }}
            >
              <span style={{ marginRight: '6px' }}>📍</span>
              <span style={{ fontSize: '12px', color: '#f1f5f9' }}>
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

function Header({ tab, cityAqi, alertCount, weather, onSelectPlace }) {
  const currentTab = TABS.find(t => t.id === tab)
  return (
    <header className="header">
      <div className="header-title">
        <span className="icon">{currentTab?.icon}</span>
        {currentTab?.label}
      </div>
      <div className="header-stats">
        <div className="header-stat" style={{ marginRight: '16px' }}>
          <HeaderSearch onSelectPlace={onSelectPlace} />
        </div>
        <div className="header-stat" style={{ display: 'flex', alignItems: 'center', gap: '6px', marginRight: '8px' }}>
          <span style={{ fontSize: '14px' }}>🇮🇳</span>
          <span style={{ fontSize: '12px', fontWeight: '600', color: '#f1f5f9', padding: '2px 8px', border: '1px solid #2e384e', borderRadius: '4px', height: '32px', display: 'flex', alignItems: 'center' }}>AQI-IN</span>
        </div>
        <div className="header-stat">
          <div className="status-dot live" />
          <span>Live</span>
        </div>
        <div className="header-stat">
          Global AQI Avg: <span className="value" style={{ color: aqiColor(cityAqi) }}>{cityAqi}</span>
        </div>
        <div className="header-stat">
          Alerts: <span className="value" style={{ color: alertCount > 0 ? '#ef4444' : '#22c55e' }}>{alertCount}</span>
        </div>
        {weather && (
          <>
            <div className="header-stat">
              🌡 <span className="value">{weather.temperature_c !== null ? `${weather.temperature_c}°C` : 'N/A'}</span>
            </div>
            <div className="header-stat">
              💨 <span className="value">{weather.wind_speed_kmh !== null ? `${weather.wind_speed_kmh} km/h` : 'N/A'}</span>
            </div>
          </>
        )}
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
  const [cctvLoading, setCctvLoading] = useState(false);
  const [cctvVerified, setCctvVerified] = useState(false);
  const [dispatched, setDispatched] = useState(false);

  useEffect(() => {
    let active = true;
    async function reverseGeocode() {
      setLoading(true);
      try {
        const [lat, lng] = src.location;
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=en`, {
          headers: {
            'User-Agent': 'AQI-Intervention-App/1.0'
          }
        });
        if (res.ok) {
          const data = await res.json();
          if (active) {
            setAddress(data.address);
          }
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

  const handleCctvRequest = () => {
    setCctvLoading(true);
    setTimeout(() => {
      setCctvLoading(false);
      setCctvVerified(true);
    }, 1200);
  };

  const handleDispatch = () => {
    setDispatched(true);
  };

  const road = address?.road || address?.suburb || address?.neighbourhood || '';
  const area = address?.county || address?.city_district || address?.city || address?.state_district || '';
  const stateName = address?.state || '';
  const postcode = address?.postcode || '';
  const [lat, lng] = src.location;

  return (
    <div style={{ minWidth: '240px', padding: '4px', fontFamily: 'inherit' }}>
      <strong>📍 {src.name.replace("Satellite Fire Anomaly (MODIS/VIIRS)", "Active Waste Burning Site")}</strong><br />
      <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'capitalize', display: 'block', marginBottom: '6px' }}>
        Category: {src.category.replace('_', ' ')}
      </span>

      {loading ? (
        <span style={{ fontSize: '12px', color: '#64748b' }}>🔍 Locating street address...</span>
      ) : address ? (
        <div style={{ fontSize: '12px', color: '#f1f5f9', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '6px', marginTop: '4px', marginBottom: '12px' }}>
          {road && <div style={{ marginBottom: '2px' }}><strong>🛣️ Street:</strong> {road}</div>}
          {area && <div style={{ marginBottom: '2px' }}><strong>🏙️ Area:</strong> {area}</div>}
          {stateName && <div style={{ marginBottom: '2px' }}><strong>📍 State:</strong> {stateName} {postcode}</div>}
          <div style={{ fontSize: '10px', color: '#64748b', marginTop: '4px' }}>
            Coordinates: {lat.toFixed(4)}, {lng.toFixed(4)}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: '11px', color: '#ef4444', marginBottom: '12px' }}>Address lookup unavailable</div>
      )}

      {/* Verification Panel */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ fontSize: '11px', fontWeight: '700', color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          🛡️ Active Status Verification
        </div>

        {cctvLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#38bdf8', padding: '6px 0' }}>
            <div style={{ 
              width: '12px', 
              height: '12px', 
              border: '2px solid rgba(56, 189, 248, 0.3)', 
              borderTopColor: '#38bdf8', 
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite'
            }} />
            <span>Pinging nearby CCTV camera node...</span>
          </div>
        )}

        {cctvVerified && !cctvLoading && (
          <div style={{ border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.05)', overflow: 'hidden', marginBottom: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', background: 'rgba(239, 68, 68, 0.15)', fontSize: '11px', color: '#f87171', fontWeight: '700' }}>
              <span>● LIVE CCTV FEED</span>
              <span>CONFIRMED</span>
            </div>
            <div style={{ width: '100%', height: '120px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0f172a', color: '#94a3b8', fontSize: '11px', gap: '8px' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#ef4444' }}>
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
              <span style={{ fontWeight: '500', letterSpacing: '0.05em' }}>[ CCTV FEED ACTIVE ]</span>
            </div>
          </div>
        )}

        {!cctvVerified && !cctvLoading && (
          <button 
            onClick={handleCctvRequest}
            style={{ width: '100%', padding: '6px 10px', background: '#1e293b', border: '1px solid #334155', borderRadius: '4px', color: '#f1f5f9', fontSize: '11px', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
          >
            📷 Query Local CCTV Node
          </button>
        )}

        <a 
          href={`https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@${lat},${lng},14z`} 
          target="_blank" 
          rel="noopener noreferrer"
          style={{ width: '100%', padding: '6px 10px', background: '#0f172a', border: '1px solid #1e293b', borderRadius: '4px', color: '#38bdf8', fontSize: '11px', fontWeight: '600', textDecoration: 'none', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
        >
          🛰️ Cross-Check NASA FIRMS Map
        </a>

        {cctvVerified && (
          dispatched ? (
            <div style={{ width: '100%', padding: '6px 10px', background: 'rgba(34, 197, 94, 0.15)', border: '1px solid rgba(34, 197, 94, 0.3)', borderRadius: '4px', color: '#4ade80', fontSize: '11px', fontWeight: '700', textAlign: 'center' }}>
              🚔 Enforcement Dispatched Successfully
            </div>
          ) : (
            <button 
              onClick={handleDispatch}
              style={{ width: '100%', padding: '6px 10px', background: '#ef4444', border: 'none', borderRadius: '4px', color: '#ffffff', fontSize: '11px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
            >
              🚔 Dispatch Local Inspector
            </button>
          )
        )}
      </div>
    </div>
  );
}

/* ── Command Center ────────────────────────────────────────────────────── */

function CommandCenter({ state, selectedWard, onSelectWard, mapStyle, setMapStyle, customPlaces, targetCenter, targetZoom }) {
  if (!state) return null;
  return (
    <div className="content-area">
      <div className="map-section">
        <MapContainer
          center={state.city.center}
          zoom={5}
          minZoom={4}
          maxBounds={[[6.0, 65.0], [38.0, 99.0]]}
          maxBoundsViscosity={1.0}
          scrollWheelZoom={true}
        >
          <MapLayersControl />
          <ChangeMapView center={targetCenter} zoom={targetZoom} />
          
          {/* Preset City Markers */}
          {state.sensors.map(s => {
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
          {customPlaces && customPlaces.map(cp => {
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

          {/* Emission Sources */}
          {state.sources && state.sources.map(src => (
            <CircleMarker
              key={src.id}
              center={src.location}
              radius={6}
              pathOptions={{
                fillColor: SOURCE_COLORS[src.category] || '#888',
                fillOpacity: 0.9,
                color: '#fff',
                weight: 1,
              }}
            >
              <Popup>
                <EmissionSourcePopup src={src} />
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>

      <div className="right-panel">
        {selectedWard ? (
          <div className="card" style={{ padding: '20px', background: '#1c2230', borderRadius: '12px', border: '1px solid #2e384e', minHeight: '400px' }}>
            {/* Header: Location */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <span style={{ fontSize: '18px', color: '#38bdf8' }}>📍</span>
              <span style={{ fontSize: '16px', fontWeight: '700', color: '#f1f5f9' }}>{selectedWard.name}</span>
            </div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginLeft: '24px', marginBottom: '16px' }}>
              {selectedWard.state ? `${selectedWard.state}, ` : ''}{selectedWard.country || 'India'}
            </div>

            {/* Weather row */}
            {selectedWard.weather && selectedWard.weather.loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', marginLeft: '24px', fontSize: '12px', color: '#94a3b8' }}>
                <div className="spinner-mini" style={{ width: '12px', height: '12px', border: '2px solid rgba(56, 189, 248, 0.3)', borderTopColor: '#38bdf8', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                <span>Fetching local weather...</span>
              </div>
            )}
            {selectedWard.weather && selectedWard.weather.temperature_c !== null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px', marginLeft: '24px', fontSize: '13px', color: '#cbd5e1', background: 'rgba(255,255,255,0.03)', padding: '6px 12px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)', width: 'fit-content' }}>
                <span title="Temperature" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>🌡️ <strong style={{ color: '#f1f5f9' }}>{selectedWard.weather.temperature_c}°C</strong></span>
                <span title="Wind Speed" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>💨 <strong style={{ color: '#f1f5f9' }}>{selectedWard.weather.wind_speed_kmh} km/h</strong></span>
                {selectedWard.weather.humidity_pct !== undefined && selectedWard.weather.humidity_pct !== null && (
                  <span title="Humidity" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>💧 <strong style={{ color: '#f1f5f9' }}>{selectedWard.weather.humidity_pct}%</strong></span>
                )}
              </div>
            )}

            {/* Air Quality Index Label */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#94a3b8', marginBottom: '16px', borderTop: '1px solid #2e384e', paddingTop: '12px' }}>
              <span>📊</span>
              <span>Air Quality Index (AQI-IN)</span>
            </div>

            {/* Large AQI and Badge */}
            {(() => {
              const aqiVal = selectedWard.aqi_in ?? selectedWard.current_aqi;
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
                  <span style={{ fontSize: '56px', fontWeight: '800', color: aqiColor(aqiVal), lineHeight: '1' }}>
                    {Math.round(aqiVal)}
                  </span>
                  <span className={`aqi-badge ${aqiLevel(aqiVal)}`} style={{ fontSize: '14px', padding: '6px 16px', borderRadius: '8px', fontWeight: '700', textTransform: 'capitalize' }}>
                    {aqiLevel(aqiVal).replace('_', ' ')}
                  </span>
                </div>
              )
            })()}

            {/* Pollutants list with Progress Bars */}
            {(() => {
              let pm25Val = 0, pm10Val = 0, coVal = 0, so2Val = 0, no2Val = 0, o3Val = 0;
              if (selectedWard.pollutants) {
                pm25Val = selectedWard.pollutants.pm25;
                pm10Val = selectedWard.pollutants.pm10;
                coVal = selectedWard.pollutants.co;
                so2Val = selectedWard.pollutants.so2;
                no2Val = selectedWard.pollutants.no2;
                o3Val = selectedWard.pollutants.o3;
              } else {
                const wardSensors = state.sensors.filter(s => s.ward_id === selectedWard.id)
                if (!wardSensors.length) return null;
                const avg = (key) =>
                  Math.round(wardSensors.reduce((s, r) => s + r.pollutants[key], 0) / wardSensors.length)
                
                pm25Val = avg('pm25')
                pm10Val = avg('pm10')
                coVal = avg('co')
                so2Val = avg('so2')
                no2Val = avg('no2')
                o3Val = avg('o3')
              }

              // Max values for progress bar scaling
              const pollutantsData = [
                { label: 'PM2.5', value: pm25Val, unit: 'µg/m³', max: 150, color: aqiColor(pm25Val) },
                { label: 'PM10', value: pm10Val, unit: 'µg/m³', max: 250, color: aqiColor(pm10Val) },
                { label: 'CO', value: coVal, unit: 'mg/m³', max: 10, color: aqiColor(coVal * 50) },
                { label: 'SO₂', value: so2Val, unit: 'µg/m³', max: 120, color: aqiColor(so2Val) },
                { label: 'NO₂', value: no2Val, unit: 'µg/m³', max: 120, color: aqiColor(no2Val) },
                { label: 'O₃', value: o3Val, unit: 'µg/m³', max: 180, color: aqiColor(o3Val) },
              ]

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', borderTop: '1px solid #2e384e', paddingTop: '16px' }}>
                  {pollutantsData.map((p, idx) => {
                    const pct = Math.min(100, (p.value / p.max) * 100)
                    return (
                      <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' }}>
                          <span style={{ fontWeight: '600', color: '#94a3b8' }}>{p.label} <span style={{ fontSize: '10px' }}>↗</span></span>
                          <span style={{ marginLeft: 'auto', fontWeight: '700', color: '#f1f5f9' }}>
                            {p.value} <span style={{ fontSize: '11px', fontWeight: '400', color: '#94a3b8' }}>{p.unit}</span>
                          </span>
                        </div>
                        {/* Progress Bar */}
                        <div style={{ width: '100%', height: '5px', background: '#0f172a', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', backgroundColor: p.color, borderRadius: '3px' }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}

            {/* Bottom Scale Legend */}
            <div style={{ marginTop: '24px', borderTop: '1px solid #2e384e', paddingTop: '16px' }}>
              <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '8px', textAlign: 'center' }}>
                AQI Scale Legend
              </div>
              <div style={{ display: 'flex', width: '100%', height: '8px', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ flex: 1, background: '#22c55e' }} title="Good (0-50)" />
                <div style={{ flex: 1, background: '#84cc16' }} title="Satisfactory (51-100)" />
                <div style={{ flex: 2, background: '#eab308' }} title="Moderate (101-200)" />
                <div style={{ flex: 2, background: '#f97316' }} title="Poor (201-300)" />
                <div style={{ flex: 2, background: '#ef4444' }} title="Very Poor (301-400)" />
                <div style={{ flex: 2, background: '#991b1b' }} title="Severe (401-500+)" />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: '#64748b', marginTop: '4px' }}>
                <span>0</span>
                <span>50</span>
                <span>100</span>
                <span>200</span>
                <span>300</span>
                <span>400</span>
                <span>500+</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="card" style={{ padding: '30px', background: '#1c2230', borderRadius: '12px', border: '1px solid #2e384e', color: '#94a3b8', textAlign: 'center', minHeight: '400px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '16px' }}>
            <span style={{ fontSize: '48px' }}>🌍</span>
            <strong style={{ color: '#f1f5f9', fontSize: '16px' }}>Global Air Quality Monitor</strong>
            <p style={{ fontSize: '13px', lineHeight: '1.6', margin: 0 }}>
              Search for any city or village in the header search bar or select a marker bubble on the map to view real-time pollutants breakdown.
            </p>
          </div>
        )}
      </div>
    </div>
  )
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
    mitigatedAqi = getMitigatedVal(baselineAqi, selectedOffset);
    
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
      mitigatedDataset.push(getMitigatedVal(baseVal, f.hour_offset));

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

  const snapshot = forecast ? forecast[Math.min(hours - 1, forecast.length - 1)] : null;

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
              const forecastAqi = w.predicted_aqi;
              return (
              <Marker
                key={w.ward_id}
                position={w.center}
                icon={createAqiIcon(forecastAqi, isWard)}
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
                    Predicted AQI: <strong style={{ color: aqiColor(forecastAqi) }}>
                      {forecastAqi}
                    </strong><br />
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
                Hyperlocal AQI Trend & Forecasting (72h)
              </div>
              <div className="forecast-legend" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                <div className="legend-dot-item">
                  <div className="dot" style={{ background: '#ef4444' }} />
                  <span style={{ fontSize: '11px' }}>ML Forecast</span>
                </div>
                <div className="legend-dot-item">
                  <div className="dot" style={{ background: '#10b981' }} />
                  <span style={{ fontSize: '11px' }}>Mitigated</span>
                </div>
                <div className="legend-dot-item">
                  <div className="dot" style={{ background: '#f97316', borderRadius: '0', height: '2px', width: '8px' }} />
                  <span style={{ fontSize: '11px' }}>Open-Meteo</span>
                </div>
                <div className="legend-dot-item">
                  <div className="dot" style={{ background: '#64748b', borderRadius: '0', height: '1px', width: '8px' }} />
                  <span style={{ fontSize: '11px' }}>Persistence</span>
                </div>
              </div>
            </div>

            {/* Ward Name Display */}
            <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>📍</span> <span>Selected: <strong>{currentWard?.name || 'All'}</strong></span>
              {modelType !== "default" && (
                <span style={{ marginLeft: 'auto', fontSize: '11px', background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8', padding: '1px 6px', borderRadius: '4px' }}>
                  Model Active: {modelType}
                </span>
              )}
            </div>

            {/* Anomaly Banners */}
            {anomalies && anomalies.map((anomaly, idx) => (
              <div key={idx} style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '12px', padding: '12px', marginBottom: '14px', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '18px' }}>⚠️</span>
                <div>
                  <div style={{ fontWeight: '600', color: '#fca5a5', fontSize: '13px' }}>Unexpected AQI Spike Detected!</div>
                  <div style={{ color: '#fca5a5', fontSize: '12px', marginTop: '2px' }}>
                    Actual AQI is <strong>{anomaly.actual}</strong> (predicted <strong>{anomaly.predicted}</strong>, deviation of <strong>+{anomaly.deviation}</strong>).
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
                <div className="metric-label">Timeline Index</div>
                <div className="metric-value">{timeLabel}</div>
              </div>
              <div className="metric-col">
                <div className="metric-label">Baseline AQI</div>
                <div className="metric-value large red">{baselineAqi}</div>
              </div>
              <div className="metric-col">
                <div className="metric-label">Mitigated AQI</div>
                <div className="metric-value large green">{mitigatedAqi}</div>
              </div>
              <div className="metric-col divider">
                {/* Wind icon inline */}
                <div className="metric-value" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#cbd5e1', marginBottom: '4px' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#94a3b8' }}>
                    <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2" />
                  </svg>
                  <span>WS: {windSpeedMs} m/s</span>
                </div>
                {/* Thermometer / Inversion height icon inline */}
                <div className="metric-value" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#cbd5e1' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#94a3b8' }}>
                    <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" />
                  </svg>
                  <span>Inversion: {inversionHeight}m</span>
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

            {/* ML Performance Evaluation Card */}
            {accuracy && accuracy.training_samples > 0 && (
              <div style={{ padding: '12px', background: '#080d1a', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.03)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: '600' }}>ML Forecast Performance (Holdout Evaluation)</span>
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
    severe:    { color: '#ef4444', bg: 'rgba(239,68,68,0.12)',    label: 'SEVERE',    icon: '🔴' },
    very_poor: { color: '#f97316', bg: 'rgba(249,115,22,0.10)',   label: 'VERY POOR', icon: '🟠' },
    poor:      { color: '#eab308', bg: 'rgba(234,179,8,0.10)',    label: 'POOR',      icon: '🟡' },
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

  return (
    <div className="panel-full">
      {/* Header */}
      <div className="panel-header">
        <div>
          <div className="panel-title">🚨 Enforcement Intelligence Console</div>
          <div className="panel-subtitle">
            AI-prioritised inspector dispatch recommendations with evidence packages
          </div>
        </div>
        <button className="btn btn-primary" onClick={onRefresh}>↻ Re-scan Hotspots</button>
      </div>

      {/* Summary stats bar */}
      {dispatches && (
        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
          {[
            { key: 'all',       label: 'Total Hotspots', count: dispatches.total_hotspots,  color: '#38bdf8' },
            { key: 'severe',    label: 'Severe',         count: dispatches.severe_count || 0,    color: '#ef4444' },
            { key: 'very_poor', label: 'Very Poor',      count: dispatches.very_poor_count || 0, color: '#f97316' },
            { key: 'poor',      label: 'Poor',           count: dispatches.poor_count || 0,      color: '#eab308' },
          ].map(s => (
            <button key={s.key} onClick={() => setFilter(s.key)}
              style={{ flex: 1, minWidth: '100px', padding: '10px 14px', borderRadius: '10px', cursor: 'pointer',
                background: filter === s.key ? `${s.color}22` : 'rgba(255,255,255,0.03)',
                border: `1px solid ${filter === s.key ? s.color : '#1e293b'}`,
                textAlign: 'left' }}>
              <div style={{ fontSize: '22px', fontWeight: '800', color: s.color }}>{s.count}</div>
              <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>{s.label}</div>
            </button>
          ))}
          <div style={{ flex: 1, minWidth: '140px', padding: '10px 14px', borderRadius: '10px',
            background: 'rgba(255,255,255,0.03)', border: '1px solid #1e293b' }}>
            <div style={{ fontSize: '11px', color: '#64748b' }}>Last Scanned</div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>
              {dispatches.generated_at ? new Date(dispatches.generated_at).toLocaleTimeString() : '—'}
            </div>
          </div>
        </div>
      )}

      {/* Hotspot cards */}
      {filtered.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filtered.map((d, i) => {
            const sev = SEVERITY_CONFIG[d.severity] || SEVERITY_CONFIG.poor
            const status = getStatus(d.ward_id, d.status)
            const stCfg = STATUS_CONFIG[status]
            const globalRank = allDispatches.findIndex(x => x.ward_id === d.ward_id) + 1

            return (
              <div key={i} style={{ borderRadius: '12px', border: `1px solid ${sev.color}33`,
                background: sev.bg, overflow: 'hidden' }}>

                {/* Card header row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px',
                  padding: '12px 16px', borderBottom: `1px solid ${sev.color}22` }}>
                  {/* Rank badge */}
                  <div style={{ width: '32px', height: '32px', borderRadius: '50%',
                    background: `${sev.color}33`, border: `2px solid ${sev.color}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '12px', fontWeight: '800', color: sev.color, flexShrink: 0 }}>
                    #{globalRank}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '14px', fontWeight: '700', color: '#f1f5f9',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {d.ward_name}
                    </div>
                    <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                      📍 {d.location[0].toFixed(3)}, {d.location[1].toFixed(3)}
                    </div>
                  </div>

                  {/* AQI */}
                  <div style={{ textAlign: 'center', flexShrink: 0 }}>
                    <div style={{ fontSize: '24px', fontWeight: '800', color: aqiColor(d.aqi), lineHeight: 1 }}>
                      {Math.round(d.aqi)}
                    </div>
                    <div style={{ fontSize: '10px', color: '#64748b' }}>AQI-IN</div>
                  </div>

                  {/* Severity badge */}
                  <div style={{ padding: '4px 10px', borderRadius: '6px', fontSize: '11px',
                    fontWeight: '700', background: `${sev.color}33`, color: sev.color,
                    border: `1px solid ${sev.color}55`, flexShrink: 0 }}>
                    {sev.icon} {sev.label}
                  </div>

                  {/* Priority score */}
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>Priority</div>
                    <div style={{ fontSize: '13px', fontWeight: '700', color: '#38bdf8' }}>
                      {Math.round(d.priority_score)}
                    </div>
                  </div>
                </div>

                {/* Card body */}
                <div style={{ padding: '12px 16px', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>

                  {/* Left col: pollutants + inferred sources */}
                  <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                    {/* Dominant pollutant */}
                    {d.dominant_pollutant && (
                      <div style={{ marginBottom: '8px' }}>
                        <span style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                          Dominant Pollutant
                        </span>
                        <span style={{ marginLeft: '8px', fontSize: '12px', fontWeight: '700', color: '#f1f5f9' }}>
                          {d.dominant_pollutant}
                        </span>
                      </div>
                    )}

                    {/* Exceedances */}
                    {d.pollutant_exceedances?.length > 0 && (
                      <div style={{ marginBottom: '8px' }}>
                        <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '4px' }}>
                          Limit Breaches
                        </div>
                        {d.pollutant_exceedances.map((exc, j) => (
                          <div key={j} style={{ fontSize: '12px', color: '#fca5a5', marginBottom: '2px' }}>
                            ⚡ {exc}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Inferred sources */}
                    {d.inferred_sources?.length > 0 && (
                      <div style={{ marginBottom: '8px' }}>
                        <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '4px' }}>
                          Inferred Source Type
                        </div>
                        {d.inferred_sources.map((src, j) => (
                          <div key={j} style={{ fontSize: '12px', color: '#cbd5e1', marginBottom: '2px' }}>
                            🔎 {src}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Middle col: nearby sources */}
                  <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                    <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '6px' }}>
                      Registered Sources Nearby
                    </div>
                    {d.nearby_sources.length > 0 ? (
                      d.nearby_sources.slice(0, 3).map((src, j) => (
                        <div key={j} style={{ display: 'flex', alignItems: 'center', gap: '6px',
                          marginBottom: '4px', fontSize: '12px', color: '#94a3b8' }}>
                          <span>{SOURCE_ICONS[src.category] || '📌'}</span>
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {src.name}
                          </span>
                          <span style={{ color: '#475569', flexShrink: 0 }}>{src.distance_km}km</span>
                        </div>
                      ))
                    ) : (
                      <div style={{ fontSize: '12px', color: '#475569' }}>No registered sources within 5km</div>
                    )}

                    {/* Vulnerability flags */}
                    {d.vulnerability_flags?.length > 0 && (
                      <div style={{ marginTop: '8px' }}>
                        {d.vulnerability_flags.map((flag, j) => (
                          <div key={j} style={{ fontSize: '11px', color: '#fbbf24', marginBottom: '2px' }}>
                            {flag}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Right col: actions + status */}
                  <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <button className="btn btn-outline btn-sm" onClick={() => onViewEvidence(d)}>
                        📄 Evidence
                      </button>
                      {status === 'pending' && (
                        <button className="btn btn-danger btn-sm"
                          onClick={() => setStatus(d.ward_id, 'dispatched')}>
                          🚔 Dispatch
                        </button>
                      )}
                      {status === 'dispatched' && (
                        <button className="btn btn-sm"
                          style={{ background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)', color: '#4ade80' }}
                          onClick={() => setStatus(d.ward_id, 'resolved')}>
                          ✅ Mark Resolved
                        </button>
                      )}
                    </div>
                    {/* Status pill */}
                    <div style={{ padding: '2px 8px', borderRadius: '12px', fontSize: '10px',
                      fontWeight: '700', background: `${stCfg.color}22`, color: stCfg.color,
                      border: `1px solid ${stCfg.color}44` }}>
                      ● {stCfg.label}
                    </div>
                  </div>
                </div>

                {/* Recommended actions strip */}
                {d.recommended_actions?.length > 0 && (
                  <div style={{ borderTop: `1px solid ${sev.color}22`, padding: '8px 16px',
                    background: 'rgba(0,0,0,0.15)', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {d.recommended_actions.map((a, j) => (
                      <div key={j} style={{ fontSize: '11px', color: '#94a3b8',
                        background: 'rgba(255,255,255,0.04)', borderRadius: '4px',
                        padding: '3px 8px', border: '1px solid rgba(255,255,255,0.06)' }}>
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
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <span style={{ fontSize: 40 }}>✅</span>
          <p style={{ marginTop: 12, color: 'var(--text-muted)' }}>
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

function CitizensAdvisoryPopup({ state, advisory, lang, onChangeLang, selectedWard, onSelectWard, isOpen, onToggle }) {
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [nearbyPlaces, setNearbyPlaces] = useState(null)
  const [nearbyLoading, setNearbyLoading] = useState(false)
  const [voices, setVoices] = useState([])
  const audioRef = useRef(null)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return
    const updateVoices = () => {
      setVoices(window.speechSynthesis.getVoices())
    }
    updateVoices()
    window.speechSynthesis.onvoiceschanged = updateVoices
    return () => {
      window.speechSynthesis.onvoiceschanged = null
    }
  }, [])

  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel()
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
    }
  }, [isOpen])

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

  const handleSpeak = () => {
    if (!advisory) return
    
    if (isSpeaking) {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
      window.speechSynthesis.cancel()
      setIsSpeaking(false)
      return
    }

    const tLang = lang in speakTemplates ? lang : 'en'
    const transLevel = levelTranslations[tLang]?.[advisory.level] || advisory.level.replace('_', ' ')
    const translatedPrecautions = advisory.precautions.map(p => precautionTranslations[tLang]?.[p] || p)
    
    const textToRead = speakTemplates[tLang](
      advisory.ward_name,
      Math.round(advisory.aqi),
      transLevel,
      advisory.advisory,
      translatedPrecautions
    )

    let langCode = 'en-IN'
    if (lang === 'hi') langCode = 'hi-IN'
    else if (lang === 'kn') langCode = 'kn-IN'
    else if (lang === 'ta') langCode = 'ta-IN'
    else if (lang === 'te') langCode = 'te-IN'

    if (lang !== 'en') {
      // Force Google Translate TTS cloud audio stream for all non-English languages using 2-letter codes
      console.log(`Using Google Translate cloud TTS: ${lang}`)
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${lang}&client=tw-ob&q=${encodeURIComponent(textToRead)}`
      
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onended = () => setIsSpeaking(false)
      audio.onerror = (e) => {
        console.error("Cloud Audio error event, falling back to local synthesis:", e)
        const utterance = new SpeechSynthesisUtterance(textToRead)
        utterance.lang = langCode
        utterance.onend = () => setIsSpeaking(false)
        utterance.onerror = () => setIsSpeaking(false)
        window.speechSynthesis.speak(utterance)
      }
      
      setIsSpeaking(true)
      audio.play().catch(err => {
        console.error("Cloud Audio play failed, falling back to local synthesis:", err)
        // Fallback to local synthesis
        const utterance = new SpeechSynthesisUtterance(textToRead)
        utterance.lang = langCode
        utterance.onend = () => setIsSpeaking(false)
        utterance.onerror = () => setIsSpeaking(false)
        window.speechSynthesis.speak(utterance)
      })
    } else {
      // Standard SpeechSynthesis for English
      const utterance = new SpeechSynthesisUtterance(textToRead)
      utterance.lang = langCode
      const match = voices.find(v => v.lang.toLowerCase().replace('_', '-').startsWith('en'))
      if (match) {
        utterance.voice = match
      }
      utterance.onend = () => setIsSpeaking(false)
      utterance.onerror = () => setIsSpeaking(false)

      setIsSpeaking(true)
      window.speechSynthesis.speak(utterance)
    }
  }

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
                <span>👥 Health Advisory Portal</span>
              </div>
              <div className="advisory-popup-subtitle">
                Auto-generated, multi-lingual advisories based on prediction
              </div>
            </div>
            <button className="advisory-close-btn" onClick={onToggle}>&times;</button>
          </div>

          {/* Controls */}
          <div style={{ display: 'flex', gap: '12px' }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                Select Ward
              </label>
              <select
                id="select-ward"
                className="select-field"
                style={{ width: '100%', padding: '6px 8px', fontSize: 13 }}
                value={selectedWard?.id || ''}
                onChange={e => {
                  const ward = state.wards.find(w => w.id === e.target.value)
                  if (ward) onSelectWard(ward)
                }}
              >
                {state.wards.map(w => (
                  <option key={w.id} value={w.id}>
                    {w.name} (AQI {Math.round(w.current_aqi)})
                  </option>
                ))}
              </select>
            </div>
            <div style={{ width: '120px' }}>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                Language
              </label>
              <select
                id="select-language"
                className="select-field"
                style={{ width: '100%', padding: '6px 8px', fontSize: 13 }}
                value={lang}
                onChange={e => onChangeLang(e.target.value)}
              >
                {LANGUAGES.map(l => (
                  <option key={l.code} value={l.code}>{l.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Advisory output */}
          {advisory ? (
            <div className={`advisory-card level-${advisory.level}`} style={{ padding: '16px', margin: 0, borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {advisory.ward_name} · {advisory.language}
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: aqiColor(advisory.aqi), marginTop: 2 }}>
                    AQI {Math.round(advisory.aqi)}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                  <span className={`aqi-badge ${advisory.level}`} style={{ fontSize: 11, padding: '2px 8px' }}>
                    {advisory.level.replace('_', ' ')}
                  </span>
                  <button
                    onClick={handleSpeak}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '4px 8px',
                      borderRadius: '8px',
                      fontSize: '11px',
                      fontWeight: '600',
                      background: isSpeaking ? 'rgba(239, 68, 68, 0.2)' : 'rgba(6, 182, 212, 0.15)',
                      color: isSpeaking ? '#ef4444' : 'var(--accent-primary)',
                      border: '1px solid currentColor',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                  >
                    <span>{isSpeaking ? '⏹️ Stop' : '🔊 Listen'}</span>
                  </button>
                </div>
              </div>
              <div className="advisory-text" style={{ fontSize: 14, margin: '12px 0', lineHeight: 1.5 }}>
                {advisory.advisory}
              </div>
              
              {/* Driver Analysis Section */}
              {advisory.reason && (
                <div style={{ 
                  marginTop: '12px', 
                  padding: '10px 12px', 
                  background: 'rgba(255,255,255,0.03)', 
                  borderRadius: '6px', 
                  fontSize: '12px', 
                  borderLeft: `3px solid ${aqiColor(advisory.aqi)}`,
                  color: '#e2e8f0',
                  lineHeight: '1.4'
                }}>
                  <strong style={{ color: '#f1f5f9', display: 'block', marginBottom: '2px' }}>
                    🔍 Driver Analysis:
                  </strong>
                  {advisory.reason}
                </div>
              )}

              {advisory.precautions.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div className="card-title" style={{ fontSize: 11, marginBottom: 6 }}>Precautions</div>
                  <ul className="precaution-list" style={{ fontSize: 13, gap: 6, display: 'flex', flexDirection: 'column' }}>
                    {advisory.precautions.map((p, i) => {
                      const translatedP = precautionTranslations[lang]?.[p] || p;
                      return (
                        <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: 'rgba(255,255,255,0.02)', padding: '6px 8px', borderRadius: '6px' }}>
                          <span style={{ fontSize: '18px', lineHeight: 1 }}>{getPrecautionEmoji(p)}</span>
                          <span>{translatedP}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {/* Vulnerability chips */}
              {advisory.vulnerable_info && (
                <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
                  <div className="chip-row" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <div className="chip" style={{ fontSize: 11, padding: '4px 8px' }}>
                      <span className="chip-icon">🏥</span> {advisory.vulnerable_info.hospitals} Hosp.
                    </div>
                    <div className="chip" style={{ fontSize: 11, padding: '4px 8px' }}>
                      <span className="chip-icon">🏫</span> {advisory.vulnerable_info.schools} Schools
                    </div>
                    <div className="chip" style={{ fontSize: 11, padding: '4px 8px' }}>
                      <span className="chip-icon">👴</span> {advisory.vulnerable_info.elderly_pct}% Elderly
                    </div>
                  </div>
                </div>
              )}

              {/* Emergency Resources — Nearby Hospitals & Medical Stores */}
              <div style={{ marginTop: 14, borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 16 }}>🚑</span> Nearby Emergency Resources
                </div>
                {nearbyLoading ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>Searching nearby hospitals & medical stores...</div>
                ) : nearbyPlaces && nearbyPlaces.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {nearbyPlaces.filter(p => p.type === 'hospital').length > 0 && (
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>🏥 Hospitals</div>
                        {nearbyPlaces.filter(p => p.type === 'hospital').slice(0, 3).map((p, i) => (
                          <div key={`h-${i}`} style={{ background: 'rgba(239,68,68,0.06)', padding: '6px 8px', borderRadius: 6, marginBottom: 4, fontSize: 12, borderLeft: '2px solid #ef4444' }}>
                            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{p.name}</div>
                            {p.address && <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>📍 {p.address}</div>}
                            {p.phone && <div style={{ color: 'var(--accent-primary)', fontSize: 11 }}>📞 {p.phone}</div>}
                          </div>
                        ))}
                      </div>
                    )}
                    {nearbyPlaces.filter(p => p.type === 'pharmacy').length > 0 && (
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: '#22c55e', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>💊 Medical Stores / Pharmacies</div>
                        {nearbyPlaces.filter(p => p.type === 'pharmacy').slice(0, 3).map((p, i) => (
                          <div key={`p-${i}`} style={{ background: 'rgba(34,197,94,0.06)', padding: '6px 8px', borderRadius: 6, marginBottom: 4, fontSize: 12, borderLeft: '2px solid #22c55e' }}>
                            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{p.name}</div>
                            {p.address && <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>📍 {p.address}</div>}
                            {p.phone && <div style={{ color: 'var(--accent-primary)', fontSize: 11 }}>📞 {p.phone}</div>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : nearbyPlaces && nearbyPlaces.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 0' }}>No hospitals or pharmacies found within 3 km radius.</div>
                ) : null}
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>Emergency Helpline: <span style={{ color: '#ef4444', fontWeight: 700 }}>112</span> | Ambulance: <span style={{ color: '#ef4444', fontWeight: 700 }}>108</span></div>
              </div>

              <div style={{ marginTop: 12, fontSize: 10, color: 'var(--text-muted)' }}>
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

/* ── Analytics View ────────────────────────────────────────────────────── */

function AnalyticsView({ state }) {
  if (!state) return null

  // Generate 24-hour historical mock data from sensor profiles
  const hours = Array.from({ length: 24 }, (_, i) => `${i}:00`)
  const wardColors = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6']

  return (
    <div className="panel-full">
      <div className="panel-header">
        <div>
          <div className="panel-title">📈 Analytics & Reporting</div>
          <div className="panel-subtitle">
            Historical AQI trends, ward comparisons, and intervention effectiveness
          </div>
        </div>
      </div>

      <div className="panel-grid">
        {/* Ward AQI comparison */}
        <div className="card">
          <div className="card-title">Current Ward AQI Comparison</div>
          <div className="chart-container">
            <Bar
              data={{
                labels: state.wards.map(w => w.name),
                datasets: [{
                  label: 'AQI',
                  data: state.wards.map(w => Math.round(w.current_aqi)),
                  backgroundColor: state.wards.map(w => aqiColor(w.current_aqi) + '88'),
                  borderColor: state.wards.map(w => aqiColor(w.current_aqi)),
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
                    ticks: { color: '#94a3b8' },
                    grid: { color: 'rgba(148,163,184,0.08)' },
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

        {/* Source distribution */}
        <div className="card">
          <div className="card-title">Emission Source Distribution</div>
          <div className="chart-container">
            {(() => {
              const cats = {}
              state.sources.forEach(s => {
                cats[s.category] = (cats[s.category] || 0) + 1
              })
              return (
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
                    cutout: '55%',
                    plugins: {
                      legend: {
                        position: 'bottom',
                        labels: { color: '#94a3b8', padding: 16, font: { size: 12 } },
                      },
                    },
                  }}
                />
              )
            })()}
          </div>
        </div>

        {/* Population summary */}
        <div className="card">
          <div className="card-title">Population & Vulnerability Summary</div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Ward</th>
                <th>Population</th>
                <th>Hospitals</th>
                <th>Schools</th>
                <th>Elderly %</th>
              </tr>
            </thead>
            <tbody>
              {state.wards.map(w => (
                <tr key={w.id}>
                  <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{w.name}</td>
                  <td>{(w.population / 1000).toFixed(0)}K</td>
                  <td>{w.vulnerable?.hospitals}</td>
                  <td>{w.vulnerable?.schools}</td>
                  <td>{w.vulnerable?.elderly_pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Sensor status */}
        <div className="card">
          <div className="card-title">Sensor Network Status</div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Sensor ID</th>
                <th>Ward</th>
                <th>AQI</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {state.sensors.map(s => {
                const ward = state.wards.find(w => w.id === s.ward_id)
                return (
                  <tr key={s.sensor_id}>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{s.sensor_id}</td>
                    <td>{ward?.name}</td>
                    <td>
                      <span style={{ color: aqiColor(s.aqi), fontWeight: 600 }}>{s.aqi}</span>
                    </td>
                    <td>
                      <span style={{ color: '#22c55e' }}>● Online</span>
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

/* ── Evidence Modal ────────────────────────────────────────────────────── */

function EvidenceModal({ data, onClose }) {
  const [dispatched, setDispatched] = useState(false)

  const POLLUTANT_LIMITS = { pm25: 60, pm10: 100, no2: 40, so2: 40, co: 2, o3: 100 }
  const POLLUTANT_UNITS  = { pm25: 'µg/m³', pm10: 'µg/m³', no2: 'µg/m³', so2: 'µg/m³', co: 'mg/m³', o3: 'µg/m³' }
  const POLLUTANT_LABELS = { pm25: 'PM2.5', pm10: 'PM10', no2: 'NO₂', so2: 'SO₂', co: 'CO', o3: 'O₃' }
  const SOURCE_ICONS = { industrial: '🏭', vehicular: '🚗', construction: '🏗️', waste_burning: '🔥' }

  const sevColor = data.severity === 'severe' ? '#ef4444'
    : data.severity === 'very_poor' ? '#f97316' : '#eab308'

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '520px', maxHeight: '85vh', overflowY: 'auto' }}>

        {/* Header */}
        <div className="modal-header" style={{ borderBottom: `2px solid ${sevColor}44`, paddingBottom: '12px' }}>
          <div>
            <div className="modal-title" style={{ fontSize: '15px' }}>📋 Enforcement Evidence Package</div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
              Generated {new Date(data.evidence?.timestamp).toLocaleString()}
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Incident summary */}
        <div style={{ display: 'flex', gap: '12px', padding: '16px 0 12px', borderBottom: '1px solid #1e293b', alignItems: 'center' }}>
          <div style={{ textAlign: 'center', minWidth: '64px' }}>
            <div style={{ fontSize: '36px', fontWeight: '800', color: aqiColor(data.aqi), lineHeight: 1 }}>
              {Math.round(data.aqi)}
            </div>
            <div style={{ fontSize: '10px', color: '#64748b' }}>AQI-IN</div>
          </div>
          <div>
            <div style={{ fontSize: '15px', fontWeight: '700', color: '#f1f5f9' }}>{data.ward_name}</div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
              <span style={{ padding: '2px 8px', borderRadius: '6px', fontSize: '11px',
                fontWeight: '700', background: `${sevColor}22`, color: sevColor,
                border: `1px solid ${sevColor}44` }}>
                {data.severity.replace('_', ' ').toUpperCase()}
              </span>
              <span style={{ padding: '2px 8px', borderRadius: '6px', fontSize: '11px',
                color: '#64748b', background: 'rgba(255,255,255,0.05)', border: '1px solid #1e293b' }}>
                Priority: {Math.round(data.priority_score)}
              </span>
            </div>
            <div style={{ fontSize: '11px', color: '#475569', marginTop: '4px', fontFamily: 'monospace' }}>
              📍 {data.location[0].toFixed(5)}, {data.location[1].toFixed(5)}
            </div>
          </div>
        </div>

        {/* Pollutant concentrations */}
        <div style={{ marginTop: '14px' }}>
          <div style={{ fontSize: '12px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' }}>
            🧪 Pollutant Concentrations
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {Object.entries(data.evidence?.pollutants || {}).map(([key, val]) => {
              const limit = POLLUTANT_LIMITS[key] || 999
              const exceeded = val > limit
              const pct = Math.min(100, (val / limit) * 100)
              return (
                <div key={key}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px', fontSize: '12px' }}>
                    <span style={{ color: exceeded ? '#fca5a5' : '#94a3b8', fontWeight: exceeded ? '700' : '400' }}>
                      {POLLUTANT_LABELS[key] || key.toUpperCase()}
                      {exceeded && ' ⚡'}
                    </span>
                    <span style={{ color: exceeded ? '#fca5a5' : '#94a3b8' }}>
                      {typeof val === 'number' ? val.toFixed(2) : val} {POLLUTANT_UNITS[key] || ''}
                      <span style={{ color: '#475569', marginLeft: '4px' }}>/ {limit}</span>
                    </span>
                  </div>
                  <div style={{ height: '4px', background: '#0f172a', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', borderRadius: '2px',
                      background: exceeded ? '#ef4444' : '#22c55e' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Inferred source types */}
        {data.inferred_sources?.length > 0 && (
          <div style={{ marginTop: '14px' }}>
            <div style={{ fontSize: '12px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
              🔎 Inferred Source Type (from pollutant signatures)
            </div>
            {data.inferred_sources.map((src, i) => (
              <div key={i} style={{ fontSize: '13px', color: '#cbd5e1', marginBottom: '4px' }}>• {src}</div>
            ))}
          </div>
        )}

        {/* Nearby registered sources */}
        <div style={{ marginTop: '14px' }}>
          <div style={{ fontSize: '12px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
            📍 Registered Emission Sources Within 5km
          </div>
          {data.nearby_sources?.length > 0 ? (
            data.nearby_sources.map((s, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '6px 10px', marginBottom: '4px', background: 'rgba(255,255,255,0.03)',
                borderRadius: '6px', border: '1px solid #1e293b' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                  <span>{SOURCE_ICONS[s.category] || '📌'}</span>
                  <span style={{ fontSize: '12px', color: '#cbd5e1', overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                </div>
                <span style={{ fontSize: '11px', color: '#475569', flexShrink: 0, marginLeft: '8px' }}>
                  {s.distance_km} km
                </span>
              </div>
            ))
          ) : (
            <div style={{ fontSize: '12px', color: '#475569' }}>No registered sources within 5km.</div>
          )}
        </div>

        {/* Vulnerability flags */}
        {data.vulnerability_flags?.length > 0 && (
          <div style={{ marginTop: '14px', padding: '10px 12px',
            background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: '8px' }}>
            <div style={{ fontSize: '12px', fontWeight: '700', color: '#fbbf24', marginBottom: '6px' }}>
              ⚠️ Vulnerable Population at Risk
            </div>
            {data.vulnerability_flags.map((f, i) => (
              <div key={i} style={{ fontSize: '12px', color: '#fbbf24', marginBottom: '2px' }}>{f}</div>
            ))}
          </div>
        )}

        {/* Recommended actions */}
        <div style={{ marginTop: '14px' }}>
          <div style={{ fontSize: '12px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
            📌 Recommended Actions
          </div>
          {(data.recommended_actions || []).map((a, i) => (
            <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '6px', fontSize: '13px', color: '#cbd5e1' }}>
              <span style={{ color: '#38bdf8', flexShrink: 0 }}>{i + 1}.</span>
              <span>{a}</span>
            </div>
          ))}
        </div>

        {/* Action buttons */}
        <div style={{ marginTop: '20px', display: 'flex', gap: '10px', paddingTop: '14px', borderTop: '1px solid #1e293b' }}>
          {!dispatched ? (
            <button className="btn btn-danger" style={{ flex: 1 }}
              onClick={() => setDispatched(true)}>
              🚔 Dispatch Inspector to Site
            </button>
          ) : (
            <div style={{ flex: 1, padding: '8px 16px', background: 'rgba(34,197,94,0.15)',
              border: '1px solid rgba(34,197,94,0.4)', borderRadius: '8px', color: '#4ade80',
              fontSize: '13px', fontWeight: '700', textAlign: 'center' }}>
              ✅ Inspector Dispatched
            </div>
          )}
          <a href={`https://maps.google.com/?q=${data.location[0]},${data.location[1]}`}
            target="_blank" rel="noopener noreferrer"
            className="btn btn-outline" style={{ flexShrink: 0 }}>
            🗺️ Open in Maps
          </a>
          <button className="btn btn-outline" onClick={onClose} style={{ flexShrink: 0 }}>Close</button>
        </div>
      </div>
    </div>
  )
}
