import type {
  SignalDecisionSnapshot,
  SignalDecisionSummary,
  SignalLifecycleState,
} from "@/lib/market/types";

function formatCode(value: string): string {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function lifecycleClass(state: SignalLifecycleState): string {
  if (state === "CONFIRMED" || state === "CONTINUATION") return "signal-confirmed";
  if (state === "ARMED") return "signal-armed";
  if (state === "WATCH") return "signal-watch";
  if (state === "INVALIDATED") return "signal-invalidated";
  if (state === "NO_TRADE") return "signal-no-trade";
  return "signal-observing";
}

export function SignalDecisionPanel({
  snapshot,
  summary,
}: {
  snapshot: SignalDecisionSnapshot | null;
  summary: SignalDecisionSummary;
}) {
  if (!snapshot) {
    return (
      <section className="panel">
        <p className="eyebrow">Phase 6 · Signal lifecycle</p>
        <h2>Insufficient closed M1 data</h2>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Phase 6 · Pattern research lifecycle</p>
          <h2>Pattern confirmation engine</h2>
        </div>
        <span className={`status-pill ${lifecycleClass(snapshot.lifecycle)}`}>
          Pattern {snapshot.lifecycle} · {snapshot.action}
        </span>
      </div>

      <p className="form-note window-note">
        CONFIRMED and CONTINUATION mean pattern-confirmed research events, not trade-ready BUY/SELL calls. Only a deduplicated Grade A/B Phase 7 plan becomes a trading-view signal.
      </p>

      <div className="signal-primary-grid">
        <article className={`signal-primary-card ${lifecycleClass(snapshot.lifecycle)}`}>
          <span>Current pattern lifecycle</span>
          <strong>{snapshot.lifecycle}</strong>
          <b>{snapshot.action === "NONE" ? "No direction" : `${snapshot.action} pattern`}</b>
          <small>{new Date(snapshot.timestampMs).toISOString()}</small>
        </article>
        <div className="metric">
          <span>Primary family</span>
          <strong>{snapshot.primaryTrack ? formatCode(snapshot.primaryTrack.family) : "None"}</strong>
        </div>
        <div className="metric">
          <span>Candidate score</span>
          <strong>{snapshot.primaryTrack?.candidateScore ?? 0}</strong>
        </div>
        <div className="metric">
          <span>Active / actionable tracks</span>
          <strong>{snapshot.activeTrackCount} / {snapshot.actionableTrackCount}</strong>
        </div>
      </div>

      {snapshot.noTradeReasons.length > 0 ? (
        <div className="signal-warning">
          <strong>Current no-trade controls</strong>
          <div className="evidence-line">
            {snapshot.noTradeReasons.map((reason) => (
              <i className="negative" key={reason}>{formatCode(reason)}</i>
            ))}
          </div>
        </div>
      ) : null}

      <div className="signal-track-grid">
        {snapshot.tracks.map((track) => (
          <article className={`signal-track-card ${lifecycleClass(track.lifecycle)}`} key={track.family}>
            <div>
              <span>{formatCode(track.family)}</span>
              <strong>{track.direction} · {track.lifecycle}</strong>
            </div>
            <b>{track.action}</b>
            <small>
              Stage {formatCode(track.candidateStage)} · score {track.candidateScore} · hypothesis {track.hypothesisScore} · age {track.ageBars} bars
            </small>
            <small>
              Started {track.startedAtMs ? new Date(track.startedAtMs).toISOString() : "—"}<br />
              Armed {track.armedAtMs ? new Date(track.armedAtMs).toISOString() : "—"}<br />
              Confirmed {track.confirmedAtMs ? new Date(track.confirmedAtMs).toISOString() : "—"}
            </small>
            <div className="evidence-line">
              {track.reasons.slice(0, 6).map((reason) => <i key={reason}>+ {formatCode(reason)}</i>)}
              {track.noTradeReasons.slice(0, 4).map((reason) => <i className="negative" key={reason}>− {formatCode(reason)}</i>)}
            </div>
          </article>
        ))}
      </div>

      {summary.recentEvents.length > 0 ? (
        <div className="signal-recent-events">
          <strong>Most recent decision events</strong>
          <div className="signal-event-list">
            {summary.recentEvents.slice(-10).reverse().map((event) => (
              <div key={`${event.episodeId}:${event.timestampMs}:${event.lifecycle}`}>
                <span>{new Date(event.timestampMs).toISOString()}</span>
                <b>{formatCode(event.family)} · {event.direction} · {event.lifecycle}</b>
                <small>{event.action} · score {event.score} · reference {event.referencePrice.toFixed(2)}</small>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <details>
        <summary>Full-range Phase 6 lifecycle statistics</summary>
        <div className="state-distribution-grid">
          <div>
            <strong>Lifecycle samples</strong>
            {Object.entries(summary.lifecycleCounts).map(([name, count]) => (
              <span key={name}>{formatCode(name)}: {count.toLocaleString()}</span>
            ))}
          </div>
          <div>
            <strong>Decision events</strong>
            <span>Confirmed: {summary.confirmedSignalCount.toLocaleString()}</span>
            <span>Continuation: {summary.continuationSignalCount.toLocaleString()}</span>
            <span>Invalidated: {summary.invalidationCount.toLocaleString()}</span>
            <span>Duplicates suppressed: {summary.duplicateSuppressedCount.toLocaleString()}</span>
            <span>Expired candidates: {summary.expiredCandidateCount.toLocaleString()}</span>
          </div>
          <div>
            <strong>Transition speed</strong>
            <span>Armed episodes: {summary.armedEpisodeCount.toLocaleString()}</span>
            <span>Watch → Armed: {summary.averageWatchToArmedBars} bars</span>
            <span>Armed → Confirmed: {summary.averageArmedToConfirmedBars} bars</span>
            <span>BUY lifecycle samples: {summary.actionCounts.BUY.toLocaleString()}</span>
            <span>SELL lifecycle samples: {summary.actionCounts.SELL.toLocaleString()}</span>
          </div>
        </div>
      </details>
    </section>
  );
}
