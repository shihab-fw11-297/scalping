import type {
  HypothesisOpportunitySnapshot,
  HypothesisOpportunitySummary,
  OpportunityCandidate,
} from "@/lib/market/types";

interface Props {
  snapshot: HypothesisOpportunitySnapshot | null;
  summary: HypothesisOpportunitySummary;
}

function score(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : "—";
}

function formatCode(value: string): string {
  return value.replaceAll("_", " ");
}

function opportunityClass(item: OpportunityCandidate): string {
  if (item.stage === "MATURE_CANDIDATE") return "opportunity-mature";
  if (item.stage === "DEVELOPING") return "opportunity-developing";
  if (item.stage === "DEGRADED") return "opportunity-degraded";
  return "";
}

export function HypothesisOpportunityPanel({ snapshot, summary }: Props) {
  if (!snapshot) {
    return (
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Phase 5</p>
            <h2>Hypothesis and opportunity engine</h2>
          </div>
          <span className="status-pill">Insufficient closed M1 history</span>
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Phase 5 · Evidence ranking</p>
          <h2>Competing hypotheses and opportunity families</h2>
        </div>
        <span className="status-pill">
          {snapshot.opportunityAvailability} · {new Date(snapshot.timestampMs).toISOString()}
        </span>
      </div>

      <p className="form-note window-note">
        These scores rank measured evidence only. They are not probabilities, entries, BUY/SELL signals, or execution permission.
      </p>

      <div className="hypothesis-grid">
        {snapshot.hypotheses.map((item) => (
          <article className={`hypothesis-card hypothesis-${item.state.toLowerCase()}`} key={item.direction}>
            <span>{item.direction} hypothesis</span>
            <strong>{score(item.score)}</strong>
            <b>{item.state}</b>
            <small>Support {score(item.supportScore)} · contradiction {score(item.contradictionScore)}</small>
            <div className="evidence-line">
              {item.support.slice(0, 4).map((code) => <i key={code}>+ {formatCode(code)}</i>)}
              {item.contradictions.slice(0, 3).map((code) => <i className="negative" key={code}>− {formatCode(code)}</i>)}
            </div>
          </article>
        ))}
      </div>

      <div className="metric-grid phase5-metrics">
        <div className="metric">
          <span>Leading hypothesis</span>
          <strong>{snapshot.leadingHypothesis}</strong>
        </div>
        <div className="metric">
          <span>Leading evidence score</span>
          <strong>{score(snapshot.leadingHypothesisScore)}</strong>
        </div>
        <div className="metric">
          <span>Mature candidates in full range</span>
          <strong>{summary.matureCandidateCount.toLocaleString()}</strong>
        </div>
        <div className="metric">
          <span>Average best opportunity</span>
          <strong>{score(summary.averageBestOpportunityScore)}</strong>
        </div>
      </div>

      <div className="opportunity-grid">
        {snapshot.opportunities.map((item) => (
          <article className={`opportunity-card ${opportunityClass(item)}`} key={item.family}>
            <div>
              <span>{formatCode(item.family)}</span>
              <strong>{item.direction} · {item.stage}</strong>
            </div>
            <b>{score(item.score)}</b>
            <small>
              Context {score(item.contextScore)} · development {score(item.developmentScore)} · trigger {score(item.triggerScore)} · freshness {score(item.freshnessScore)}
            </small>
            <div className="evidence-line">
              {item.evidence.slice(0, 5).map((code) => <i key={code}>+ {formatCode(code)}</i>)}
              {item.blockers.slice(0, 4).map((code) => <i className="negative" key={code}>− {formatCode(code)}</i>)}
            </div>
          </article>
        ))}
      </div>

      <details>
        <summary>Full-range Phase 5 distribution</summary>
        <div className="state-distribution-grid">
          <div>
            <strong>Leading hypotheses</strong>
            {Object.entries(summary.leadingHypothesisCounts).map(([name, count]) => (
              <span key={name}>{name}: {count.toLocaleString()}</span>
            ))}
          </div>
          <div>
            <strong>Opportunity stages</strong>
            {Object.entries(summary.opportunityStageCounts).map(([name, count]) => (
              <span key={name}>{name}: {count.toLocaleString()}</span>
            ))}
          </div>
          <div>
            <strong>Opportunity families observed</strong>
            {Object.entries(summary.opportunityFamilyCounts).map(([name, count]) => (
              <span key={name}>{formatCode(name)}: {count.toLocaleString()}</span>
            ))}
            <span>Average leading score: {score(summary.averageLeadingHypothesisScore)}</span>
          </div>
        </div>
      </details>
    </section>
  );
}
