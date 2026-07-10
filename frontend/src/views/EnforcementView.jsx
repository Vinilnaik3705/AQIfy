/* ── EnforceHub: violation hotspots + dispatch recommendations ──────────── */

import { useState } from 'react'
import { RefreshCw, FileText, Navigation } from 'lucide-react'

export default function EnforcementView({ dispatches, onRefresh, onViewEvidence }) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [scanning, setScanning] = useState(false)

  const handleRescan = async () => {
    setScanning(true)
    await onRefresh()
    setTimeout(() => setScanning(false), 1800)
  }

  // Use REAL dispatch data from backend EnforcementAgent (only shows AQI >= 201 i.e. poor+)
  const allDispatches = dispatches?.dispatches || []

  // Sort by state name (extracted from ward_name which is formatted as "WardName (CityKey)")
  const sortedDispatches = [...allDispatches].sort((a, b) => {
    const stateA = (a.ward_name || '').toLowerCase()
    const stateB = (b.ward_name || '').toLowerCase()
    return stateA.localeCompare(stateB)
  })

  const activeItem = sortedDispatches[selectedIndex] || null

  const getSeverityBadge = (sev) => {
    if (sev === 'severe') return <span style={{ background: '#fef2f2', color: '#ef4444', border: '1px solid #fee2e2', borderRadius: '6px', padding: '2px 8px', fontSize: '11px', fontWeight: '700' }}>Severe</span>
    if (sev === 'very_poor') return <span style={{ background: '#fff7ed', color: '#ea580c', border: '1px solid #ffedd5', borderRadius: '6px', padding: '2px 8px', fontSize: '11px', fontWeight: '700' }}>Very Poor</span>
    return <span style={{ background: '#fffbeb', color: '#d97706', border: '1px solid #fef3c7', borderRadius: '6px', padding: '2px 8px', fontSize: '11px', fontWeight: '700' }}>Poor</span>
  }

  return (
    <div style={{ padding: '0', marginTop: '16px' }}>

      {/* Main 2-column layout */}
      <div className="telemetry-grid">

        {/* LEFT: Pollution Hotspots List */}
        <div className="telemetry-column-left">
          <div className="telemetry-card" style={{ paddingBottom: '16px' }}>
            <div className="telemetry-card-title" style={{ marginBottom: '14px' }}>
              <span style={{ fontSize: '16px' }}>Pollution Hotspots</span>
              <button
                onClick={handleRescan}
                disabled={scanning}
                style={{
                  background: scanning 
                    ? 'linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%)' 
                    : 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                  color: scanning ? '#94a3b8' : '#ffffff',
                  border: 'none',
                  borderRadius: '30px',
                  padding: '8px 20px',
                  cursor: scanning ? 'not-allowed' : 'pointer',
                  fontSize: '13px',
                  fontWeight: '700',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: scanning ? 'none' : '0 4px 12px rgba(37, 99, 235, 0.25)',
                  transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                  transform: 'scale(1)',
                }}
                onMouseOver={e => { if(!scanning) { e.currentTarget.style.transform = 'scale(1.04)'; e.currentTarget.style.boxShadow = '0 6px 16px rgba(37, 99, 235, 0.35)'; } }}
                onMouseOut={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = scanning ? 'none' : '0 4px 12px rgba(37, 99, 235, 0.25)'; }}
                onMouseDown={e => { if(!scanning) e.currentTarget.style.transform = 'scale(0.97)'; }}
                onMouseUp={e => { if(!scanning) e.currentTarget.style.transform = 'scale(1.04)'; }}
              >
                <RefreshCw size={14} style={{ animation: scanning ? 'spin 1s linear infinite' : 'none' }} />
                {scanning ? 'Scanning...' : 'Scan Now'}
              </button>
            </div>

            {sortedDispatches.length > 0 ? (
              <div className="telemetry-list" style={{ maxHeight: '500px', overflowY: 'auto' }}>
                {sortedDispatches.map((item, idx) => (
                  <div
                    key={idx}
                    onClick={() => setSelectedIndex(idx)}
                    className="telemetry-list-item"
                    style={{
                      cursor: 'pointer',
                      border: selectedIndex === idx ? '1.5px solid #3b82f6' : '1px solid #f1f5f9',
                      background: selectedIndex === idx ? '#f0f7ff' : '#f8fafc'
                    }}
                  >
                    <div>
                      <div data-notranslate style={{ fontSize: '13px', fontWeight: '750', color: '#0f172a' }}>{item.ward_name}</div>
                      <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
                        Dominant: {item.dominant_pollutant}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      {getSeverityBadge(item.severity)}
                      <span style={{ fontSize: '14px', fontWeight: '850', color: '#0f172a' }}>{Math.round(item.aqi)} AQI</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: '#64748b', fontSize: '13px' }}>
                {scanning ? 'Scanning for pollution hotspots...' : 'No active pollution hotspots detected (AQI < 201 across all wards). Air quality is acceptable.'}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Prioritised Action */}
        <div className="telemetry-column-right">
          <div className="telemetry-card" style={{ display: 'flex', flexDirection: 'column', minHeight: '300px' }}>
            <div className="telemetry-card-title" style={{ marginBottom: '12px' }}>
              <span style={{ fontSize: '16px' }}>Prioritised Action</span>
            </div>

            {activeItem ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                {/* Header info */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', paddingBottom: '12px', borderBottom: '1.5px solid #f1f5f9' }}>
                  <div>
                    <div data-notranslate style={{ fontSize: '15px', fontWeight: '800', color: '#0f172a' }}>{activeItem.ward_name}</div>
                    <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                      Priority Score: <strong>{activeItem.priority_score}</strong> · Severity: <strong>{activeItem.severity?.replace('_', ' ').toUpperCase()}</strong>
                    </div>
                  </div>
                  <div style={{ fontSize: '22px', fontWeight: '850', color: activeItem.aqi > 400 ? '#ef4444' : activeItem.aqi > 300 ? '#f97316' : '#eab308' }}>
                    {Math.round(activeItem.aqi)} <span style={{ fontSize: '11px', color: '#64748b' }}>AQI</span>
                  </div>
                </div>

                {/* Pollutant exceedances */}
                {activeItem.pollutant_exceedances?.length > 0 && (
                  <div style={{ marginBottom: '14px' }}>
                    <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '700', letterSpacing: '0.5px', marginBottom: '6px' }}>Pollutant Exceedances</div>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {activeItem.pollutant_exceedances.map((e, i) => (
                        <span key={i} style={{ fontSize: '11px', color: '#dc2626', background: '#fef2f2', padding: '3px 8px', borderRadius: '6px', border: '1px solid #fecaca', fontWeight: '600' }}>
                          {e}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Inferred Sources */}
                {activeItem.inferred_sources?.length > 0 && (
                  <div style={{ marginBottom: '14px' }}>
                    <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '700', letterSpacing: '0.5px', marginBottom: '6px' }}>Inferred Emission Sources</div>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {activeItem.inferred_sources.map((s, i) => (
                        <span key={i} style={{ fontSize: '11px', color: '#1e40af', background: '#eff6ff', padding: '3px 8px', borderRadius: '6px', border: '1px solid #bfdbfe', fontWeight: '600' }}>
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recommended Actions from backend EnforcementAgent */}
                <div style={{ marginBottom: '14px', flex: 1 }}>
                  <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: '700', letterSpacing: '0.5px', marginBottom: '8px' }}>Recommended Actions</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {(activeItem.recommended_actions || []).map((action, i) => (
                      <div key={i} style={{ display: 'flex', gap: '8px', fontSize: '12px', color: '#334155', fontWeight: '500', padding: '8px 12px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', lineHeight: '1.4' }}>
                        <span style={{ color: '#3b82f6', fontWeight: '800', flexShrink: 0 }}>{i + 1}.</span>
                        <span>{action}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Vulnerability flags */}
                {activeItem.vulnerability_flags?.length > 0 && (
                  <div style={{ marginBottom: '14px', padding: '10px 12px', background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: '10px' }}>
                    <div style={{ fontSize: '10px', fontWeight: '700', color: '#b45309', marginBottom: '4px', textTransform: 'uppercase' }}>Vulnerable Population</div>
                    {activeItem.vulnerability_flags.map((f, i) => (
                      <div key={i} style={{ fontSize: '11px', color: '#b45309', fontWeight: '600', paddingLeft: '8px' }}>• {f}</div>
                    ))}
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: '10px', paddingTop: '12px', borderTop: '1.5px solid #f1f5f9', marginTop: 'auto' }}>
                  <button
                    onClick={() => onViewEvidence && onViewEvidence(activeItem)}
                    style={{
                      flex: 1,
                      padding: '10px 16px',
                      background: '#0f172a',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '10px',
                      fontSize: '12px',
                      fontWeight: '700',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px'
                    }}
                  >
                    <FileText size={13} />
                    View Evidence Package
                  </button>
                  <a
                    href={activeItem.location ? `https://maps.google.com/?q=${activeItem.location[0]},${activeItem.location[1]}` : '#'}
                    target="_blank" rel="noopener noreferrer"
                    style={{
                      padding: '10px 16px',
                      border: '1px solid #e2e8f0',
                      borderRadius: '10px',
                      fontSize: '12px',
                      fontWeight: '600',
                      color: '#475569',
                      background: '#f8fafc',
                      textDecoration: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <Navigation size={12} />
                    Maps
                  </a>
                </div>
              </div>
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '13px', textAlign: 'center', padding: '40px' }}>
                {sortedDispatches.length === 0
                  ? 'No pollution hotspots detected. All wards are within acceptable AQI limits.'
                  : 'Select a hotspot from the left panel to view prioritised actions.'
                }
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}

