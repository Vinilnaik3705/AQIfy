/* ── DOM translation engine (backend-powered via /api/translate) ────────── */

// Module-level stores so MutationObserver callbacks can access them
const originalTexts = new Map()
let translationMap = {}
let activeLang = 'en'

export function getActiveLang() {
  return activeLang
}

export function setActiveLang(code) {
  activeLang = code
}

export function resetTranslations() {
  translationMap = {}
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

export function restoreOriginals() {
  originalTexts.forEach((orig, node) => {
    try {
      node.textContent = orig
    } catch {
      // Node may be detached from the DOM — ignore
    }
  })
  translationMap = {}
}

export function getTextNodes(root) {
  const nodes = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const t = node.textContent.trim()
      if (!t || t.length < 2) return NodeFilter.FILTER_REJECT
      const tag = node.parentElement?.tagName
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE', 'PRE'].includes(tag)) return NodeFilter.FILTER_REJECT
      if (node.parentElement?.closest?.('[data-notranslate]')) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })
  while (walker.nextNode()) nodes.push(walker.currentNode)
  return nodes
}

export async function translateNodes(nodes, langCode) {
  const uniqueSet = new Set()
  nodes.forEach(n => {
    const orig = originalTexts.get(n) || n.textContent
    if (!originalTexts.has(n)) originalTexts.set(n, n.textContent)
    uniqueSet.add(orig.trim())
  })
  const uniqueTexts = [...uniqueSet].filter(t => t.length >= 2 && !translationMap[t])

  if (uniqueTexts.length > 0) {
    try {
      const resp = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: uniqueTexts, target: langCode }),
      })
      const data = await resp.json()
      uniqueTexts.forEach((t, i) => {
        translationMap[t] = data.translations[i]
      })
    } catch (err) {
      console.error('Translation API error:', err)
      return
    }
  }

  nodes.forEach(n => {
    const orig = (originalTexts.get(n) || '').trim()
    if (translationMap[orig]) {
      n.textContent = translationMap[orig]
    }
  })
}
