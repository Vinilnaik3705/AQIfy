/* ── Evidence Modal (EnforceHub violation detail) ───────────────────────── */

import { useState } from 'react'
import { Search, AlertTriangle, Activity, MapPin, Factory, Car, Hammer, Flame, FileText, Navigation, Clock, AlertCircle, CheckCircle } from 'lucide-react'
import { aqiColor } from '../../lib/aqi'

export default function EvidenceModal({ data, onClose }) {
  const [dispatched, setDispatched] = useState(false)

  const POLLUTANT_LIMITS = { pm25: 60, pm10: 100, no2: 40, so2: 40, co: 2000, o3: 50 }
  const POLLUTANT_UNITS = { pm25: 'µg/m³', pm10: 'µg/m³', no2: 'ppb', so2: 'ppb', co: 'ppb', o3: 'ppb' }
  const POLLUTANT_LABELS = { pm25: 'PM2.5', pm10: 'PM10', no2: 'NO₂', so2: 'SO₂', co: 'CO', o3: 'O₃' }

  const sevColor = data.severity === 'severe' ? '#ef4444'
    : data.severity === 'very_poor' ? '#f97316' : '#eab308'

  const sevLabel = data.severity?.replace('_', ' ').toUpperCase() || 'UNKNOWN'

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ backdropFilter: 'blur(12px)', backgroundColor: 'rgba(15, 23, 42, 0.6)', transition: 'all 0.3s ease' }}>
      <div className="modal evidence-modal" onClick={e => e.stopPropagation()} style={{
        maxWidth: '580px', maxHeight: '90vh', borderRadius: '24px',
        background: '#ffffff', border: '1px solid rgba(226, 232, 240, 0.8)',
        boxShadow: '0 30px 60px -15px rgba(15, 23, 42, 0.3)', padding: 0,
        animation: 'evidence-modal-in 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden'
      }}>

        {/* ── Premium Gradient Header Bar ──────────────────────────── */}
        <div style={{
          background: 'linear-gradient(135deg, #0b0f19 0%, #1e293b 100%)',
          borderBottom: `4px solid ${sevColor}`,
          padding: '24px 28px',
          borderRadius: '24px 24px 0 0',
          position: 'relative',
          overflow: 'hidden',
          flexShrink: 0
        }}>
          <div style={{ position: 'absolute', top: 0, right: 0, width: '220px', height: '100%', opacity: 0.04, background: 'repeating-linear-gradient(45deg, #fff 0px, #fff 1px, transparent 1px, transparent 10px)', pointerEvents: 'none' }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative', zIndex: 1 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '10px', background: `${sevColor}20`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <FileText size={16} color={sevColor} />
                </div>
                <span style={{ fontSize: '18px', fontWeight: '800', color: '#f8fafc', letterSpacing: '-0.3px' }}>Enforcement Evidence Package</span>
              </div>
              <div style={{ fontSize: '12px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Clock size={12} color="#64748b" />
                <span>Generated:</span>
                <span data-notranslate style={{ color: '#cbd5e1', fontWeight: '600' }}>{new Date(data.evidence?.timestamp).toLocaleString()}</span>
              </div>
            </div>
            <button onClick={onClose} style={{
              width: '32px', height: '32px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(255,255,255,0.08)', color: '#cbd5e1', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px',
              transition: 'all 0.2s ease', fontWeight: 'bold'
            }} onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'} onMouseOut={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}>✕</button>
          </div>
        </div>

        <div className="no-scrollbar" style={{ padding: '28px', overflowY: 'auto', flex: 1 }}>
          {/* ── Incident Summary ──────────────────────── */}
          <div style={{ display: 'flex', gap: '22px', paddingBottom: '24px', borderBottom: '1px solid #f1f5f9', alignItems: 'center' }}>
            {/* Elegant AQI Ring */}
            <div style={{
              width: '90px', height: '90px', borderRadius: '50%',
              background: `conic-gradient(${aqiColor(data.aqi)} ${Math.min(100, (data.aqi / 500) * 100)}%, #f1f5f9 0)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              boxShadow: '0 4px 12px rgba(0,0,0,0.05)'
            }}>
              <div style={{
                width: '74px', height: '74px', borderRadius: '50%', background: '#ffffff',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
              }}>
                <div data-notranslate style={{ fontSize: '28px', fontWeight: '900', color: aqiColor(data.aqi), lineHeight: 1, letterSpacing: '-0.5px' }}>
                  {Math.round(data.aqi)}
                </div>
                <div style={{ fontSize: '9px', color: '#64748b', fontWeight: '800', marginTop: '3px', letterSpacing: '0.5px' }}>AQI-IN</div>
              </div>
            </div>

            <div style={{ flex: 1 }}>
              <div data-notranslate style={{ fontSize: '22px', fontWeight: '850', color: '#0f172a', marginBottom: '8px', letterSpacing: '-0.5px' }}>{data.ward_name}</div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
                <span style={{
                  padding: '5px 12px', borderRadius: '10px', fontSize: '11px',
                  fontWeight: '800', background: `${sevColor}12`, color: sevColor,
                  border: `1px solid ${sevColor}20`, letterSpacing: '0.3px'
                }}>
                  {sevLabel}
                </span>
                <span style={{
                  padding: '5px 12px', borderRadius: '10px', fontSize: '11px', fontWeight: '700',
                  color: '#334155', background: '#f8fafc', border: '1px solid #e2e8f0',
                  display: 'inline-flex', gap: '4px'
                }}>
                  <span>Priority:</span>
                  <span data-notranslate>{Math.round(data.priority_score)}</span>
                </span>
              </div>
              <div style={{ fontSize: '12px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <MapPin size={12} color="#94a3b8" />
                <span data-notranslate style={{ fontFamily: 'monospace', color: '#475569' }}>{data.location[0].toFixed(5)}, {data.location[1].toFixed(5)}</span>
              </div>
            </div>
          </div>

          {/* ── Pollutant Concentrations ─────────────── */}
          <div style={{ marginTop: '24px' }}>
            <div style={{ fontSize: '13px', fontWeight: '800', color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '24px', height: '24px', borderRadius: '8px', background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Activity size={13} color="#10b981" />
              </div>
              <span>Pollutant Concentrations</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {Object.entries(data.evidence?.pollutants || {}).map(([key, val]) => {
                const limit = POLLUTANT_LIMITS[key] || 999
                const exceeded = val > limit
                const pct = Math.min(100, (val / limit) * 100)
                return (
                  <div key={key} style={{
                    background: exceeded ? 'linear-gradient(135deg, #fffafb 0%, #fef2f2 100%)' : 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
                    padding: '12px 16px', borderRadius: '14px',
                    border: `1px solid ${exceeded ? '#fca5a5' : '#e2e8f0'}`,
                    boxShadow: '0 2px 4px rgba(0,0,0,0.01)',
                    transition: 'all 0.2s ease'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
                      <span data-notranslate style={{ color: exceeded ? '#dc2626' : '#1e293b', fontWeight: exceeded ? '800' : '700', display: 'flex', alignItems: 'center', gap: '5px' }}>
                        {POLLUTANT_LABELS[key] || key.toUpperCase()}
                        {exceeded && <AlertCircle size={12} color="#ef4444" />}
                      </span>
                      <span data-notranslate style={{ color: exceeded ? '#dc2626' : '#1e293b', fontWeight: '800' }}>
                        {typeof val === 'number' ? (key === 'co' && val < 10.0 ? (val * 1000).toFixed(0) : val.toFixed(1)) : val} {POLLUTANT_UNITS[key] || ''}
                        <span style={{ color: '#94a3b8', marginLeft: '4px', fontWeight: '500', fontSize: '11px' }}>/ {limit}</span>
                      </span>
                    </div>
                    <div style={{ height: '8px', background: exceeded ? '#fee2e2' : '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{
                        width: `${pct}%`, height: '100%', borderRadius: '4px',
                        background: exceeded ? 'linear-gradient(90deg, #f87171, #dc2626)' : 'linear-gradient(90deg, #34d399, #10b981)',
                        transition: 'width 0.8s ease'
                      }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Inferred Source Types ────────────────── */}
          {data.inferred_sources?.length > 0 && (
            <div style={{ marginTop: '24px' }}>
              <div style={{ fontSize: '13px', fontWeight: '800', color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '24px', height: '24px', borderRadius: '8px', background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Search size={13} color="#3b82f6" />
                </div>
                <span>Inferred Source Type</span>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {data.inferred_sources.map((src, i) => (
                  <div key={i} style={{
                    fontSize: '12px', color: '#1e40af', background: '#eff6ff', padding: '8px 14px',
                    borderRadius: '12px', border: '1px solid #bfdbfe', fontWeight: '700',
                    display: 'flex', alignItems: 'center', gap: '6px',
                    boxShadow: '0 1px 2px rgba(59,130,246,0.05)'
                  }}>
                    <Search size={12} color="#3b82f6" />
                    <span>{src}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Nearby Registered Sources ────────────── */}
          <div style={{ marginTop: '24px' }}>
            <div style={{ fontSize: '13px', fontWeight: '800', color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '24px', height: '24px', borderRadius: '8px', background: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Factory size={13} color="#f59e0b" />
              </div>
              <span>Registered Sources (5km)</span>
            </div>
            {data.nearby_sources?.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {data.nearby_sources.map((s, i) => (
                  <div key={i} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '10px 14px', background: '#f8fafc',
                    borderRadius: '12px', border: '1px solid #e2e8f0',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.005)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                        {s.category === 'industrial' ? <Factory size={14} color="#ef4444" /> :
                          s.category === 'vehicular' ? <Car size={14} color="#3b82f6" /> :
                            s.category === 'construction' ? <Hammer size={14} color="#f59e0b" /> :
                              s.category === 'waste_burning' ? <Flame size={14} color="#10b981" /> :
                                <MapPin size={14} color="#64748b" />}
                      </span>
                      <span style={{
                        fontSize: '13px', color: '#1e293b', overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: '700'
                      }}>{s.name}</span>
                    </div>
                    <span data-notranslate style={{ fontSize: '11px', color: '#475569', flexShrink: 0, marginLeft: '8px', fontWeight: '700', background: '#e2e8f0', padding: '3px 8px', borderRadius: '8px' }}>
                      {s.distance_km} km
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: '13px', color: '#64748b', background: '#f8fafc', padding: '12px', borderRadius: '12px', textAlign: 'center', border: '1px solid #e2e8f0' }}>No registered sources within 5km.</div>
            )}
          </div>

          {/* ── Vulnerability Flags ──────────────────── */}
          {data.vulnerability_flags?.length > 0 && (
            <div style={{
              marginTop: '24px', padding: '14px 16px',
              background: 'linear-gradient(135deg, rgba(245,158,11,0.08) 0%, rgba(245,158,11,0.03) 100%)',
              border: '1px solid rgba(245,158,11,0.25)', borderRadius: '16px'
            }}>
              <div style={{ fontSize: '13px', fontWeight: '800', color: '#b45309', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <AlertTriangle size={15} color="#d97706" />
                <span>Vulnerable Population at Risk</span>
              </div>
              {data.vulnerability_flags.map((f, i) => (
                <div key={i} style={{ fontSize: '12px', color: '#b45309', marginBottom: '4px', fontWeight: '700', paddingLeft: '21px' }}>• {f}</div>
              ))}
            </div>
          )}

          {/* ── Recommended Actions ──────────────────── */}
          <div style={{ marginTop: '24px' }}>
            <div style={{ fontSize: '13px', fontWeight: '800', color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '24px', height: '24px', borderRadius: '8px', background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CheckCircle size={13} color="#22c55e" />
              </div>
              <span>Recommended Actions</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {(data.recommended_actions || []).map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: '12px', fontSize: '12.5px', color: '#334155', fontWeight: '600', padding: '10px 14px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                  <span style={{ color: '#3b82f6', fontWeight: '900', flexShrink: 0 }}>{i + 1}.</span>
                  <span>{a}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Action Buttons ───────────────────────── */}
          <div style={{ marginTop: '28px', display: 'flex', gap: '12px', paddingTop: '22px', borderTop: '1px solid #f1f5f9' }}>
            {!dispatched ? (
              <button style={{
                flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                fontWeight: '800', fontSize: '14px', padding: '12px 24px', borderRadius: '14px',
                background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)', color: '#ffffff',
                border: 'none', cursor: 'pointer', boxShadow: '0 6px 16px rgba(239,68,68,0.3)',
                transition: 'all 0.2s ease'
              }}
                onClick={() => setDispatched(true)}
                onMouseOver={e => e.currentTarget.style.transform = 'translateY(-1px)'}
                onMouseOut={e => e.currentTarget.style.transform = 'none'}>
                <Activity size={16} />
                <span>Dispatch Inspector</span>
              </button>
            ) : (
              <div style={{
                flex: 1, padding: '12px 24px', background: 'linear-gradient(135deg, rgba(34,197,94,0.12) 0%, rgba(34,197,94,0.06) 100%)',
                border: '1px solid rgba(34,197,94,0.35)', borderRadius: '14px', color: '#15803d',
                fontSize: '14px', fontWeight: '800', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
              }}>
                <CheckCircle size={16} />
                <span>Inspector Dispatched ✓</span>
              </div>
            )}
            <a href={`https://maps.google.com/?q=${data.location[0]},${data.location[1]}`}
              target="_blank" rel="noopener noreferrer"
              style={{
                flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: '6px',
                textDecoration: 'none', fontWeight: '700', fontSize: '13px', padding: '12px 18px',
                borderRadius: '14px', border: '1px solid #e2e8f0', color: '#334155',
                background: '#f8fafc', transition: 'all 0.2s ease', boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
              }}
              onMouseOver={e => e.currentTarget.style.background = '#f1f5f9'}
              onMouseOut={e => e.currentTarget.style.background = '#f8fafc'}>
              <Navigation size={14} color="#475569" />
              <span>Maps</span>
            </a>
            <button onClick={onClose} style={{
              flexShrink: 0, fontWeight: '700', fontSize: '13px', padding: '12px 18px',
              borderRadius: '14px', border: '1px solid #e2e8f0', color: '#334155',
              background: '#f8fafc', cursor: 'pointer', transition: 'all 0.2s ease',
              boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
            }}
            onMouseOver={e => e.currentTarget.style.background = '#f1f5f9'}
            onMouseOut={e => e.currentTarget.style.background = '#f8fafc'}>Close</button>
          </div>
        </div>
      </div>
    </div>
  )
}

