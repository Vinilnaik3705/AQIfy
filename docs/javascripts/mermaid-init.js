(() => {
  const MIN_ZOOM = 0.65
  const MAX_ZOOM = 2.5
  const ZOOM_STEP = 0.25
  let diagramCounter = 0

  function makeButton(label, title, handler) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'aqi-diagram-button'
    button.setAttribute('aria-label', title)
    button.title = title
    button.textContent = label
    button.addEventListener('click', handler)
    return button
  }

  function getSvgMarkup(svg) {
    const copy = svg.cloneNode(true)
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    copy.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
    return new XMLSerializer().serializeToString(copy)
  }

  function getDiagramTitle(host) {
    const heading = host.previousElementSibling
    if (heading && /^H[1-6]$/.test(heading.tagName)) return heading.textContent.trim()
    return document.title.replace(/\s+-\s+AQIfy Docs$/, '').trim() || 'AQIfy diagram'
  }

  function addZoomControls(host, svg, source) {
    if (host.dataset.zoomReady === 'true') return
    host.dataset.zoomReady = 'true'
    host.dataset.source = source
    host.setAttribute('role', 'region')
    host.setAttribute('aria-label', `${getDiagramTitle(host)} diagram`)

    const viewport = document.createElement('div')
    viewport.className = 'aqi-diagram-viewport'
    host.appendChild(viewport)
    viewport.appendChild(svg)

    const viewBox = svg.viewBox && svg.viewBox.baseVal
    const viewBoxWidth = viewBox && viewBox.width > 0 ? viewBox.width : 1200
    const viewBoxHeight = viewBox && viewBox.height > 0 ? viewBox.height : 600
    const aspectRatio = viewBoxWidth / viewBoxHeight
    const availableWidth = Math.max(viewport.clientWidth || 900, 1100)
    const baseWidth = Math.max(availableWidth, 1100)
    const baseHeight = baseWidth / aspectRatio
    let zoom = 1

    const controls = document.createElement('div')
    controls.className = 'aqi-diagram-controls'
    controls.setAttribute('role', 'group')
    controls.setAttribute('aria-label', 'Diagram zoom controls')

    const zoomLabel = document.createElement('span')
    zoomLabel.className = 'aqi-diagram-zoom-label'

    function applyZoom(nextZoom) {
      zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom))
      svg.style.width = `${baseWidth * zoom}px`
      svg.style.height = `${baseHeight * zoom}px`
      zoomLabel.textContent = `${Math.round(zoom * 100)}%`
    }

    const fitWidth = () => {
      const width = Math.max(viewport.clientWidth - 32, 320)
      applyZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, width / baseWidth)))
    }

    controls.appendChild(makeButton('-', 'Zoom out', () => applyZoom(zoom - ZOOM_STEP)))
    controls.appendChild(zoomLabel)
    controls.appendChild(makeButton('+', 'Zoom in', () => applyZoom(zoom + ZOOM_STEP)))
    controls.appendChild(makeButton('Fit', 'Fit diagram to available width', fitWidth))
    controls.appendChild(makeButton('Reset', 'Reset diagram zoom', () => applyZoom(1)))

    const status = document.createElement('span')
    status.className = 'aqi-diagram-status'
    status.setAttribute('aria-live', 'polite')

    const copyButton = makeButton('Copy', 'Copy Mermaid source', async () => {
      try {
        await navigator.clipboard.writeText(source)
        status.textContent = 'Mermaid source copied'
      } catch (error) {
        status.textContent = 'Copy unavailable; use the source below'
        console.warn('AQIfy could not copy Mermaid source:', error)
      }
    })
    controls.appendChild(copyButton)

    const downloadButton = makeButton('SVG', 'Download diagram as SVG', () => {
      const blob = new Blob([getSvgMarkup(svg)], { type: 'image/svg+xml;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${getDiagramTitle(host).toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'aqify-diagram'}.svg`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      status.textContent = 'SVG download started'
    })
    controls.appendChild(downloadButton)
    host.prepend(controls)
    host.appendChild(status)
    applyZoom(1)

    const sourceDetails = document.createElement('details')
    sourceDetails.className = 'aqi-diagram-source'
    const sourceSummary = document.createElement('summary')
    sourceSummary.textContent = 'View Mermaid source'
    const sourceBlock = document.createElement('pre')
    sourceBlock.textContent = source
    sourceDetails.append(sourceSummary, sourceBlock)
    host.appendChild(sourceDetails)
  }

  function showRenderError(host, source, error) {
    host.classList.add('aqi-diagram-failed')
    host.innerHTML = ''
    const message = document.createElement('div')
    message.className = 'aqi-diagram-error'
    message.innerHTML = '<strong>Diagram could not be rendered.</strong><span>The source is shown below so the content remains available.</span>'
    const sourceBlock = document.createElement('pre')
    sourceBlock.textContent = source
    message.appendChild(sourceBlock)
    host.appendChild(message)
    console.error('AQIfy Mermaid diagram failed:', error)
  }

  function configureMermaid() {
    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      flowchart: { useMaxWidth: false, htmlLabels: true, curve: 'basis' },
      sequence: { useMaxWidth: false, wrap: true },
      er: { useMaxWidth: false },
      themeVariables: {
        fontFamily: 'Inter, Roboto, Arial, sans-serif',
        fontSize: '18px',
        primaryColor: '#e8f0ff',
        primaryTextColor: '#172033',
        primaryBorderColor: '#5478e8',
        lineColor: '#52617a',
        secondaryColor: '#eef6ff',
        tertiaryColor: '#f8fafc'
      }
    })
  }

  async function renderDiagrams() {
    if (!window.mermaid) {
      return
    }

    const diagrams = Array.from(document.querySelectorAll('.aqi-mermaid:not([data-aqify-rendered="true"])'))
    for (const host of diagrams) {
      if (host.querySelector('svg')) {
        addZoomControls(host, host.querySelector('svg'), host.dataset.source || '')
        host.dataset.aqifyRendered = 'true'
        continue
      }
      const source = (host.dataset.source || host.textContent).trim()
      const renderId = `aqify-mermaid-${diagramCounter++}`
      try {
        const result = await window.mermaid.render(renderId, source)
        host.innerHTML = result.svg
        host.dataset.aqifyRendered = 'true'
        const svg = host.querySelector('svg')
        if (!svg) throw new Error('Mermaid returned no SVG element')
        if (result.bindFunctions) result.bindFunctions(host)
        addZoomControls(host, svg, source)
      } catch (error) {
        showRenderError(host, source, error)
      }
    }

  }

  let mermaidWaitAttempts = 0
  function startWhenMermaidIsReady() {
    if (window.mermaid) {
      configureMermaid()
      window.setTimeout(renderDiagrams, 0)
      return
    }
    mermaidWaitAttempts += 1
    if (mermaidWaitAttempts < 100) window.setTimeout(startWhenMermaidIsReady, 50)
  }

  if (window.document$ && typeof window.document$.subscribe === 'function') {
    window.document$.subscribe(() => {
      window.setTimeout(startWhenMermaidIsReady, 0)
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startWhenMermaidIsReady, { once: true })
  } else {
    startWhenMermaidIsReady()
  }
})()
