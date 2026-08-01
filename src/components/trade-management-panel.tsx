import type {
  TradeManagementSummary,
  TradePlanSnapshot,
  TradePlanStatus,
} from "@/lib/market/types";

function title(value: string): string {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function price(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(2);
}

function statusClass(status: TradePlanStatus): string {
  if (status === "ENTRY_VALID" || status === "ACTIVE" || status.startsWith("TARGET") || status === "COMPLETED") return "trade-qualified";
  if (status === "WAIT_ENTRY") return "trade-wait";
  if (status === "REJECTED" || status === "EXPIRED" || status === "INVALIDATED") return "trade-blocked";
  if (status === "AMBIGUOUS_INTRABAR") return "trade-ambiguous";
  return "trade-empty";
}

export function TradeManagementPanel({
  snapshot,
  summary,
}: {
  snapshot: TradePlanSnapshot | null;
  summary: TradeManagementSummary;
}) {
  if (!snapshot) {
    return (
      <section className="panel">
        <p className="eyebrow">Phase 7 · Entry, target and risk</p>
        <h2>No qualified Phase 6 decision at this anchor</h2>
      </section>
    );
  }

  const tp1 = snapshot.targetSpace?.targets.find((target) => target.name === "TP1") ?? null;
  const tp2 = snapshot.targetSpace?.targets.find((target) => target.name === "TP2") ?? null;
  const tp3 = snapshot.targetSpace?.targets.find((target) => target.name === "TP3") ?? null;

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Phase 7 · Analytical trade qualification</p>
          <h2>Entry, structural risk and target plan</h2>
        </div>
        <span className={`status-pill ${statusClass(snapshot.status)}`}>
          {snapshot.action} · {snapshot.status}
        </span>
      </div>

      <p className="form-note window-note">
        This is an OHLC-derived analytical plan. Live bid/ask spread, slippage, broker contract value and order execution are not verified. Intrabar sequence uncertainty is explicitly rejected instead of guessed.
      </p>

      <div className="trade-primary-grid">
        <article className={`trade-primary-card ${statusClass(snapshot.status)}`}>
          <span>Current plan</span>
          <strong>{snapshot.action}</strong>
          <b>{title(snapshot.status)}</b>
          <small>{snapshot.family ? title(snapshot.family) : "No family"}</small>
        </article>
        <div className="metric"><span>Entry zone</span><strong>{price(snapshot.entryZone?.lower)}–{price(snapshot.entryZone?.upper)}</strong></div>
        <div className="metric"><span>Preferred entry</span><strong>{price(snapshot.entryZone?.preferred)}</strong></div>
        <div className="metric"><span>Actual filled entry</span><strong>{price(snapshot.entryPrice)}</strong></div>
        <div className="metric"><span>Entered at</span><strong>{snapshot.enteredAtMs ? new Date(snapshot.enteredAtMs).toISOString() : "Not filled"}</strong></div>
        <div className="metric"><span>Initial stop</span><strong>{price(snapshot.structuralRisk?.stopLossPrice)}</strong></div>
        <div className="metric"><span>TP1 / R:R</span><strong>{price(tp1?.price)} / {tp1?.riskReward ?? 0}</strong></div>
        <div className="metric"><span>TP2</span><strong>{price(tp2?.price)}</strong></div>
        <div className="metric"><span>Current protective stop</span><strong>{price(snapshot.currentProtectiveStopPrice)}</strong></div>
        <div className="metric"><span>Management action</span><strong>{title(snapshot.managementAction)}</strong></div>
        <div className="metric"><span>Qualification</span><strong>{title(snapshot.executionQualification)}</strong></div>
        <div className="metric"><span>No-chase price</span><strong>{price(snapshot.entryZone?.noChasePrice)}</strong></div>
        <div className="metric"><span>Expiry</span><strong>{snapshot.entryZone ? new Date(snapshot.entryZone.expiresAtMs).toISOString() : "—"}</strong></div>
      </div>

      <div className="trade-detail-grid">
        <article>
          <strong>Structural risk</strong>
          <span>Invalidation: {price(snapshot.structuralRisk?.invalidationPrice)}</span>
          <span>Risk distance: {price(snapshot.structuralRisk?.riskDistance)}</span>
          <span>Execution cost: {price(snapshot.structuralRisk?.estimatedExecutionCost)}</span>
          <span>Planned total risk with costs: {price(snapshot.structuralRisk?.totalRiskWithCosts)}</span>
          <span>Actual risk after fill: {price(snapshot.filledExecution?.actualRiskDistance)}</span>
          <span>Actual total risk with costs: {price(snapshot.filledExecution?.actualTotalRiskWithCosts)}</span>
          <span>Actual TP1 R:R: {snapshot.filledExecution?.actualRiskRewardToTp1 ?? "—"}</span>
          <span>Risk in avg ranges: {snapshot.structuralRisk?.riskInAverageRanges ?? 0}</span>
          <span>Safety buffer: {price(snapshot.structuralRisk?.safetyBuffer)}</span>
        </article>
        <article>
          <strong>Target space</strong>
          <span>Nearest obstacle: {price(snapshot.targetSpace?.nearestObstaclePrice)}</span>
          <span>Obstacle source: {snapshot.targetSpace?.nearestObstacleSource ? title(snapshot.targetSpace.nearestObstacleSource) : "None"}</span>
          <span>Obstacle distance: {price(snapshot.targetSpace?.obstacleDistance)}</span>
          <span>Expected 10M capacity: {price(snapshot.targetSpace?.expected10MinuteCapacity)}</span>
          <span>Limiting factor: {snapshot.targetSpace ? title(snapshot.targetSpace.limitingFactor) : "—"}</span>
          <span>Candidates evaluated: {snapshot.targetSpace?.obstacleCandidatesEvaluated ?? 0}</span>
          <span>Available distance: {price(snapshot.targetSpace?.availableDistance)}</span>
          <span>Available R:R: {snapshot.targetSpace?.availableRiskReward ?? 0}</span>
          <span>TP3: {price(tp3?.price)}</span>
        </article>
        <article>
          <strong>Expected movement</strong>
          <span>5-minute: {price(snapshot.expectedMovement?.expected5MinuteDistance)}</span>
          <span>10-minute: {price(snapshot.expectedMovement?.expected10MinuteDistance)}</span>
          <span>First progress: {snapshot.expectedMovement?.expectedFirstProgressBars ?? 0} bars</span>
          <span>Confidence: {snapshot.expectedMovement?.confidence ?? "—"}</span>
          <span>Spread/slippage: {price(snapshot.executionCosts.totalEstimatedCost)}</span>
        </article>
        <article>
          <strong>Trade health</strong>
          <span>State: {title(snapshot.health)}</span>
          <span>MFE: {price(snapshot.maximumFavourableExcursion)}</span>
          <span>MAE: {price(snapshot.maximumAdverseExcursion)}</span>
          <span>Progress: {snapshot.progressInRiskUnits}R</span>
        </article>
      </div>

      <div className="trade-target-list">
        <strong>{snapshot.executionQualification === "BLOCKED" ? "Calculated target references (plan blocked)" : "Qualified target ladder"}</strong>
        <div className="state-distribution-grid">
          {snapshot.targetSpace?.targets.map((target) => (
            <div key={target.name}>
              <strong>{target.name}</strong>
              <span>Price: {price(target.price)}</span>
              <span>Net R:R: {target.riskReward}</span>
              <span>Source: {title(target.source)}</span>
            </div>
          ))}
        </div>
      </div>

      {snapshot.rejectionReasons.length > 0 ? (
        <div className="signal-warning">
          <strong>Rejection and invalidation reasons</strong>
          <div className="evidence-line">
            {snapshot.rejectionReasons.map((reason) => <i className="negative" key={reason}>{title(reason)}</i>)}
          </div>
        </div>
      ) : null}

      {snapshot.limitations.length > 0 ? (
        <div className="signal-warning">
          <strong>Analytical limitations</strong>
          <div className="evidence-line">
            {snapshot.limitations.map((limitation) => <i key={limitation}>{title(limitation)}</i>)}
          </div>
        </div>
      ) : null}

      <div className="evidence-line trade-reasons">
        {snapshot.reasons.map((reason) => <i key={reason}>+ {title(reason)}</i>)}
      </div>

      <div className="signal-warning">
        <strong>Position sizing deliberately unavailable</strong>
        <p>{snapshot.positionSizing.message}</p>
      </div>

      <details>
        <summary>Full-range Phase 7 statistics</summary>
        <div className="state-distribution-grid">
          <div>
            <strong>Plan qualification</strong>
            <span>Created: {summary.createdPlanCount.toLocaleString()}</span>
            <span>Qualified: {summary.qualifiedPlanCount.toLocaleString()}</span>
            <span>Rejected: {summary.rejectedPlanCount.toLocaleString()}</span>
            <span>Entered: {summary.enteredPlanCount.toLocaleString()}</span>
          </div>
          <div>
            <strong>Outcomes</strong>
            <span>Expired: {summary.expiredPlanCount.toLocaleString()}</span>
            <span>Invalidated: {summary.invalidatedPlanCount.toLocaleString()}</span>
            <span>Ambiguous: {summary.ambiguousPlanCount.toLocaleString()}</span>
            <span>TP1 / TP2 / complete: {summary.tp1HitCount} / {summary.tp2HitCount} / {summary.completedPlanCount}</span>
          </div>
          <div>
            <strong>Averages</strong>
            <span>Risk distance: {summary.averageRiskDistance}</span>
            <span>TP1 R:R: {summary.averageTp1RiskReward}</span>
            <span>Bars to entry: {summary.averageBarsToEntry}</span>
            <span>Execution: candle-data qualification only</span>
          </div>
        </div>
      </details>
    </section>
  );
}
