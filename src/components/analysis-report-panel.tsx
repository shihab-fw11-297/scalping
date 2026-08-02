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
                  A/B {report.summary.tradeOverview.tradeReadySignals} · A {report.summary.tradeOverview.gradeA} · B {report.summary.tradeOverview.gradeB} · Entries {report.summary.tradeOverview.entered} · TP1 {report.summary.tradeOverview.tp1Hit}
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
