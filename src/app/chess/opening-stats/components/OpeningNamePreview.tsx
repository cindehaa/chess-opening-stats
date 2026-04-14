'use client'

import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import styles from './OpeningNamePreview.module.css'

const Chessboard = dynamic(() => import('react-chessboard').then((m) => m.Chessboard), {
  ssr: false,
  loading: () => <div className={styles.boardPlaceholder} />,
})

type OpeningNamePreviewProps = {
  name: string
  fen: string | null
  color: 'w' | 'b'
  className?: string
  forceExpanded?: boolean
}

export function OpeningNamePreview({ name, fen, color, className, forceExpanded }: OpeningNamePreviewProps) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLSpanElement>(null)

  // Sync open state when section-level forceExpanded changes
  useEffect(() => {
    if (forceExpanded !== undefined) {
      setOpen(forceExpanded)
    }
  }, [forceExpanded])

  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (!fen) {
    return <span className={className}>{name}</span>
  }

  return (
    <span ref={wrapperRef} className={styles.wrapper}>
      <button
        type="button"
        className={`${styles.nameButton} ${className ?? ''}`}
        aria-expanded={open}
        aria-label={`${name} — click to ${open ? 'hide' : 'show'} board position`}
        onClick={() => setOpen((v) => !v)}
      >
        {name}
      </button>
      {open && (
        <span className={styles.preview}>
          <Chessboard
            position={fen}
            boardOrientation={color === 'w' ? 'white' : 'black'}
            arePiecesDraggable={false}
            boardWidth={176}
          />
        </span>
      )}
    </span>
  )
}
