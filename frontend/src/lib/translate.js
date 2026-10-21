/* ── DOM translation engine (backend-powered via /api/translate) ────────── */

const API = (import.meta.env.VITE_API_BASE_URL || window.location.origin).replace(/\/$/, '')

// Module-level stores so MutationObserver callbacks can access them. React can
// replace text nodes while rendering, so originals belong to the node rather
// than to the current language.
const originalTexts = new Map()
const originalAttributes = new Map()
const languageCaches = new Map([['en', new Map()]])
const pendingTranslations = new Map()
const translationQueues = new Map()
const translationNextAllowedAt = new Map()
const TRANSLATION_MIN_GAP_MS = 250
let translationMap = {}
let activeLang = 'en'

export function getActiveLang() {
  return activeLang
}

export function setActiveLang(code) {
  activeLang = code
  translationMap = Object.fromEntries(languageCaches.get(code) || [])
}

export function resetTranslations() {
  translationMap = Object.fromEntries(languageCaches.get(activeLang) || [])
}

export function getTranslation(text) {
  return translationMap[text]
}

export function hasOriginal(node) {
  return originalTexts.has(node)
}

export function getOriginal(node) {
  return originalTexts.get(node)
}

export function setOriginal(node, text) {
  originalTexts.set(node, text)
}

export function restoreOriginals() {
  originalTexts.forEach((orig, node) => {
    try {
      if (node.textContent !== orig) node.textContent = orig
    } catch {
      // Node may be detached from the DOM — ignore
    }
  })
  originalAttributes.forEach((attrs, element) => {
    Object.entries(attrs).forEach(([attribute, original]) => {
      try {
        if (element.getAttribute(attribute) !== original) element.setAttribute(attribute, original)
      } catch {
        // Element may be detached from the DOM — ignore
      }
    })
  })
  translationMap = Object.fromEntries(languageCaches.get(activeLang) || [])
}

function hasLetters(text) {
  return /\p{L}/u.test(text)
}

function isTranslatable(text) {
  const value = text.trim()
  return value.length >= 2 && hasLetters(value)
}

function wait(ms) {
  return ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve()
}

function enqueueTranslation(langCode, job) {
  const previous = translationQueues.get(langCode) || Promise.resolve()
  const queued = previous
    .catch(() => {})
    .then(async () => {
      const waitMs = (translationNextAllowedAt.get(langCode) || 0) - Date.now()
      await wait(waitMs)
      try {
        return await job()
      } finally {
        translationNextAllowedAt.set(langCode, Date.now() + TRANSLATION_MIN_GAP_MS)
      }
    })
    .finally(() => {
      if (translationQueues.get(langCode) === queued) translationQueues.delete(langCode)
    })
  translationQueues.set(langCode, queued)
  return queued
}

export function getTextNodes(root) {
  const nodes = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const t = node.textContent.trim()
      if (!isTranslatable(t)) return NodeFilter.FILTER_REJECT
      const tag = node.parentElement?.tagName
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE', 'PRE'].includes(tag)) return NodeFilter.FILTER_REJECT
      if (node.parentElement?.closest?.('[data-notranslate]')) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })
  while (walker.nextNode()) nodes.push(walker.currentNode)
  return nodes
}

export function getTranslatableAttributes(root) {
  return [...root.querySelectorAll('[placeholder], [title]')]
    .filter(element => !element.closest?.('[data-notranslate]'))
    .flatMap(element => ['placeholder', 'title']
      .filter(attribute => isTranslatable(element.getAttribute(attribute) || ''))
      .map(attribute => ({ element, attribute })))
}

export async function translateNodes(nodes, langCode, attributes = []) {
  const cache = languageCaches.get(langCode) || new Map()
  languageCaches.set(langCode, cache)
  const uniqueSet = new Set()
  nodes.forEach(n => {
    const current = n.textContent
    const cachedOriginal = originalTexts.get(n)
    const cachedTranslation = cachedOriginal && cache.get(cachedOriginal.trim())
    if (cachedOriginal && current.trim() !== cachedOriginal.trim() && current.trim() !== cachedTranslation?.trim()) {
      originalTexts.set(n, current)
    }
    if (!originalTexts.has(n)) originalTexts.set(n, n.textContent)
    const source = originalTexts.get(n)
    if (isTranslatable(source)) uniqueSet.add(source.trim())
  })
  attributes.forEach(({ element, attribute }) => {
    const current = element.getAttribute(attribute) || ''
    const attrs = originalAttributes.get(element) || {}
    const original = attrs[attribute]
    const cachedTranslation = original && cache.get(original.trim())
    if (original !== undefined && current.trim() !== original.trim() && current.trim() !== cachedTranslation?.trim()) {
      attrs[attribute] = current
    } else if (original === undefined) {
      attrs[attribute] = current
    }
    originalAttributes.set(element, attrs)
    if (isTranslatable(attrs[attribute])) uniqueSet.add(attrs[attribute].trim())
  })
  const uniqueTexts = [...uniqueSet].filter(t => !cache.has(t) && !pendingTranslations.has(`${langCode}\u0000${t}`))

  if (uniqueTexts.length > 0) {
    const requestKey = `${langCode}\u0000${uniqueTexts.join('\u0001')}`
    let request = pendingTranslations.get(requestKey)
    if (!request) {
      request = enqueueTranslation(langCode, () => fetch(`${API}/api/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: uniqueTexts, target: langCode }),
      })
        .then(async resp => {
          if (!resp.ok) throw new Error(`Translation request failed (${resp.status})`)
          const data = await resp.json()
          const translations = Array.isArray(data.translations) ? data.translations : []
          uniqueTexts.forEach((text, index) => {
            // Keeping the source text on a failed/malformed item prevents the
            // observer from retrying the same item on every React mutation.
            cache.set(text, typeof translations[index] === 'string' && translations[index] ? translations[index] : text)
          })
        }))
        .catch(err => {
          console.error('Translation API error:', err)
          uniqueTexts.forEach(text => cache.set(text, text))
        })
        .finally(() => {
          pendingTranslations.delete(requestKey)
          uniqueTexts.forEach(text => pendingTranslations.delete(`${langCode}\u0000${text}`))
        })
      pendingTranslations.set(requestKey, request)
      uniqueTexts.forEach(text => pendingTranslations.set(`${langCode}\u0000${text}`, request))
    }
    await request
  }

  if (activeLang !== langCode) return
  translationMap = Object.fromEntries(cache)
  nodes.forEach(n => {
    const orig = (originalTexts.get(n) || '').trim()
    const translated = cache.get(orig)
    if (translated && n.textContent !== translated) {
      n.textContent = translated
    }
  })
  attributes.forEach(({ element, attribute }) => {
    const orig = (originalAttributes.get(element)?.[attribute] || '').trim()
    const translated = cache.get(orig)
    if (translated && element.getAttribute(attribute) !== translated) {
      element.setAttribute(attribute, translated)
    }
  })
}
