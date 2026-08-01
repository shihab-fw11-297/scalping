"use client";

import type {
  CandleBehaviourView,
  CandleCompleteness,
  CompactCandle,
  PriceBehaviourView,
} from "@/lib/market/types";

interface DataTableProps {
  candles: readonly CompactCandle[];
  completeness: readonly CandleCompleteness[];
  behaviours: readonly CandleBehaviourView[];
  priceBehaviours: readonly PriceBehaviourView[];
}

function statusClass(status: CandleCompleteness["status"]): string {
  return status === "MISSING_DATA" || status === "PARTIAL_MISSING_DATA" || status === "OVERFULL"
    ? "incomplete"
    : "complete";
}

function riskClass(risk: PriceBehaviourView["lateEntryRisk"] | undefined): string {
  if (risk === "HIGH") return "risk-high";
  if (risk === "MEDIUM") return "risk-medium";
  return "risk-low";
}

export function DataTable({
  candles,
  completeness,
  behaviours,
  priceBehaviours,
}: DataTableProps) {
  const start = Math.max(0, candles.length - 300);

  return (
    <div className="data-table-section">
      <p className="table-scroll-hint">Swipe or scroll horizontally to inspect all candle and price-behaviour fields.</p>
      <div
        className="table-wrap behaviour-table"
        role="region"
        aria-label="Candle and price behaviour data table"
        tabIndex={0}
      >
      <table>
        <thead>
          <tr>
            <th>UTC time</th>
            <th>Open</th>
            <th>High</th>
            <th>Low</th>
            <th>Close</th>
            <th>Coverage</th>
            <th>Candle behaviour</th>
            <th>Direction</th>
            <th>Range</th>
            <th>Body %</th>
            <th>Range/20</th>
            <th>Overlap</th>
            <th>Price phase</th>
            <th>Efficiency 5</th>
            <th>Efficiency 20</th>
            <th>Noise</th>
            <th>Impulse</th>
            <th>Strength</th>
            <th>Impulse bars</th>
            <th>Pullback depth</th>
            <th>Pullback bars</th>
            <th>Recovery speed</th>
            <th>Break acceptance</th>
            <th>Break level</th>
            <th>Momentum</th>
            <th>Acceleration</th>
            <th>Extension/20</th>
            <th>Freshness</th>
            <th>Late-entry risk</th>
          </tr>
        </thead>
        <tbody>
          {candles.slice(start).map((candle, localIndex) => {
            const index = start + localIndex;
            const coverage = completeness[index] ?? {
              actualChildren: 1,
              expectedChildren: 1,
              fullIntervalChildren: 1,
              expectedClosedChildren: 0,
              completenessPercent: 100,
              status: "COMPLETE" as const,
            };
            const behaviour = behaviours[index];
            const price = priceBehaviours[index];
            return (
              <tr key={candle[0]}>
                <td>{new Date(candle[0]).toISOString().replace("T", " ").slice(0, 19)}</td>
                <td>{candle[1].toFixed(2)}</td>
                <td>{candle[2].toFixed(2)}</td>
                <td>{candle[3].toFixed(2)}</td>
                <td>{candle[4].toFixed(2)}</td>
                <td className={statusClass(coverage.status)} title={coverage.status.replaceAll("_", " ")}>
                  {coverage.actualChildren}/{coverage.expectedChildren} ({coverage.completenessPercent.toFixed(1)}%)
                </td>
                <td>{behaviour?.primaryTag.replaceAll("_", " ") ?? "—"}</td>
                <td>{behaviour?.direction ?? "—"}</td>
                <td>{behaviour?.range.toFixed(3) ?? "—"}</td>
                <td>{behaviour ? `${(behaviour.bodyToRange * 100).toFixed(1)}%` : "—"}</td>
                <td>{behaviour?.rangeVsAverage20?.toFixed(2) ?? "—"}</td>
                <td>{behaviour?.overlapWithPrevious?.toFixed(2) ?? "—"}</td>
                <td>{price?.phase.replaceAll("_", " ") ?? "—"}</td>
                <td>{price ? `${(price.efficiency5 * 100).toFixed(1)}%` : "—"}</td>
                <td>{price ? `${(price.efficiency20 * 100).toFixed(1)}%` : "—"}</td>
                <td>{price?.noiseScore.toFixed(1) ?? "—"}</td>
                <td>{price?.impulseDirection ?? "—"}</td>
                <td>{price?.impulseStrength.toFixed(1) ?? "—"}</td>
                <td>{price?.impulseBars ?? 0}</td>
                <td>{price?.pullbackDepthPercent !== null && price?.pullbackDepthPercent !== undefined ? `${price.pullbackDepthPercent.toFixed(1)}%` : "—"}</td>
                <td>{price?.pullbackBars ?? 0}</td>
                <td>{price?.recoverySpeedRatio?.toFixed(2) ?? "—"}</td>
                <td>{price?.breakState.replaceAll("_", " ") ?? "—"}</td>
                <td>{price?.breakLevel?.toFixed(2) ?? "—"}</td>
                <td>{price?.momentumCondition.replaceAll("_", " ") ?? "—"}</td>
                <td>{price?.accelerationRatio?.toFixed(2) ?? "—"}</td>
                <td>{price?.extensionVsAverageRange20?.toFixed(2) ?? "—"}</td>
                <td>{price?.freshnessScore.toFixed(1) ?? "—"}</td>
                <td className={riskClass(price?.lateEntryRisk)}>{price?.lateEntryRisk ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {candles.length > 300 ? (
        <p className="table-note">Showing the latest 300 candles from the loaded server window.</p>
      ) : null}
      </div>
    </div>
  );
}
