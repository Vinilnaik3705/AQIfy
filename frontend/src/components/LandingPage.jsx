import {
  Activity,
  ArrowRight,
  BarChart3,
  BellRing,
  CloudSun,
  MapPin,
  Radio,
  ShieldCheck,
  Wind,
} from 'lucide-react'

const noop = () => {}

const valueProps = [
  {
    icon: Radio,
    eyebrow: 'Live monitoring',
    title: 'See conditions as they change',
    description: 'A clear, city-wide view of current AQI, pollutant levels, and the places that need attention now.',
    color: '#e11d48',
  },
  {
    icon: CloudSun,
    eyebrow: '72-hour forecast',
    title: 'Plan before the next peak',
    description: 'Turn upcoming air-quality shifts into earlier guidance, smarter scheduling, and better preparedness.',
    color: '#2563eb',
  },
  {
    icon: Wind,
    eyebrow: 'Source analysis',
    title: 'Understand what is driving it',
    description: 'Connect pollution patterns to likely sources so teams can focus interventions where they matter most.',
    color: '#0f766e',
  },
  {
    icon: ShieldCheck,
    eyebrow: 'Decisive action',
    title: 'Move from insight to impact',
    description: 'Give communities and authorities the evidence they need to respond with confidence and measure progress.',
    color: '#7c3aed',
  },
]

const chartBars = [38, 52, 46, 68, 61, 76, 58, 44, 50, 32, 42, 28]

