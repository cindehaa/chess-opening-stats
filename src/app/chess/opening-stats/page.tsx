/**
 * Opening Statistics — aggregate opening statistics across multiple games.
 *
 * Fetches games from Lichess or Chess.com using API-level filters (time control,
 * opponent, color, date range) and analyzes each game's moves against the ECO
 * opening book (static, no API calls).
 *
 * Displays:
 *   - Opening frequency as white/black
 *   - Per-opening win rates and W/D/L breakdowns
 *   - Hover previews of opening positions
 *
 * Games are cached per platform:username:timeControlBucket so subsequent analyses
 * that reuse the same time controls don't trigger redundant network requests.
 * Quick filters let you slice the loaded data without re-fetching.
 *
 * Goal: get better at playing by the book.
 */

'use client'

import { useState, useRef, useMemo, useEffect } from 'react'
import { fetchGames, TC_LABELS, type GameSummary, type TimeControlBucket, type Platform, ALL_TIME_CONTROLS } from './lib/fetchGames'
import { analyzeGamesAsync, aggregateStats, type GameAnalysis, type OpeningStats } from './lib/analyzeOpenings'
import { getEvalDisplayColor } from './lib/evalDisplay'
import { evaluateFen } from './lib/stockfishEval'
import { GameInput, type GameInputValues, type GameInputInitialValues } from './components/GameInput'
import { AnalysisProgress } from './components/AnalysisProgress'
import { OpeningFrequency } from './components/OpeningFrequency'
import { OpeningBreakdown } from './components/OpeningBreakdown'
import { GameCarousel } from './components/GameCarousel'
import styles from './page.module.css'

type Phase = 'idle' | 'loading' | 'results' | 'error'

type CacheEntry = { games: GameSummary[]; max: number }

const SHARE_SECTION_BY_KIND = {
  input: 'load-games',
  frequency: 'opening-frequency',
  breakdown: 'opening-breakdown',
  detailed: 'detailed-opening-info',
  carousel: 'games-carousel',
} as const

const EVAL_MAP_COMMIT_INTERVAL = 8

