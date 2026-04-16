'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AggregateStats, OpeningStats } from '../lib/analyzeOpenings'
import { getEvalDisplayColor } from '../lib/evalDisplay'
import { OpeningNamePreview } from './OpeningNamePreview'
import styles from './OpeningBreakdown.module.css'
import shared from './collapsible.module.css'

type SortKey = 'name' | 'side' | 'games' | 'winRate' | 'medianEval'
type SortDir = 'asc' | 'desc'
const ROWS_PER_PAGE = 20

function winRatePct(s: OpeningStats) {
  return s.gamesCount === 0 ? 0 : Math.round((s.wins / s.gamesCount) * 100)
}

// --------------- Filter expression parser ---------------
// Grammar:
//   expr   = and ( '||' and )*
//   and    = primary ( ('&' | '&&' | WS) primary )*
//   primary = '(' expr ')' | TERM

type Token =
  | { type: 'term'; value: string }
  | { type: 'and' }
  | { type: 'or' }
  | { type: 'lparen' }
  | { type: 'rparen' }

function tokenize(input: string): Token[] {
  const raw: Token[] = []
  let i = 0
  while (i < input.length) {
    if (/\s/.test(input[i])) { i++; continue }
    if (input[i] === '|' && input[i + 1] === '|') { raw.push({ type: 'or' }); i += 2; continue }
    if (input[i] === '&' && input[i + 1] === '&') { raw.push({ type: 'and' }); i += 2; continue }
    if (input[i] === '&') { i++; continue } // lone & is ignored (adjacent terms get implicit AND)
    if (input[i] === '(') { raw.push({ type: 'lparen' }); i++; continue }
    if (input[i] === ')') { raw.push({ type: 'rparen' }); i++; continue }
    let j = i
    while (j < input.length && !/[\s|()]/.test(input[j]) && !(input[j] === '&' && input[j + 1] === '&')) j++
    if (j > i) { raw.push({ type: 'term', value: input.slice(i, j) }); i = j; continue }
    i++
  }
  // Insert implicit AND between adjacent terms/groups
  const tokens: Token[] = []
  for (let k = 0; k < raw.length; k++) {
    tokens.push(raw[k])
    if (k + 1 < raw.length) {
      const cur = raw[k].type
      const nxt = raw[k + 1].type
      const curEnds = cur === 'term' || cur === 'rparen'
      const nxtStarts = nxt === 'term' || nxt === 'lparen'
      if (curEnds && nxtStarts) tokens.push({ type: 'and' })
    }
  }
  return tokens
}

function matchAtom(term: string, s: OpeningStats): boolean {
  const tl = term.toLowerCase()
  const winGt = tl.match(/^win%?>([\d.]+)$/)
  if (winGt) return winRatePct(s) > parseFloat(winGt[1])
  const winLt = tl.match(/^win%?<([\d.]+)$/)
  if (winLt) return winRatePct(s) < parseFloat(winLt[1])
  const evalGt = tl.match(/^eval?>([+-]?[\d.]+)$/)
  if (evalGt) return s.medianEvalCp !== null && s.medianEvalCp / 100 > parseFloat(evalGt[1])
  const evalLt = tl.match(/^eval?<([+-]?[\d.]+)$/)
  if (evalLt) return s.medianEvalCp !== null && s.medianEvalCp / 100 < parseFloat(evalLt[1])
  const gamesGt = tl.match(/^games?>([\d]+)$/)
  if (gamesGt) return s.gamesCount > parseInt(gamesGt[1], 10)
  const gamesLt = tl.match(/^games?<([\d]+)$/)
  if (gamesLt) return s.gamesCount < parseInt(gamesLt[1], 10)
  const gamesEq = tl.match(/^games?=([\d]+)$/)
  if (gamesEq) return s.gamesCount === parseInt(gamesEq[1], 10)
  const sideEq = tl.match(/^side=([wb])$/)
  if (sideEq) return s.color === sideEq[1]
  return s.name.toLowerCase().includes(tl) || s.eco.toLowerCase().startsWith(tl)
}

function parseExpr(tokens: Token[], pos: { i: number }, s: OpeningStats): boolean {
  let left = parseAnd(tokens, pos, s)
  while (pos.i < tokens.length && tokens[pos.i].type === 'or') {
    pos.i++
    const right = parseAnd(tokens, pos, s)
    left = left || right
  }
  return left
}