export default function LandingPage({ onLogin = noop, onRegister = noop }) {
  return (
    <main style={styles.page}>
      <div style={styles.backgroundGlow} aria-hidden="true" />

      <header style={styles.header}>
        <a href="#top" style={styles.brand} aria-label="AQIfy home">
          <span style={styles.brandMark} aria-hidden="true"><Activity size={17} strokeWidth={2.8} /></span>
          <span>AQIfy</span>
        </a>

        <nav style={styles.nav} aria-label="Primary navigation">
          <a href="#platform" style={styles.navLink}>Platform</a>
          <a href="#why-aqify" style={styles.navLink}>Why AQIfy</a>
          <a href="#for-cities" style={styles.navLink}>For cities</a>
        </nav>

        <div style={styles.headerActions}>
          <button type="button" onClick={onLogin} style={styles.headerLogin}>Login <ArrowRight size={15} /></button>
          <button type="button" onClick={onRegister} style={styles.headerRegister}>Register</button>
        </div>
      </header>

      <section id="top" style={styles.hero}>
        <div style={styles.heroCopy}>
          <div style={styles.kicker}><span style={styles.kickerDot} /> AIR QUALITY, MADE ACTIONABLE</div>
          <h1 style={styles.heroTitle}>Know the air.<br /><span style={styles.heroAccent}>Change the outcome.</span></h1>
          <p style={styles.heroDescription}>
            AQIfy turns complex air-quality data into a simple path from awareness to intervention—for healthier communities and more confident decisions.
          </p>
          <div style={styles.actions}>
            <button type="button" onClick={onLogin} style={styles.primaryButton}>Login to AQIfy <ArrowRight size={17} /></button>
            <button type="button" onClick={onRegister} style={styles.secondaryButton}>Create an account</button>
          </div>
          <div style={styles.reassurance}><ShieldCheck size={16} color="#0f766e" /> Built for citizens, teams, and city leaders</div>
        </div>

        <div style={styles.dashboardWrap} aria-label="AQIfy air-quality dashboard preview">
          <div style={styles.dashboardCard}>
            <div style={styles.dashboardTopline}>
              <div>
                <div style={styles.dashboardLabel}>CITY AIR QUALITY</div>
                <div style={styles.location}><MapPin size={14} color="#e11d48" /> Bengaluru, India</div>
              </div>
              <div style={styles.liveBadge}><span style={styles.liveDot} /> LIVE</div>
            </div>

            <div style={styles.aqiRow}>
              <div>
                <div style={styles.aqiLabel}>Current AQI</div>
                <div style={styles.aqiValue}>84<span style={styles.aqiUnit}> / 500</span></div>
                <div style={styles.aqiStatus}><span style={styles.statusDot} /> Moderate · Updated 2 min ago</div>
              </div>
              <div style={styles.aqiRing}>
                <div style={styles.aqiRingInner}><span>84</span><small>AQI</small></div>
              </div>
            </div>

            <div style={styles.chartHeader}><span>Last 12 hours</span><span style={styles.chartLegend}><span style={styles.legendLine} /> AQI trend</span></div>
            <div style={styles.chart} aria-hidden="true">
              {chartBars.map((height, index) => (
                <div key={`${height}-${index}`} style={styles.barColumn}>
                  <div style={{ ...styles.bar, height: `${height}%`, background: index > 7 ? '#fda4af' : '#fb7185' }} />
                </div>
              ))}
            </div>
            <div style={styles.chartAxis}><span>08:00</span><span>14:00</span><span>20:00</span></div>

            <div style={styles.metricGrid}>
              <div style={styles.metric}><span style={styles.metricIcon}><Wind size={14} /></span><span><b>PM2.5</b><small> 28 µg/m³</small></span></div>
              <div style={styles.metric}><span style={{ ...styles.metricIcon, color: '#2563eb', background: '#dbeafe' }}><CloudSun size={14} /></span><span><b>Forecast</b><small> Improving</small></span></div>
            </div>
          </div>
          <div style={styles.floatingAlert}><span style={styles.alertIcon}><BellRing size={15} /></span><span><b>New insight available</b><small>Traffic corridor elevated</small></span></div>
        </div>
      </section>

      <section style={styles.statStrip} aria-label="AQIfy platform highlights">
        <div style={styles.stat}><strong>72h</strong><span>Forecast visibility</span></div>
        <div style={styles.stat}><strong>24/7</strong><span>Continuous monitoring</span></div>
        <div style={styles.stat}><strong>1 view</strong><span>From data to action</span></div>
        <div style={styles.stat}><strong>Built for</strong><span>Healthier communities</span></div>
      </section>

      <section id="platform" style={styles.section}>
        <div style={styles.sectionHeading}>
          <div style={styles.sectionKicker}>ONE CLEARER PICTURE</div>
          <h2 style={styles.sectionTitle}>Everything you need to make air quality actionable.</h2>
          <p style={styles.sectionDescription}>Whether you are checking conditions before heading out or coordinating a city response, AQIfy brings the signal into focus.</p>
        </div>
        <div style={styles.valueGrid}>
          {valueProps.map(({ icon: Icon, eyebrow, title, description, color }) => (
            <article key={title} style={styles.valueCard}>
              <div style={{ ...styles.valueIcon, color, background: `${color}12` }}><Icon size={20} strokeWidth={2.1} /></div>
              <div style={{ ...styles.valueEyebrow, color }}>{eyebrow}</div>
              <h3 style={styles.valueTitle}>{title}</h3>
              <p style={styles.valueDescription}>{description}</p>
              <a href="#for-cities" style={styles.cardLink}>Explore the platform <ArrowRight size={14} /></a>
            </article>
          ))}
        </div>
      </section>

      <section id="why-aqify" style={styles.insightSection}>
        <div style={styles.insightVisual} aria-hidden="true">
          <div style={styles.insightOrb} />
          <div style={styles.insightGridLines} />
          <div style={styles.insightMiniCard}><BarChart3 size={18} color="#e11d48" /><span><b>Source confidence</b><small>High · 91%</small></span></div>
          <div style={styles.insightMiniCardBottom}><Wind size={18} color="#0f766e" /><span><b>PM2.5 trend</b><small>↓ 12% this week</small></span></div>
        </div>
        <div style={styles.insightCopy}>
          <div style={styles.sectionKicker}>FROM SIGNAL TO STORY</div>
          <h2 style={styles.sectionTitle}>The context behind every reading.</h2>
          <p style={styles.sectionDescription}>Numbers are only the beginning. AQIfy helps you understand patterns, spot likely sources, and communicate what a changing atmosphere means for the people you serve.</p>
          <div style={styles.checkList}>
            <div><span style={styles.check}>✓</span><span><b>Understand local patterns</b><small>See where conditions are changing and why.</small></span></div>
            <div><span style={styles.check}>✓</span><span><b>Act with evidence</b><small>Give every response a clear data trail.</small></span></div>
            <div><span style={styles.check}>✓</span><span><b>Keep people informed</b><small>Share timely, useful guidance with confidence.</small></span></div>
          </div>
        </div>
      </section>

      <section id="for-cities" style={styles.finalCta}>
        <div>
          <div style={{ ...styles.sectionKicker, color: '#fda4af' }}>A HEALTHIER NEXT STEP</div>
          <h2 style={styles.finalTitle}>Start with a clearer view of the air.</h2>
          <p style={styles.finalDescription}>Log in to your AQIfy workspace or create an account to begin.</p>
        </div>
        <div style={styles.finalActions}>
          <button type="button" onClick={onLogin} style={styles.finalPrimary}>Login <ArrowRight size={17} /></button>
          <button type="button" onClick={onRegister} style={styles.finalSecondary}>Register</button>
        </div>
      </section>

      <footer style={styles.footer}><span style={styles.footerBrand}><span style={styles.footerMark}><Activity size={13} /></span> AQIfy</span><span>Clearer air starts with clearer information.</span></footer>
    </main>
  )
}

