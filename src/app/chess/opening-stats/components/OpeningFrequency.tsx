'use client'

import { useState } from 'react'
import type { OpeningStats } from '../lib/analyzeOpenings'
import { OpeningNamePreview } from './OpeningNamePreview'
import styles from './OpeningFrequency.module.css'

type OpeningFrequencyProps = {
  openingStats: OpeningStats[]
  totalGames: number
  onCopyLink?: () => void
  copyLinkSuccess?: boolean
}

function FrequencyList({
  openings,
  color,
  totalGames,
  forceExpanded,
}: {
  openings: OpeningStats[]
  color: 'w' | 'b'
  totalGames: number
  forceExpanded?: boolean
}) {
  const allForColor = openings.filter((s) => s.color === color)
  const colorTotal = allForColor.reduce((sum, s) => sum + s.gamesCount, 0)
  const filtered = allForColor.slice(0, 6)

  if (filtered.length === 0) {
    return <p className={styles.empty}>No games found</p>
  }

  return (
    <ul className={styles.list}>
      {filtered.map((s) => {
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
              <span className={styles.itemMeta}>
                {s.gamesCount} games · {pct}%
              </span>
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

export function OpeningFrequency({ openingStats, totalGames, onCopyLink, copyLinkSuccess = false }: OpeningFrequencyProps) {
  const [previewsExpanded, setPreviewsExpanded] = useState(false)

  return (
    <section className={styles.section}>
      <details className={styles.collapsible} open>
        <summary className={styles.summary}>
          <h2 className={styles.heading}>Opening Frequency</h2>
          <div className={styles.summaryActions}>
            <label
              className={styles.previewToggle}
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="checkbox"
                checked={previewsExpanded}
                onChange={(e) => setPreviewsExpanded(e.target.checked)}
              />
              previews
            </label>
            {onCopyLink && (
              <button
                className={styles.copyLinkBtn}
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); onCopyLink() }}
                title="Copy link to this analysis"
                aria-label="Copy link"
              >
                {copyLinkSuccess ? '✓' : '🔗'}
              </button>
            )}
          </div>
          <span className={styles.chevron} aria-hidden="true">▾</span>
        </summary>

        <div className={styles.columns}>
          <div className={styles.column}>
            <h3 className={styles.colorHeading}>As White</h3>
            <div className={styles.columnScroll}>
              <FrequencyList openings={openingStats} color="w" totalGames={totalGames} forceExpanded={previewsExpanded} />
            </div>
          </div>
          <div className={styles.column}>
            <h3 className={styles.colorHeading}>As Black</h3>
            <div className={styles.columnScroll}>
              <FrequencyList openings={openingStats} color="b" totalGames={totalGames} forceExpanded={previewsExpanded} />
            </div>
          </div>
        </div>
      </details>
    </section>
  )
}
