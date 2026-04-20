import type { Metadata } from 'next'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { ErrorBoundary } from './components/ErrorBoundary'
import '@/styles/globals.css'

export const metadata: Metadata = {
  metadataBase: new URL('https://chessopeningstats.com'),
  title: 'Chess Opening Statistics',
  description: 'Analyze your opening repertoire from Lichess and Chess.com games',
  robots: { index: true, follow: true },
  openGraph: {
    title: 'Chess Opening Statistics',
    description: 'Analyze your opening repertoire from Lichess and Chess.com games',
    url: 'https://chessopeningstats.com',
    siteName: 'Chess Opening Statistics',
    images: [{ url: '/og.png', width: 1200, height: 630 }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Chess Opening Statistics',
    description: 'Analyze your opening repertoire from Lichess and Chess.com games',
    images: ['/og.png'],
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ErrorBoundary>{children}</ErrorBoundary>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
