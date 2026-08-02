import type {
  LiquidityLevelSnapshot,
  QmlSetupSnapshot,
  SessionLiquiditySnapshot,
  SessionLiquiditySummary,
} from "@/lib/market/types";

function title(value: string): string {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function price(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(2);
}

function level(level: LiquidityLevelSnapshot | null): string {
  return level ? `${title(level.type)} · ${price(level.price)} · ${level.obstacleClass}` : "—";
}

function qmlStatusClass(qml: QmlSetupSnapshot): string {
  if (qml.stage === "RETEST_CONFIRMED") return "trade-qualified";
  if (qml.stage === "MSS_CONFIRMED" || qml.stage === "RETEST_WAIT" || qml.stage === "LIQUIDITY_SWEPT") return "trade-wait";
  if (qml.stage === "INVALIDATED" || qml.stage === "EXPIRED") return "trade-blocked";
  return "trade-empty";
}

export function SessionLiquidityPanel({
  snapshot,
  summary,
}: {
  snapshot: SessionLiquiditySnapshot | null;
  summary: SessionLiquiditySummary;
}) {
  if (!snapshot) {
    return (
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Phase 8–9 · Session, liquidity and QML</p>
            <h2>Waiting for closed-candle liquidity context</h2>
          </div>
          <span className="status-pill">No snapshot</span>
        </div>
      </section>
    );
  }

  const qml = snapshot.qml;
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Phase 8–9 · Session liquidity QML</p>
          <h2>Location, sweep, structure shift and retest</h2>
        </div>
        <span className={`status-pill ${qmlStatusClass(qml)}`}>
          {qml.direction} · {title(qml.stage)} · {qml.score}
        </span>
      </div>

      <p className="form-note window-note">
        QML is permitted only after meaningful liquidity is swept, price reclaims the level, a closed-candle BOS/MSS forms, and a first or second retest confirms. This medium profile avoids both random visual QML patterns and over-strict first-retest-only silence.
      </p>

      <div className="metric-grid phase5-metrics">
        <div className="metric"><span>Active session</span><strong>{title(snapshot.activeSession)}</strong></div>
        <div className="metric"><span>Market location</span><strong>{title(snapshot.location)}</strong></div>
        <div className="metric"><span>Data ready</span><strong>{snapshot.dataReady ? "Yes" : "No"}</strong></div>
        <div className="metric"><span>QML stage</span><strong>{title(qml.stage)}</strong></div>
        <div className="metric"><span>QML direction</span><strong>{qml.direction}</strong></div>
        <div className="metric"><span>QML score</span><strong>{qml.score}</strong></div>
        <div className="metric"><span>Retest</span><strong>{qml.retestCount > 0 ? `#${qml.retestCount}` : "Waiting"}</strong></div>
        <div className="metric"><span>Age</span><strong>{qml.ageBars} M1 bars</strong></div>
      </div>

      <div className="trade-detail-grid">
        <article>
          <strong>Major reference levels</strong>
          <span>Previous day: {price(snapshot.previousDayLow)} – {price(snapshot.previousDayHigh)}</span>
          <span>Previous week: {price(snapshot.previousWeekLow)} – {price(snapshot.previousWeekHigh)}</span>
          <span>Asia: {price(snapshot.asiaLow)} – {price(snapshot.asiaHigh)}</span>
          <span>London: {price(snapshot.londonLow)} – {price(snapshot.londonHigh)}</span>
          <span>New York: {price(snapshot.newYorkLow)} – {price(snapshot.newYorkHigh)}</span>
        </article>
        <article>
          <strong>Nearest liquidity</strong>
          <span>Above: {level(snapshot.nearestLiquidityAbove)}</span>
          <span>Below: {level(snapshot.nearestLiquidityBelow)}</span>
          <span>Latest sweep: {snapshot.latestSweep ? `${title(snapshot.latestSweep.levelType)} · ${snapshot.latestSweep.direction} · ${snapshot.latestSweep.score}` : "—"}</span>
          <span>Reclaimed: {snapshot.latestSweep ? (snapshot.latestSweep.reclaimed ? "Yes" : "No") : "—"}</span>
          <span>Structure: {snapshot.latestStructureShift ? `${snapshot.latestStructureShift.direction} ${snapshot.latestStructureShift.type} · ${snapshot.latestStructureShift.score}` : "—"}</span>
        </article>
        <article>
          <strong>QML execution map</strong>
          <span>Shoulder/QML: {price(qml.shoulderPrice)} / {price(qml.qmlLevel)}</span>
          <span>Head: {price(qml.headPrice)}</span>
          <span>Entry zone: {price(qml.entryLower)} – {price(qml.entryUpper)}</span>
          <span>Invalidation: {price(qml.invalidationPrice)}</span>
          <span>Opposite-liquidity target: {price(qml.targetPrice)}</span>
          <span>Target type: {qml.targetType ? title(qml.targetType) : "Expansion fallback"}</span>
        </article>
      </div>

      {(qml.reasons.length > 0 || qml.blockers.length > 0) ? (
        <div className="signal-warning">
          <strong>QML evidence and blockers</strong>
          <div className="evidence-line">
            {qml.reasons.map((reason) => <i key={reason}>+ {title(reason)}</i>)}
            {qml.blockers.map((reason) => <i className="negative" key={reason}>− {title(reason)}</i>)}
          </div>
        </div>
      ) : null}

      <details>
        <summary>Full-range Phase 8–9 distribution</summary>
        <div className="state-distribution-grid">
          <div>
            <strong>Liquidity and structure</strong>
            <span>Sweeps: {summary.sweepCount.toLocaleString()}</span>
            <span>Bullish / bearish sweeps: {summary.bullishSweepCount} / {summary.bearishSweepCount}</span>
            <span>BOS / MSS: {summary.bosCount} / {summary.mssCount}</span>
            <span>Data-ready samples: {summary.dataReadySamples.toLocaleString()} / {summary.sampleCount.toLocaleString()}</span>
          </div>
          <div>
            <strong>QML funnel</strong>
            <span>Sweep watches: {summary.qmlWatchCount.toLocaleString()}</span>
            <span>MSS-confirmed: {summary.qmlMssCount.toLocaleString()}</span>
            <span>Retest-confirmed: {summary.qmlRetestConfirmedCount.toLocaleString()}</span>
            <span>Grade-ready: {summary.qmlGradeReadyCount.toLocaleString()}</span>
            <span>Invalidated / expired: {summary.qmlInvalidatedCount} / {summary.qmlExpiredCount}</span>
          </div>
          <div>
            <strong>Session samples</strong>
            {Object.entries(summary.sessionCounts).map(([name, count]) => (
              <span key={name}>{title(name)}: {count.toLocaleString()}</span>
            ))}
          </div>
        </div>
      </details>
    </section>
  );
}