const styles = {
  page: {
    position: 'relative',
    minHeight: '100vh',
    overflowY: 'auto',
    overflowX: 'hidden',
    background: '#f8fafc',
    color: '#0f172a',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  },
  backgroundGlow: { position: 'absolute', top: -230, right: -160, width: 520, height: 520, borderRadius: '50%', background: 'rgba(251, 113, 133, 0.11)', filter: 'blur(4px)', pointerEvents: 'none' },
  header: { position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, maxWidth: 1220, margin: '0 auto', padding: '24px 32px' },
  brand: { display: 'inline-flex', alignItems: 'center', gap: 9, color: '#0f172a', fontSize: 22, fontWeight: 800, letterSpacing: '-0.8px', textDecoration: 'none' },
  brandMark: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 29, height: 29, borderRadius: 8, color: '#fff', background: '#e11d48', boxShadow: '0 7px 16px rgba(225, 29, 72, 0.25)' },
  nav: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 30, flex: 1 },
  navLink: { color: '#64748b', fontSize: 13, fontWeight: 600, textDecoration: 'none' },
  headerLogin: { display: 'inline-flex', alignItems: 'center', gap: 7, border: '1px solid #cbd5e1', borderRadius: 8, color: '#0f172a', background: '#fff', padding: '9px 15px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  headerActions: { display: 'flex', alignItems: 'center', gap: 9 },
  headerRegister: { display: 'inline-flex', alignItems: 'center', border: 0, borderRadius: 8, color: '#fff', background: '#0f172a', padding: '10px 15px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  hero: { position: 'relative', zIndex: 1, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))', alignItems: 'center', gap: 'clamp(36px, 7vw, 96px)', maxWidth: 1220, margin: '0 auto', padding: '58px 32px 82px' },
  heroCopy: { maxWidth: 610 },
  kicker: { display: 'flex', alignItems: 'center', gap: 9, color: '#e11d48', fontSize: 11, fontWeight: 800, letterSpacing: '0.15em' },
  kickerDot: { width: 7, height: 7, borderRadius: '50%', background: '#e11d48', boxShadow: '0 0 0 5px rgba(225, 29, 72, 0.1)' },
  heroTitle: { margin: '20px 0 22px', color: '#0f172a', fontSize: 'clamp(42px, 6vw, 76px)', lineHeight: 1.02, letterSpacing: '-0.065em', fontWeight: 800 },
  heroAccent: { color: '#e11d48' },
  heroDescription: { maxWidth: 550, margin: 0, color: '#475569', fontSize: 'clamp(16px, 2vw, 18px)', lineHeight: 1.7 },
  actions: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginTop: 32 },
  primaryButton: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10, border: 0, borderRadius: 8, color: '#fff', background: '#e11d48', padding: '14px 19px', fontSize: 14, fontWeight: 750, cursor: 'pointer', boxShadow: '0 10px 22px rgba(225, 29, 72, 0.22)' },
  secondaryButton: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #cbd5e1', borderRadius: 8, color: '#334155', background: '#fff', padding: '13px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  reassurance: { display: 'flex', alignItems: 'center', gap: 7, marginTop: 22, color: '#64748b', fontSize: 12 },
  dashboardWrap: { position: 'relative', width: '100%', maxWidth: 500, justifySelf: 'end' },
  dashboardCard: { position: 'relative', zIndex: 1, border: '1px solid rgba(148, 163, 184, 0.32)', borderRadius: 18, background: 'rgba(255, 255, 255, 0.93)', padding: '23px 24px 19px', boxShadow: '0 24px 65px rgba(15, 23, 42, 0.13)', backdropFilter: 'blur(10px)' },
  dashboardTopline: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 },
  dashboardLabel: { color: '#94a3b8', fontSize: 10, fontWeight: 800, letterSpacing: '0.14em' },
  location: { display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, color: '#1e293b', fontSize: 14, fontWeight: 700 },
  liveBadge: { display: 'flex', alignItems: 'center', gap: 6, borderRadius: 20, color: '#0f766e', background: '#ccfbf1', padding: '5px 9px', fontSize: 10, fontWeight: 800, letterSpacing: '0.08em' },
  liveDot: { width: 6, height: 6, borderRadius: '50%', background: '#14b8a6' },
  aqiRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18, marginTop: 27 },
  aqiLabel: { color: '#64748b', fontSize: 12, fontWeight: 600 },
  aqiValue: { marginTop: 2, color: '#0f172a', fontSize: 46, fontWeight: 800, letterSpacing: '-0.06em', lineHeight: 1.1 },
  aqiUnit: { color: '#94a3b8', fontSize: 13, fontWeight: 600, letterSpacing: 0 },
  aqiStatus: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, color: '#64748b', fontSize: 11 },
  statusDot: { width: 7, height: 7, borderRadius: '50%', background: '#eab308' },
  aqiRing: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: 96, height: 96, borderRadius: '50%', background: 'conic-gradient(#eab308 0deg 60deg, #e2e8f0 60deg 360deg)' },
  aqiRingInner: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: 78, height: 78, borderRadius: '50%', background: '#fff', color: '#0f172a', fontSize: 23, fontWeight: 800 },
  chartHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 29, color: '#334155', fontSize: 11, fontWeight: 700 },
  chartLegend: { display: 'flex', alignItems: 'center', gap: 6, color: '#94a3b8', fontSize: 10, fontWeight: 600 },
  legendLine: { width: 16, height: 3, borderRadius: 3, background: '#fb7185' },
  chart: { display: 'flex', alignItems: 'end', gap: 5, height: 92, marginTop: 10, padding: '0 3px 1px', borderBottom: '1px solid #e2e8f0' },
  barColumn: { display: 'flex', alignItems: 'end', flex: 1, height: '100%' },
  bar: { width: '100%', minHeight: 8, borderRadius: '4px 4px 0 0' },
  chartAxis: { display: 'flex', justifyContent: 'space-between', marginTop: 6, color: '#94a3b8', fontSize: 9 },
  metricGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginTop: 19 },
  metric: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, borderRadius: 9, background: '#f8fafc', padding: '9px 10px', color: '#334155', fontSize: 11 },
  metricIcon: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, width: 25, height: 25, borderRadius: 7, color: '#0f766e', background: '#ccfbf1' },
  floatingAlert: { position: 'absolute', zIndex: 2, right: -31, bottom: -27, display: 'flex', alignItems: 'center', gap: 9, width: 195, border: '1px solid #fecdd3', borderRadius: 11, background: '#fff', padding: '11px 12px', boxShadow: '0 14px 28px rgba(15, 23, 42, 0.12)', color: '#334155', fontSize: 10 },
  alertIcon: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, width: 28, height: 28, borderRadius: 8, color: '#e11d48', background: '#fff1f2' },
  statStrip: { position: 'relative', zIndex: 1, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', maxWidth: 1156, margin: '0 auto', borderTop: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0', padding: '23px 0' },
  stat: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, borderRight: '1px solid #e2e8f0', color: '#64748b', fontSize: 11, textAlign: 'center' },
  section: { position: 'relative', zIndex: 1, maxWidth: 1220, margin: '0 auto', padding: '112px 32px 100px' },
  sectionHeading: { maxWidth: 680, marginBottom: 43 },
  sectionKicker: { color: '#e11d48', fontSize: 11, fontWeight: 800, letterSpacing: '0.15em' },
  sectionTitle: { margin: '14px 0 15px', color: '#0f172a', fontSize: 'clamp(29px, 4vw, 46px)', lineHeight: 1.1, letterSpacing: '-0.045em', fontWeight: 800 },
  sectionDescription: { margin: 0, color: '#64748b', fontSize: 15, lineHeight: 1.75 },
  valueGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 15 },
  valueCard: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minHeight: 290, border: '1px solid #e2e8f0', borderRadius: 13, background: '#fff', padding: 23, boxShadow: '0 7px 18px rgba(15, 23, 42, 0.035)' },
  valueIcon: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 42, height: 42, borderRadius: 11 },
  valueEyebrow: { marginTop: 25, fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase' },
  valueTitle: { margin: '10px 0 9px', color: '#0f172a', fontSize: 19, lineHeight: 1.25, letterSpacing: '-0.02em' },
  valueDescription: { margin: 0, color: '#64748b', fontSize: 13, lineHeight: 1.65 },
  cardLink: { display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 'auto', paddingTop: 20, color: '#334155', fontSize: 11, fontWeight: 750, textDecoration: 'none' },
  insightSection: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', alignItems: 'center', gap: 'clamp(45px, 8vw, 125px)', maxWidth: 1156, margin: '0 auto', padding: '0 32px 115px' },
  insightVisual: { position: 'relative', minHeight: 340, overflow: 'hidden', borderRadius: 16, background: '#0f172a' },
  insightOrb: { position: 'absolute', top: '16%', left: '25%', width: 220, height: 220, borderRadius: '50%', background: 'radial-gradient(circle at 40% 35%, rgba(251, 113, 133, 0.9), rgba(225, 29, 72, 0.15) 54%, transparent 70%)', filter: 'blur(1px)' },
  insightGridLines: { position: 'absolute', inset: 0, opacity: 0.21, backgroundImage: 'linear-gradient(rgba(148,163,184,.3) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,.3) 1px, transparent 1px)', backgroundSize: '34px 34px', transform: 'perspective(500px) rotateX(60deg) scale(1.5)', transformOrigin: 'bottom' },
  insightMiniCard: { position: 'absolute', top: 36, right: 25, display: 'flex', alignItems: 'center', gap: 9, border: '1px solid rgba(148, 163, 184, .25)', borderRadius: 10, background: 'rgba(30, 41, 59, .9)', padding: '10px 12px', color: '#f8fafc', fontSize: 10 },
  insightMiniCardBottom: { position: 'absolute', bottom: 32, left: 25, display: 'flex', alignItems: 'center', gap: 9, border: '1px solid rgba(45, 212, 191, .25)', borderRadius: 10, background: 'rgba(30, 41, 59, .92)', padding: '10px 12px', color: '#f8fafc', fontSize: 10 },
  insightCopy: { maxWidth: 490 },
  checkList: { display: 'grid', gap: 18, marginTop: 28 },
  checkListItem: {},
  check: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, width: 22, height: 22, borderRadius: '50%', color: '#0f766e', background: '#ccfbf1', fontSize: 13, fontWeight: 800 },
  finalCta: { position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 30, maxWidth: 1156, margin: '0 auto 70px', borderRadius: 16, background: '#0f172a', padding: '42px 48px', overflow: 'hidden' },
  finalTitle: { margin: '12px 0 8px', color: '#f8fafc', fontSize: 'clamp(26px, 4vw, 38px)', letterSpacing: '-0.04em', lineHeight: 1.1 },
  finalDescription: { margin: 0, color: '#94a3b8', fontSize: 14 },
  finalActions: { display: 'flex', flexWrap: 'wrap', gap: 10, flexShrink: 0 },
  finalPrimary: { display: 'inline-flex', alignItems: 'center', gap: 8, border: 0, borderRadius: 8, color: '#0f172a', background: '#fff', padding: '12px 16px', fontSize: 13, fontWeight: 750, cursor: 'pointer' },
  finalSecondary: { border: '1px solid #475569', borderRadius: 8, color: '#f8fafc', background: 'transparent', padding: '11px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  footer: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, maxWidth: 1156, margin: '0 auto', borderTop: '1px solid #e2e8f0', padding: '24px 0 35px', color: '#94a3b8', fontSize: 11 },
  footerBrand: { display: 'inline-flex', alignItems: 'center', gap: 6, color: '#334155', fontSize: 14, fontWeight: 800 },
  footerMark: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 21, height: 21, borderRadius: 5, color: '#fff', background: '#e11d48' },
}
