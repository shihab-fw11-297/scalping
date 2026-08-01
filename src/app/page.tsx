import { MarketAnalyzer } from "@/components/market-analyzer";

export default function HomePage() {
  return (
    <main className="page-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Phase 1 through Phase 7</p>
          <h1>XAUUSD Multi-Timeframe Market Intelligence Analyzer</h1>
          <p className="hero-copy">
            Fetch up to 100,000 Finage M1 candles, validate and aggregate them,
            measure candle and price behaviour, synchronize 1D-to-1M market state,
            rank competing hypotheses, confirm deterministic BUY/SELL decisions,
            and qualify family-specific entry, structural stop and target plans.
          </p>
        </div>
        <div className="scope-card">
          <strong>Current scope</strong>
          <span>No database</span>
          <span>No background worker</span>
          <span>Historical analytical BUY/SELL + entry/SL/TP</span>
          <span>No live spread or order execution</span>
          <span>No future-candle lookahead</span>
        </div>
      </header>
      <MarketAnalyzer />
      <footer className="footer">
        Charts powered by <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView Lightweight Charts™</a>.
      </footer>
    </main>
  );
}
