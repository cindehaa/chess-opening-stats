# Chess Opening Statistics

Analyze your opening repertoire directly from your Lichess or Chess.com games. Get detailed statistics on how often you play each opening, track win rates, and identify your strengths and weaknesses by opening.

**Live URL:** (deployment coming soon)

## Features

- **Fast game fetching** — pull recent games from Lichess or Chess.com APIs
- **Opening classification** — automatically map games to ECO opening codes
- **Win rate analysis** — see your performance in each opening
- **Position evaluation** — (optional) Stockfish deep analysis at move 10
- **Detailed filtering** — by time control, opponent, date range, and side (White/Black)
- **Opening preview** — small board previews of opening positions
- **Game carousel** — review individual games by opening

## Getting Started

### Using the Live Site

Visit the site and enter:
1. Your username (Lichess or Chess.com)
2. Platform preference
3. Number of games to analyze (10–1000, default 25)
4. Time controls of interest

Results load in ~5–30 seconds depending on game count and filters.

### Self-Hosting / Development

```bash
npm install
npm run dev
# Visit http://localhost:3000/chess/opening-stats
```

## What's Displayed

### Opening Frequency

Shows your most-played openings as White and Black, with play percentages. Expand to see board position previews.

### Per-Opening Breakdown

Lists all discovered openings with:
- Game count
- Win/Draw/Loss record
- Win rate percentage
- Median centipawn evaluation at move 10 (when available)

You can sort by any column and use an expression-based search filter (e.g., `"semi-slav" win%>50`).

### Game Carousel

Pick an opening to see individual games. Navigate between games and jump to interesting positions.

---

## Technical Details

**Backend:** None required. All game fetching is client-side via public APIs.

**Frontend:** Next.js 13+ with TypeScript, React 18+.

**APIs Used:**
- [Lichess API](https://lichess.org/api) — NDJSON streaming games
- [Chess.com API](https://www.chess.com/news/view/published-data-api) — archived games by month

**Libraries:**
- `chess.js` — PGN parsing and move replay
- `chess-openings` — static ECO opening database
- `react-chessboard` — interactive board display
- `recharts` — data visualization
- `stockfish.js` — optional Web Worker-based position evaluation

**Why no backend?**
Using public APIs directly keeps deployment simple and costs zero. No server state, no database, no authentication needed.

## URL Sharing & Deep Linking

Results are encoded in the URL, so you can share links:
- `?u=hikaru&platform=lichess&n=50&tc=blitz` — pre-load a specific analysis
- `?u=hikaru&opening=C45:w` — jump to a specific opening
- `#games-carousel` — scroll to and open the game carousel section

## Performance Notes

- Lichess games stream efficiently via NDJSON, so even 1000 games fetch in ~10s.
- Chess.com requires fetching archives month-by-month; large ranges may take longer.
- Analysis (ECO classification) happens in chunks with progress updates.
- Stockfish evaluation happens asynchronously in the background; you can view results before it completes.

## Running on Your Own Server

```bash
# Install dependencies
npm install

# Build
npm run build

# Start server
npm start
```

Deploy to Vercel, Netlify, or any Node.js host that supports Next.js.

## Contributing

Found a bug or have a feature idea? Open an issue or submit a PR.

## License

MIT

---

**Built by [cindehaa](https://cindehaa.com)** • Part of the [cindehaa.com](https://cindehaa.com) personal site
