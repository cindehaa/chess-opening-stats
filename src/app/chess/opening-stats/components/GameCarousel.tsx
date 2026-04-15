'use client'

import { useState, useMemo, useRef } from 'react'
import dynamic from 'next/dynamic'
import { Chess } from 'chess.js'
import type { GameAnalysis } from '../lib/analyzeOpenings'
import { getEvalDisplayColor } from '../lib/evalDisplay'
import styles from './GameCarousel.module.css'

const Chessboard = dynamic(() => import('react-chessboard').then((m) => m.Chessboard), {
  ssr: false,
  loading: () => <div className={styles.boardPlaceholder} />,
})

type GameCarouselProps = {
  openingName: string
  analyses: GameAnalysis[]
  username: string
  fenEvalMap?: Map<string, number>
}


type ParsedMove = { san: string; fen: string }

function parsePgn(pgn: string): ParsedMove[] {
  const chess = new Chess()
  try {
    chess.loadPgn(pgn, { strict: false })
  } catch {
    return []
  }
  const history = chess.history({ verbose: true })
  const replay = new Chess()
  const moves: ParsedMove[] = []
  for (const m of history) {
    try {
      replay.move(m)
    } catch {
      break
    }
    moves.push({ san: m.san, fen: replay.fen() })
  }
  return moves
}

function resultLabel(result: GameAnalysis['result'], userColor: 'w' | 'b'): string {
  if (result === 'draw') return 'Draw'
  const userWon = result === (userColor === 'w' ? 'white' : 'black')
  return userWon ? 'Win' : 'Loss'
}

