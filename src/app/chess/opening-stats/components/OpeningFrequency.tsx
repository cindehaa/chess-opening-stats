'use client'

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import type { OpeningStats } from '../lib/analyzeOpenings'
import styles from './OpeningFrequency.module.css'
import shared from './collapsible.module.css'

type OpeningFrequencyProps = {
  openingStats: OpeningStats[]
  totalGames: number
  onCopyLink?: () => void
  copyLinkSuccess?: boolean
}

const PALETTE = [
  '#21c45d', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6',
  '#ef4444', '#14b8a6', '#f97316', '#06b6d4', '#84cc16',
  '#a855f7', '#64748b', '#e11d48', '#0891b2', '#65a30d',
  '#d97706', '#7c3aed', '#0369a1', '#15803d', '#b91c1c',
]

type InnerSlice = {
  name: string
  value: number
  wins: number
  draws: number
  losses: number
  color: string
}

type OuterSlice = {
  name: string
  fullName: string
  value: number
  wins: number
  draws: number
  losses: number
  color: string
  eco: string
}

function parseOpeningName(name: string): { main: string; variant: string } {
  const idx = name.indexOf(':')
  if (idx === -1) return { main: name, variant: '' }
  return { main: name.slice(0, idx).trim(), variant: name.slice(idx + 1).trim() }
}

function buildChartData(openings: OpeningStats[], color: 'w' | 'b') {
  const forColor = openings
    .filter((s) => s.color === color)
    .sort((a, b) => b.gamesCount - a.gamesCount)

  const mainMap = new Map<string, InnerSlice>()

  for (const s of forColor) {
    const { main } = parseOpeningName(s.name)
    if (!mainMap.has(main)) {
      mainMap.set(main, {
        name: main,
        value: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        color: PALETTE[mainMap.size % PALETTE.length],
      })
    }
    const entry = mainMap.get(main)!
    entry.value += s.gamesCount
    entry.wins += s.wins
    entry.draws += s.draws
    entry.losses += s.losses
  }

  const innerData: InnerSlice[] = Array.from(mainMap.values())
  const colorByMain = new Map(innerData.map((d) => [d.name, d.color]))

  const outerData: OuterSlice[] = forColor.map((s) => {
    const { main, variant } = parseOpeningName(s.name)
    return {
      name: variant || main,
      fullName: s.name,
      value: s.gamesCount,
      wins: s.wins,
      draws: s.draws,
      losses: s.losses,
      color: colorByMain.get(main) ?? PALETTE[0],
      eco: s.eco,
    }
  })

  return { innerData, outerData }
}

const RADIAN = Math.PI / 180

function renderOuterLabel({
  cx,
  cy,
  midAngle,
  outerRadius,
  name,
  percent,
}: {
  cx: number
  cy: number
  midAngle: number
  outerRadius: number
  name: string
  percent: number
}) {
  if (percent < 0.04) return null
  const radius = outerRadius + 16
  const x = cx + radius * Math.cos(-midAngle * RADIAN)
  const y = cy + radius * Math.sin(-midAngle * RADIAN)
  const label = name.length > 14 ? name.slice(0, 14) + '…' : name
  return (
    <text
      x={x}
      y={y}
      textAnchor={x > cx ? 'start' : 'end'}
      dominantBaseline="central"
      fontSize={9}
      fill="#758a7d"
    >
      {label}
    </text>
  )
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload: InnerSlice | OuterSlice }>
}) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  const total = d.value
  const wPct = total ? Math.round((d.wins / total) * 100) : 0
  const dPct = total ? Math.round((d.draws / total) * 100) : 0
  const lPct = total ? Math.round((d.losses / total) * 100) : 0
  const displayName = 'fullName' in d ? d.fullName : d.name
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipName}>{displayName}</div>
      <div className={styles.tooltipMeta}>
        {total} game{total !== 1 ? 's' : ''}
      </div>
      <div className={styles.tooltipWdl}>
        <span className={styles.tooltipW}>{wPct}%W</span>
        {' · '}
        <span className={styles.tooltipD}>{dPct}%D</span>
        {' · '}
        <span className={styles.tooltipL}>{lPct}%L</span>
      </div>
    </div>
  )
}

function OpeningDonutChart({
  openings,
  color,
}: {
  openings: OpeningStats[]
  color: 'w' | 'b'
}) {
  const { innerData, outerData } = buildChartData(openings, color)

  if (innerData.length === 0) {
    return <p className={shared.empty}>No games found</p>
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart margin={{ top: 20, right: 55, bottom: 20, left: 55 }}>
        <Pie
          data={innerData}
          cx="50%"
          cy="50%"
          innerRadius={50}
          outerRadius={82}
          dataKey="value"
          stroke="none"
        >
          {innerData.map((d) => (
            <Cell key={d.name} fill={d.color} opacity={0.9} />
          ))}
        </Pie>
        <Pie
          data={outerData}
          cx="50%"
          cy="50%"
          innerRadius={87}
          outerRadius={112}
          dataKey="value"
          label={renderOuterLabel as any}
          labelLine={false}
          stroke="none"
        >
          {outerData.map((d, i) => (
            <Cell key={`${d.eco}-${i}`} fill={d.color} opacity={0.6} />
          ))}
        </Pie>
        <Tooltip content={(props) => <CustomTooltip {...(props as any)} />} />
      </PieChart>
    </ResponsiveContainer>
  )
}

export function OpeningFrequency({
  openingStats,
  onCopyLink,
  copyLinkSuccess = false,
}: OpeningFrequencyProps) {
  return (
    <section className={shared.section}>
      <details className={shared.collapsible} open>
        <summary className={shared.summary}>
          <h2 className={shared.heading}>Opening Frequency</h2>
          <div className={shared.summaryActions}>
            {onCopyLink && (
              <button
                className={shared.copyLinkBtn}
                onClick={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  onCopyLink()
                }}
                title="Copy link to this analysis"
                aria-label="Copy link"
              >
                {copyLinkSuccess ? '✓' : '🔗'}
              </button>
            )}
          </div>
          <span className={shared.chevron} aria-hidden="true">▾</span>
        </summary>

        <div className={styles.columns}>
          <div className={styles.column}>
            <h3 className={styles.colorHeading}>As White</h3>
            <OpeningDonutChart openings={openingStats} color="w" />
          </div>
          <div className={styles.column}>
            <h3 className={styles.colorHeading}>As Black</h3>
            <OpeningDonutChart openings={openingStats} color="b" />
          </div>
        </div>
      </details>
    </section>
  )
}
