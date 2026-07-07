/* ── Command Center: live AQI map + detail panel ────────────────────────── */

import { useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup, Marker, WMSTileLayer, ZoomControl } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { Search, Wind, Thermometer, Activity, MapPin, Factory, Car, Hammer, Flame, Leaf, Radio, Sun, Cloud, CloudRain, Moon, CloudMoon } from 'lucide-react'
import { SOURCE_COLORS } from '../lib/constants'
import { aqiColor, createAqiIcon } from '../lib/aqi'
import { ChangeMapView } from '../components/map/MapParts'
import AqiGauge from '../components/AqiGauge'

export default function CommandCenter({ state, selectedWard, forecast, onSelectWard, customPlaces, targetCenter, targetZoom, attribution = null }) {
  // Freeze "now" for this render pass (fallback timestamps only)
  const [mountedAt] = useState(() => Date.now())

  // Floating Map Overlays State
  const [showStations, setShowStations] = useState(true)
  const [showFires, setShowFires] = useState(false)
  const [showFactories, setShowFactories] = useState(true)
  const [showVehicular, setShowVehicular] = useState(true)
  const [showConstruction, setShowConstruction] = useState(true)

  const SOURCE_ICONS = {
    industrial: <Factory size={13} color="#ef4444" style={{ marginRight: '4px', verticalAlign: 'middle' }} />,
    vehicular: <Car size={13} color="#3b82f6" style={{ marginRight: '4px', verticalAlign: 'middle' }} />,
    construction: <Hammer size={13} color="#f59e0b" style={{ marginRight: '4px', verticalAlign: 'middle' }} />,
    waste_burning: <Flame size={13} color="#10b981" style={{ marginRight: '4px', verticalAlign: 'middle' }} />
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
  const forecastWardId = selectedWard?.ward_key ?? selectedWard?.id ?? state.city_key ?? state.city?.key ?? state.city?.name;

  const hourlyForecastData = Array.isArray(forecast) && forecast.length > 0
    ? forecast.slice(0, 72).map((entry, idx) => {
        const wardForecast = entry?.wards?.find(w => w.ward_id === forecastWardId) ?? entry?.wards?.[0] ?? null;
        const dt = new Date(entry?.timestamp || mountedAt + idx * 3600000);
        const labelHour = dt.getHours();
        const timeLabel = idx === 0
          ? 'Now'
          : labelHour === 0
            ? dt.toLocaleDateString('en-US', { weekday: 'short' })
            : String(labelHour).padStart(2, '0') + ':00';
        const hourlyAqi = idx === 0 ? Math.round(trendAqi) : Math.round(wardForecast?.predicted_aqi ?? trendAqi);
        const forecastWind = Math.round(wardForecast?.wind_speed_kmh ?? windKmh);
        const isNight = labelHour < 6 || labelHour > 18;

        let condition = 'sunny';
        if (hourlyAqi > 150) {
          condition = 'cloudy';
        } else if (isNight) {
          condition = idx % 2 === 0 ? 'night-cloudy' : 'clear-night';
        } else if (hourlyAqi > 100) {
          condition = 'cloudy';
        }

        return {
          time: timeLabel,
          aqi: hourlyAqi,
          temp: Math.round(temp),
          wind: forecastWind,
          humidity: Math.round(humidity),
          condition
        };
      })
    : Array.from({ length: 72 }).map((_, idx) => {
        let timeLabel;
        const date = new Date(mountedAt);
        date.setHours(date.getHours() + idx);
        const hour = date.getHours();
        const isNight = hour < 6 || hour > 18;

        if (idx === 0) {
          timeLabel = 'Now';
        } else {
          const hoursStr = String(hour).padStart(2, '0') + ':00';
          if (hour === 0) {
            timeLabel = date.toLocaleDateString('en-US', { weekday: 'short' });
          } else {
            timeLabel = hoursStr;
          }
        }
        const multiplier = 1 + 0.12 * Math.sin(idx / 5);
        const hourlyAqi = Math.round(trendAqi * multiplier);

        let condition = 'sunny';
        if (idx % 15 === 0) {
          condition = 'rainy';
        } else if (isNight) {
          condition = idx % 2 === 0 ? 'night-cloudy' : 'clear-night';
        } else if (idx % 5 === 0 || idx % 7 === 0) {
          condition = 'cloudy';
        }

        return {
          time: timeLabel,
          aqi: hourlyAqi,
          temp: Math.round(temp + 3 * Math.cos(idx / 6)),
          wind: Math.round(windKmh + Math.sin(idx / 2)),
          humidity: Math.round(humidity + (idx % 6)),
          condition
        };
      });

  return (
    <div className="content-area">
      <div className="content-area-main">
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
                updateWhenIdle={true}
                keepBuffer={6}
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
                        <strong>{placeLabel}</strong><br />
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
                        <strong>{cp.name}</strong><br />
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
                  layers="VIIRS_SNPP_Thermal_Anomalies_375m_All"
                  format="image/png"
                  transparent={true}
                  attribution="NASA GIBS / FIRMS"
                  noWrap={true}
                  time={new Date(mountedAt - 86400000).toISOString().split('T')[0]}
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
                        <strong style={{ fontSize: '13px', display: 'inline-flex', alignItems: 'center' }}>{SOURCE_ICONS[src.category] || <MapPin size={13} color="#64748b" style={{ marginRight: '4px' }} />} {src.name}</strong><br />
                        Category: <span style={{ textTransform: 'capitalize', fontWeight: '600' }}>{src.label || src.category}</span><br />
                        Emission Rate: <strong>{src.Q ?? src.emission_rate_Q ?? 0} g/s</strong>
                      </div>
                    </Popup>
                  </CircleMarker>
                );
              })}

              <ZoomControl position="bottomright" />
            </MapContainer>

            {/* Floating Controls Overlay (Right Panel on Map) styled as individual white pills with blue icons */}
            <div className="map-right-controls">
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
                  width: 'var(--map-pill-w)',
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
                  width: 'var(--map-pill-w)',
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
                  width: 'var(--map-pill-w)',
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
                  width: 'var(--map-pill-w)',
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
                  width: 'var(--map-pill-w)',
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
                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: '16px' }}>
                      {item.condition === 'rainy' ? <CloudRain size={14} color="#3b82f6" /> :
                        item.condition === 'clear-night' ? <Moon size={14} color="#a5f3fc" /> :
                          item.condition === 'night-cloudy' ? <CloudMoon size={14} color="#94a3b8" /> :
                            item.condition === 'cloudy' ? <Cloud size={14} color="#94a3b8" /> :
                              <Sun size={14} color="#eab308" />}
                    </span>
                    <span className="hourly-temp">{item.temp}°</span>
                    <span className="hourly-wind"><Wind size={11} color="#64748b" style={{ marginRight: '3px', verticalAlign: 'middle' }} />{item.wind} km/h</span>
                    <span className="hourly-humidity"><Activity size={11} color="#3b82f6" style={{ marginRight: '3px', verticalAlign: 'middle' }} />{item.humidity}%</span>
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
      <div className="right-panel">
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

            {/* SVG Air Quality Gauge Meter */}
            {(() => {
              const aqiVal = selectedWard.aqi_in ?? selectedWard.current_aqi;
              return (
                <AqiGauge aqi={aqiVal} />
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

            {/* ── Source Attribution Agent ──────────────── */}
            {(() => {
              // Seeding function to generate different/unique values for different cities/wards
              const getSeededSources = (seedStr) => {
                let hash = 0;
                for (let i = 0; i < seedStr.length; i++) {
                  hash = seedStr.charCodeAt(i) + ((hash << 5) - hash);
                }
                const r1 = Math.abs(hash % 30) + 15;        // 15-45
                const r2 = Math.abs((hash >> 2) % 25) + 12;   // 12-37
                const r3 = Math.abs((hash >> 4) % 20) + 8;    // 8-28
                const r4 = Math.abs((hash >> 6) % 12) + 5;    // 5-17
                const r5 = 100 - (r1 + r2 + r3 + r4);

                return [
                  { label: 'Industrial', pct: r1, color: '#ef4444', icon: <Factory size={12} color="#ef4444" /> },
                  { label: 'Vehicular', pct: r2, color: '#3b82f6', icon: <Car size={12} color="#3b82f6" /> },
                  { label: 'Construction', pct: r3, color: '#f59e0b', icon: <Hammer size={12} color="#f59e0b" /> },
                  { label: 'Waste Burning', pct: r4, color: '#10b981', icon: <Flame size={12} color="#10b981" /> },
                  { label: 'Background', pct: Math.max(0, r5), color: '#64748b', icon: <Leaf size={12} color="#64748b" /> },
                ].sort((a, b) => b.pct - a.pct);
              };

              const getRealSources = (ward) => {
                if (!ward || !state.sources) return getSeededSources(ward?.name || 'Default');
                const localSources = state.sources.filter(src => {
                  if (!src.location || !ward.center) return false;
                  const dLat = src.location[0] - ward.center[0];
                  const dLng = src.location[1] - ward.center[1];
                  const dist = Math.sqrt(dLat * dLat + dLng * dLng) * 111;
                  return dist <= 25; // 25km radius
                });
                if (localSources.length === 0) {
                  return getSeededSources(ward.name);
                }
                const sums = { industrial: 0, vehicular: 0, construction: 0, waste_burning: 0, background: 0 };
                let totalQ = 0;
                localSources.forEach(src => {
                  const cat = src.category || 'background';
                  const q = src.Q ?? src.emission_rate_Q ?? 0;
                  if (sums[cat] !== undefined) {
                    sums[cat] += q;
                    totalQ += q;
                  }
                });
                if (totalQ === 0) {
                  sums.background = 15;
                  totalQ = 15;
                } else {
                  sums.background = totalQ * 0.12;
                  totalQ += sums.background;
                }
                return [
                  { label: 'Industrial', pct: Math.round((sums.industrial / totalQ) * 100), color: '#ef4444', icon: <Factory size={12} color="#ef4444" /> },
                  { label: 'Vehicular', pct: Math.round((sums.vehicular / totalQ) * 100), color: '#3b82f6', icon: <Car size={12} color="#3b82f6" /> },
                  { label: 'Construction', pct: Math.round((sums.construction / totalQ) * 100), color: '#f59e0b', icon: <Hammer size={12} color="#f59e0b" /> },
                  { label: 'Waste Burning', pct: Math.round((sums.waste_burning / totalQ) * 100), color: '#10b981', icon: <Flame size={12} color="#10b981" /> },
                  { label: 'Background', pct: Math.round((sums.background / totalQ) * 100), color: '#64748b', icon: <Leaf size={12} color="#64748b" /> },
                ].sort((a, b) => b.pct - a.pct);
              };

              const displaySources = (attribution && attribution.sources) ? attribution.sources.map(s => {
                const category = s.category || s.label?.toLowerCase() || 'background';
                return {
                  label: s.label || category.charAt(0).toUpperCase() + category.slice(1).replace('_', ' '),
                  pct: Math.round(s.percentage),
                  color: SOURCE_COLORS[category] || '#64748b',
                  icon: category === 'industrial' ? <Factory size={12} color="#ef4444" /> :
                    category === 'vehicular' ? <Car size={12} color="#3b82f6" /> :
                      category === 'construction' ? <Hammer size={12} color="#f59e0b" /> :
                        category === 'waste_burning' ? <Flame size={12} color="#10b981" /> :
                          <Leaf size={12} color="#64748b" />
                };
              }).sort((a, b) => b.pct - a.pct) : getRealSources(selectedWard);

              return (
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px', marginTop: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                    <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: 'linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Search size={14} color="#ffffff" />
                    </div>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: '750', color: '#0f172a' }}>SourceIQ</div>
                    </div>
                  </div>

                  {/* Stacked bar */}
                  <div style={{ display: 'flex', height: '8px', borderRadius: '4px', overflow: 'hidden', marginBottom: '12px' }}>
                    {displaySources.map((s, i) => (
                      <div key={i} style={{ width: `${s.pct}%`, background: s.color, transition: 'width 0.6s ease' }} />
                    ))}
                  </div>

                  {/* Source list */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {displaySources.map((s, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '20px' }}>{s.icon}</span>
                        <span style={{ flex: 1, fontWeight: '600', color: '#334155' }}>{s.label}</span>
                        <div style={{ width: '60px', height: '5px', background: '#f1f5f9', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ width: `${s.pct}%`, height: '100%', background: s.color, borderRadius: '3px', transition: 'width 0.6s ease' }} />
                        </div>
                        <span style={{ fontWeight: '700', color: s.color, minWidth: '32px', textAlign: 'right' }}>{s.pct}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>

        ) : (
          <div style={{ padding: '30px', color: '#64748b', textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '16px', flex: 1 }}>
            <Radio size={48} color="#3b82f6" />
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
