import React, { useState } from 'react'

export function AnalyticsAreaChart({ data = [], height = 220, valueKey = 'runs', labelKey = 'label' }) {
  const [hoveredIdx, setHoveredIdx] = useState(null)

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center text-xs text-gray-500 h-48 border border-dashed border-white/10 rounded-xl">
        No execution data available for this period.
      </div>
    )
  }

  const values = data.map(d => Number(d[valueKey]) || 0)
  const maxVal = Math.max(...values, 5) // Minimum scale of 5 to avoid flat 0
  const width = 600
  const paddingX = 40
  const paddingTop = 20
  const paddingBottom = 30
  const chartWidth = width - paddingX * 2
  const chartHeight = height - paddingTop - paddingBottom

  // Generate SVG path points
  const points = data.map((d, i) => {
    const x = paddingX + (i / Math.max(data.length - 1, 1)) * chartWidth
    const val = Number(d[valueKey]) || 0
    const y = paddingTop + chartHeight - (val / maxVal) * chartHeight
    return { x, y, ...d }
  })

  const pathD = points.length === 1
    ? `M ${points[0].x} ${points[0].y}`
    : points.reduce((acc, pt, idx, arr) => {
        if (idx === 0) return `M ${pt.x} ${pt.y}`
        const prev = arr[idx - 1]
        const cx = (prev.x + pt.x) / 2
        return `${acc} C ${cx} ${prev.y}, ${cx} ${pt.y}, ${pt.x} ${pt.y}`
      }, '')

  const areaD = points.length > 0
    ? `${pathD} L ${points[points.length - 1].x} ${paddingTop + chartHeight} L ${points[0].x} ${paddingTop + chartHeight} Z`
    : ''

  // Y-axis gridlines
  const yTicks = [0, Math.round(maxVal / 2), maxVal]

  // X-axis sampled labels (max 6 labels)
  const step = Math.max(1, Math.floor(data.length / 6))
  const sampledIndices = new Set([0, data.length - 1])
  for (let i = 0; i < data.length; i += step) {
    sampledIndices.add(i)
  }

  return (
    <div className="relative w-full overflow-hidden select-none">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto overflow-visible"
        onMouseLeave={() => setHoveredIdx(null)}
      >
        <defs>
          <linearGradient id="brandAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5a67f2" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#5a67f2" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Y Axis Grid Lines */}
        {yTicks.map((tick, i) => {
          const y = paddingTop + chartHeight - (tick / maxVal) * chartHeight
          return (
            <g key={i}>
              <line
                x1={paddingX}
                y1={y}
                x2={width - paddingX}
                y2={y}
                stroke="rgba(255,255,255,0.06)"
                strokeDasharray="4 4"
              />
              <text
                x={paddingX - 8}
                y={y + 3}
                fill="#6b7280"
                fontSize="10"
                textAnchor="end"
                fontFamily="Inter, sans-serif"
              >
                {tick}
              </text>
            </g>
          )
        })}

        {/* Area fill */}
        {areaD && (
          <path d={areaD} fill="url(#brandAreaGrad)" />
        )}

        {/* Smooth line */}
        {pathD && (
          <path
            d={pathD}
            fill="none"
            stroke="#5a67f2"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Data points */}
        {points.map((pt, idx) => (
          <g key={idx}>
            <circle
              cx={pt.x}
              cy={pt.y}
              r={hoveredIdx === idx ? 5 : 2.5}
              fill="#ffffff"
              stroke="#5a67f2"
              strokeWidth="2"
              className="transition-all duration-150 cursor-pointer"
              onMouseEnter={() => setHoveredIdx(idx)}
            />
            {/* Transparent hover capture column */}
            <rect
              x={pt.x - (chartWidth / data.length) / 2}
              y={paddingTop}
              width={chartWidth / data.length}
              height={chartHeight}
              fill="transparent"
              onMouseEnter={() => setHoveredIdx(idx)}
              className="cursor-pointer"
            />
          </g>
        ))}

        {/* X Axis Labels */}
        {points.map((pt, idx) => {
          if (!sampledIndices.has(idx)) return null
          return (
            <text
              key={idx}
              x={pt.x}
              y={height - 8}
              fill="#9ca3af"
              fontSize="10"
              textAnchor="middle"
              fontFamily="Inter, sans-serif"
            >
              {pt[labelKey]}
            </text>
          )
        })}
      </svg>

      {/* Floating tooltip */}
      {hoveredIdx !== null && points[hoveredIdx] && (
        <div
          className="absolute z-10 pointer-events-none transform -translate-x-1/2 bg-surface-800 border border-white/10 px-2.5 py-1.5 rounded-lg shadow-xl text-xs"
          style={{
            left: `${(points[hoveredIdx].x / width) * 100}%`,
            top: '8px',
          }}
        >
          <p className="text-gray-400 font-medium text-[11px]">{points[hoveredIdx].date}</p>
          <p className="text-white font-bold text-sm">
            {points[hoveredIdx][valueKey]} <span className="text-gray-400 font-normal text-xs">{valueKey}</span>
          </p>
        </div>
      )}
    </div>
  )
}