function parseAnd(tokens: Token[], pos: { i: number }, s: OpeningStats): boolean {
  let left = parsePrimary(tokens, pos, s)
  while (pos.i < tokens.length && tokens[pos.i].type === 'and') {
    pos.i++
    const right = parsePrimary(tokens, pos, s)
    left = left && right
  }
  return left
}

function parsePrimary(tokens: Token[], pos: { i: number }, s: OpeningStats): boolean {
  if (pos.i >= tokens.length) return true
  const t = tokens[pos.i]
  if (t.type === 'lparen') {
    pos.i++
    const result = parseExpr(tokens, pos, s)
    if (pos.i < tokens.length && tokens[pos.i].type === 'rparen') pos.i++
    return result
  }
  if (t.type === 'term') { pos.i++; return matchAtom(t.value, s) }
  // skip unexpected tokens (e.g. stray ')') to avoid infinite loops
  pos.i++
  return true
}

function buildFilterPredicate(filter: string): (s: OpeningStats) => boolean {
  const trimmed = filter.trim()
  if (!trimmed) {
    return () => true
  }
  try {
    const tokens = tokenize(trimmed)
    return (stats: OpeningStats) => parseExpr(tokens, { i: 0 }, stats)
  } catch {
    // On parse error, keep results visible instead of returning an empty table.
    return () => true
  }
}

function formatEval(cp: number | null, done: boolean): string {
  if (cp === null) return done ? '—' : '…'
  const pawns = cp / 100
  return (pawns >= 0 ? '+' : '') + pawns.toFixed(2)
}

type SortHeaderProps = {
  label: ReactNode
  col: SortKey
  sortKey: SortKey
  sortDir: SortDir
  onSort: (col: SortKey) => void
  thClass: string
  thActiveClass: string
  tooltip?: string
}

