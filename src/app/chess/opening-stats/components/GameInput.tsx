'use client'

import { useState, useEffect } from 'react'
import { ALL_TIME_CONTROLS, TC_LABELS } from '../lib/fetchGames'
import type { Platform, TimeControlBucket } from '../lib/fetchGames'
import styles from './GameInput.module.css'

const LS_KEY_USERNAME = 'opening-stats-username'
const LS_KEY_PLATFORM = 'opening-stats-platform'
const LS_KEY_GAME_COUNT = 'opening-stats-count'
const LS_KEY_TIME_CONTROLS = 'opening-stats-time-controls'
const LS_KEY_OPPONENT = 'opening-stats-opponent'
const LS_KEY_EXCLUDE_OPPONENT = 'opening-stats-exclude-opponent'
const LS_KEY_FROM_DATE = 'opening-stats-from-date'
const LS_KEY_TO_DATE = 'opening-stats-to-date'
const LS_KEY_SIDE = 'opening-stats-side'

const MIN_GAMES = 10
const MAX_GAMES = 1000
const DEFAULT_GAMES = 25

export type GameInputValues = {
  platform: Platform
  username: string
  gameCount: number
  allowedControls: Set<TimeControlBucket>
  opponent: string
  excludeOpponent: string
  fromDate: string
  toDate: string
  side: 'both' | 'w' | 'b'
}

export type GameInputInitialValues = {
  platform?: Platform
  username?: string
  gameCount?: number
  allowedControls?: Set<TimeControlBucket>
  opponent?: string
}

type GameInputProps = {
  onAnalyze: (values: GameInputValues) => void
  loading: boolean
  locked?: boolean
  onReset?: () => void
  initialValues?: GameInputInitialValues
  onCopyLink?: () => void
  copyLinkSuccess?: boolean
}

