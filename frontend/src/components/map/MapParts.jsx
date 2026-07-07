/* ── Shared map helpers ─────────────────────────────────────────────────── */

import { useEffect } from 'react'
import L from 'leaflet'
import { useMap } from 'react-leaflet'
import markerIconPng from 'leaflet/dist/images/marker-icon.png'
import markerShadowPng from 'leaflet/dist/images/marker-shadow.png'

// Fix Leaflet's default marker icon Vite resolution bug
const DefaultIcon = L.icon({
    iconUrl: markerIconPng,
    shadowUrl: markerShadowPng,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
})
L.Marker.prototype.options.icon = DefaultIcon

export function ChangeMapView({ center, zoom }) {
    const map = useMap();
    useEffect(() => {
        if (center) {
            map.setView(center, zoom || map.getZoom(), { animate: true, duration: 1.5 });
        }
    }, [center, zoom, map]);
    return null;
}
