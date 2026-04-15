/**
 * Fetch recent games from Chess.com or Lichess public APIs.
 * Returns a normalized GameSummary[] regardless of source.
 */

export type Platform = 'lichess' | 'chesscom'

export type TimeControlBucket = 'bullet' | 'blitz' | 'rapid+'

export const ALL_TIME_CONTROLS: TimeControlBucket[] = ['bullet', 'blitz', 'rapid+']

export const TC_LABELS: Record<TimeControlBucket, string> = {
  bullet: 'Bullet',
  blitz: 'Blitz',
  'rapid+': 'Rapid+',
}

export function normalizeTimeControl(raw: string): TimeControlBucket {
  switch (raw.toLowerCase()) {
    case 'bullet':
    case 'ultrabullet':
      return 'bullet'
    case 'blitz':
      return 'blitz'
    default:
      return 'rapid+' // rapid, classical, correspondence, daily, unknown
  }
}

export type GameSummary = {
  id: string
  platform: Platform
  white: string
  black: string
  result: 'white' | 'black' | 'draw'
  date: string
  playedAtMs: number
  timeControl: string
  timeControlBucket: TimeControlBucket
  pgn: string
  userColor: 'w' | 'b'
  userRating: number | null
  opponentRating: number | null
  sourceUrl?: string
}

export type FetchCriteria = {
  opponent?: string
  side?: 'w' | 'b' | 'both'
  fromDate?: string
  toDate?: string
}

// Map our bucket to Lichess perfType values
const LICHESS_PERF_TYPE: Record<TimeControlBucket, string> = {
  bullet: 'ultraBullet,bullet',
  blitz: 'blitz',
  'rapid+': 'rapid,classical,correspondence',
}

// --------------- Lichess ---------------

async function fetchLichessGamesByTC(
  username: string,
  tcBuckets: TimeControlBucket[],
  max: number,
  criteria?: FetchCriteria,
  onProgress?: (fetched: number, target: number) => void
): Promise<GameSummary[]> {
  const tcBucketSet = new Set(tcBuckets)
  const combinedPerfType = Array.from(new Set(tcBuckets.flatMap((tc) => LICHESS_PERF_TYPE[tc].split(',')))).join(',')
  const params = new URLSearchParams({
    max: String(max),
    pgnInJson: 'true',
    opening: 'true',
    variant: 'standard',
    perfType: combinedPerfType,
  })

  if (criteria?.side && criteria.side !== 'both') {
    params.set('color', criteria.side === 'w' ? 'white' : 'black')
  }
  if (criteria?.opponent?.trim()) {
    params.set('vs', criteria.opponent.trim())
  }
  if (criteria?.fromDate) {
    params.set('since', String(new Date(`${criteria.fromDate}T00:00:00`).getTime()))
  }
  if (criteria?.toDate) {
    params.set('until', String(new Date(`${criteria.toDate}T23:59:59.999`).getTime()))
  }

  const url = `https://lichess.org/api/games/user/${encodeURIComponent(username)}?${params}`
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 30_000)
  let res: Response
  try {
    res = await fetch(url, { headers: { Accept: 'application/x-ndjson' }, signal: controller.signal })
  } catch {
    throw new Error('Lichess request timed out or failed')
  } finally {
    clearTimeout(timeoutId)
  }

  if (!res.ok) throw new Error(`Lichess API error: ${res.status}`)

  // Stream the NDJSON response so we can report progress as games arrive
  const rawGames: any[] = []
  if (res.body) {
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        try { rawGames.push(JSON.parse(line)) } catch { /* ignore malformed line */ }
      }
      onProgress?.(rawGames.length, max)
    }
    if (buffer.trim()) {
      try { rawGames.push(JSON.parse(buffer)) } catch { /* ignore */ }
    }
  } else {
    const text = await res.text()
    text.trim().split('\n').filter(Boolean).forEach((line) => {
      try { rawGames.push(JSON.parse(line)) } catch { /* ignore */ }
    })
  }

  return rawGames
    .filter((g) => {
      if ((g.variant?.key ?? g.variant) !== 'standard' && g.variant) return false
      return tcBucketSet.has(normalizeTimeControl(g.speed ?? g.perf ?? ''))
    })
    .map((g) => {
      const userIsWhite = g.players?.white?.user?.name?.toLowerCase() === username.toLowerCase()
      const winner = g.winner
      const result = winner === 'white' ? 'white' : winner === 'black' ? 'black' : 'draw'

      const timeControl = g.speed ?? g.perf ?? 'unknown'
      const createdAtMs = typeof g.createdAt === 'number' ? g.createdAt : Date.now()
      return {
        id: g.id,
        platform: 'lichess' as Platform,
        white: g.players?.white?.user?.name ?? 'Anonymous',
        black: g.players?.black?.user?.name ?? 'Anonymous',
        result,
        date: new Date(createdAtMs).toLocaleDateString(),
        playedAtMs: createdAtMs,
        timeControl,
        timeControlBucket: normalizeTimeControl(timeControl),
        pgn: g.pgn ?? '',
        userColor: userIsWhite ? 'w' : 'b',
        userRating: userIsWhite
          ? (g.players?.white?.rating ?? null)
          : (g.players?.black?.rating ?? null),
        opponentRating: userIsWhite
          ? (g.players?.black?.rating ?? null)
          : (g.players?.white?.rating ?? null),
        sourceUrl: undefined,
      }
    })
}