export function GameInput({ onAnalyze, loading, locked = false, onReset, initialValues, onCopyLink, copyLinkSuccess = false }: GameInputProps) {
  const isDisabled = loading || locked
  const [platform, setPlatform] = useState<Platform>('lichess')
  const [username, setUsername] = useState('')
  const [gameCount, setGameCount] = useState(DEFAULT_GAMES)
  const [allowedControls, setAllowedControls] = useState<Set<TimeControlBucket>>(
    new Set(ALL_TIME_CONTROLS)
  )
  const [opponent, setOpponent] = useState('')
  const [excludeOpponent, setExcludeOpponent] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [side, setSide] = useState<'both' | 'w' | 'b'>('both')
  const [error, setError] = useState('')

  useEffect(() => {
    // initialValues (from URL) take priority over localStorage
    if (initialValues) {
      if (initialValues.platform) setPlatform(initialValues.platform)
      if (initialValues.username) setUsername(initialValues.username)
      if (initialValues.gameCount) setGameCount(initialValues.gameCount)
      if (initialValues.allowedControls) setAllowedControls(initialValues.allowedControls)
      if (initialValues.opponent) setOpponent(initialValues.opponent)
      return
    }
    try {
      const savedUser = localStorage.getItem(LS_KEY_USERNAME)
      const savedPlatform = localStorage.getItem(LS_KEY_PLATFORM) as Platform | null
      const savedCount = localStorage.getItem(LS_KEY_GAME_COUNT)
      const savedTC = localStorage.getItem(LS_KEY_TIME_CONTROLS)
      const savedOpponent = localStorage.getItem(LS_KEY_OPPONENT)
      const savedExcludeOpponent = localStorage.getItem(LS_KEY_EXCLUDE_OPPONENT)
      const savedFromDate = localStorage.getItem(LS_KEY_FROM_DATE)
      const savedToDate = localStorage.getItem(LS_KEY_TO_DATE)
      const savedSide = localStorage.getItem(LS_KEY_SIDE)

      if (savedUser) setUsername(savedUser)
      if (savedPlatform === 'lichess' || savedPlatform === 'chesscom') setPlatform(savedPlatform)
      if (savedCount) setGameCount(Number(savedCount))
      if (savedTC) {
        const parsed = JSON.parse(savedTC) as string[]
        const valid = parsed.filter((t): t is TimeControlBucket => ALL_TIME_CONTROLS.includes(t as TimeControlBucket))
        if (valid.length > 0) setAllowedControls(new Set<TimeControlBucket>(valid))
      }
      if (savedOpponent) setOpponent(savedOpponent)
      if (savedExcludeOpponent) setExcludeOpponent(savedExcludeOpponent)
      if (savedFromDate) setFromDate(savedFromDate)
      if (savedToDate) setToDate(savedToDate)
      if (savedSide === 'both' || savedSide === 'w' || savedSide === 'b') {
        setSide(savedSide)
      }
    } catch {
      // localStorage unavailable
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY_USERNAME, username)
      localStorage.setItem(LS_KEY_PLATFORM, platform)
      localStorage.setItem(LS_KEY_GAME_COUNT, String(gameCount))
      localStorage.setItem(LS_KEY_TIME_CONTROLS, JSON.stringify(Array.from(allowedControls)))
      localStorage.setItem(LS_KEY_OPPONENT, opponent)
      localStorage.setItem(LS_KEY_EXCLUDE_OPPONENT, excludeOpponent)
      localStorage.setItem(LS_KEY_FROM_DATE, fromDate)
      localStorage.setItem(LS_KEY_TO_DATE, toDate)
      localStorage.setItem(LS_KEY_SIDE, side)
    } catch {
      // localStorage unavailable
    }
  }, [username, platform, gameCount, allowedControls, opponent, excludeOpponent, fromDate, toDate, side])

  function toggleTimeControl(tc: TimeControlBucket) {
    setAllowedControls((prev) => {
      const next = new Set(prev)
      if (next.has(tc)) next.delete(tc)
      else next.add(tc)
      return next
    })
  }

  function handleSubmit() {
    const trimmed = username.trim()
    if (!trimmed) {
      setError('Enter a username')
      return
    }
    if (allowedControls.size === 0) {
      setError('Select at least one time control')
      return
    }
    if (fromDate && toDate && fromDate > toDate) {
      setError('Start date must be before end date')
      return
    }
    setError('')
    onAnalyze({
      platform,
      username: trimmed,
      gameCount,
      allowedControls,
      opponent: opponent.trim(),
      excludeOpponent: excludeOpponent.trim(),
      fromDate,
      toDate,
      side,
    })
  }

  return (
    <div className={styles.container}>
      <div className={styles.platformToggle}>
        <button
          className={`${styles.platformBtn} ${platform === 'lichess' ? styles.platformBtnActive : ''}`}
          onClick={() => setPlatform('lichess')}
          disabled={isDisabled}
        >
          Lichess
        </button>
        <button
          className={`${styles.platformBtn} ${platform === 'chesscom' ? styles.platformBtnActive : ''}`}
          onClick={() => setPlatform('chesscom')}
          disabled={isDisabled}
        >
          Chess.com
        </button>
      </div>

      <div className={styles.inputRow}>
        <input
          className={styles.input}
          type="text"
          placeholder={platform === 'lichess' ? 'Lichess username' : 'Chess.com username'}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          disabled={isDisabled}
        />
        {locked ? (
          <>
            <button
              className={styles.analyzeBtn}
              onClick={onReset}
            >
              ← New Analysis
            </button>
            {onCopyLink && (
              <button
                className={styles.copyLinkBtn}
                onClick={onCopyLink}
                title="Copy link to this analysis"
                aria-label="Copy link"
              >
                {copyLinkSuccess ? '✓' : '🔗'}
              </button>
            )}
          </>
        ) : (
          <button
            className={styles.analyzeBtn}
            onClick={handleSubmit}
            disabled={loading || !username.trim()}
          >
            {loading ? 'Loading…' : 'Analyze'}
          </button>
        )}
      </div>

      <div className={styles.sliderRow}>
        <label className={styles.sliderLabel}>
          <span>Games</span>
          <span className={styles.sliderValue}>{gameCount}</span>
        </label>
        <input
          className={styles.slider}
          type="range"
          min={MIN_GAMES}
          max={MAX_GAMES}
          step={10}
          value={gameCount}
          onChange={(e) => setGameCount(Number(e.target.value))}
          disabled={isDisabled}
        />
        <div className={styles.sliderTicks}>
          <span>{MIN_GAMES}</span>
          <span>{MAX_GAMES}</span>
        </div>
      </div>

      <div className={styles.filterRow}>
        <span className={styles.filterLabel}>Time controls</span>
        <div className={styles.checkboxGroup}>
          {ALL_TIME_CONTROLS.map((tc) => (
            <label key={tc} className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={allowedControls.has(tc)}
                onChange={() => toggleTimeControl(tc)}
                disabled={isDisabled}
                className={styles.checkbox}
              />
              {TC_LABELS[tc]}
            </label>
          ))}
        </div>
      </div>

      <details className={styles.advancedDetails}>
        <summary className={styles.advancedSummary}>Advanced settings</summary>
        <div className={styles.advancedFilters}>
          <div className={styles.filterField}>
            <label className={styles.filterLabel} htmlFor="opponentFilter">Opponent</label>
            <input
              id="opponentFilter"
              className={styles.input}
              type="text"
              placeholder="username, username…"
              value={opponent}
              onChange={(e) => setOpponent(e.target.value)}
              disabled={isDisabled}
            />
          </div>

          <div className={styles.filterField}>
            <label className={styles.filterLabel} htmlFor="sideFilter">Side</label>
            <select
              id="sideFilter"
              className={styles.select}
              value={side}
              onChange={(e) => setSide(e.target.value as 'both' | 'w' | 'b')}
              disabled={isDisabled}
            >
              <option value="both">Both</option>
              <option value="w">White</option>
              <option value="b">Black</option>
            </select>
          </div>

          <div className={styles.filterField}>
            <label className={styles.filterLabel} htmlFor="fromDateFilter">From</label>
            <input
              id="fromDateFilter"
              className={styles.input}
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              disabled={isDisabled}
            />
          </div>

          <div className={styles.filterField}>
            <label className={styles.filterLabel} htmlFor="toDateFilter">To</label>
            <input
              id="toDateFilter"
              className={styles.input}
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              disabled={isDisabled}
            />
          </div>

          <div className={`${styles.filterField} ${styles.filterFieldFull}`}>
            <label className={styles.filterLabel} htmlFor="excludeOpponentFilter">Exclude opponent</label>
            <input
              id="excludeOpponentFilter"
              className={styles.input}
              type="text"
              placeholder="username, username…"
              value={excludeOpponent}
              onChange={(e) => setExcludeOpponent(e.target.value)}
              disabled={isDisabled}
            />
          </div>
        </div>
      </details>

      {error && <p className={styles.error}>{error}</p>}
    </div>
  )
}
