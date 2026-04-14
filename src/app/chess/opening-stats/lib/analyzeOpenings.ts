/**
 * Opening analysis: identify ECO openings and aggregate repertoire stats.
 *
 * Uses the chess-openings package (static data, no API calls) for instant results.
 */

import { Chess } from 'chess.js'
import type { GameSummary, TimeControlBucket } from './fetchGames'

// Import the raw ECO data directly to avoid the Polyglot sub-module
// which pulls in node:fs/promises (incompatible with browser/webpack).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { eco: ecoData } = require('chess-openings/dist/chess/openings/eco') as {
  eco: Record<string, { eco: string; name: string; moves: string[] }>
}

const MAX_PLY = 20 // analyze up to 20 half-moves (10 full moves)

function fen2epd(fen: string): string {
  return fen.split(/\s+/).slice(0, 4).join(' ')
}

function lookupEco(fen: string) {
  const epd = fen2epd(fen)
  if (ecoData[epd]) return ecoData[epd]
  // chess.js always records the en passant square after a double pawn push
  // (e.g. "...KQkq e3"), but the ECO data stores "-" unless the ep capture
  // is actually available. Fall back to the normalized form.
  const normalized = epd.replace(/ [a-h][36]$/, ' -')
  return normalized !== epd ? ecoData[normalized] : undefined
}

// --------------- Types ---------------

export type GameAnalysis = {
  gameId: string
  platform: 'lichess' | 'chesscom'
  timeControlBucket: TimeControlBucket
  userColor: 'w' | 'b'
  result: 'white' | 'black' | 'draw'
  opening: { eco: string; name: string } | null
  openingFen: string | null
  totalBookMoves: number
  opponent: string
  playedAtMs: number
  date: string
  pgn: string
  userRating: number | null
  opponentRating: number | null
  /** Original game URL (Chess.com href or undefined for Lichess — derive from gameId). */
  sourceUrl?: string
  /** FEN after exactly 10 full moves; null if the game ended before move 10. */
  move10Fen: string | null
  /**
   * Centipawn proxy (from White's perspective) used when the game ended
   * before move 10: +500 for white win, -500 for black win, 0 for draw.
   * null when move10Fen is available (real eval should be used instead).
   */
  move10ProxyCp: number | null
}

export type OpeningStats = {
  eco: string
  name: string
  openingFen: string | null
  color: 'w' | 'b'
  gamesCount: number
  wins: number
  draws: number
  losses: number
  /**
   * Median centipawn eval at move 10 across all games for this opening,
   * from White's perspective. null when no eval data is available yet.
   */
  medianEvalCp: number | null
}

export type AggregateStats = {
  totalGames: number
  openingStats: OpeningStats[]
  strongestOpenings: OpeningStats[]
  weakestOpenings: OpeningStats[]
}

// --------------- Per-game analysis ---------------

export function analyzeGame(game: GameSummary): GameAnalysis | null {
  const chess = new Chess()

  try {
    chess.loadPgn(game.pgn, { strict: false })
  } catch {
    return null
  }

  const fullHistory = chess.history({ verbose: true })
  if (fullHistory.length === 0) return null

  const replay = new Chess()

  let lastNamedOpening: { eco: string; name: string; ply: number; fen: string } | null = null
  let move10Fen: string | null = null

  for (let i = 0; i < Math.min(fullHistory.length, MAX_PLY); i++) {
    const move = fullHistory[i]
    try {
      replay.move(move)
    } catch {
      return null
    }

    const entryAfter = lookupEco(replay.fen())
    if (entryAfter) {
      lastNamedOpening = { eco: entryAfter.eco, name: entryAfter.name, ply: i + 1, fen: replay.fen() }
    }

    // Record FEN after ply 20 (= 10 full moves, 0-indexed so i === 19)
    if (i === 19) {
      move10Fen = replay.fen()
    }
  }

  // For games that ended before move 10, use the game result as a centipawn proxy
  // (from White's perspective: +500 win, -500 loss, 0 draw) so they still
  // contribute to the median rather than being silently dropped.
  const move10ProxyCp: number | null =
    move10Fen === null
      ? game.result === 'white' ? 500 : game.result === 'black' ? -500 : 0
      : null

  return {
    gameId: game.id,
    platform: game.platform,
    timeControlBucket: game.timeControlBucket,
    userColor: game.userColor,
    result: game.result,
    opening: lastNamedOpening
      ? { eco: lastNamedOpening.eco, name: lastNamedOpening.name }
      : null,
    openingFen: lastNamedOpening?.fen ?? null,
    totalBookMoves: lastNamedOpening?.ply ?? 0,
    opponent: game.userColor === 'w' ? game.black : game.white,
    playedAtMs: game.playedAtMs,
    date: game.date,
    pgn: game.pgn,
    userRating: game.userRating ?? null,
    opponentRating: game.opponentRating ?? null,
    sourceUrl: game.sourceUrl,
    move10Fen,
    move10ProxyCp,
  }
}

