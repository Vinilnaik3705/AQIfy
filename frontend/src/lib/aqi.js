/* ── AQI helpers (Indian NAQI standard) ─────────────────────────────────── */

import L from 'leaflet'
import { AQI_COLORS } from './constants'

export function aqiLevel(aqi) {
    if (aqi <= 50) return 'good'
    if (aqi <= 100) return 'moderate'
    if (aqi <= 200) return 'poor'
    if (aqi <= 300) return 'very_poor'
    if (aqi <= 400) return 'severe'
    return 'hazardous'
}

export function aqiColor(aqi) {
    return AQI_COLORS[aqiLevel(aqi)]
}

export function getAqiTextColor(aqi) {
    const level = aqiLevel(aqi)
    if (level === 'good' || level === 'moderate') {
        return '#000000'
    }
    return '#ffffff'
}

export function createAqiIcon(aqi, isWard = false) {
    const size = isWard ? 26 : 32
    const anchor = isWard ? 13 : 16
    const ring = isWard ? '1.5px solid rgba(255,255,255,0.4)' : '2px solid rgba(255,255,255,0.6)'

    const hasAqi = aqi !== undefined && aqi !== null && !isNaN(aqi)
    const displayVal = hasAqi ? Math.round(aqi) : '--'
    const bgColor = hasAqi ? aqiColor(aqi) : '#64748b' // Gray fallback for unmonitored / loading
    const textColor = hasAqi ? getAqiTextColor(aqi) : '#ffffff'

    return L.divIcon({
        className: 'custom-aqi-bubble',
        html: `<div class="aqi-bubble-inner" style="background-color: ${bgColor}; color: ${textColor}; width:${size}px; height:${size}px; line-height:${size}px; font-size:${isWard ? 10 : 12}px; border:${ring}; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:700; box-shadow:0 2px 6px rgba(0,0,0,0.5)">${displayVal}</div>`,
        iconSize: [size, size],
        iconAnchor: [anchor, anchor],
    })
}
