'use client'

import { useState } from 'react'
import { PieChart, Pie, Cell, Sector, Tooltip, ResponsiveContainer } from 'recharts'
import type { OpeningStats } from '../lib/analyzeOpenings'
import { OpeningNamePreview } from './OpeningNamePreview'
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
  hasVariant: boolean
  isLabelSegment: boolean  // first (largest) segment of each family — carries the group label
}

function parseOpeningName(name: string): { family: string; variant: string } {
  const idx = name.indexOf(':')
  if (idx === -1) return { family: name, variant: '' }
  return { family: name.slice(0, idx).trim(), variant: name.slice(idx + 1).trim() }
}

function buildChartData(openings: OpeningStats[], color: 'w' | 'b') {
  const forColor = openings
    .filter((s) => s.color === color)
    .sort((a, b) => b.gamesCount - a.gamesCount)

  const familyMap = new Map<string, InnerSlice>()
  for (const s of forColor) {
    const { family } = parseOpeningName(s.name)
    if (!familyMap.has(family)) {
      familyMap.set(family, {
        name: family,
        value: 0, wins: 0, draws: 0, losses: 0,
        color: PALETTE[familyMap.size % PALETTE.length],
      })
    }
    const e = familyMap.get(family)!
    e.value += s.gamesCount
    e.wins += s.wins
    e.draws += s.draws
    e.losses += s.losses
  }

  const innerData = Array.from(familyMap.values()).sort((a, b) => b.value - a.value)
  const colorByFamily = new Map(innerData.map((d) => [d.name, d.color]))
  const familyOrder = new Map(innerData.map((d, i) => [d.name, i]))

  const sorted = forColor
    .map((s) => {
      const { family, variant } = parseOpeningName(s.name)
      return {
        name: variant || s.name,
        fullName: s.name,
        value: s.gamesCount,
        wins: s.wins,
        draws: s.draws,
        losses: s.losses,
        color: colorByFamily.get(family) ?? PALETTE[0],
        hasVariant: Boolean(variant),
        isLabelSegment: false,
      }
    })
    .sort((a, b) => {
      const { family: fa } = parseOpeningName(a.fullName)
      const { family: fb } = parseOpeningName(b.fullName)
      const orderDiff = (familyOrder.get(fa) ?? 99) - (familyOrder.get(fb) ?? 99)
      return orderDiff !== 0 ? orderDiff : b.value - a.value
    })

  // Mark the first (largest) segment of each family to carry the group label
  const seenFamilies = new Set<string>()
  const outerData: OuterSlice[] = sorted.map((d) => {
    const { family } = parseOpeningName(d.fullName)
    const isLabelSegment = !seenFamilies.has(family)
    seenFamilies.add(family)
    return { ...d, isLabelSegment }
  })

  return { innerData, outerData }
}

const RADIAN = Math.PI / 180

function renderOuterLabel({ cx, cy, midAngle, outerRadius, percent, payload }: any) {
  // One label per opening family, on its largest segment; skip tiny arcs
  if (!payload.isLabelSegment || percent < 0.03) return null
  const family = parseOpeningName(payload.fullName).family
  const label = family.length > 15 ? family.slice(0, 15) + '…' : family
  const radius = outerRadius + 16
  const x = cx + radius * Math.cos(-midAngle * RADIAN)
  const y = cy + radius * Math.sin(-midAngle * RADIAN)
  return (
    <text x={x} y={y} textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" fontSize={9} fill="#758a7d">
      {label}
    </text>
  )
}

function renderZoomedLabel({ cx, cy, midAngle, outerRadius, percent, payload }: any) {
  if (percent < 0.04) return null
  const radius = outerRadius + 20
  const x = cx + radius * Math.cos(-midAngle * RADIAN)
  const y = cy + radius * Math.sin(-midAngle * RADIAN)
  const name = payload.name.length > 18 ? payload.name.slice(0, 18) + '…' : payload.name
  const pct = `${Math.round(percent * 100)}%`
  return (
    <text x={x} y={y} textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" fontSize={10} fill="#758a7d">
      {`${name} ${pct}`}
    </text>
  )
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: InnerSlice | OuterSlice; percent?: number }> }) {
  if (!active || !payload?.length) return null
  const { payload: d, percent } = payload[0]
  const total = d.value
  const slicePct = percent != null ? Math.round(percent * 100) : null
  const wPct = total ? Math.round((d.wins / total) * 100) : 0
  const dPct = total ? Math.round((d.draws / total) * 100) : 0
  const lPct = total ? Math.round((d.losses / total) * 100) : 0
  const displayName = 'fullName' in d ? d.fullName : d.name
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipName}>{displayName}</div>
      <div className={styles.tooltipMeta}>
        {total} game{total !== 1 ? 's' : ''}{slicePct != null ? ` · ${slicePct}%` : ''}
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

