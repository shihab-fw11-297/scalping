"use client";

import type { AnalysisReport, AnalysisReportSummary } from "@/lib/market/types";

interface AnalysisReportPanelProps {
  analysisId: string;
  summary: AnalysisReportSummary;
  currentReport: AnalysisReport | null;
  collectedReports: readonly AnalysisReport[];
  reportLoading: boolean;
  onDownloadBundle: () => void;
  onClearReports: () => void;
}

function formatPeriod(fromUtc: string, toUtc: string): string {
  const from = new Date(fromUtc);
  const to = new Date(toUtc);
  return `${from.toLocaleString("en-IN")} → ${to.toLocaleString("en-IN")}`;
}

export function AnalysisReportPanel({
  analysisId,
  summary,
  currentReport,
  collectedReports,
  reportLoading,
  onDownloadBundle,
  onClearReports,
}: AnalysisReportPanelProps) {
  const reportParams = new URLSearchParams({ analysisId });
  const jsonUrl = `/api/market/report?${reportParams.toString()}&format=json`;
  const markdownUrl = `/api/market/report?${reportParams.toString()}&format=md`;

  return (
    <section className="panel report-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Automatic complete report</p>
          <h2>Fetch report ready for comparison</h2>
        </div>
        <span className="status-pill">
          {reportLoading ? "Building full report…" : `Collected ${collectedReports.length}/6`}
        </span>
      </div>

      <div className="metric-grid report-metrics">
        <div className="metric"><span>Confirmed signals</span><strong>{summary.signalOverview.confirmed}</strong></div>
        <div className="metric"><span>Continuation signals</span><strong>{summary.signalOverview.continuations}</strong></div>
        <div className="metric"><span>Qualified plans</span><strong>{summary.tradeOverview.qualified}</strong></div>
        <div className="metric"><span>Entries observed</span><strong>{summary.tradeOverview.entered}</strong></div>
        <div className="metric"><span>Qualification rate</span><strong>{summary.observedRates.qualificationRatePercent}%</strong></div>
        <div className="metric"><span>Entry fill rate</span><strong>{summary.observedRates.entryFillRatePercent}%</strong></div>
        <div className="metric"><span>TP1 progress rate</span><strong>{summary.observedRates.tp1ProgressRatePercent}%</strong></div>
        <div className="metric"><span>Intrabar ambiguity</span><strong>{summary.observedRates.intrabarAmbiguityRatePercent}%</strong></div>
      </div>

      <div className="report-layout">
        <div className="report-card">
          <span>Current fetch</span>
          <strong>{formatPeriod(summary.requestedFromUtc, summary.requestedToUtc)}</strong>
          <small>
            {summary.dataQuality.validM1Candles.toLocaleString()} M1 candles · {summary.processingMs.toLocaleString()} ms processing
          </small>
          <div className="actions report-download-actions">
            <a className="button-link" href={jsonUrl}>Download full report JSON</a>
            <a className="button-link" href={markdownUrl}>Download readable report</a>
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
            disabled={collectedReports.length === 0 || reportLoading}
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
                  Signals {report.summary.signalOverview.confirmed + report.summary.signalOverview.continuations} · Plans {report.summary.tradeOverview.created} · Entries {report.summary.tradeOverview.entered} · TP1 {report.summary.tradeOverview.tp1Hit}
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