export function analyzeGames(games: GameSummary[]): GameAnalysis[] {
  return games
    .map(analyzeGame)
    .filter((analysis): analysis is GameAnalysis => analysis !== null)
}

const ANALYSIS_CHUNK = 50

export async function analyzeGamesAsync(
  games: GameSummary[],
  onProgress: (done: number, total: number) => void
): Promise<GameAnalysis[]> {
  const results: GameAnalysis[] = []
  for (let i = 0; i < games.length; i += ANALYSIS_CHUNK) {
    const chunk = games.slice(i, i + ANALYSIS_CHUNK)
    for (const game of chunk) {
      const analysis = analyzeGame(game)
      if (analysis) results.push(analysis)
    }
    onProgress(Math.min(i + ANALYSIS_CHUNK, games.length), games.length)
    // Yield to the browser between chunks so the progress bar can paint
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
  return results
}

// --------------- Aggregation ---------------

function computeMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid]
}

/**
 * @param fenEvalMap  Optional map of FEN → centipawns (from White's perspective)
 *                    produced by Stockfish. When provided, medianEvalCp is computed
 *                    per opening. Games that ended before move 10 contribute their
 *                    result proxy (±500 / 0) regardless of this map.
 */
export function aggregateStats(
  analyses: GameAnalysis[],
  fenEvalMap?: Map<string, number>
): AggregateStats {
  type MutableStats = OpeningStats & { evalSamples: number[] }

  const openingMap = new Map<string, MutableStats>()

  for (const a of analyses) {
    const userWon = a.result === (a.userColor === 'w' ? 'white' : 'black')
    const isDraw = a.result === 'draw'

    if (a.opening) {
      const key = `${a.opening.eco}:${a.userColor}`
      if (!openingMap.has(key)) {
        openingMap.set(key, {
          eco: a.opening.eco,
          name: a.opening.name,
          openingFen: a.openingFen,
          color: a.userColor,
          gamesCount: 0,
          wins: 0,
          draws: 0,
          losses: 0,
          medianEvalCp: null,
          evalSamples: [],
        })
      }
      const stats = openingMap.get(key)!
      stats.gamesCount++
      if (userWon) stats.wins++
      else if (isDraw) stats.draws++
      else stats.losses++

      // Collect eval samples when eval data is available
      if (fenEvalMap !== undefined) {
        let sample: number | null = null
        if (a.move10Fen !== null && fenEvalMap.has(a.move10Fen)) {
          sample = fenEvalMap.get(a.move10Fen)!
        } else if (a.move10ProxyCp !== null) {
          sample = a.move10ProxyCp
        }
        if (sample !== null) stats.evalSamples.push(sample)
      }
    }
  }

  const openingStats: OpeningStats[] = Array.from(openingMap.values()).map((s) => {
    const medianEvalCp = s.evalSamples.length > 0 ? computeMedian(s.evalSamples) : null
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { evalSamples: _, ...rest } = s
    return { ...rest, medianEvalCp }
  }).sort((a, b) => b.gamesCount - a.gamesCount)

  const eligibleOpenings = openingStats.filter((s) => s.gamesCount >= 4)
  const winRate = (s: OpeningStats) => s.wins / s.gamesCount
  const strongestOpenings = [...eligibleOpenings].sort((a, b) => winRate(b) - winRate(a)).slice(0, 5)
  const weakestOpenings = [...eligibleOpenings].sort((a, b) => winRate(a) - winRate(b)).slice(0, 5)

  return {
    totalGames: analyses.length,
    openingStats,
    strongestOpenings,
    weakestOpenings,
  }
}
