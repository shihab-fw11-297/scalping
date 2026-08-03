"use client";

import type { AnalysisReport, AnalysisReportSummary } from "@/lib/market/types";

interface AnalysisReportPanelProps {
  summary: AnalysisReportSummary;
  currentReport: AnalysisReport | null;
  collectedReports: readonly AnalysisReport[];
  onDownloadBundle: () => void;
  onDownloadCurrentReport: (format: "json" | "md") => void;
  onClearReports: () => void;
}

function formatPeriod(fromUtc: string, toUtc: string): string {
  const from = new Date(fromUtc);
  const to = new Date(toUtc);
  return `${from.toLocaleString("en-IN")} → ${to.toLocaleString("en-IN")}`;
}

export function AnalysisReportPanel({
  summary,
  currentReport,
  collectedReports,
  onDownloadBundle,
  onDownloadCurrentReport,
  onClearReports,
}: AnalysisReportPanelProps) {
  return (
    <section className="panel report-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Automatic complete report</p>
          <h2>Fetch report ready for comparison</h2>
        </div>
        <span className="status-pill">
          {currentReport ? `Report ready · collected ${collectedReports.length}/6` : "Report unavailable"}
        </span>
      </div>

      <div className="metric-grid report-metrics">
        <div className="metric"><span>Trade-ready A/B</span><strong>{summary.tradeOverview.tradeReadySignals}</strong></div>
        <div className="metric"><span>Grade A / B</span><strong>{summary.tradeOverview.gradeA} / {summary.tradeOverview.gradeB}</strong></div>
        <div className="metric"><span>Pattern confirms</span><strong>{summary.signalOverview.confirmed + summary.signalOverview.continuations}</strong></div>
        <div className="metric"><span>Duplicate episodes hidden</span><strong>{summary.tradeOverview.duplicateEpisodesSuppressed}</strong></div>
        <div className="metric"><span>Average quality</span><strong>{summary.tradeOverview.averageQualityScore}</strong></div>
        <div className="metric"><span>Entries observed</span><strong>{summary.tradeOverview.entered}</strong></div>
        <div className="metric"><span>TP1 progress rate</span><strong>{summary.observedRates.tp1ProgressRatePercent}%</strong></div>
        <div className="metric"><span>Intrabar ambiguity</span><strong>{summary.observedRates.intrabarAmbiguityRatePercent}%</strong></div>
      </div>

      {currentReport ? (
        <div className="metric-grid report-metrics phase10-metrics">
          <div className="metric"><span>Data integrity</span><strong>{currentReport.phase10.dataIntegrityGrade}</strong></div>
          <div className="metric"><span>QML engine ready</span><strong>{currentReport.phase10.qmlDataReady ? "YES" : "NO"}</strong></div>
          <div className="metric"><span>Analytical realized R</span><strong>{currentReport.phase10.aggregateRealizedR}</strong></div>
          <div className="metric"><span>Profit factor R</span><strong>{currentReport.phase10.profitFactorR ?? "N/A"}</strong></div>
          <div className="metric"><span>Conservative win rate</span><strong>{currentReport.phase10.ambiguityPolicies.CONSERVATIVE.winRatePercent ?? "N/A"}%</strong></div>
          <div className="metric"><span>Shadow rules tracked</span><strong>{currentReport.phase10.rejectionRules.length}</strong></div>
        </div>
      ) : null}

      {currentReport ? (
        <div className="metric-grid report-metrics phase10-metrics">
          <div className="metric"><span>Native M1 signals</span><strong>{currentReport.phase12.timeframeSummaries.M1.generated}</strong></div>
          <div className="metric"><span>Native M5 signals</span><strong>{currentReport.phase12.timeframeSummaries.M5.generated}</strong></div>
          <div className="metric"><span>Native M15 signals</span><strong>{currentReport.phase12.timeframeSummaries.M15.generated}</strong></div>
          <div className="metric"><span>MTF paper signals</span><strong>{currentReport.phase12.totalTradeReady}</strong></div>
          <div className="metric"><span>QML context ready</span><strong>{currentReport.phase12.qmlReadinessFixed ? "YES" : "NO"}</strong></div>
          <div className="metric"><span>D1 usable warm-up</span><strong>{currentReport.phase12.qmlReadinessDiagnostics.d1UsableClosed}/{currentReport.phase12.qmlReadinessDiagnostics.minimumRequiredD1}</strong></div>
          <div className="metric"><span>H1 usable warm-up</span><strong>{currentReport.phase12.qmlReadinessDiagnostics.h1UsableClosed}/{currentReport.phase12.qmlReadinessDiagnostics.minimumRequiredH1}</strong></div>
          <div className="metric"><span>Architecture</span><strong>M1 + M5 + M15</strong></div>
        </div>
      ) : null}

      {currentReport ? (
        <div className="metric-grid report-metrics phase10-metrics">
          <div className="metric"><span>Scalping audit score</span><strong>{currentReport.phase11.systemScore}/100</strong></div>
          <div className="metric"><span>System verdict</span><strong>{currentReport.phase11.systemVerdict}</strong></div>
          <div className="metric"><span>Technical A / B</span><strong>{currentReport.phase11.auditCounts.A} / {currentReport.phase11.auditCounts.B}</strong></div>
          <div className="metric"><span>Paper-trade signals</span><strong>{currentReport.phase11.permissionCounts.PAPER_TRADE}</strong></div>
          <div className="metric"><span>Forward resolved</span><strong>{currentReport.phase11.forwardValidation.forward.resolved}</strong></div>
          <div className="metric"><span>Forward expectancy</span><strong>{currentReport.phase11.forwardValidation.forward.expectancyR ?? "N/A"}R</strong></div>
          <div className="metric"><span>Maximum drawdown</span><strong>{currentReport.phase11.overallPerformance.maximumDrawdownR}R</strong></div>
          <div className="metric"><span>Live gates</span><strong>{currentReport.phase11.gates.filter((gate) => gate.requiredForLive && gate.passed).length}/{currentReport.phase11.gates.filter((gate) => gate.requiredForLive).length}</strong></div>
        </div>
      ) : null}

      <div className="report-layout">
        <div className="report-card">
          <span>Current fetch</span>
          <strong>{formatPeriod(summary.requestedFromUtc, summary.requestedToUtc)}</strong>
          <small>
            {summary.dataQuality.validM1Candles.toLocaleString()} visible M1 · {summary.dataQuality.warmupM1Candles.toLocaleString()} warm-up · {summary.processingMs.toLocaleString()} ms
          </small>
          <div className="actions report-download-actions">
            <button
              type="button"
              className="button-link"
              disabled={!currentReport}
              onClick={() => onDownloadCurrentReport("json")}
            >
              Download full report JSON
            </button>
            <button
              type="button"
              className="button-link"
              disabled={!currentReport}
              onClick={() => onDownloadCurrentReport("md")}
            >
              Download readable report
            </button>
          </div>
          <small>
            JSON contains every signal event, every Phase 7 plan, engine settings, MFE/MAE, rejection reasons and family breakdown.
          </small>
        </div>

        <div className="report-card">
          <span>Latest context</span>
          <strong>{summary.latestContext.signalAction} · {summary.latestContext.signalLifecycle}</strong>
          <small>
            {summary.latestContext.compositeMarketState} / {summary.latestContext.compositeDirection} · {summary.latestContext.leadingHypothesis} hypothesis
          </small>
          <small>
            Trade plan: {summary.latestContext.tradePlanAction} / {summary.latestContext.tradePlanStatus}
          </small>
        </div>
      </div>

      <details open>
        <summary>Key report findings</summary>
        <div className="report-findings">
          {summary.keyFindings.map((finding) => <p key={finding}>{finding}</p>)}
        </div>
      </details>

      <details>
        <summary>Diagnostic flags</summary>
        <div className="evidence-line report-flags">
          {summary.diagnosticFlags.map((flag) => <i key={flag}>{flag}</i>)}
          {summary.dataQuality.qualityFlags.map((flag) => <i key={flag}>{flag}</i>)}
        </div>
      </details>

      {currentReport ? (
        <details open>
          <summary>Phase 12 native multi-timeframe engines</summary>
          <div className="report-findings">
            <p>Architecture: native M1, M5 and M15 signal origins. H1 and D1 remain context layers.</p>
            {(["M1", "M5", "M15"] as const).map((origin) => {
              const item = currentReport.phase12.timeframeSummaries[origin];
              return <p key={origin}>{origin}: {item.generated} generated · A/B {item.gradeA}/{item.gradeB} · paper {item.paperTrade} · research {item.researchOnly} · blocked {item.blocked} · expectancy {item.expectancyR ?? "N/A"}R.</p>;
            })}
            <p>QML readiness: D1 usable {currentReport.phase12.qmlReadinessDiagnostics.d1UsableClosed}/{currentReport.phase12.qmlReadinessDiagnostics.minimumRequiredD1} · H1 usable {currentReport.phase12.qmlReadinessDiagnostics.h1UsableClosed}/{currentReport.phase12.qmlReadinessDiagnostics.minimumRequiredH1}.</p>
            {currentReport.phase12.diagnostics.map((item) => <p key={item}>{item}</p>)}
          </div>
        </details>
      ) : null}

      {currentReport ? (
        <details open>
          <summary>Phase 11 professional scalping audit</summary>
          <div className="report-findings">
            <p>Verdict: {currentReport.phase11.systemVerdict} · audit score {currentReport.phase11.systemScore}/100 · live ready {currentReport.phase11.liveReady ? "YES" : "NO"}.</p>
            <p>Technical signals: A {currentReport.phase11.auditCounts.A} · B {currentReport.phase11.auditCounts.B} · C {currentReport.phase11.auditCounts.C} · blocked {currentReport.phase11.auditCounts.BLOCKED}.</p>
            <p>Clean resolved outcomes: {currentReport.phase11.overallPerformance.resolved} · expectancy {currentReport.phase11.overallPerformance.expectancyR ?? "N/A"}R · PF {currentReport.phase11.overallPerformance.profitFactorR ?? "N/A"} · max drawdown {currentReport.phase11.overallPerformance.maximumDrawdownR}R.</p>
            <p>Chronological forward holdout: {currentReport.phase11.forwardValidation.forward.resolved} resolved · expectancy {currentReport.phase11.forwardValidation.forward.expectancyR ?? "N/A"}R · positive {currentReport.phase11.forwardValidation.positive ? "YES" : "NO"}.</p>
            {currentReport.phase11.gates.map((gate) => (
              <p key={gate.code}>{gate.passed ? "PASS" : "FAIL"} · {gate.code} · current {String(gate.current ?? "N/A")} · required {gate.required}</p>
            ))}
          </div>
        </details>
      ) : null}

      {currentReport ? (
        <details>
          <summary>Phase 11 strategy, session and regime evidence</summary>
          <div className="report-findings">
            {currentReport.phase11.familyPerformance.map((item) => (
              <p key={`family-${item.key}`}>{item.key}: {item.resolved} resolved · expectancy {item.expectancyR ?? "N/A"}R · PF {item.profitFactorR ?? "N/A"} · max DD {item.maximumDrawdownR}R.</p>
            ))}
            {currentReport.phase11.sessionPerformance.filter((item) => item.plans > 0).map((item) => (
              <p key={`session-${item.key}`}>{item.key}: {item.resolved} resolved · expectancy {item.expectancyR ?? "N/A"}R · win rate {item.winRatePercent ?? "N/A"}%.</p>
            ))}
            {currentReport.phase11.regimePerformance.filter((item) => item.plans > 0).map((item) => (
              <p key={`regime-${item.key}`}>{item.key}: {item.resolved} resolved · expectancy {item.expectancyR ?? "N/A"}R · PF {item.profitFactorR ?? "N/A"}.</p>
            ))}
          </div>
        </details>
      ) : null}

      {currentReport ? (
        <details>
          <summary>Phase 10 score and rejection calibration</summary>
          <div className="report-findings">
            {currentReport.phase10.scoreBuckets.map((bucket) => (
              <p key={bucket.bucket}>
                Score {bucket.bucket}: {bucket.plans} plans · {bucket.entries} entries · {bucket.resolved} resolved · win rate {bucket.winRatePercent ?? "N/A"}% · avg R {bucket.averageRealizedR ?? "N/A"}
              </p>
            ))}
            {currentReport.phase10.rejectionRules.slice(0, 8).map((rule) => (
              <p key={rule.code}>
                {rule.code}: {rule.rejectedPlans} rejected · {rule.lossesAvoided} losses avoided · {rule.winnersMissed} winners missed · {rule.noFill} no-fill
              </p>
            ))}
          </div>
        </details>
      ) : null}

      <div className="report-collection">
        <div>
          <strong>Session report collection</strong>
          <span>
            Fetch 5–6 different periods. Full reports are kept in this browser tab and can be exported as one comparison bundle.
          </span>
        </div>
        <div className="actions report-collection-actions">
          <button
            type="button"
            className="secondary"
            disabled={collectedReports.length === 0}
            onClick={onDownloadBundle}
          >
            Download {collectedReports.length}-report bundle
          </button>
          <button
            type="button"
            className="secondary"
            disabled={collectedReports.length === 0}
            onClick={onClearReports}
          >
            Clear reports
          </button>
        </div>
      </div>

      {collectedReports.length > 0 ? (
        <div className="report-list">
          {collectedReports.map((report, index) => (
            <div className="report-list-item" key={report.analysisId}>
              <b>#{index + 1}</b>
              <div>
                <strong>{formatPeriod(report.summary.requestedFromUtc, report.summary.requestedToUtc)}</strong>
                <span>
                  Audit {report.phase11.systemScore}/100 · {report.phase11.systemVerdict} · M1/M5/M15 {report.phase12.timeframeSummaries.M1.generated}/{report.phase12.timeframeSummaries.M5.generated}/{report.phase12.timeframeSummaries.M15.generated} · Entries {report.summary.tradeOverview.entered} · TP1 {report.summary.tradeOverview.tp1Hit}
                </span>
              </div>
              <small>{report.analysisId.slice(0, 8)}</small>
            </div>
          ))}
        </div>
      ) : null}

      <p className="form-note">
        Report rates are observed historical counts, not win-rate or profitability proof. Keep the JSON bundle unchanged when sharing it for threshold and behaviour review.
      </p>
      {currentReport ? <span className="complete report-ready">Full report loaded: {currentReport.signalEvents.length.toLocaleString()} signal events and {currentReport.tradePlans.length.toLocaleString()} trade plans.</span> : null}
    </section>
  );
}