function parseCommaSeparated(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

function getDateRangeMs(from: string, to: string): { fromMs: number; toMs: number } {
  return {
    fromMs: from ? new Date(from + 'T00:00:00').getTime() : 0,
    toMs: to ? new Date(to + 'T23:59:59.999').getTime() : Infinity,
  }
}

function clampRequestedGameCount(rawCount: string | null): number {
  const parsed = Number(rawCount ?? '200')
  const safe = Number.isFinite(parsed) ? parsed : 200
  return Math.max(10, Math.min(1000, safe))
}

export default function TrainOpeningsPage() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const [loadedAnalyses, setLoadedAnalyses] = useState<GameAnalysis[]>([])
  const [loadingMessage, setLoadingMessage] = useState('')
  const [loadingProgress, setLoadingProgress] = useState<number | undefined>(undefined)
  // FEN → centipawns (White's perspective); grows as Stockfish evaluates each unique position
  const [fenEvalMap, setFenEvalMap] = useState<Map<string, number>>(new Map())
  const [evalDone, setEvalDone] = useState(false)
  // Increment to cancel in-flight eval loops from previous analyses
  const evalSessionRef = useRef(0)

  // Quick filters applied to the already-loaded analyses
  const [quickControls, setQuickControls] = useState<Set<TimeControlBucket>>(new Set(ALL_TIME_CONTROLS))
  const [quickSide, setQuickSide] = useState<'both' | 'w' | 'b'>('both')
  const [quickOpponent, setQuickOpponent] = useState('')
  const [quickDateFrom, setQuickDateFrom] = useState('')
  const [quickDateTo, setQuickDateTo] = useState('')
  const [quickExcludeOpponent, setQuickExcludeOpponent] = useState('')

  // Game cache: "platform:username:tcBucket" -> { games, max }
  const gameCache = useRef<Map<string, CacheEntry>>(new Map())

  // Selected opening for the games carousel ("ECO:color" key, e.g. "B12:w")
  const [selectedOpeningKey, setSelectedOpeningKey] = useState<string | null>(null)
  const [selectedOpeningName, setSelectedOpeningName] = useState('')
  const [username, setUsername] = useState('')
  const gamesSectionRef = useRef<HTMLDetailsElement>(null)
  const lastValuesRef = useRef<GameInputValues | null>(null)
  const [copiedShareKey, setCopiedShareKey] = useState<'input' | 'frequency' | 'breakdown' | 'detailed' | 'carousel' | null>(null)
  const copiedShareTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const didAutoAnalyzeFromUrlRef = useRef(false)
  const didAutoOpenFromUrlRef = useRef(false)
  const shouldApplyUrlNavigationRef = useRef(false)

  const urlInitialValues = useMemo<GameInputInitialValues | undefined>(() => {
    if (typeof window === 'undefined') return undefined
    const params = new URLSearchParams(window.location.search)
    const u = params.get('u')
    if (!u) return undefined
    const platform = (params.get('platform') === 'chesscom' ? 'chesscom' : 'lichess') as Platform
    const n = clampRequestedGameCount(params.get('n'))
    const tcRaw = params.get('tc')
    const tcParsed = tcRaw
      ? tcRaw.split(',').filter((t): t is TimeControlBucket => ALL_TIME_CONTROLS.includes(t as TimeControlBucket))
      : ALL_TIME_CONTROLS
    return {
      platform,
      username: u,
      gameCount: n,
      allowedControls: new Set(tcParsed.length > 0 ? tcParsed : ALL_TIME_CONTROLS),
      opponent: params.get('opponent') ?? '',
    }
  }, [])

  const urlInitialOpening = useMemo<string | null>(() => {
    if (typeof window === 'undefined') return null
    return new URLSearchParams(window.location.search).get('opening')
  }, [])

  function buildShareUrl(openingKey?: string, sectionHash?: string | null) {
    const values = lastValuesRef.current
    if (!values) return window.location.href
    const params = new URLSearchParams()
    params.set('u', values.username)
    params.set('platform', values.platform)
    params.set('n', String(values.gameCount))
    params.set('tc', Array.from(values.allowedControls).join(','))
    if (values.opponent) params.set('opponent', values.opponent)
    if (openingKey) params.set('opening', openingKey)
    const hash = sectionHash === undefined ? window.location.hash : (sectionHash ? `#${sectionHash}` : '')
    return `${window.location.origin}${window.location.pathname}?${params.toString()}${hash}`
  }

  async function copyShareLink(kind: 'input' | 'frequency' | 'breakdown' | 'detailed' | 'carousel', includeOpening: boolean) {
    const url = buildShareUrl(includeOpening ? selectedOpeningKey ?? undefined : undefined, SHARE_SECTION_BY_KIND[kind])
    try {
      await navigator.clipboard.writeText(url)
      setCopiedShareKey(kind)
      if (copiedShareTimeoutRef.current) clearTimeout(copiedShareTimeoutRef.current)
      copiedShareTimeoutRef.current = setTimeout(() => setCopiedShareKey(null), 1500)
    } catch {
      // Ignore clipboard failures silently
    }
  }

  useEffect(() => {
    return () => {
      if (copiedShareTimeoutRef.current) clearTimeout(copiedShareTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    if (!urlInitialValues) return
    if (didAutoAnalyzeFromUrlRef.current) return
    if (phase !== 'idle' || loadedAnalyses.length > 0) return
    didAutoAnalyzeFromUrlRef.current = true
    handleAnalyze({
      platform: urlInitialValues.platform ?? 'lichess',
      username: urlInitialValues.username ?? '',
      gameCount: urlInitialValues.gameCount ?? 200,
      allowedControls: urlInitialValues.allowedControls ?? new Set(ALL_TIME_CONTROLS),
      opponent: urlInitialValues.opponent ?? '',
      excludeOpponent: '',
      fromDate: '',
      toDate: '',
      side: 'both',
    }, { fromUrlNavigation: true })
  }, [urlInitialValues, phase, loadedAnalyses.length])

  useEffect(() => {
    if (phase !== 'results' || !selectedOpeningKey) return
    window.history.replaceState(null, '', buildShareUrl(selectedOpeningKey, null))
  }, [phase, selectedOpeningKey])

  useEffect(() => {
    if (phase !== 'results') return
    if (!shouldApplyUrlNavigationRef.current) return
    if (didAutoOpenFromUrlRef.current) return
    const opening = urlInitialOpening
    if (!opening || !opening.includes(':')) return
    const [eco, color] = opening.split(':')
    if (color === 'w' || color === 'b') {
      didAutoOpenFromUrlRef.current = true
      handleSeeGames(eco, color)
    }
  }, [phase, urlInitialOpening])

  useEffect(() => {
    if (phase !== 'results') return
    if (!shouldApplyUrlNavigationRef.current) return
    const hash = window.location.hash.replace(/^#/, '')
    if (!hash) return
    const target = document.getElementById(hash)
    if (!target) return
    if (hash === 'games-carousel' && gamesSectionRef.current) {
      gamesSectionRef.current.open = true
    }
    const timeoutId = window.setTimeout(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
    shouldApplyUrlNavigationRef.current = false
    return () => window.clearTimeout(timeoutId)
  }, [phase, selectedOpeningKey])

  // Derive which TCs are actually present in loaded analyses (for quick filter UI)
  const loadedTCs = useMemo(() => {
    const tcs = new Set<TimeControlBucket>()
    for (const a of loadedAnalyses) tcs.add(a.timeControlBucket)
    return tcs
  }, [loadedAnalyses])

  // Stage 1: filter analyses by quick-filter controls (no eval dependency)
  const quickIncludeNeedles = useMemo(() => parseCommaSeparated(quickOpponent), [quickOpponent])
  const quickExcludeNeedles = useMemo(() => parseCommaSeparated(quickExcludeOpponent), [quickExcludeOpponent])
  const quickDateRange = useMemo(() => getDateRangeMs(quickDateFrom, quickDateTo), [quickDateFrom, quickDateTo])

  const filteredAnalyses = useMemo(() => {
    if (loadedAnalyses.length === 0) return null
    const { fromMs, toMs } = quickDateRange

    return loadedAnalyses.filter((a) => {
      if (!quickControls.has(a.timeControlBucket)) return false
      if (quickSide !== 'both' && a.userColor !== quickSide) return false
      if (fromMs > 0 && a.playedAtMs < fromMs) return false
      if (Number.isFinite(toMs) && a.playedAtMs > toMs) return false
      const opp = a.opponent.toLowerCase()
      if (quickIncludeNeedles.length > 0 && !quickIncludeNeedles.some((n) => opp === n)) return false
      if (quickExcludeNeedles.length > 0 && quickExcludeNeedles.some((n) => opp === n)) return false
      return true
    })
  }, [loadedAnalyses, quickControls, quickSide, quickDateRange, quickIncludeNeedles, quickExcludeNeedles])

  // Stage 2: aggregate stats — only reruns when filtered list or eval map changes
  const filteredResult = useMemo(() => {
    if (!filteredAnalyses) return null
    if (filteredAnalyses.length === 0) return { stats: null, count: 0 }
    return { stats: aggregateStats(filteredAnalyses, fenEvalMap), count: filteredAnalyses.length }
  }, [filteredAnalyses, fenEvalMap])

  // Games for the selected opening (filtered by quick filters automatically)
  const selectedGames = useMemo(() => {
    if (!selectedOpeningKey || !filteredAnalyses) return null
    const [eco, color] = selectedOpeningKey.split(':') as [string, 'w' | 'b']
    return filteredAnalyses.filter((a) => a.opening?.eco === eco && a.userColor === color)
  }, [selectedOpeningKey, filteredAnalyses])

  const openingStatsByKey = useMemo(() => {
    const map = new Map<string, OpeningStats>()
    const openingStats = filteredResult?.stats?.openingStats ?? []
    for (const stats of openingStats) {
      map.set(`${stats.eco}:${stats.color}`, stats)
    }
    return map
  }, [filteredResult])

  const selectedOpeningStats = useMemo(() => {
    if (!selectedOpeningKey) return null
    return openingStatsByKey.get(selectedOpeningKey) ?? null
  }, [selectedOpeningKey, openingStatsByKey])

  // Scroll the games section into view when a new opening is selected
  useEffect(() => {
    if (selectedOpeningKey && gamesSectionRef.current) {
      gamesSectionRef.current.open = true
      const timeoutId = window.setTimeout(() => {
        gamesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }, 50)
      return () => window.clearTimeout(timeoutId)
    }
  }, [selectedOpeningKey])

  async function runEvals(analyses: GameAnalysis[]) {
    const session = ++evalSessionRef.current
    setFenEvalMap(new Map())
    setEvalDone(false)

    // Collect unique FENs that need a real Stockfish eval
    const uniqueFens = Array.from(new Set(analyses.map((a) => a.move10Fen).filter((f): f is string => f !== null)))

    const nextEvalMap = new Map<string, number>()
    let pendingCommits = 0

    for (const fen of uniqueFens) {
      if (evalSessionRef.current !== session) return
      try {
        const cp = await evaluateFen(fen)
        if (evalSessionRef.current !== session) return
        nextEvalMap.set(fen, cp)
        pendingCommits++
        if (pendingCommits >= EVAL_MAP_COMMIT_INTERVAL) {
          setFenEvalMap(new Map(nextEvalMap))
          pendingCommits = 0
        }
      } catch {
        // skip positions that fail to evaluate
      }
    }

    if (evalSessionRef.current === session) {
      if (pendingCommits > 0 || uniqueFens.length === 0) {
        setFenEvalMap(new Map(nextEvalMap))
      }
      setEvalDone(true)
    }
  }

  async function handleAnalyze(values: GameInputValues, options?: { fromUrlNavigation?: boolean }) {
    const { platform, username, gameCount, allowedControls, opponent, excludeOpponent, fromDate, toDate, side } = values

    const includeNeedles = parseCommaSeparated(opponent)
    const excludeNeedles = parseCommaSeparated(excludeOpponent)
    // For Lichess API optimization: only pass vs= for a single opponent
    const apiOpponent = includeNeedles.length === 1 ? includeNeedles[0] : ''

    setUsername(username)
    setSelectedOpeningKey(null)
    setSelectedOpeningName('')
    shouldApplyUrlNavigationRef.current = options?.fromUrlNavigation === true
    if (!shouldApplyUrlNavigationRef.current) {
      didAutoOpenFromUrlRef.current = true
    }
    lastValuesRef.current = values
    setPhase('loading')
    setError('')
    setLoadedAnalyses([])
    setLoadingMessage('Fetching games…')
    setLoadingProgress(0)

    const tcList = Array.from(allowedControls)
    const criteria = { opponent: apiOpponent, side, fromDate, toDate }
    // Cache key must include API-level criteria; otherwise a filtered fetch can poison later broader fetches.
    const cacheKey = [
      platform,
      username.toLowerCase(),
      [...tcList].sort().join(','),
      criteria.opponent || '',
      criteria.side || 'both',
      criteria.fromDate || '',
      criteria.toDate || '',
    ].join(':')

    try {
      let rawGames: GameSummary[]
      const cached = gameCache.current.get(cacheKey)

      if (cached && cached.max >= gameCount) {
        rawGames = cached.games.slice(0, gameCount)
      } else {
        const tcLabel = tcList.length === 1 ? (TC_LABELS[tcList[0]] ?? tcList[0]) : 'games'
        setLoadingMessage(`Fetching ${tcLabel}…`)
        rawGames = await fetchGames(platform, username, tcList, gameCount, criteria, (fetched, target) => {
          setLoadingProgress(Math.min(fetched / target, 0.95) * 50)
        })
        gameCache.current.set(cacheKey, { games: rawGames, max: gameCount })
      }

      // Apply client-side opponent include/exclude filtering, then cap at requested gameCount
      const filtered = (includeNeedles.length > 0 || excludeNeedles.length > 0)
        ? rawGames.filter((g) => {
            const opp = (g.userColor === 'w' ? g.black : g.white).toLowerCase()
            if (includeNeedles.length > 0 && !includeNeedles.some((n) => opp === n)) return false
            if (excludeNeedles.length > 0 && excludeNeedles.some((n) => opp === n)) return false
            return true
          })
        : rawGames
      const allGames = filtered.slice(0, gameCount)

      if (allGames.length === 0) {
        setError('No games found matching your criteria.')
        setPhase('error')
        return
      }

      setLoadingMessage('Analyzing openings…')
      setLoadingProgress(50)
      const analyses = await analyzeGamesAsync(allGames, (done, total) => {
        setLoadingProgress(50 + (done / total) * 50)
      })
      if (analyses.length === 0) {
        setError('No valid standard games could be analyzed (variant or invalid PGN).')
        setPhase('error')
        return
      }

      setLoadedAnalyses(analyses)
      // Initialize quick filters to match what was loaded
      setQuickControls(new Set(allowedControls))
      setQuickSide('both')
      setQuickOpponent('')
      setQuickDateFrom('')
      setQuickDateTo('')
      setQuickExcludeOpponent('')
      setPhase('results')
      // Only preserve URL-driven opening deep-link for the initial auto-analyze flow.
      const openingToKeep = shouldApplyUrlNavigationRef.current && !didAutoOpenFromUrlRef.current
        ? (urlInitialOpening ?? undefined)
        : undefined
      window.history.replaceState(null, '', buildShareUrl(openingToKeep, null))
      // Kick off Stockfish evals in the background (does not block the UI)
      runEvals(analyses)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to fetch games. Check the username and try again.'
      )
      setPhase('error')
    }
  }

  function handleSeeGames(eco: string, color: 'w' | 'b') {
    const key = `${eco}:${color}`
    const opening = openingStatsByKey.get(key)
    setSelectedOpeningName(opening?.name ?? eco)
    setSelectedOpeningKey(key)
    window.history.replaceState(null, '', buildShareUrl(key, 'games-carousel'))
  }

  function handleReset() {
    evalSessionRef.current++ // cancel any in-flight eval loop
    setPhase('idle')
    setLoadedAnalyses([])
    setError('')
    setLoadingMessage('')
    setLoadingProgress(undefined)
    setFenEvalMap(new Map())
    setEvalDone(false)
    setSelectedOpeningKey(null)
    didAutoOpenFromUrlRef.current = false
    window.history.replaceState(null, '', window.location.pathname)
  }

  function toggleQuickTC(tc: TimeControlBucket) {
    setQuickControls((prev) => {
      const next = new Set(prev)
      if (next.has(tc)) next.delete(tc)
      else next.add(tc)
      return next
    })
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Opening Statistics</h1>
        <p className={styles.subtitle}>
          "is this theory?"
        </p>
      </header>

      <section id="load-games" className={styles.inputSection}>
        <GameInput
          onAnalyze={handleAnalyze}
          loading={phase === 'loading'}
          locked={phase === 'results'}
          onReset={handleReset}
          initialValues={urlInitialValues}
          onCopyLink={() => copyShareLink('input', false)}
          copyLinkSuccess={copiedShareKey === 'input'}
        />
      </section>

      {phase === 'loading' && (
        <section className={styles.loadingSection}>
          <AnalysisProgress label={loadingMessage} progress={loadingProgress} />
        </section>
      )}

      {phase === 'error' && (
        <section className={styles.errorSection}>
          <p className={styles.errorMsg}>{error}</p>
          <button className={styles.resetBtn} onClick={handleReset}>
            Try again
          </button>
        </section>
      )}

      {phase === 'results' && filteredResult && (
        <>
          <div className={styles.summaryBar}>
            <span className={styles.summaryItem}>
              <span className={styles.summaryValue}>{filteredResult.count}</span>
              {loadedAnalyses.length > filteredResult.count ? ` of ${loadedAnalyses.length}` : ''} games analyzed
            </span>
            {filteredResult.stats && filteredResult.stats.openingStats.length > 0 && (
              <span className={styles.summaryItem}>
                <span className={styles.summaryValue}>{filteredResult.stats.openingStats.length}</span> distinct openings
              </span>
            )}
          </div>

          {/* Quick filters — collapsible */}
          <details className={styles.quickFilterSection}>
            <summary className={styles.quickFilterSummary}>Quick Filters</summary>
            <div className={styles.quickFilterContent}>
              <div className={styles.quickFilterRow}>
                {loadedTCs.size > 0 && (
                  <>
                    <span className={styles.quickFilterLabel}>Time:</span>
                    {ALL_TIME_CONTROLS.filter((tc) => loadedTCs.has(tc)).map((tc) => (
                      <label key={tc} className={`${styles.quickFilterChip} ${loadedTCs.size === 1 ? styles.quickFilterChipSingle : ''}`}>
                        <input
                          type="checkbox"
                          checked={quickControls.has(tc)}
                          onChange={() => toggleQuickTC(tc)}
                          className={styles.quickFilterCheckbox}
                          disabled={loadedTCs.size === 1}
                        />
                        {TC_LABELS[tc]}
                      </label>
                    ))}
                    <span className={styles.quickFilterDivider} />
                  </>
                )}
                <span className={styles.quickFilterLabel}>Side:</span>
                {(['both', 'w', 'b'] as const).map((s) => (
                  <button
                    key={s}
                    className={`${styles.quickFilterBtn} ${quickSide === s ? styles.quickFilterBtnActive : ''}`}
                    onClick={() => setQuickSide(s)}
                  >
                    {s === 'both' ? 'Both' : s === 'w' ? 'White' : 'Black'}
                  </button>
                ))}
              </div>
              <div className={styles.quickFilterRow}>
                <span className={styles.quickFilterLabel}>Include:</span>
                <input
                  type="text"
                  value={quickOpponent}
                  onChange={(e) => setQuickOpponent(e.target.value)}
                  placeholder="username, username…"
                  className={styles.quickFilterInput}
                />
                <span className={styles.quickFilterDivider} />
                <span className={styles.quickFilterLabel}>From:</span>
                <input
                  type="date"
                  value={quickDateFrom}
                  onChange={(e) => setQuickDateFrom(e.target.value)}
                  className={styles.quickFilterDateInput}
                />
                <span className={styles.quickFilterLabel}>To:</span>
                <input
                  type="date"
                  value={quickDateTo}
                  onChange={(e) => setQuickDateTo(e.target.value)}
                  className={styles.quickFilterDateInput}
                />
              </div>
              <details className={styles.quickFilterAdvanced}>
                <summary className={styles.quickFilterAdvancedSummary}>Advanced</summary>
                <div className={styles.quickFilterAdvancedContent}>
                  <span className={styles.quickFilterLabel}>Exclude:</span>
                  <input
                    type="text"
                    value={quickExcludeOpponent}
                    onChange={(e) => setQuickExcludeOpponent(e.target.value)}
                    placeholder="username, username…"
                    className={styles.quickFilterInput}
                  />
                </div>
              </details>
            </div>
          </details>

          {filteredResult.stats ? (
            <div className={styles.dashboard}>
              <div className={styles.divider} />
              <div id="opening-frequency">
                <OpeningFrequency
                  openingStats={filteredResult.stats.openingStats}
                  totalGames={filteredResult.stats.totalGames}
                  onCopyLink={() => copyShareLink('frequency', false)}
                  copyLinkSuccess={copiedShareKey === 'frequency'}
                />
              </div>
              <div id="opening-breakdown">
                <OpeningBreakdown
                  stats={filteredResult.stats}
                  evalDone={evalDone}
                  onSeeGames={handleSeeGames}
                  activeKey={selectedOpeningKey ?? undefined}
                  onCopyLink={(target) => copyShareLink(target, false)}
                  copyLinkSuccess={copiedShareKey === 'breakdown' ? 'breakdown' : copiedShareKey === 'detailed' ? 'detailed' : null}
                />
              </div>
              {selectedOpeningKey && selectedGames !== null && (
                <details
                  id="games-carousel"
                  key={selectedOpeningKey}
                  ref={gamesSectionRef}
                  className={styles.gamesSection}
                >
                  <summary className={styles.gamesSectionSummary}>
                    <span className={styles.gamesSectionTitle}>
                      <span className={styles.gamesSectionTitleRow}>
                        {selectedOpeningName} Games <br></br>
                      </span>
                      {selectedOpeningStats && (
                        <span className={styles.gamesSectionMeta}>
                          <span>{selectedOpeningStats.color === 'w' ? 'White' : 'Black'}</span>
                          <span className={styles.gamesSectionMetaSep}>·</span>
                          <span>{selectedOpeningStats.gamesCount} {selectedOpeningStats.gamesCount === 1 ? 'game' : 'games'}</span>
                          <span className={styles.gamesSectionMetaSep}>·</span>
                          <span>
                            <span className={styles.wdlW}>{selectedOpeningStats.wins}W</span>{' '}
                            <span className={styles.wdlD}>{selectedOpeningStats.draws}D</span>{' '}
                            <span className={styles.wdlL}>{selectedOpeningStats.losses}L</span>
                          </span>
                          <span className={styles.gamesSectionMetaSep}>·</span>
                          <span>
                            {selectedOpeningStats.gamesCount === 0
                              ? '0%'
                              : `${Math.round((selectedOpeningStats.wins / selectedOpeningStats.gamesCount) * 100)}%`} win
                          </span>
                          {selectedOpeningStats.medianEvalCp !== null && (
                            <>
                              <span className={styles.gamesSectionMetaSep}>·</span>
                              <span style={{ color: getEvalDisplayColor(selectedOpeningStats.medianEvalCp, selectedOpeningStats.color) }}>
                                {(selectedOpeningStats.medianEvalCp / 100) >= 0 ? '+' : ''}
                                {(selectedOpeningStats.medianEvalCp / 100).toFixed(2)} @10
                              </span>
                            </>
                          )}
                        </span>
                      )}
                    </span>
                    <span className={styles.gamesSectionActions}>
                      <button
                        className={styles.copyLinkBtn}
                        onClick={(e) => {
                          e.preventDefault()
                          copyShareLink('carousel', true)
                        }}
                        title="Copy link to this view"
                        aria-label="Copy link"
                      >
                        {copiedShareKey === 'carousel' ? '✓' : '🔗'}
                      </button>
                      <span className={styles.gamesSectionChevron} aria-hidden="true">▾</span>
                    </span>
                  </summary>
                  <GameCarousel
                    openingName={selectedOpeningName}
                    analyses={selectedGames}
                    username={username}
                    fenEvalMap={fenEvalMap}
                  />
                </details>
              )}
            </div>
          ) : (
            <p className={styles.errorMsg}>No games match the current filters.</p>
          )}
        </>
      )}
    </main>
  )
}
