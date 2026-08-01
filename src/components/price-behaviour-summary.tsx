"use client";

import type { PriceBehaviourSummary, Timeframe } from "@/lib/market/types";

interface PriceBehaviourSummaryProps {
  timeframe: Timeframe;
  summary: PriceBehaviourSummary;
}

const PHASES = [
  "BULLISH_IMPULSE",
  "BEARISH_IMPULSE",
  "BULLISH_PULLBACK",
  "BEARISH_PULLBACK",
  "BULLISH_RECOVERY",
  "BEARISH_RECOVERY",
  "COMPRESSION",
  "EXPANSION",
  "MOMENTUM_DECAY",
  "NOISY",
] as const;

const BREAKS = [
  "BULLISH_ACCEPTED",
  "BEARISH_ACCEPTED",
  "BULLISH_FAILED",
  "BEARISH_FAILED",
  "BOTH_SIDES_FAILED",
] as const;

export function PriceBehaviourSummaryPanel({ timeframe, summary }: PriceBehaviourSummaryProps) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Phase 3 · Price behaviour</p>
          <h2>{timeframe} progress and momentum summary</h2>
        </div>
        <span className="status-pill">Bounded-history, no-lookahead measurements</span>
      </div>

      <div className="metric-grid">
        <Metric label="5-bar efficiency" value={`${(summary.averageEfficiency5 * 100).toFixed(1)}%`} />
        <Metric label="20-bar efficiency" value={`${(summary.averageEfficiency20 * 100).toFixed(1)}%`} />
        <Metric label="Average noise" value={summary.averageNoiseScore.toFixed(1)} />
        <Metric label="Average impulse strength" value={summary.averageImpulseStrength.toFixed(1)} />
        <Metric
          label="Average pullback depth"
          value={summary.pullbackSampleCount > 0 ? `${summary.averagePullbackDepthPercent.toFixed(1)}%` : "N/A"}
        />
        <Metric
          label="Average recovery speed"
          value={summary.recoverySampleCount > 0 ? `${summary.averageRecoverySpeedRatio.toFixed(2)}×` : "N/A"}
        />
        <Metric label="High late-entry risk" value={summary.lateEntryRiskCounts.HIGH.toLocaleString()} />
        <Metric label="Low late-entry risk" value={summary.lateEntryRiskCounts.LOW.toLocaleString()} />
      </div>

      <div className="tag-grid phase-grid">
        {PHASES.map((phase) => (
          <div className="tag-card" key={phase}>
            <span>{phase.replaceAll("_", " ")}</span>
            <strong>{summary.phaseCounts[phase].toLocaleString()}</strong>
          </div>
        ))}
      </div>

      <div className="tag-grid break-grid">
        {BREAKS.map((state) => (
          <div className="tag-card" key={state}>
            <span>{state.replaceAll("_", " ")}</span>
            <strong>{summary.breakStateCounts[state].toLocaleString()}</strong>
          </div>
        ))}
      </div>

      {summary.strongestEvents.length > 0 ? (
        <details>
          <summary>Strongest price-behaviour events</summary>
          <div className="issue-list">
            {summary.strongestEvents.slice(0, 15).map((event) => (
              <div key={`${event.timestampMs}-${event.phase}-${event.breakState}`}>
                <strong>{event.phase.replaceAll("_", " ")} · score {event.score.toFixed(1)}</strong>
                <span>
                  {new Date(event.timestampMs).toISOString()} · impulse {event.impulseDirection} {event.impulseStrength.toFixed(1)} · {event.breakState.replaceAll("_", " ")} · {event.momentumCondition.replaceAll("_", " ")} · late risk {event.lateEntryRisk}
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
