/* ── Header: brand, search, language selector, navigation ───────────────── */

import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, MapPin, LayoutDashboard, Shield } from 'lucide-react'
import { LANGUAGES } from '../lib/constants'
import { safeLocalStorage } from '../lib/api'
import {
  getActiveLang, setActiveLang, resetTranslations, getTranslation,
  hasOriginal, getOriginal, restoreOriginals, getTextNodes, translateNodes,
} from '../lib/translate'

function HeaderSearch({ onSelectPlace, wards = [], onSelectWard }) {
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

  const handleSearch = (val) => {
    setQuery(val)
    if (val.trim().length < 1) {
      setResults([])
      return
    }
    const filtered = (wards || []).filter(w => {
      const isParentCity = w.id && !w.id.includes('_');
      if (!isParentCity) return false;
      return w.name.toLowerCase().includes(val.toLowerCase()) ||
        (w.state && w.state.toLowerCase().includes(val.toLowerCase()));
    })
    setResults(filtered.slice(0, 6))
    setShowDropdown(true)
  }

  const selectItem = (item) => {
    if (onSelectWard) {
      onSelectWard(item)
    } else {
      onSelectPlace({
        name: item.name,
        state: item.state || '',
        country: item.country || '',
        lat: item.center ? item.center[0] : item.lat,
        lng: item.center ? item.center[1] : item.lng
      })
    }
    setQuery('')
    setResults([])
    setShowDropdown(false)
  }

  return (
    <div className="header-search-container" ref={dropdownRef}>
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
                {(r.state || r.admin1) && `, ${r.state || r.admin1}`}
                {r.country && ` (${r.country})`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function LanguageSelector({ onLanguageChange }) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState(() => safeLocalStorage.getItem('aqify_lang') || 'en')
  const [translating, setTranslating] = useState(false)
  const ref = useRef(null)
  const observerRef = useRef(null)

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // MutationObserver: auto-translate new content React renders
  useEffect(() => {
    const root = document.getElementById('root')
    if (!root) return
    observerRef.current = new MutationObserver(() => {
      if (getActiveLang() === 'en') return
      clearTimeout(observerRef.current._timer)
      observerRef.current._timer = setTimeout(() => {
        const nodes = getTextNodes(root)
        const untranslated = nodes.filter(n => {
          const orig = (getOriginal(n) || n.textContent).trim()
          return getTranslation(orig) && n.textContent.trim() !== getTranslation(orig)
        })
        const brandNew = nodes.filter(n => !hasOriginal(n))
        const all = [...untranslated, ...brandNew]
        if (all.length > 0) translateNodes(all, getActiveLang())
      }, 300)
    })
    observerRef.current.observe(root, { childList: true, subtree: true, characterData: true })
    return () => observerRef.current?.disconnect()
  }, [])

  const translatePage = useCallback(async (langCode) => {
    setActiveLang(langCode)
    if (langCode === 'en') {
      restoreOriginals()
      return
    }
    setTranslating(true)
    resetTranslations()
    const root = document.getElementById('root')
    if (root) {
      const nodes = getTextNodes(root)
      await translateNodes(nodes, langCode)
    }
    setTranslating(false)
  }, [])

  // Auto-apply saved language on first load
  useEffect(() => {
    const saved = safeLocalStorage.getItem('aqify_lang')
    if (saved && saved !== 'en') {
      const timer = setTimeout(() => {
        translatePage(saved)
        if (onLanguageChange) onLanguageChange(saved)
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [onLanguageChange, translatePage])

  const handleSelect = async (langCode) => {
    setSelected(langCode)
    setOpen(false)
    safeLocalStorage.setItem('aqify_lang', langCode)
    await translatePage(langCode)
    if (onLanguageChange) onLanguageChange(langCode)
  }

  const current = LANGUAGES.find(l => l.code === selected) || LANGUAGES[0]

  return (
    <div ref={ref} data-notranslate style={{ position: 'relative', zIndex: 1000 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '6px 12px', borderRadius: '20px',
          background: translating ? '#fef3c7' : open ? '#e0e7ff' : '#f1f5f9',
          border: '1px solid ' + (translating ? '#fbbf24' : open ? '#818cf8' : '#e2e8f0'),
          cursor: 'pointer', fontWeight: '600', fontSize: '12px',
          color: '#334155', transition: 'all 0.2s',
          whiteSpace: 'nowrap'
        }}
        title="Change language"
      >
        {translating ? (
          <span>⏳ Translating…</span>
        ) : (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
            </svg>
            <span>{current.flag} {current.label}</span>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d={open ? 'M2 6.5L5 3.5L8 6.5' : 'M2 3.5L5 6.5L8 3.5'} />
            </svg>
          </>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0,
          background: '#ffffff', borderRadius: '12px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 12px 40px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.06)',
          padding: '6px', minWidth: '180px',
          animation: 'fadeIn 0.15s ease-out'
        }}>
          {LANGUAGES.map(lang => (
            <button
              key={lang.code}
              onClick={() => handleSelect(lang.code)}
              disabled={translating}
              style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                width: '100%', padding: '8px 12px', border: 'none',
                borderRadius: '8px', cursor: 'pointer',
                fontSize: '13px', fontWeight: selected === lang.code ? '700' : '500',
                color: selected === lang.code ? '#3b82f6' : '#334155',
                background: selected === lang.code ? '#eff6ff' : 'transparent',
                transition: 'all 0.15s', textAlign: 'left'
              }}
              onMouseEnter={e => { if (selected !== lang.code) e.currentTarget.style.background = '#f8fafc' }}
              onMouseLeave={e => { if (selected !== lang.code) e.currentTarget.style.background = 'transparent' }}
            >
              <span style={{ fontSize: '16px' }}>{lang.flag}</span>
              <span>{lang.label}</span>
              {selected === lang.code && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 'auto' }}>
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              )}
            </button>
          ))}

        </div>
      )}
    </div>
  )
}

export default function Header({ tab, setTab, onSelectPlace, wards, onSelectWard, onLanguageChange }) {
  return (
    <header className="header">
      {/* Brand Logo and Title */}
      <div
        className="brand-section"
        onClick={() => setTab('command')}
        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', fontWeight: '800', fontSize: '20px', color: '#0f172a' }}
      >
        <svg width="32" height="32" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* Outer gradient ring with correct coordinate mapping and all NAQI colors */}
          <defs>
            <linearGradient id="ringGrad" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#10b981" />
              <stop offset="20%" stopColor="#eab308" />
              <stop offset="40%" stopColor="#f97316" />
              <stop offset="60%" stopColor="#ef4444" />
              <stop offset="80%" stopColor="#a855f7" />
              <stop offset="100%" stopColor="#991b1b" />
            </linearGradient>
          </defs>
          <circle cx="32" cy="32" r="28" stroke="url(#ringGrad)" strokeWidth="6" fill="none" />
          {/* Cloud icon */}
          <path d="M44 36H22a6 6 0 0 1-.84-11.94A8 8 0 0 1 36.29 22 7 7 0 0 1 44 29a5 5 0 0 1 0 7Z" fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span style={{ letterSpacing: '-0.5px' }}>AQIfy</span>
      </div>

      {/* Header Right containing Search Bar and Navigation Group */}
      <div className="header-right">
        {/* Search Input Box */}
        <HeaderSearch onSelectPlace={onSelectPlace} wards={wards} onSelectWard={onSelectWard} />

        {/* Language Selector (uses backend /api/translate) */}
        <LanguageSelector onLanguageChange={onLanguageChange} />

        {/* Segmented Navigation Control */}
        <div className="header-nav-segment">
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