function OpeningDonutChart({ openings, color }: { openings: OpeningStats[]; color: 'w' | 'b' }) {
  const [focusedFamily, setFocusedFamily] = useState<string | null>(null)
  const { innerData, outerData } = buildChartData(openings, color)

  if (innerData.length === 0) return <p className={shared.empty}>No games found</p>

  // Assign distinct colours to variants in the zoomed view
  const zoomedVariants = focusedFamily
    ? outerData
        .filter((d) => parseOpeningName(d.fullName).family === focusedFamily)
        .map((d, i) => ({ ...d, color: PALETTE[i % PALETTE.length] }))
    : []

  return (
    <div>
      {focusedFamily ? (
        <>
          <div className={styles.zoomHeader}>
            <button className={styles.zoomBack} onClick={() => setFocusedFamily(null)}>← back</button>
            <span className={styles.zoomTitle}>{focusedFamily}</span>
          </div>
          <div className={styles.chartWrap}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart margin={{ top: 25, right: 75, bottom: 25, left: 75 }}>
                <Pie
                  data={zoomedVariants}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={110}
                  dataKey="value"
                  label={renderZoomedLabel}
                  labelLine={false}
                  stroke="#0b0e0c"
                  strokeWidth={2}
                >
                  {zoomedVariants.map((d, i) => (
                    <Cell key={`${d.fullName}-${i}`} fill={d.color} opacity={0.9} />
                  ))}
                </Pie>
                <Tooltip content={(props) => <CustomTooltip {...(props as any)} />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </>
      ) : (
        <div className={styles.chartWrap}>
          <ResponsiveContainer width="100%" height="100%">
          <PieChart margin={{ top: 30, right: 75, bottom: 30, left: 75 }}>
            <Pie
              data={innerData}
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={82}
              dataKey="value"
              stroke="none"
              onClick={(d) => setFocusedFamily(d.name ?? null)}
              style={{ cursor: 'pointer' }}
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
              label={renderOuterLabel}
              labelLine={false}
              stroke="#0b0e0c"
              strokeWidth={2}
              // Render active shape at same size so there's no hover-expand effect
              activeShape={(props: any) => (
                <Sector
                  {...props}
                  innerRadius={props.innerRadius}
                  outerRadius={props.outerRadius}
                />
              )}
            >
              {outerData.map((d, i) => (
                <Cell key={`${d.fullName}-${i}`} fill={d.color} opacity={0.9} />
              ))}
            </Pie>
            <Tooltip content={(props) => <CustomTooltip {...(props as any)} />} />
          </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

function FrequencyList({
  openings,
  color,
  forceExpanded,
}: {
  openings: OpeningStats[]
  color: 'w' | 'b'
  forceExpanded?: boolean
}) {
  const forColor = openings.filter((s) => s.color === color)
  const colorTotal = forColor.reduce((sum, s) => sum + s.gamesCount, 0)
  const top5 = [...forColor].sort((a, b) => b.gamesCount - a.gamesCount).slice(0, 5)

  if (top5.length === 0) return null

  return (
    <ul className={styles.list}>
      {top5.map((s) => {
        const pct = Math.round((s.gamesCount / Math.max(colorTotal, 1)) * 100)
        return (
          <li key={`${s.eco}:${s.color}`} className={styles.item}>
            <div className={styles.itemHeader}>
              <div className={styles.openingNameWrap}>
                <OpeningNamePreview
                  name={s.name}
                  fen={s.openingFen}
                  color={s.color}
                  className={styles.openingName}
                  forceExpanded={forceExpanded}
                />
              </div>
              <span className={styles.itemMeta}>{s.gamesCount} game{s.gamesCount !== 1 ? 's' : ''} · {pct}%</span>
            </div>
            <div className={styles.barTrack}>
              <div className={styles.barFill} style={{ width: `${pct}%` }} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export function OpeningFrequency({ openingStats, onCopyLink, copyLinkSuccess = false }: OpeningFrequencyProps) {
  const [previewsExpanded, setPreviewsExpanded] = useState(false)

  return (
    <section className={shared.section}>
      <details className={shared.collapsible} open>
        <summary className={shared.summary}>
          <h2 className={shared.heading}>Opening Frequency</h2>
          <div className={shared.summaryActions}>
            <label className={shared.previewToggle} onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={previewsExpanded}
                onChange={(e) => setPreviewsExpanded(e.target.checked)}
              />
              previews
            </label>
            {onCopyLink && (
              <button
                className={shared.copyLinkBtn}
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); onCopyLink() }}
                title="Copy link to this analysis"
                aria-label="Copy link"
              >
                {copyLinkSuccess ? '✓' : '🔗'}
              </button>
            )}
          </div>
          <span className={shared.chevron} aria-hidden="true">▾</span>
        </summary>

        <div className={styles.grid}>
          <div className={styles.column}>
            <h3 className={styles.colorHeading}>As White</h3>
            <OpeningDonutChart openings={openingStats} color="w" />
          </div>
          <div className={styles.column}>
            <FrequencyList openings={openingStats} color="w" forceExpanded={previewsExpanded} />
          </div>
          <div className={styles.column}>
            <h3 className={styles.colorHeading}>As Black</h3>
            <OpeningDonutChart openings={openingStats} color="b" />
          </div>
          <div className={styles.column}>
            <FrequencyList openings={openingStats} color="b" forceExpanded={previewsExpanded} />
          </div>
        </div>
      </details>
    </section>
  )
}
