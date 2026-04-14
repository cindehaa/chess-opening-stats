# Chess Opening Statistics

Analyze your opening repertoire directly from your Lichess or Chess.com games. Get detailed statistics on how often you play each opening, track win rates, and identify your strengths and weaknesses by opening.

**URL:** https://chessopeningstats.com/

## Features

- **Game fetching** — pull recent games from Lichess or Chess.com APIs
- **Game filtering** — by time control, opponent, date range, and side (White/Black)
- **Opening classification** — automatically map games to ECO opening codes
- **Overall statistics** — summary of your most frequently played openings, best win rates, and areas for improvement
- **Detailed opening statistics** — see your performance in each opening/variant, with convenient filtering and sorting
- **Median opening evaluation** — Stockfish analysis at move 10 to determine average advantage/disadvantage in each opening
- **Game carousel** — review individual games with a link to the original on Lichess/Chess.com and a link to a Lichess analysis board
- URL sharing — encode input parameters and results in the URL for easy sharing

## Local Development

```bash
npm install
npm run dev
```

## Technical Details

**Frontend:** Next.js 13+ with TypeScript, React 18+.

**APIs Used:**
- [Lichess API](https://lichess.org/api) — NDJSON streaming games
- [Chess.com API](https://www.chess.com/news/view/published-data-api) — archived games by month

**Libraries:**
- `chess.js` — PGN parsing and move replay
- `chess-openings` — static ECO opening database
- `react-chessboard` — interactive board display
- `recharts` — data visualization
- `stockfish.js` — optional Web Worker-based position evaluation`

Deployed with Vercel.

## Contributions

Contributions are very welcome!

