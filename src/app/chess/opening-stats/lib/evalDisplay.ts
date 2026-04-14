export function getEvalDisplayColor(cp: number | null, perspective: 'w' | 'b', threshold = 30): string {
  if (cp === null) return 'var(--color-text-muted)'

  const perspectiveCp = perspective === 'w' ? cp : -cp
  if (perspectiveCp > threshold) return '#4ade80'
  if (perspectiveCp < -threshold) return '#f87171'
  return 'var(--color-text-muted)'
}
