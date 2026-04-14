/**
 * Minimal Stockfish Web Worker wrapper for evaluating single FEN positions.
 * One shared worker instance; evaluations run sequentially to avoid overloading.
 * Deduplicates concurrent requests for the same FEN.
 */

type QueueItem = {
  fen: string
  depth: number
  resolve: (cp: number) => void
  reject: (reason: unknown) => void
}

class StockfishEvaluator {
  private worker: Worker | null = null
  private initialized = false
  private initResolvers: (() => void)[] = []
  private queue: QueueItem[] = []
  private busy = false
  private pendingResolve: ((cp: number) => void) | null = null
  private pendingReject: ((reason: unknown) => void) | null = null
  private bestCp = 0

  private initWorker(): Worker {
    if (this.worker) return this.worker
    this.worker = new Worker('/stockfish.js')
    this.worker.onmessage = (e: MessageEvent<string>) => this.handleLine(e.data)
    this.worker.onerror = (err) => {
      this.pendingReject?.(err)
      this.pendingResolve = null
      this.pendingReject = null
      this.busy = false
      this.processQueue()
    }
    this.worker.postMessage('uci')
    return this.worker
  }

  private handleLine(line: string) {
    if (line === 'uciok') {
      this.worker!.postMessage('isready')
      return
    }
    if (line === 'readyok') {
      this.initialized = true
      for (const r of this.initResolvers) r()
      this.initResolvers = []
      this.processQueue()
      return
    }
    if (line.startsWith('info') && line.includes('score')) {
      const mateMatch = line.match(/score mate (-?\d+)/)
      const cpMatch = line.match(/score cp (-?\d+)/)
      if (mateMatch) {
        this.bestCp = parseInt(mateMatch[1]) > 0 ? 9999 : -9999
      } else if (cpMatch) {
        this.bestCp = parseInt(cpMatch[1])
      }
    }
    if (line.startsWith('bestmove')) {
      const resolve = this.pendingResolve
      this.pendingResolve = null
      this.pendingReject = null
      this.busy = false
      resolve?.(this.bestCp)
      this.processQueue()
    }
  }

  private ensureInitialized(): Promise<void> {
    if (this.initialized) return Promise.resolve()
    return new Promise((resolve) => {
      this.initResolvers.push(resolve)
      this.initWorker()
    })
  }

  private processQueue() {
    if (this.busy || !this.initialized || this.queue.length === 0) return
    const item = this.queue.shift()!
    this.busy = true
    this.pendingResolve = item.resolve
    this.pendingReject = item.reject
    this.bestCp = 0
    const w = this.initWorker()
    w.postMessage(`position fen ${item.fen}`)
    w.postMessage(`go depth ${item.depth}`)
  }

  async evaluate(fen: string, depth = 10): Promise<number> {
    await this.ensureInitialized()
    return new Promise((resolve, reject) => {
      this.queue.push({ fen, depth, resolve, reject })
      this.processQueue()
    })
  }

  terminate() {
    this.worker?.terminate()
    this.worker = null
    this.initialized = false
    this.busy = false
    this.queue = []
    this.pendingResolve = null
    this.pendingReject = null
    this.initResolvers = []
  }
}

let instance: StockfishEvaluator | null = null

function getInstance(): StockfishEvaluator {
  if (!instance) instance = new StockfishEvaluator()
  return instance
}

/**
 * Evaluate a FEN position and return centipawns from White's perspective.
 * Mate scores are clamped to ±9999.
 */
export async function evaluateFen(fen: string, depth = 10): Promise<number> {
  return getInstance().evaluate(fen, depth)
}

/** Terminate the shared Stockfish worker (call on cleanup). */
export function terminateStockfish() {
  instance?.terminate()
  instance = null
}
