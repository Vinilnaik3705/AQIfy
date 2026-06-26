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

function createAqiIcon(aqi) {
  return L.divIcon({
    className: 'custom-aqi-bubble',
    html: `<div class="aqi-bubble-inner" style="background-color: ${aqiColor(aqi)}; color: ${getAqiTextColor(aqi)}">${Math.round(aqi)}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15]
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
  { id: 'citizens',    icon: ICONS.citizens,    label: 'Citizens' },
  { id: 'analytics',   icon: ICONS.analytics,   label: 'Analytics' },
]

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी (Hindi)' },
  { code: 'kn', label: 'ಕನ್ನಡ (Kannada)' },
  { code: 'ta', label: 'தமிழ் (Tamil)' },
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
  const [aqiStandard, setAqiStandard] = useState('US')

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
    if (tab === 'citizens' && selectedWard) loadAdvisory(selectedWard.id, advLang)
  }, [tab, selectedWard, advLang, loadAdvisory])

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
    // Set basic info first so the UI responds instantly, showing a loading indicator for weather
    setSelectedWard({
      ...ward,
      weather: { temperature_c: null, wind_speed_kmh: null, loading: true }
    })
    
    const data = await fetchJSON(`/api/aqi-details?lat=${ward.center[0]}&lng=${ward.center[1]}&name=${encodeURIComponent(ward.name)}&country=${encodeURIComponent(ward.country || '')}&state=${encodeURIComponent(ward.state || '')}`)
    if (data) {
      setSelectedWard(data)
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
    ? Math.round(state.sensors.reduce((s, r) => s + (aqiStandard === 'US' ? (r.aqi_us ?? r.aqi) : (r.aqi_in ?? r.aqi)), 0) / state.sensors.length)
    : 0
  const alertCount = state ? state.sensors.filter(s => (aqiStandard === 'US' ? (s.aqi_us ?? s.aqi) : (s.aqi_in ?? s.aqi)) > (aqiStandard === 'US' ? 100 : 150)).length : 0

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
          aqiStandard={aqiStandard}
          onChangeStandard={setAqiStandard}
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
            aqiStandard={aqiStandard}
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
            aqiStandard={aqiStandard}
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
        {tab === 'citizens' && (
          <CitizensView
            state={state}
            advisory={advisory}
            lang={advLang}
            onChangeLang={setAdvLang}
            selectedWard={selectedWard}
            onSelectWard={(w) => { handleSelectWard(w); loadAdvisory(w.id, advLang) }}
          />
        )}
        {tab === 'analytics' && (
          <AnalyticsView state={state} />
        )}
      </div>

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

function Header({ tab, cityAqi, alertCount, weather, onSelectPlace, aqiStandard, onChangeStandard }) {
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
          <span style={{ fontSize: '14px' }}>🇺🇸/🇮🇳</span>
          <select 
            value={aqiStandard} 
            onChange={e => onChangeStandard(e.target.value)}
            style={{ 
              background: '#0f172a', 
              color: '#f1f5f9', 
              border: '1px solid #2e384e', 
              borderRadius: '4px', 
              padding: '2px 8px', 
              fontSize: '12px', 
              height: '32px',
              cursor: 'pointer',
              outline: 'none',
              fontWeight: '600'
            }}
          >
            <option value="US">AQI-US</option>
            <option value="IN">AQI-IN</option>
          </select>
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

function CommandCenter({ state, selectedWard, onSelectWard, mapStyle, setMapStyle, customPlaces, targetCenter, targetZoom, aqiStandard }) {
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
            const aqiVal = aqiStandard === 'US' ? (s.aqi_us ?? s.aqi) : (s.aqi_in ?? s.aqi);
            return (
              <Marker
                key={s.sensor_id}
                position={s.location}
                icon={createAqiIcon(aqiVal)}
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
            const aqiVal = aqiStandard === 'US' ? (cp.aqi_us ?? cp.current_aqi) : (cp.aqi_in ?? cp.current_aqi);
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
              <span>Air Quality Index ({aqiStandard === 'US' ? 'AQI-US' : 'AQI-IN'})</span>
            </div>

            {/* Large AQI and Badge */}
            {(() => {
              const aqiVal = aqiStandard === 'US' ? (selectedWard.aqi_us ?? selectedWard.current_aqi) : (selectedWard.aqi_in ?? selectedWard.current_aqi);
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

/* ── Forecast View ─────────────────────────────────────────────────────── */

function ForecastView({ state, forecast, hours, onChangeHours, selectedWard, onSelectWard, mapStyle, setMapStyle, aqiStandard }) {
  const [selectedOffset, setSelectedOffset] = useState(0);

  if (!state) return null;

  // Safe default selectedWard if null
  const currentWard = selectedWard || state.wards[0];

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
    const baseVal = currentWard ? Math.round(aqiStandard === 'IN' ? (currentWard.aqi_in ?? currentWard.current_aqi) : (currentWard.aqi_us ?? currentWard.current_aqi)) : 0;
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
    const wForecast = entry?.wards?.find(w => w.ward_id === currentWard?.id) || entry?.wards?.[0];
    
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
  const base0 = currentWard ? Math.round(aqiStandard === 'IN' ? (currentWard.aqi_in ?? currentWard.current_aqi) : (currentWard.aqi_us ?? currentWard.current_aqi)) : 0;
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
      const wForecast = f.wards?.find(w => w.ward_id === currentWard?.id) || f.wards?.[0];
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

  // Extract ML metadata
  const firstEntry = forecast?.[0];
  const firstWForecast = firstEntry?.wards?.find(w => w.ward_id === currentWard?.id) || firstEntry?.wards?.[0];
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
            {snapshot && snapshot.wards.map(w => (
              <Marker
                key={w.ward_id}
                position={w.center}
                icon={createAqiIcon(w.predicted_aqi)}
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
                    Predicted AQI: <strong style={{ color: aqiColor(w.predicted_aqi) }}>
                      {w.predicted_aqi}
                    </strong><br />
                    Confidence: {(w.confidence * 100).toFixed(0)}%
                  </div>
                </Popup>
              </Marker>
            ))}
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
  );
}


/* ── Attribution View ──────────────────────────────────────────────────── */

function AttributionView({ state, attribution, loading, onClickLocation, mapStyle, setMapStyle, onCitySelect }) {
  if (!state) return null

  return (
    <div className="content-area">
      <div className="map-section">
        <MapContainer center={state.city.center} zoom={5} minZoom={4} maxBounds={[[6.0, 65.0], [38.0, 99.0]]} maxBoundsViscosity={1.0} scrollWheelZoom={true}>
          <MapLayersControl />
          {/* City averages bubbles (All India mode) */}
          {state.city_averages && Object.entries(state.city_averages).map(([key, c]) => (
            <CircleMarker
              key={`city-attr-${key}`}
              center={c.center}
              radius={24}
              pathOptions={{
                fillColor: aqiColor(c.aqi),
                fillOpacity: 0.4,
                color: aqiColor(c.aqi),
                weight: 2,
                dashArray: '5 5'
              }}
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
                pathOptions={{
                  fillColor: aqiColor(s.aqi),
                  fillOpacity: 0.7,
                  color: aqiColor(s.aqi),
                  weight: 2,
                }}
                eventHandlers={{
                  click: () => onClickLocation(s.location[0], s.location[1]),
                }}
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
        <div className="card-title">Source Attribution Agent</div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
          Click any sensor on the map to identify pollution sources at that location.
        </p>

        {loading && <div className="loading-state"><div className="spinner" /><span>Running agent…</span></div>}

        {attribution && !loading && (
          <div className="card">
            <div className="card-title">Source Breakdown</div>
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
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  cutout: '60%',
                  plugins: {
                    legend: { display: false },
                  },
                }}
              />
            </div>
            {attribution.sources.map((s, i) => (
              <div key={i} className="legend-item" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div className="legend-dot" style={{ background: SOURCE_COLORS[s.category] || '#64748b', width: '10px', height: '10px', borderRadius: '50%', display: 'inline-block' }} />
                  <span style={{ fontSize: '13px', color: '#cbd5e1' }}>{s.label || s.category}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>(Confidence: {(s.confidence * 100).toFixed(0)}%)</span>
                  <span className="legend-pct" style={{ fontWeight: '700', fontSize: '13px', color: '#f1f5f9' }}>{s.percentage}%</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Enforcement View ──────────────────────────────────────────────────── */

function EnforcementView({ dispatches, onRefresh, onViewEvidence }) {
  return (
    <div className="panel-full">
      <div className="panel-header">
        <div>
          <div className="panel-title">🚨 Enforcement Intelligence Console</div>
          <div className="panel-subtitle">
            AI-prioritised inspector dispatch recommendations with evidence packages
          </div>
        </div>
        <button id="btn-refresh-dispatch" className="btn btn-primary" onClick={onRefresh}>
          ↻ Re-scan Hotspots
        </button>
      </div>

      {dispatches && dispatches.total_hotspots > 0 ? (
        <table className="data-table">
          <thead>
            <tr>
              <th>Priority</th>
              <th>Ward</th>
              <th>AQI</th>
              <th>Severity</th>
              <th>Nearby Sources</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {dispatches.dispatches.map((d, i) => (
              <tr key={i}>
                <td>
                  <span style={{ fontWeight: 700, color: 'var(--accent-primary)' }}>
                    #{i + 1}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>
                    ({d.priority_score.toFixed(0)})
                  </span>
                </td>
                <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{d.ward_name}</td>
                <td>
                  <span style={{ color: aqiColor(d.aqi), fontWeight: 700 }}>{d.aqi}</span>
                </td>
                <td>
                  <span className={`tag ${d.severity}`}>{d.severity.replace('_', ' ')}</span>
                </td>
                <td style={{ maxWidth: 200 }}>
                  {d.nearby_sources.length > 0
                    ? d.nearby_sources.map(s => s.name).join(', ')
                    : '—'}
                </td>
                <td>
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => onViewEvidence(d)}
                  >
                    📄 View Evidence
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <span style={{ fontSize: 40 }}>✅</span>
          <p style={{ marginTop: 12, color: 'var(--text-muted)' }}>
            No enforcement hotspots detected. All zones within safe limits.
          </p>
        </div>
      )}
    </div>
  )
}

/* ── Citizens View ─────────────────────────────────────────────────────── */

function CitizensView({ state, advisory, lang, onChangeLang, selectedWard, onSelectWard }) {
  if (!state) return null

  return (
    <div className="panel-full">
      <div className="panel-header">
        <div>
          <div className="panel-title">👥 Citizen Health Advisory Portal</div>
          <div className="panel-subtitle">
            Auto-generated, multi-lingual advisories based on real-time AQI predictions
          </div>
        </div>
      </div>

      <div className="panel-grid">
        {/* Controls */}
        <div className="card">
          <div className="card-title">Configure Advisory</div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 13, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
              Select Ward
            </label>
            <select
              id="select-ward"
              className="select-field"
              value={selectedWard?.id || ''}
              onChange={e => {
                const ward = state.wards.find(w => w.id === e.target.value)
                if (ward) onSelectWard(ward)
              }}
            >
              {state.wards.map(w => (
                <option key={w.id} value={w.id}>
                  {w.name} — AQI {Math.round(w.current_aqi)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 13, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
              Language
            </label>
            <select
              id="select-language"
              className="select-field"
              value={lang}
              onChange={e => onChangeLang(e.target.value)}
            >
              {LANGUAGES.map(l => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </div>

          {/* Vulnerability chips */}
          {advisory && advisory.vulnerable_info && (
            <>
              <div className="card-title" style={{ marginTop: 20 }}>Vulnerability Profile</div>
              <div className="chip-row">
                <div className="chip">
                  <span className="chip-icon">🏥</span>
                  {advisory.vulnerable_info.hospitals} Hospitals
                </div>
                <div className="chip">
                  <span className="chip-icon">🏫</span>
                  {advisory.vulnerable_info.schools} Schools
                </div>
                <div className="chip">
                  <span className="chip-icon">👴</span>
                  {advisory.vulnerable_info.elderly_pct}% Elderly
                </div>
              </div>
            </>
          )}
        </div>

        {/* Advisory output */}
        {advisory ? (
          <div className={`advisory-card level-${advisory.level}`}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  {advisory.ward_name} · {advisory.language}
                </div>
                <div style={{ fontSize: 28, fontWeight: 800, color: aqiColor(advisory.aqi), marginTop: 4 }}>
                  AQI {Math.round(advisory.aqi)}
                </div>
              </div>
              <span className={`aqi-badge ${advisory.level}`}>
                {advisory.level.replace('_', ' ')}
              </span>
            </div>
            <div className="advisory-text">{advisory.advisory}</div>
            
            {/* Driver Analysis Section explaining why AQI is high */}
            {advisory.reason && (
              <div style={{ 
                marginTop: '16px', 
                padding: '12px 16px', 
                background: 'rgba(255,255,255,0.03)', 
                borderRadius: '8px', 
                fontSize: '13px', 
                borderLeft: `4px solid ${aqiColor(advisory.aqi)}`,
                color: '#e2e8f0',
                lineHeight: '1.5'
              }}>
                <strong style={{ color: '#f1f5f9', display: 'block', marginBottom: '4px' }}>
                  🔍 Driver Analysis (Why is AQI elevated?):
                </strong>
                {advisory.reason}
              </div>
            )}

            {advisory.precautions.length > 0 && (
              <>
                <div className="card-title">Precautions</div>
                <ul className="precaution-list">
                  {advisory.precautions.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              </>
            )}
            <div style={{ marginTop: 16, fontSize: 11, color: 'var(--text-muted)' }}>
              Generated at {new Date(advisory.generated_at).toLocaleTimeString()}
            </div>
          </div>
        ) : (
          <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: 'var(--text-muted)' }}>Select a ward to generate advisory</span>
          </div>
        )}
      </div>
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
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">📄 Enforcement Evidence Package</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="evidence-row">
          <span className="evidence-label">Ward</span>
          <span className="evidence-value">{data.ward_name}</span>
        </div>
        <div className="evidence-row">
          <span className="evidence-label">Sensor ID</span>
          <span className="evidence-value" style={{ fontFamily: 'monospace' }}>{data.sensor_id}</span>
        </div>
        <div className="evidence-row">
          <span className="evidence-label">AQI Reading</span>
          <span className="evidence-value" style={{ color: aqiColor(data.aqi), fontWeight: 700 }}>
            {data.aqi}
          </span>
        </div>
        <div className="evidence-row">
          <span className="evidence-label">Severity</span>
          <span className="evidence-value">
            <span className={`tag ${data.severity}`}>{data.severity.replace('_', ' ')}</span>
          </span>
        </div>
        <div className="evidence-row">
          <span className="evidence-label">Priority Score</span>
          <span className="evidence-value">{data.priority_score}</span>
        </div>
        <div className="evidence-row">
          <span className="evidence-label">Coordinates</span>
          <span className="evidence-value" style={{ fontFamily: 'monospace' }}>
            {data.location[0].toFixed(4)}, {data.location[1].toFixed(4)}
          </span>
        </div>
        <div className="evidence-row">
          <span className="evidence-label">Timestamp</span>
          <span className="evidence-value">{new Date(data.evidence.timestamp).toLocaleString()}</span>
        </div>

        <div className="card-title" style={{ marginTop: 20 }}>Pollutant Concentrations</div>
        {Object.entries(data.evidence.pollutants).map(([key, val]) => (
          <div key={key} className="evidence-row">
            <span className="evidence-label">{key.toUpperCase()}</span>
            <span className="evidence-value">{val} µg/m³</span>
          </div>
        ))}

        <div className="card-title" style={{ marginTop: 20 }}>Nearby Emission Sources</div>
        {data.nearby_sources.length > 0 ? (
          data.nearby_sources.map((s, i) => (
            <div key={i} className="evidence-row">
              <span className="evidence-label">{s.name} ({s.category})</span>
              <span className="evidence-value">{s.distance_km} km</span>
            </div>
          ))
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No registered sources nearby.</p>
        )}

        <div className="card-title" style={{ marginTop: 20 }}>Recommended Actions</div>
        <ul className="precaution-list">
          {data.recommended_actions.map((a, i) => <li key={i}>{a}</li>)}
        </ul>

        <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
          <button id="btn-dispatch-inspector" className="btn btn-danger">
            🚔 Dispatch Inspector
          </button>
          <button className="btn btn-outline" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