export function GameCarousel({ openingName, analyses, username, fenEvalMap }: GameCarouselProps) {
  const [idx, setIdx] = useState(0)
  const [plyOffset, setPlyOffset] = useState(() => analyses[0]?.totalBookMoves ?? 0)
  // Chess.com → cached Lichess import URL
  const lichessUrlCache = useRef<Map<string, string>>(new Map())
  const [importingId, setImportingId] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<'original' | 'lichess' | null>(null)
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const moveListRef = useRef<HTMLDivElement>(null)

  function flashCopied(key: 'original' | 'lichess') {
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
    setCopiedKey(key)
    copyTimeoutRef.current = setTimeout(() => setCopiedKey(null), 1500)
  }

  function copyUrl(url: string, key: 'original' | 'lichess') {
    navigator.clipboard.writeText(url).then(() => flashCopied(key)).catch(() => {})
  }

  const game = analyses.length > 0 ? analyses[Math.min(idx, analyses.length - 1)] : undefined

  // Parse all moves from the game PGN
  const allMoves = useMemo(() => parsePgn(game?.pgn ?? ''), [game?.pgn])

  // Board FEN at the current ply (plyOffset=0 means starting position)
  const boardFen = useMemo(() => {
    if (plyOffset === 0) return 'start'
    return allMoves[plyOffset - 1]?.fen ?? 'start'
  }, [allMoves, plyOffset])

  if (!game) {
    return (
      <p className={styles.empty}>No games match the current filters for this opening.</p>
    )
  }

  function goToGame(newIdx: number) {
    setIdx(newIdx)
    setPlyOffset(analyses[Math.min(newIdx, analyses.length - 1)].totalBookMoves)
    if (moveListRef.current) moveListRef.current.scrollTop = 0
  }

  async function handleLichessAnalysis() {
    if (!game) return
    const ply = game.totalBookMoves

    if (game.platform === 'lichess') {
      const url = `https://lichess.org/${game.gameId}#${ply}`
      window.open(url, '_blank', 'noopener,noreferrer')
      copyUrl(url, 'lichess')
      return
    }

    // Chess.com: import PGN to Lichess, then open analysis
    const cached = lichessUrlCache.current.get(game.gameId)
    if (cached) {
      const url = `${cached}#${ply}`
      window.open(url, '_blank', 'noopener,noreferrer')
      copyUrl(url, 'lichess')
      return
    }

    setImportingId(game.gameId)
    try {
      const body = new URLSearchParams({ pgn: game.pgn })
      const res = await fetch('https://lichess.org/api/import', {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
      })
      const text = await res.text()
      try {
        const data = JSON.parse(text) as { id: string; url: string }
        if (data.url) {
          lichessUrlCache.current.set(game.gameId, data.url)
          const url = `${data.url}#${ply}`
          window.open(url, '_blank', 'noopener,noreferrer')
          copyUrl(url, 'lichess')
          return
        }
      } catch {
        // Lichess returned non-JSON (rate limited or error) — fall through
      }
      // Fallback: open analysis board with just the opening FEN
      if (game.openingFen) {
        const fen = game.openingFen.replace(/ /g, '_')
        window.open(`https://lichess.org/analysis/${fen}`, '_blank', 'noopener,noreferrer')
      }
    } finally {
      setImportingId(null)
    }
  }

  const userIsWhite = game.userColor === 'w'
  const whiteName = userIsWhite ? (username || 'You') : game.opponent
  const blackName = userIsWhite ? game.opponent : (username || 'You')
  const whiteRating = userIsWhite ? game.userRating : game.opponentRating
  const blackRating = userIsWhite ? game.opponentRating : game.userRating
  const result = resultLabel(game.result, game.userColor)
  const resultClass = result === 'Win' ? styles.resultWin : result === 'Loss' ? styles.resultLoss : styles.resultDraw

  return (
    <div className={styles.carousel}>
      {/* Navigation */}
      <div className={styles.nav}>
        <button
          className={styles.navBtn}
          onClick={() => goToGame(Math.max(0, idx - 1))}
          disabled={idx === 0}
          aria-label="Previous game"
        >
          ‹ Prev
        </button>
        <span className={styles.navInfo}>
          {idx + 1} <span className={styles.navSep}>/</span> {analyses.length}
        </span>
        <button
          className={styles.navBtn}
          onClick={() => goToGame(Math.min(analyses.length - 1, idx + 1))}
          disabled={idx === analyses.length - 1}
          aria-label="Next game"
        >
          Next ›
        </button>
      </div>

      {/* Game card */}
      <div className={styles.card}>
        {/* Board */}
        <div className={styles.boardCol}>
          <Chessboard
            id={`carousel-board-${game.gameId}`}
            position={boardFen}
            boardWidth={220}
            arePiecesDraggable={false}
            boardOrientation={game.userColor === 'w' ? 'white' : 'black'}
            animationDuration={0}
          />
          {plyOffset !== game.totalBookMoves && game.totalBookMoves > 0 && (
            <button
              className={styles.resetBoardBtn}
              onClick={() => setPlyOffset(game.totalBookMoves)}
              title="Return to opening position"
            >
              ↩ Opening position
            </button>
          )}
        </div>

        {/* Info + moves */}
        <div className={styles.infoCol}>
          {/* Players */}
          <div className={styles.players}>
            <div className={`${styles.player} ${styles.playerWhite}`}>
              <span className={styles.playerPiece}>♔</span>
              <span className={`${styles.playerName} ${userIsWhite ? styles.playerUser : ''}`}>
                {whiteName}
                {whiteRating != null && (
                  <span className={styles.playerRating}> ({whiteRating})</span>
                )}
              </span>
            </div>
            <div className={`${styles.player} ${styles.playerBlack}`}>
              <span className={styles.playerPiece}>♚</span>
              <span className={`${styles.playerName} ${!userIsWhite ? styles.playerUser : ''}`}>
                {blackName}
                {blackRating != null && (
                  <span className={styles.playerRating}> ({blackRating})</span>
                )}
              </span>
            </div>
          </div>

          {/* Result + meta */}
          <div className={styles.meta}>
            <span className={`${styles.resultBadge} ${resultClass}`}>{result}</span>
            <span className={styles.metaDetail}>
              {game.date} · {game.timeControlBucket}
            </span>
            {game.opening && (
              <span className={styles.metaEco}>
                · {game.opening.eco} · {game.totalBookMoves} book ply
                {game.move10Fen
                  ? fenEvalMap?.has(game.move10Fen) && (() => {
                      const cp = fenEvalMap.get(game.move10Fen)!
                      const pawns = cp / 100
                      return (
                        <>
                          {' '}
                          ·{' '}
                          <span style={{ color: getEvalDisplayColor(cp, game.userColor) }}>
                            {pawns > 0 ? `+${pawns.toFixed(2)}` : pawns.toFixed(2)} @10
                          </span>
                        </>
                      )
                    })()
                  : <> · {result === 'Win' ? 'W' : result === 'Loss' ? 'L' : 'D'} &lt;10</>
                }
              </span>
            )}
          </div>

          {/* Full move list: opening moves (muted) + post-opening moves */}
          <div className={styles.moveSection}>
            <p className={styles.moveSectionLabel}>Moves</p>
            {allMoves.length === 0 ? (
              <p className={styles.moveSectionEmpty}>No moves available.</p>
            ) : (
              <div className={styles.moveList} ref={moveListRef}>
                {allMoves.map((m, i) => {
                  const ply = i
                  const isWhiteMove = ply % 2 === 0
                  const moveNum = Math.floor(ply / 2) + 1
                  const isActive = plyOffset === i + 1
                  const isOpening = i < game.totalBookMoves
                  return (
                    <span key={i} className={styles.moveGroup}>
                      {isWhiteMove && (
                        <span className={styles.moveNum}>{moveNum}.</span>
                      )}
                      <button
                        className={`${styles.moveBtn} ${isActive ? styles.moveBtnActive : ''} ${isOpening ? styles.moveBtnOpening : ''}`}
                        onClick={() => setPlyOffset(i + 1)}
                        title={`Go to move ${moveNum}${isWhiteMove ? '' : '...'} ${m.san}`}
                      >
                        {m.san}
                      </button>
                    </span>
                  )
                })}
              </div>
            )}
          </div>

          {/* Action row: original game + Lichess analysis */}
          <div className={styles.actionRow}>
            {(() => {
              const originalUrl = game.platform === 'lichess'
                ? `https://lichess.org/${game.gameId}`
                : (game.sourceUrl ?? `https://www.chess.com/game/live/${game.gameId}`)
              return (
                <a
                  className={styles.originalLink}
                  href={originalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => copyUrl(originalUrl, 'original')}
                >
                  {copiedKey === 'original' ? '✓ Copied' : '↗ Original game'}
                </a>
              )
            })()}
            <button
              className={styles.lichessBtn}
              onClick={handleLichessAnalysis}
              disabled={importingId === game.gameId}
            >
              {importingId === game.gameId
                ? 'Importing…'
                : copiedKey === 'lichess'
                  ? '✓ Copied'
                  : '↗ Analyze on Lichess'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