// --------------- Chess.com ---------------

async function fetchChesscomGamesByTC(
  username: string,
  tcBuckets: TimeControlBucket[],
  max: number,
  criteria?: FetchCriteria,
  onProgress?: (fetched: number, target: number) => void
): Promise<GameSummary[]> {
  const tcBucketSet = new Set(tcBuckets)
  const archivesController = new AbortController()
  const archivesTimeout = setTimeout(() => archivesController.abort(), 10_000)
  let archivesRes: Response
  try {
    archivesRes = await fetch(
      `https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/archives`,
      { signal: archivesController.signal }
    )
  } catch {
    throw new Error('Chess.com archives request timed out or failed')
  } finally {
    clearTimeout(archivesTimeout)
  }
  if (!archivesRes.ok) throw new Error(`Chess.com archives error: ${archivesRes.status}`)

  const { archives } = (await archivesRes.json()) as { archives: string[] }
  if (!archives || archives.length === 0) throw new Error('No games found on Chess.com')

  // Filter archive months by date range to avoid fetching irrelevant months
  let filteredArchives = archives
  if (criteria?.fromDate || criteria?.toDate) {
    filteredArchives = archives.filter((url) => {
      const match = url.match(/(\d{4})\/(\d{2})$/)
      if (!match) return true
      const archiveYM = `${match[1]}-${match[2]}`
      if (criteria?.fromDate && archiveYM < criteria.fromDate.slice(0, 7)) return false
      if (criteria?.toDate && archiveYM > criteria.toDate.slice(0, 7)) return false
      return true
    })
  }

  const opponentNeedle = criteria?.opponent?.trim().toLowerCase() ?? ''
  const fromMs = criteria?.fromDate ? new Date(`${criteria.fromDate}T00:00:00`).getTime() : null
  const toMs = criteria?.toDate ? new Date(`${criteria.toDate}T23:59:59.999`).getTime() : null

  const results: GameSummary[] = []

  for (let i = filteredArchives.length - 1; i >= 0 && results.length < max; i--) {
    let gamesRes: Response
    try {
      const gamesController = new AbortController()
      const gamesTimeout = setTimeout(() => gamesController.abort(), 10_000)
      gamesRes = await fetch(filteredArchives[i], { signal: gamesController.signal })
      clearTimeout(gamesTimeout)
    } catch {
      continue // skip this month on timeout or network error
    }
    if (!gamesRes.ok) continue

    const { games } = (await gamesRes.json()) as { games: any[] }
    if (!games) continue

    for (let j = games.length - 1; j >= 0 && results.length < max; j--) {
      const g = games[j]
      const timeControl = g.time_class ?? 'unknown'
      if (!tcBucketSet.has(normalizeTimeControl(timeControl))) continue

      const endTimeMs = typeof g.end_time === 'number' ? g.end_time * 1000 : Date.now()
      if (fromMs !== null && endTimeMs < fromMs) continue
      if (toMs !== null && endTimeMs > toMs) continue

      const userIsWhite = g.white?.username?.toLowerCase() === username.toLowerCase()
      if (criteria?.side && criteria.side !== 'both') {
        const userColor = userIsWhite ? 'w' : 'b'
        if (userColor !== criteria.side) continue
      }

      if (opponentNeedle) {
        const opponentName = (userIsWhite ? g.black?.username : g.white?.username)?.toLowerCase() ?? ''
        if (!opponentName.includes(opponentNeedle)) continue
      }

      const whiteResult = g.white?.result
      const result = whiteResult === 'win' ? 'white' : g.black?.result === 'win' ? 'black' : 'draw'

      results.push({
        id: g.url?.split('/').pop() ?? String(g.end_time),
        platform: 'chesscom',
        white: g.white?.username ?? '?',
        black: g.black?.username ?? '?',
        result: result as GameSummary['result'],
        date: new Date(endTimeMs).toLocaleDateString(),
        playedAtMs: endTimeMs,
        timeControl,
        timeControlBucket: normalizeTimeControl(timeControl),
        pgn: g.pgn ?? '',
        userColor: userIsWhite ? 'w' : 'b',
        userRating: userIsWhite ? (g.white?.rating ?? null) : (g.black?.rating ?? null),
        opponentRating: userIsWhite ? (g.black?.rating ?? null) : (g.white?.rating ?? null),
        sourceUrl: g.url ?? undefined,
      })
    }
    onProgress?.(results.length, max)
  }

  return results
}

// --------------- Public API ---------------

/**
 * Fetch up to `max` most-recent games across all given time-control buckets,
 * interleaved by recency (not grouped by TC).
 */
export async function fetchGames(
  platform: Platform,
  username: string,
  tcBuckets: TimeControlBucket[],
  max: number,
  criteria?: FetchCriteria,
  onProgress?: (fetched: number, target: number) => void
): Promise<GameSummary[]> {
  if (!username || username.length > 255) throw new Error('Invalid username')
  if (platform === 'lichess') return fetchLichessGamesByTC(username, tcBuckets, max, criteria, onProgress)
  return fetchChesscomGamesByTC(username, tcBuckets, max, criteria, onProgress)
}
