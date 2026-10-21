/* ── Shared map helpers ─────────────────────────────────────────────────── */

import { useCallback, useEffect, useState } from 'react'
import L from 'leaflet'
import { TileLayer, useMap } from 'react-leaflet'
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
    if (Array.isArray(center) && center.length >= 2 && center.every(Number.isFinite)) {
      map.invalidateSize({ animate: false })
      map.setView(center, zoom || map.getZoom(), { animate: true, duration: 1.5 });
    }
  }, [center, zoom, map]);
  return null;
}

/** Keep Leaflet's canvas aligned with flex/grid layout changes. */
export function MapResizeHandler() {
  const map = useMap()

  useEffect(() => {
    let frame
    const invalidate = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => map.invalidateSize({ animate: false }))
    }
    const container = map.getContainer().parentElement
    const observer = typeof ResizeObserver !== 'undefined' && container
      ? new ResizeObserver(invalidate)
      : null

    observer?.observe(container)
    window.addEventListener('resize', invalidate)
    invalidate()
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', invalidate)
    }
  }, [map])

  return null
}

/** Try readable no-key basemaps with a visible fallback if tiles fail. */
export function ResilientTileLayer() {
  const [sourceIndex, setSourceIndex] = useState(0)
  const [failed, setFailed] = useState(false)
  const map = useMap()
  const sources = [
    {
      // OSM is the no-key baseline. CARTO can return HTTP 200 watermark tiles
      // when a key is required, so it must not be the primary source.
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; OpenStreetMap contributors',
    },
    {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles &copy; Esri &mdash; Source: Esri, OpenStreetMap contributors',
    },
  ]
  const handleTileError = useCallback(() => {
    setSourceIndex(index => {
      if (index < sources.length - 1) return index + 1
      setFailed(true)
      return index
    })
  }, [sources.length])

  useEffect(() => {
    if (!failed) map.invalidateSize({ animate: false })
  }, [failed, sourceIndex, map])

  return (
    <>
      <TileLayer
        key={sources[sourceIndex].url}
        attribution={sources[sourceIndex].attribution}
        url={sources[sourceIndex].url}
        noWrap
        updateWhenIdle
        keepBuffer={4}
        eventHandlers={{
          tileerror: handleTileError,
          load: () => setFailed(false),
        }}
      />
      {failed && (
        <div className="map-tile-fallback" role="status">
          <strong>Map tiles are unavailable</strong>
          <span>Live AQI markers are still shown below.</span>
        </div>
      )}
    </>
  )
}
