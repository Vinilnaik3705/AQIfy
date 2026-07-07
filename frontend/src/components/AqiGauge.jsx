/* ── AQI Gauge Component (Indian NAQI standard) ─────────────────────────── */

export default function AqiGauge({ aqi }) {
    const clampedAqi = Math.max(0, Math.min(500, aqi));
    const cx = 130, cy = 120, r = 95;

    const arcPoint = (deg) => {
        const rad = (deg * Math.PI) / 180;
        return [cx + r * Math.cos(rad), cy - r * Math.sin(rad)];
    };

    // Piecewise linear mapping for the equal-width segmented NAQI gauge scale
    const toAngle = (val) => {
        if (val <= 50) {
            return 180 - (val / 50) * 30;
        } else if (val <= 100) {
            return 150 - ((val - 50) / 50) * 30;
        } else if (val <= 200) {
            return 120 - ((val - 100) / 100) * 30;
        } else if (val <= 300) {
            return 90 - ((val - 200) / 100) * 30;
        } else if (val <= 400) {
            return 60 - ((val - 300) / 100) * 30;
        } else {
            return 30 - ((val - 400) / 100) * 30;
        }
    };

    const bands = [
        { color: '#2ea74f', startAngle: 180, endAngle: 150 }, // Green
        { color: '#f7bc06', startAngle: 150, endAngle: 120 }, // Yellow
        { color: '#f57e0f', startAngle: 120, endAngle: 90 },  // Orange
        { color: '#e52229', startAngle: 90, endAngle: 60 },  // Red
        { color: '#743ca1', startAngle: 60, endAngle: 30 },  // Purple
        { color: '#6e1e2d', startAngle: 30, endAngle: 0 },   // Maroon
    ];

    const buildArc = (startAngle, endAngle) => {
        const [x1, y1] = arcPoint(startAngle);
        const [x2, y2] = arcPoint(endAngle);
        return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
    };

    const tickLines = [
        { val: 0, angle: 180, len: 10 },
        { val: 50, angle: 150, len: 8 },
        { val: 100, angle: 120, len: 8 },
        { val: 200, angle: 90, len: 8 },
        { val: 300, angle: 60, len: 8 },
        { val: 400, angle: 30, len: 8 },
        { val: 500, angle: 0, len: 10 },
    ];

    const labels = [
        { val: 0, angle: 180, dx: -14, dy: 4, color: '#2ea74f' },
        { val: 50, angle: 150, dx: -14, dy: -10, color: '#f7bc06' },
        { val: 100, angle: 120, dx: -14, dy: -12, color: '#f57e0f' },
        { val: 200, angle: 90, dx: 0, dy: -14, color: '#e52229' },
        { val: 300, angle: 60, dx: 14, dy: -12, color: '#743ca1' },
        { val: 400, angle: 30, dx: 14, dy: -10, color: '#6e1e2d' },
        { val: 500, angle: 0, dx: 16, dy: 4, color: '#6e1e2d' },
    ];

    const aqiLabel = clampedAqi <= 50 ? 'Good'
        : clampedAqi <= 100 ? 'Satisfactory'
            : clampedAqi <= 200 ? 'Moderate'
                : clampedAqi <= 300 ? 'Poor'
                    : clampedAqi <= 400 ? 'Very Poor' : 'Severe';

    const aqiLabelColor = clampedAqi <= 50 ? '#2ea74f'
        : clampedAqi <= 100 ? '#f7bc06'
            : clampedAqi <= 200 ? '#f57e0f'
                : clampedAqi <= 300 ? '#e52229'
                    : clampedAqi <= 400 ? '#743ca1' : '#6e1e2d';

    // Tapered needle geometry
    const needleAngle = toAngle(clampedAqi);
    const rad = (needleAngle * Math.PI) / 180;
    const tipX = cx + (r - 10) * Math.cos(rad);
    const tipY = cy - (r - 10) * Math.sin(rad);

    const baseW = 4.5;
    const bx1 = cx + baseW * Math.cos(rad - Math.PI / 2);
    const by1 = cy - baseW * Math.sin(rad - Math.PI / 2);
    const bx2 = cx + baseW * Math.cos(rad + Math.PI / 2);
    const by2 = cy - baseW * Math.sin(rad + Math.PI / 2);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '4px 0 8px 0', width: '100%' }}>
            <svg width="260" height="155" viewBox="0 0 260 155" style={{ display: 'block', overflow: 'visible' }}>
                {/* Background track */}
                <path
                    d={`M ${arcPoint(180)[0].toFixed(2)} ${arcPoint(180)[1].toFixed(2)} A ${r} ${r} 0 0 1 ${arcPoint(0)[0].toFixed(2)} ${arcPoint(0)[1].toFixed(2)}`}
                    fill="none" stroke="#f8fafc" strokeWidth="22"
                />

                {/* Colored NAQI bands */}
                {bands.map((b, i) => (
                    <path key={i} d={buildArc(b.startAngle, b.endAngle)} fill="none" stroke={b.color} strokeWidth="20" strokeLinecap="butt" />
                ))}

                {/* Tick lines */}
                {tickLines.map(t => {
                    const trad = (t.angle * Math.PI) / 180;
                    const x1 = cx + (r + 2) * Math.cos(trad);
                    const y1 = cy - (r + 2) * Math.sin(trad);
                    const x2 = cx + (r + t.len) * Math.cos(trad);
                    const y2 = cy - (r + t.len) * Math.sin(trad);
                    return (
                        <line key={`tick-${t.val}`} x1={x1.toFixed(1)} y1={y1.toFixed(1)} x2={x2.toFixed(1)} y2={y2.toFixed(1)} stroke="#94a3b8" strokeWidth="1.8" />
                    );
                })}

                {/* Tick Labels */}
                {labels.map(l => {
                    const lrad = (l.angle * Math.PI) / 180;
                    const lx = cx + (r + 14) * Math.cos(lrad) + l.dx;
                    const ly = cy - (r + 14) * Math.sin(lrad) + l.dy;
                    return (
                        <text key={l.val} x={lx.toFixed(1)} y={ly.toFixed(1)} fontSize="12" fontWeight="800" fill={l.color} textAnchor="middle" style={{ fontFamily: 'Inter, sans-serif' }}>
                            {l.val}
                        </text>
                    );
                })}

                {/* Tapered Needle */}
                <polygon
                    points={`${bx1.toFixed(2)},${by1.toFixed(2)} ${tipX.toFixed(2)},${tipY.toFixed(2)} ${bx2.toFixed(2)},${by2.toFixed(2)}`}
                    fill="#1e293b"
                    style={{ transformOrigin: `${cx}px ${cy}px`, transition: 'transform 0.8s cubic-bezier(0.34,1.56,0.64,1)' }}
                />

                {/* Hub */}
                <circle cx={cx} cy={cy} r="12" fill="#1e293b" />
                <circle cx={cx} cy={cy} r="8" fill="#475569" />
                <circle cx={cx} cy={cy} r="4" fill="#94a3b8" />

                {/* AQI value display */}
                <text x={cx} y={cy + 32} fontSize="26" fontWeight="900" fill={aqiLabelColor} textAnchor="middle" style={{ fontFamily: 'Inter, sans-serif' }}>
                    {Math.round(clampedAqi)}
                </text>
                <text x={cx} y={cy + 46} fontSize="11" fontWeight="700" fill={aqiLabelColor} textAnchor="middle" style={{ fontFamily: 'Inter, sans-serif', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                    {aqiLabel}
                </text>
            </svg>
        </div>
    );
}
