/* ── Citizens Health Advisory floating widget ───────────────────────────── */

import { useState, useEffect } from 'react'
import { Search, Users, MapPin, Shield, AlertCircle, Sparkles, Phone } from 'lucide-react'

export default function CitizensAdvisoryPopup({
    state,
    advisory,
    lang,
    selectedWard,
    isOpen,
    onToggle,
}) {
    const [nearbyPlaces, setNearbyPlaces] = useState(null)

    // Fallback Address & Phone Helpers for real resources
    const getHospitalPhone = (p) => {
        if (p.phone) return p.phone;
        return "Emergency: 108 / 112";
    };

    const getHospitalAddress = (p) => {
        if (p.address) return p.address;
        return `Near ${advisory ? advisory.ward_name : 'Delhi'} (Coordinates: ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)})`;
    };

    const getPharmacyPhone = (p) => {
        if (p.phone) return p.phone;
        return "Emergency Helpline: 112";
    };

    const getPharmacyAddress = (p) => {
        if (p.address) return p.address;
        return `Near ${advisory ? advisory.ward_name : 'Delhi'} (Coordinates: ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)})`;
    };

    // AI Health Assistant States & Function
    const [aiQuestion, setAiQuestion] = useState('')
    const [aiResponseData, setAiResponseData] = useState(null)
    const [aiLoading, setAiLoading] = useState(false)

    // AI language follows the main language dropdown
    const aiLang = lang || 'en'

    const handleAskAi = async () => {
        if (!aiQuestion.trim()) return;
        setAiLoading(true);
        setAiResponseData(null);
        try {
            const response = await fetch('/api/health-assistant', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question: aiQuestion,
                    lang: aiLang,
                    aqi: advisory ? advisory.aqi : 50,
                    city_name: state?.city?.name || 'Delhi',
                    ward_name: advisory ? advisory.ward_name : 'Delhi'
                })
            });
            const data = await response.json();
            setAiResponseData(data);
        } catch {
            setAiResponseData({
                response: 'Error communicating with AI health assistant.',
                precautions: []
            });
        } finally {
            setAiLoading(false);
        }
    };

    // Fetch nearby hospitals & pharmacies when ward changes and popup is open
    useEffect(() => {
        if (!isOpen || !selectedWard?.center) return
        const [lat, lng] = selectedWard.center
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
                    phone: el.tags?.phone || el.tags?.['contact:phone'] || el.tags?.['phone:mobile'] || el.tags?.['contact:mobile'] || null,
                    address: el.tags?.['addr:full'] ||
                        [
                            el.tags?.['addr:housenumber'] || el.tags?.['addr:housename'],
                            el.tags?.['addr:street'],
                            el.tags?.['addr:suburb'] || el.tags?.['addr:neighbourhood'] || el.tags?.['addr:place'],
                            el.tags?.['addr:city']
                        ].filter(Boolean).join(', ') || null,
                    lat: el.lat,
                    lng: el.lon,
                }))
                setNearbyPlaces(places)
            })
            .catch(() => { setNearbyPlaces([]) })
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
    let pct;
    if (aqiValue <= 50) {
        pct = (aqiValue / 50) * 16.67;
    } else if (aqiValue <= 100) {
        pct = 16.67 + ((aqiValue - 50) / 50) * 16.67;
    } else if (aqiValue <= 200) {
        pct = 33.33 + ((aqiValue - 100) / 100) * 16.67;
    } else if (aqiValue <= 300) {
        pct = 50.0 + ((aqiValue - 200) / 100) * 16.67;
    } else if (aqiValue <= 400) {
        pct = 66.67 + ((aqiValue - 300) / 100) * 16.67;
    } else if (aqiValue <= 500) {
        pct = 83.33 + ((aqiValue - 400) / 100) * 16.67;
    } else {
        pct = 100;
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
                <div className="advisory-popup-card" style={{ background: 'rgba(255, 240, 242, 0.98)', border: '1.5px solid #fecdd3', boxShadow: '0 10px 40px rgba(225, 29, 72, 0.08)' }}>
                    <div className="advisory-popup-header">
                        <div>
                            <div className="advisory-popup-title">
                                <Users size={18} color="#be123c" />
                                <span style={{ color: '#be123c' }}>Health Advisory Portal</span>
                            </div>
                            <div className="advisory-popup-subtitle" style={{ color: '#e11d48' }}>
                                Auto-generated, multi-lingual advisories based on prediction
                            </div>
                        </div>
                        <button className="advisory-close-btn" style={{ color: '#be123c' }} onClick={onToggle}>&times;</button>
                    </div>

                    {/* Advisory output */}
                    {advisory ? (
                        <div style={{ padding: '16px', overflowY: 'auto', maxHeight: 'calc(100vh - 250px)' }}>

                            {/* AQI Numerical Scale & Multi-color Scale */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
                                <span style={{ fontSize: '14px', fontWeight: '600', color: '#be123c' }}>{advisory.ward_name}</span>
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
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: '#e11d48', marginBottom: '14px', padding: '0 2px' }}>
                                <span>0</span>
                                <span>50</span>
                                <span>100</span>
                                <span>200</span>
                                <span>300</span>
                                <span>400</span>
                                <span>500+</span>
                            </div>

                            {/* Analysis Section */}
                            {advisory.reason && (
                                <div style={{
                                    marginTop: '16px',
                                    padding: '14px 16px',
                                    background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.5), rgba(255, 255, 255, 0.3))',
                                    backdropFilter: 'blur(16px)',
                                    borderRadius: '16px',
                                    fontSize: '13.5px',
                                    boxShadow: '0 8px 32px 0 rgba(225, 29, 72, 0.04)',
                                    border: '1.5px solid rgba(254, 205, 211, 0.6)',
                                    color: '#334155',
                                    lineHeight: '1.5',
                                }}>
                                    <strong style={{ color: '#be123c', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', fontSize: '14.5px', fontWeight: '700' }}>
                                        <Search size={15} color="#e11d48" /> Analysis
                                    </strong>
                                    {advisory.reason}
                                </div>
                            )}

                            {/* Multilingual AI Health Assistant */}
                            <div style={{
                                marginTop: '20px',
                                padding: '16px',
                                background: 'linear-gradient(135deg, rgba(255, 241, 242, 0.9), rgba(255, 255, 255, 0.95))',
                                borderRadius: '16px',
                                border: '1px solid rgba(225, 29, 72, 0.2)',
                                boxShadow: '0 8px 30px rgba(225, 29, 72, 0.04)',
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                                    <span style={{ fontSize: '14.5px', fontWeight: '800', color: '#be123c', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <Sparkles size={16} color="#e11d48" /> AI Health Assistant
                                    </span>
                                </div>

                                <div style={{ position: 'relative' }}>
                                    <textarea
                                        rows={2}
                                        value={aiQuestion}
                                        onChange={(e) => setAiQuestion(e.target.value)}
                                        placeholder={
                                            aiLang === 'kn' ? "ಈ AQI ನ ಆರೋಗ್ಯದ ಮೇಲಿನ ಪರಿಣಾಮಗಳ ಬಗ್ಗೆ ಏನೇ ಕೇಳಿ..." :
                                                aiLang === 'ml' ? "ഈ AQI-യുടെ ആരോഗ്യ പ്രത്യാഘാതങ്ങളെക്കുറിച്ച് എന്തും ചോദിക്കുക..." :
                                                    aiLang === 'ta' ? "இந்த AQI இன் சுகாதார விளைவுகள் பற்றி ஏதேனும் கேளுங்கள்..." :
                                                        aiLang === 'te' ? "ఈ AQI ఆరోగ్య ప్రభావాల గురించి ఏదైనా అడగండి..." :
                                                            aiLang === 'hi' ? "इस AQI के स्वास्थ्य प्रभावों के बारे में कुछ भी पूछें..." :
                                                                "Ask anything about health effects of this AQI..."
                                        }
                                        style={{
                                            width: '100%',
                                            padding: '10px 12px',
                                            borderRadius: '12px',
                                            border: '1px solid #fecdd3',
                                            fontSize: '13px',
                                            color: '#1e293b',
                                            background: '#ffffff',
                                            outline: 'none',
                                            resize: 'none',
                                            lineHeight: '1.4',
                                            boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)',
                                            fontFamily: 'inherit',
                                            boxSizing: 'border-box'
                                        }}
                                    />
                                    <button
                                        onClick={handleAskAi}
                                        disabled={aiLoading || !aiQuestion.trim()}
                                        style={{
                                            marginTop: '8px',
                                            width: '100%',
                                            padding: '8px 12px',
                                            background: 'linear-gradient(to right, #e11d48, #be123c)',
                                            color: '#ffffff',
                                            border: 'none',
                                            borderRadius: '10px',
                                            fontSize: '13px',
                                            fontWeight: '700',
                                            cursor: !aiQuestion.trim() || aiLoading ? 'not-allowed' : 'pointer',
                                            opacity: !aiQuestion.trim() || aiLoading ? 0.6 : 1,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '6px',
                                            boxShadow: '0 4px 12px rgba(225, 29, 72, 0.25)',
                                            transition: 'all 0.2s'
                                        }}
                                    >
                                        {aiLoading ? (
                                            <>
                                                <span className="spinner-mini" style={{
                                                    width: '12px',
                                                    height: '12px',
                                                    border: '2px solid #ffffff',
                                                    borderTopColor: 'transparent',
                                                    borderRadius: '50%',
                                                    display: 'inline-block',
                                                    animation: 'spin 0.6s linear infinite'
                                                }} />
                                                Analyzing...
                                            </>
                                        ) : (
                                            <>Ask Health Assistant</>
                                        )}
                                    </button>
                                </div>

                                {/* AI Response Display */}
                                {aiResponseData && (
                                    <div style={{
                                        marginTop: '16px',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '12px'
                                    }}>
                                        {/* Direct Response Text */}
                                        <div style={{
                                            padding: '12px 14px',
                                            background: '#ffffff',
                                            borderRadius: '12px',
                                            border: '1px solid #fecdd3',
                                            fontSize: '13.5px',
                                            color: '#334155',
                                            lineHeight: '1.5',
                                            boxShadow: '0 4px 12px rgba(0,0,0,0.02)',
                                        }}>
                                            <div style={{ fontWeight: '750', color: '#be123c', fontSize: '11px', textTransform: 'uppercase', marginBottom: '6px', letterSpacing: '0.5px' }}>AI Answer</div>
                                            <div style={{ whiteSpace: 'pre-wrap' }}>{aiResponseData.response}</div>
                                        </div>

                                        {/* AI Recommended Precautions */}
                                        {aiResponseData.precautions && aiResponseData.precautions.length > 0 && (
                                            <div style={{
                                                padding: '12px 14px',
                                                background: '#fffbfb',
                                                borderRadius: '12px',
                                                border: '1px solid #ffe4e6',
                                                fontSize: '13px',
                                                color: '#475569',
                                            }}>
                                                <div style={{ fontWeight: '750', color: '#be123c', fontSize: '11px', textTransform: 'uppercase', marginBottom: '6px', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    <Shield size={12} color="#be123c" /> Recommended Precautions
                                                </div>
                                                <ul style={{ margin: 0, paddingLeft: '18px', lineHeight: '1.5' }}>
                                                    {aiResponseData.precautions.map((p, idx) => (
                                                        <li key={idx} style={{ marginBottom: '4px' }}>{p}</li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}

                                        {/* Nearby Emergency Resources */}
                                        {nearbyPlaces && nearbyPlaces.length > 0 && (
                                            <div style={{
                                                padding: '12px 14px',
                                                background: '#fffafb',
                                                borderRadius: '12px',
                                                border: '1px solid #ffe4e6',
                                                fontSize: '13px',
                                                color: '#475569',
                                            }}>
                                                <div style={{ fontWeight: '750', color: '#be123c', fontSize: '11px', textTransform: 'uppercase', marginBottom: '8px', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    <AlertCircle size={12} color="#be123c" /> Nearby Emergency Resources
                                                </div>

                                                {/* Hospitals */}
                                                {nearbyPlaces.filter(p => p.type === 'hospital').length > 0 && (
                                                    <div style={{ marginBottom: '8px' }}>
                                                        <div style={{ fontSize: '11px', fontWeight: '600', color: '#e11d48', textTransform: 'uppercase', marginBottom: '4px' }}>Hospitals</div>
                                                        {nearbyPlaces.filter(p => p.type === 'hospital').slice(0, 2).map((p, i) => (
                                                            <div key={`ai-h-${i}`} style={{ background: '#ffffff', padding: '8px 10px', borderRadius: '8px', border: '1px solid #ffe4e6', marginBottom: '6px' }}>
                                                                <div style={{ fontWeight: '600', color: '#1e293b', fontSize: '12.5px' }}>{p.name}</div>
                                                                <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}><MapPin size={11} color="#94a3b8" /> {getHospitalAddress(p, i)}</div>
                                                                <div style={{ fontSize: '11.5px', color: '#e11d48', fontWeight: '600', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}><Phone size={11} color="#e11d48" /> {getHospitalPhone(p, i)}</div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}

                                                {/* Pharmacies */}
                                                {nearbyPlaces.filter(p => p.type === 'pharmacy').length > 0 && (
                                                    <div>
                                                        <div style={{ fontSize: '11px', fontWeight: '600', color: '#16a34a', textTransform: 'uppercase', marginBottom: '4px' }}>Medical Stores</div>
                                                        {nearbyPlaces.filter(p => p.type === 'pharmacy').slice(0, 2).map((p, i) => (
                                                            <div key={`ai-p-${i}`} style={{ background: '#ffffff', padding: '8px 10px', borderRadius: '8px', border: '1px solid #ffe4e6', marginBottom: '6px' }}>
                                                                <div style={{ fontWeight: '600', color: '#1e293b', fontSize: '12.5px' }}>{p.name}</div>
                                                                <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}><MapPin size={11} color="#94a3b8" /> {getPharmacyAddress(p, i)}</div>
                                                                <div style={{ fontSize: '11.5px', color: '#16a34a', fontWeight: '600', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}><Phone size={11} color="#16a34a" /> {getPharmacyPhone(p, i)}</div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
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
