import styles from './AnalysisProgress.module.css'

type AnalysisProgressProps = {
  label?: string
  progress?: number
}

export function AnalysisProgress({ label = 'Fetching games…', progress }: AnalysisProgressProps) {
  const pct = progress !== undefined ? `${Math.round(progress)}%` : null
  const barWidth = progress !== undefined ? `${progress}%` : '100%'
  return (
    <div className={styles.container}>
      <div className={styles.labelRow}>
        <span className={styles.label}>{label}</span>
        {pct && <span className={styles.pct}>{pct}</span>}
      </div>
      <div className={styles.barOuter}>
        <div className={styles.barInner} style={{ width: barWidth }} />
      </div>
    </div>
  )
}