function SortHeader({ label, col, sortKey, sortDir, onSort, thClass, thActiveClass, tooltip }: SortHeaderProps) {
  const active = sortKey === col
  return (
    <th
      className={`${thClass} ${active ? thActiveClass : ''}${tooltip ? ' ' + styles.tooltipAnchor : ''}`}
      onClick={() => onSort(col)}
      style={{ cursor: 'pointer', userSelect: 'none' }}
      title={tooltip}
    >
      {label}
      <span className={styles.sortIndicator}>
        {active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ·'}
      </span>
    </th>
  )
}

function getWinRateColor(winRate: number): string {
  if (winRate >= 50) return 'var(--color-win)'
  if (winRate >= 35) return '#f59e0b'
  return 'var(--color-loss)'
}

type OpeningBreakdownProps = {
  stats: AggregateStats
  openingFilter?: string
  evalDone?: boolean
  onSeeGames?: (eco: string, color: 'w' | 'b') => void
  activeKey?: string
  onCopyLink?: (target: 'breakdown' | 'detailed') => void
  copyLinkSuccess?: 'breakdown' | 'detailed' | null
}

export function OpeningBreakdown({ stats, openingFilter = '', evalDone = false, onSeeGames, activeKey, onCopyLink, copyLinkSuccess = null }: OpeningBreakdownProps) {
  const [sortKey, setSortKey] = useState<SortKey>('games')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [filter, setFilter] = useState(openingFilter)
  const [currentPage, setCurrentPage] = useState(1)
  const [highlightPreviewsExpanded, setHighlightPreviewsExpanded] = useState(false)
  const [tablePreviewsExpanded, setTablePreviewsExpanded] = useState(false)

  // Keep local filter in sync when parent resets (but let user type locally)
  const q = filter.trim()

  const { openingStats, strongestOpenings, weakestOpenings } = stats

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'name' || key === 'side' ? 'asc' : 'desc')
    }
  }

  function sortValue(s: OpeningStats): number | string {
    switch (sortKey) {
      case 'name': return s.name
      case 'side': return s.color
      case 'games': return s.gamesCount
      case 'winRate': return winRatePct(s)
      case 'medianEval': return s.medianEvalCp ?? -Infinity
    }
  }

  const filterPredicate = useMemo(() => buildFilterPredicate(q), [q])

  const filtered = useMemo(() => {
    if (!q) return openingStats
    return openingStats.filter(filterPredicate)
  }, [q, openingStats, filterPredicate])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = sortValue(a)
      const bv = sortValue(b)
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number)
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [filtered, sortDir, sortKey])

  const totalPages = useMemo(() => Math.max(1, Math.ceil(sorted.length / ROWS_PER_PAGE)), [sorted.length])

  const pageRows = useMemo(() => {
    const startIdx = (currentPage - 1) * ROWS_PER_PAGE
    return sorted.slice(startIdx, startIdx + ROWS_PER_PAGE)
  }, [currentPage, sorted])

  useEffect(() => {
    setCurrentPage(1)
  }, [q, sortKey, sortDir])

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  if (openingStats.length === 0) {
    return (
      <section className={shared.section}>
        <details className={shared.collapsible} open>
          <summary className={shared.summary}>
            <h2 className={shared.heading}>Per-Opening Breakdown</h2>
            <span className={shared.chevron} aria-hidden="true">▾</span>
          </summary>
          <p className={shared.empty}>No openings detected in these games.</p>
        </details>
      </section>
    )
  }

  return (
    <section className={shared.section}>
      <details className={shared.collapsible} open>
        <summary className={shared.summary}>
          <h2 className={shared.heading}>Per-Opening Breakdown</h2>
          <div className={shared.summaryActions}>
            <label
              className={shared.previewToggle}
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="checkbox"
                checked={highlightPreviewsExpanded}
                onChange={(e) => setHighlightPreviewsExpanded(e.target.checked)}
              />
              previews
            </label>
            {onCopyLink && (
              <button
                className={shared.copyLinkBtn}
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); onCopyLink('breakdown') }}
                title="Copy link to this analysis"
                aria-label="Copy link"
              >
                {copyLinkSuccess === 'breakdown' ? '✓' : '🔗'}
              </button>
            )}
          </div>
          <span className={shared.chevron} aria-hidden="true">▾</span>
        </summary>

        <div className={styles.highlightColumns}>
          <div className={styles.highlightColumn}>
            <p className={styles.highlightGroupLabel}>You cooked</p>
            <div className={styles.highlightScroll}>
              {strongestOpenings.length === 0 ? (
                <p className={shared.empty}>Not enough data available.</p>
              ) : (
                <div className={styles.highlights}>
                  {strongestOpenings.map((s) => (
                    <div key={`${s.eco}:${s.color}`} className={styles.highlightRow}>
                      <OpeningNamePreview
                        name={s.name}
                        fen={s.openingFen}
                        color={s.color}
                        className={styles.highlightName}
                        forceExpanded={highlightPreviewsExpanded}
                      />
                      <span className={styles.highlightDetail}>
                        {s.gamesCount} {s.gamesCount === 1 ? 'game' : 'games'} as {s.color === 'w' ? 'white' : 'black'}
                        {' · '}
                        <span style={{ color: winRatePct(s) >= 50 ? 'var(--color-win)' : 'var(--color-loss)' }}>
                          {winRatePct(s)}% win
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className={styles.highlightColumn}>
            <p className={styles.highlightGroupLabel}>You got cooked</p>
            <div className={styles.highlightScroll}>
              {weakestOpenings.length === 0 ? (
                <p className={shared.empty}>Not enough data available.</p>
              ) : (
                <div className={styles.highlights}>
                  {weakestOpenings.map((s) => (
                    <div key={`${s.eco}:${s.color}`} className={styles.highlightRow}>
                      <OpeningNamePreview
                        name={s.name}
                        fen={s.openingFen}
                        color={s.color}
                        className={styles.highlightName}
                        forceExpanded={highlightPreviewsExpanded}
                      />
                      <span className={styles.highlightDetail}>
                        {s.gamesCount} {s.gamesCount === 1 ? 'game' : 'games'} as {s.color === 'w' ? 'white' : 'black'}
                        {' · '}
                        <span style={{ color: winRatePct(s) >= 50 ? 'var(--color-win)' : 'var(--color-loss)' }}>
                          {winRatePct(s)}% win
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </details>

      <details id="detailed-opening-info" className={shared.collapsible} open>
        <summary className={shared.summary}>
          <h2 className={shared.heading}>Detailed Opening Information</h2>
          <div className={shared.summaryActions}>
            <label
              className={shared.previewToggle}
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="checkbox"
                checked={tablePreviewsExpanded}
                onChange={(e) => setTablePreviewsExpanded(e.target.checked)}
              />
              previews
            </label>
            {onCopyLink && (
              <button
                className={shared.copyLinkBtn}
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); onCopyLink('detailed') }}
                title="Copy link to this analysis"
                aria-label="Copy link"
              >
                {copyLinkSuccess === 'detailed' ? '✓' : '🔗'}
              </button>
            )}
          </div>
          <span className={shared.chevron} aria-hidden="true">▾</span>
        </summary>

        <div className={styles.filterBar}>
          <input
            className={styles.filterInput}
            type="search"
            placeholder="e.g. (italian || B06) && win%>55 && games>5 && side=w"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        {filtered.length === 0 && q && (
          <p className={shared.empty}>No openings matching "{filter}".</p>
        )}

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <SortHeader label="Opening" col="name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} thClass={styles.th} thActiveClass={styles.thActive} />
                <SortHeader label="Side" col="side" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} thClass={styles.th} thActiveClass={styles.thActive} />
                <SortHeader label="Games" col="games" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} thClass={styles.th} thActiveClass={styles.thActive} />
                <th className={styles.th}>W / D / L</th>
                <SortHeader label="Win%" col="winRate" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} thClass={styles.th} thActiveClass={styles.thActive} />
                <SortHeader
                  label="Eval @10"
                  col="medianEval"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                  thClass={styles.th}
                  thActiveClass={styles.thActive}
                  tooltip="Median Stockfish (depth 10) evaluation at the end of move 10"
                />
                <th className={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((s) => {
                const winRate = winRatePct(s)
                return (
                  <tr
                    key={`${s.eco}:${s.color}`}
                    className={`${styles.row} ${activeKey === `${s.eco}:${s.color}` ? styles.rowActive : ''}`}
                  >
                  <td className={styles.tdName}>
                    <div className={styles.nameCell}>
                      <span className={styles.eco}>{s.eco}</span>
                      <OpeningNamePreview
                        name={s.name}
                        fen={s.openingFen}
                        color={s.color}
                        className={styles.openingName}
                        forceExpanded={tablePreviewsExpanded}
                      />
                    </div>
                  </td>
                  <td className={styles.td}>
                    {s.color === 'w' ? '♔' : '♚'}
                  </td>
                  <td className={styles.td}>{s.gamesCount}</td>
                  <td className={styles.tdWdl}>
                    <span className={styles.wdlGroup}>
                      <span className={styles.win}>{s.wins}</span>
                      <span className={styles.sep}>/</span>
                      <span className={styles.draw}>{s.draws}</span>
                      <span className={styles.sep}>/</span>
                      <span className={styles.loss}>{s.losses}</span>
                    </span>
                  </td>
                  <td className={styles.td}>
                    <span style={{ color: getWinRateColor(winRate) }}>
                      {winRate}%
                    </span>
                  </td>
                  <td className={styles.tdEval}>
                    {s.medianEvalCp === null ? (
                      <span className={styles.evalPending}>{evalDone ? '—' : '…'}</span>
                    ) : (
                      <span style={{ color: getEvalDisplayColor(s.medianEvalCp, s.color) }}>
                        {formatEval(s.medianEvalCp, evalDone)}
                      </span>
                    )}
                  </td>
                  <td className={styles.td}>
                    <button
                      className={`${styles.gamesBtn} ${activeKey === `${s.eco}:${s.color}` ? styles.gamesBtnActive : ''}`}
                      onClick={() => onSeeGames?.(s.eco, s.color)}
                      title={`View games for ${s.name}`}
                    >
                      See Games
                    </button>
                  </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {sorted.length > ROWS_PER_PAGE && (
          <div className={styles.pagination}>
            <button
              className={styles.pageBtn}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              Prev
            </button>
            <span className={styles.pageInfo}>
              Page {currentPage} / {totalPages}
            </span>
            <button
              className={styles.pageBtn}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              Next
            </button>
          </div>
        )}
      </details>
    </section>
  )
}
