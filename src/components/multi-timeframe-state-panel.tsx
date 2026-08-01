import type {
  MultiTimeframeStateSnapshot,
  MultiTimeframeStateSummary,
} from "@/lib/market/types";

function number(value: number | null, digits = 1): string {
  return value === null ? "—" : value.toFixed(digits);
}

function timestamp(value: number | null): string {
  return value === null ? "Unavailable" : new Date(value).toLocaleString();
}

interface Props {
  snapshot: MultiTimeframeStateSnapshot | null;
  summary: MultiTimeframeStateSummary;
}

export function MultiTimeframeStatePanel({ snapshot, summary }: Props) {
  if (!snapshot) {
    return (
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Phase 4</p>
            <h2>Multi-timeframe market state unavailable</h2>
          </div>
        </div>
        <p className="form-note">The selected range does not contain enough closed candles to build a synchronized state.</p>
      </section>
    );
  }

  const layers = [
    {
      label: "1D environment",
      state: snapshot.daily.condition,
      direction: snapshot.daily.direction,
      strength: snapshot.daily.strength,
      detail: `${snapshot.daily.maturity} · range ${number(snapshot.daily.rangePositionPercent)}%`,
      source: timestamp(snapshot.daily.sourceTimestampMs),
    },
    {
      label: "Rolling 5H campaign",
      state: snapshot.rolling5h.stage,
      direction: snapshot.rolling5h.direction,
      strength: snapshot.rolling5h.strength,
      detail: `Efficiency ${number(snapshot.rolling5h.efficiency, 2)} · ${snapshot.rolling5h.candlesPresent} M1 candles`,
      source: timestamp(snapshot.rolling5h.toTimestampMs),
    },
    {
      label: "1H location",
      state: snapshot.hourly.condition,
      direction: snapshot.hourly.direction,
      strength: snapshot.hourly.locationQuality,
      detail: `${snapshot.hourly.zone} · range ${number(snapshot.hourly.rangePositionPercent)}%`,
      source: timestamp(snapshot.hourly.sourceTimestampMs),
    },
    {
      label: "15M narrative",
      state: snapshot.m15.state,
      direction: snapshot.m15.direction,
      strength: snapshot.m15.strength,
      detail: `Pressure ${number(snapshot.m15.pressureScore)}`,
      source: timestamp(snapshot.m15.sourceTimestampMs),
    },
    {
      label: "5M construction",
      state: snapshot.m5.state,
      direction: snapshot.m5.direction,
      strength: snapshot.m5.constructionScore,
      detail: `Freshness ${number(snapshot.m5.freshnessScore)} · late risk ${snapshot.m5.lateEntryRisk}`,
      source: timestamp(snapshot.m5.sourceTimestampMs),
    },
    {
      label: "1M execution context",
      state: snapshot.m1.state,
      direction: snapshot.m1.direction,
      strength: snapshot.m1.intensity,
      detail: `${snapshot.m1.quality} · freshness ${number(snapshot.m1.freshnessScore)}`,
      source: timestamp(snapshot.m1.sourceTimestampMs),
    },
  ];

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Phase 4 · synchronized at {new Date(snapshot.timestampMs).toLocaleString()}</p>
          <h2>Multi-timeframe market state</h2>
        </div>
        <span className="status-pill">
          {snapshot.composite.state} · {snapshot.composite.direction}
        </span>
      </div>

      <div className="state-overview">
        <div className="state-primary">
          <span>Alignment</span>
          <strong>{snapshot.composite.alignment}</strong>
          <small>
            Evidence score {number(snapshot.composite.evidenceScore)} / 100. This is measured coherence, not win probability.
          </small>
        </div>
        <div className="metric">
          <span>Agreeing layers</span>
          <strong>{snapshot.composite.agreementCount}</strong>
        </div>
        <div className="metric">
          <span>Conflicting layers</span>
          <strong>{snapshot.composite.conflictCount}</strong>
        </div>
        <div className="metric">
          <span>Available layers</span>
          <strong>{snapshot.composite.availableLayers}/6</strong>
        </div>
      </div>

      <div className="state-layer-grid">
        {layers.map((layer) => (
          <article className="state-layer-card" key={layer.label}>
            <span>{layer.label}</span>
            <strong>{layer.state}</strong>
            <b>{layer.direction} · {number(layer.strength)}</b>
            <small>{layer.detail}</small>
            <small>{layer.source}</small>
          </article>
        ))}
      </div>

      <details>
        <summary>Full-range Phase 4 distribution</summary>
        <div className="state-distribution-grid">
          <div>
            <strong>Composite states</strong>
            {Object.entries(summary.stateCounts).map(([name, count]) => (
              <span key={name}>{name}: {count.toLocaleString()}</span>
            ))}
          </div>
          <div>
            <strong>Alignment</strong>
            {Object.entries(summary.alignmentCounts).map(([name, count]) => (
              <span key={name}>{name}: {count.toLocaleString()}</span>
            ))}
          </div>
          <div>
            <strong>Direction</strong>
            {Object.entries(summary.directionCounts).map(([name, count]) => (
              <span key={name}>{name}: {count.toLocaleString()}</span>
            ))}
            <span>Average evidence: {number(summary.averageEvidenceScore)}</span>
          </div>
        </div>
      </details>
    </section>
  );
}
