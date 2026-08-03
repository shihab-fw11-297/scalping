"use client";

import type { AnalyzeMarketResponse, CandleCoverageStatus } from "@/lib/market/types";

interface QualityPanelProps {
  result: AnalyzeMarketResponse;
}

const PROBLEM_STATUSES: CandleCoverageStatus[] = [
  "MISSING_DATA",
  "PARTIAL_MISSING_DATA",
  "OVERFULL",
];

export function QualityPanel({ result }: QualityPanelProps) {
  const { meta, quality, rolling5hLatest } = result;
  const expectedTradableM1 = quality.valid + quality.missingTradableCandles;
  const coveragePercent = expectedTradableM1 === 0
    ? 100
    : (quality.valid / expectedTradableM1) * 100;

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Phase 1 audit</p>
          <h2>Data quality</h2>
        </div>
        <span className="status-pill">{quality.valid.toLocaleString()} valid M1 candles</span>
      </div>

      <div className="metric-grid">
        <Metric label="Finage records" value={quality.received.toLocaleString()} />
        <Metric label="Valid M1" value={quality.valid.toLocaleString()} />
        <Metric label="M1 coverage" value={`${coveragePercent.toFixed(2)}%`} />
        <Metric label="Warm-up M1" value={quality.warmupCandles.toLocaleString()} />
        <Metric label="Context M1 total" value={quality.contextValid.toLocaleString()} />
        <Metric label="Invalid" value={quality.invalid.toLocaleString()} />
        <Metric label="Outside [from,to)" value={quality.filteredOutsideRange.toLocaleString()} />
        <Metric label="Duplicates" value={quality.duplicates.toLocaleString()} />
        <Metric label="Missing tradable M1" value={quality.missingTradableCandles.toLocaleString()} />
        <Metric label="Expected closed M1" value={quality.expectedClosedCandles.toLocaleString()} />
        <Metric label="Closed candles removed" value={quality.closedMarketCandlesRemoved.toLocaleString()} />
        <Metric label="Stale candles removed" value={quality.staleCandlesRemoved.toLocaleString()} />
        <Metric label="Gap safety bars" value={quality.gapSafetyCandlesMarked.toLocaleString()} />
        <Metric label="Server processing" value={`${meta.processingMs.toLocaleString()} ms`} />
      </div>

      <div className="tag-grid">
        {Object.entries(quality.incompleteByTimeframe).map(([timeframe, count]) => (
          <div className="tag-card" key={timeframe}>
            <span>{timeframe} data-quality failures</span>
            <strong>{count.toLocaleString()}</strong>
          </div>
        ))}
      </div>

      <details>
        <summary>Coverage classification by timeframe</summary>
        <div className="coverage-grid">
          {Object.entries(quality.coverageStatusByTimeframe).map(([timeframe, statuses]) => (
            <div className="coverage-card" key={timeframe}>
              <strong>{timeframe}</strong>
              {Object.entries(statuses).map(([status, count]) => (
                <span className={PROBLEM_STATUSES.includes(status as CandleCoverageStatus) ? "incomplete" : ""} key={status}>
                  {status.replaceAll("_", " ")}: {count.toLocaleString()}
                </span>
              ))}
            </div>
          ))}
        </div>
      </details>

      {rolling5hLatest ? (
        <div className="rolling-card">
          <strong>Latest rolling 5H window</strong>
          <span>
            {new Date(rolling5hLatest.fromTimestampMs).toISOString().slice(0, 16)} → {" "}
            {new Date(rolling5hLatest.toTimestampMs).toISOString().slice(0, 16)} UTC
          </span>
          <span>
            O {rolling5hLatest.open.toFixed(2)} · H {rolling5hLatest.high.toFixed(2)} · L {rolling5hLatest.low.toFixed(2)} · C {rolling5hLatest.close.toFixed(2)}
          </span>
          <span>Completeness: {rolling5hLatest.completenessPercent.toFixed(1)}%</span>
        </div>
      ) : null}

      <p className="form-note">
        Profile: {meta.analysisProfile}. Context starts {new Date(meta.contextFromUtc).toISOString()} with {meta.warmupCalendarDays} calendar days requested for warm-up. Weekend schedule: {meta.weekendScheduleMode}. {meta.dailyBoundaryDescription} Analysis cache expires at {new Date(meta.cacheExpiresAtUtc).toLocaleString()}.
      </p>

      {quality.gapSamples.length > 0 ? (
        <details>
          <summary>View gap samples ({quality.gapCount})</summary>
          <div className="issue-list">
            {quality.gapSamples.map((gap) => (
              <div key={`${gap.fromTimestampMs}-${gap.toTimestampMs}`}>
                <strong>{gap.classification}</strong>
                <span>
                  {new Date(gap.fromTimestampMs).toISOString()} → {new Date(gap.toTimestampMs).toISOString()} · tradable missing {gap.missingTradableCandles} · expected closed {gap.expectedClosedCandles}
                </span>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {quality.issueSamples.length > 0 ? (
        <details>
          <summary>View validation issues</summary>
          <div className="issue-list">
            {quality.issueSamples.map((issue, index) => (
              <div key={`${issue.type}-${issue.index}-${index}`}>
                <strong>{issue.type}</strong>
                <span>{issue.message}</span>
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
