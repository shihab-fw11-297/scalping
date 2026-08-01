"use client";

import type { CandleBehaviourSummary, Timeframe } from "@/lib/market/types";

interface BehaviourSummaryProps {
  timeframe: Timeframe;
  summary: CandleBehaviourSummary;
}

const IMPORTANT_TAGS = [
  "BULLISH_DISPLACEMENT",
  "BEARISH_DISPLACEMENT",
  "WICK_SWEEP_HIGH",
  "WICK_SWEEP_LOW",
  "UPPER_REJECTION",
  "LOWER_REJECTION",
  "RANGE_EXPANSION",
  "RANGE_COMPRESSION",
  "EXHAUSTION_CANDIDATE",
] as const;

export function BehaviourSummaryPanel({ timeframe, summary }: BehaviourSummaryProps) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Phase 2 · Candle behaviour</p>
          <h2>{timeframe} behaviour summary</h2>
        </div>
        <span className="status-pill">Measurements, not trade signals</span>
      </div>

      <div className="metric-grid">
        <Metric label="Candles" value={summary.candleCount.toLocaleString()} />
        <Metric label="Average range" value={summary.averageRange.toFixed(3)} />
        <Metric label="Median range" value={summary.medianRange.toFixed(3)} />
        <Metric label="P95 range" value={summary.p95Range.toFixed(3)} />
        <Metric label="Average body/range" value={`${(summary.averageBodyToRange * 100).toFixed(1)}%`} />
        <Metric label="Bullish candles" value={summary.bullishCount.toLocaleString()} />
        <Metric label="Bearish candles" value={summary.bearishCount.toLocaleString()} />
        <Metric label="Neutral candles" value={summary.neutralCount.toLocaleString()} />
      </div>

      <div className="tag-grid">
        {IMPORTANT_TAGS.map((tag) => (
          <div className="tag-card" key={tag}>
            <span>{tag.replaceAll("_", " ")}</span>
            <strong>{summary.tagCounts[tag].toLocaleString()}</strong>
          </div>
        ))}
      </div>

      {summary.strongestEvents.length > 0 ? (
        <details>
          <summary>Strongest measured candles</summary>
          <div className="issue-list">
            {summary.strongestEvents.slice(0, 12).map((event) => (
              <div key={`${event.timestampMs}-${event.primaryTag}`}>
                <strong>{event.primaryTag.replaceAll("_", " ")} · {event.intensityScore.toFixed(1)}</strong>
                <span>
                  {new Date(event.timestampMs).toISOString()} · {event.direction} · range/20 avg {event.rangeVsAverage20?.toFixed(2) ?? "N/A"}×
                </span>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
