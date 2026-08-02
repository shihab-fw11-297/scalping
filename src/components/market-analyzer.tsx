"use client";

import { useMemo, useRef, useState } from "react";
import { BehaviourSummaryPanel } from "./behaviour-summary";
import { DataTable } from "./data-table";
import { MarketChart } from "./market-chart";
import { QualityPanel } from "./quality-panel";
import { PriceBehaviourSummaryPanel } from "./price-behaviour-summary";
import { MultiTimeframeStatePanel } from "./multi-timeframe-state-panel";
import { HypothesisOpportunityPanel } from "./hypothesis-opportunity-panel";
import { SignalDecisionPanel } from "./signal-decision-panel";
import { TradeManagementPanel } from "./trade-management-panel";
import { AnalysisReportPanel } from "./analysis-report-panel";
import type {
  AnalysisReport,
  AnalysisReportBundle,
  AnalyzeMarketResponse,
  MarketWindowResponse,
  Timeframe,
} from "@/lib/market/types";

const TIMEFRAMES: Timeframe[] = ["M1", "M5", "M15", "H1", "D1"];
const WINDOW_SIZES = [500, 1_000, 2_000, 5_000] as const;

function windowCacheKey(timeframe: Timeframe, offset: number, limit: number): string {
  return `${timeframe}:${Math.max(0, offset)}:${limit}`;
}

function addRecoveryParams(
  params: URLSearchParams,
  recovery: AnalyzeMarketResponse["recoveryRequest"],
): void {
  params.set("recoveryFromUtc", recovery.fromUtc);
  params.set("recoveryToUtc", recovery.toUtc);
  params.set("recoverySpread", String(recovery.assumedSpreadPrice));
  params.set("recoverySlippage", String(recovery.assumedSlippagePrice));
  params.set("recoveryMinimumRiskReward", String(recovery.minimumRiskReward));
  params.set("recoveryMaximumRiskRanges", String(recovery.maximumRiskInAverageRanges));
}

function downloadBlob(content: string, mimeType: string, filename: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function createReadableReport(report: AnalysisReport): string {
  const summary = report.summary;
  const familyRows = Object.entries(report.familyBreakdown).map(([family, item]) =>
    `| ${family} | ${item.confirmedSignals} | ${item.gradeA} | ${item.gradeB} | ${item.tradeReady} | ${item.entriesObserved} | ${item.tp1Hit} |`,
  );
  return [
    "# XAUUSD Analysis Report",
    "",
    `- Analysis ID: \`${report.analysisId}\``,
    `- Period: ${summary.requestedFromUtc} to ${summary.requestedToUtc}`,
    `- Visible M1 candles: ${summary.dataQuality.validM1Candles}`,
    `- Warm-up M1 candles: ${summary.dataQuality.warmupM1Candles}`,
    `- Closed/stale candles removed: ${summary.dataQuality.closedMarketCandlesRemoved}/${summary.dataQuality.staleCandlesRemoved}`,
    `- Pattern confirmations: ${summary.signalOverview.confirmed + summary.signalOverview.continuations}`,
    `- Trade-ready A/B signals: ${summary.tradeOverview.tradeReadySignals}`,
    `- Grade A / B / C: ${summary.tradeOverview.gradeA} / ${summary.tradeOverview.gradeB} / ${summary.tradeOverview.gradeC}`,
    `- Average trade quality: ${summary.tradeOverview.averageQualityScore}`,
    `- Duplicate episodes suppressed: ${summary.tradeOverview.duplicateEpisodesSuppressed}`,
    `- Qualified plans: ${summary.tradeOverview.qualified}`,
    `- Entries observed: ${summary.tradeOverview.entered}`,
    `- TP1 hit: ${summary.tradeOverview.tp1Hit}`,
    `- Completed: ${summary.tradeOverview.completed}`,
    "",
    "## Observed rates",
    "",
    `- Qualification: ${summary.observedRates.qualificationRatePercent}%`,
    `- Entry fill: ${summary.observedRates.entryFillRatePercent}%`,
    `- TP1 progress: ${summary.observedRates.tp1ProgressRatePercent}%`,
    `- Completion: ${summary.observedRates.completionRatePercent}%`,
    "",
    "## Family breakdown",
    "",
    "| Family | Confirmed | Grade A | Grade B | Trade-ready | Entries | TP1 |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...familyRows,
    "",
    "## Key findings",
    "",
    ...summary.keyFindings.map((item) => `- ${item}`),
    "",
    `The JSON report contains ${report.signalEvents.length} signal events and ${report.tradePlans.length} trade plans.`,
  ].join("\n");
}

function toLocalInputValue(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function defaultDates(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { from: toLocalInputValue(from), to: toLocalInputValue(to) };
}

async function readError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: unknown };
    return typeof data.error === "string" ? data.error : "Request failed.";
  } catch {
    return `Request failed with status ${response.status}.`;
  }
}

export function MarketAnalyzer() {
  const initial = useMemo(defaultDates, []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [result, setResult] = useState<AnalyzeMarketResponse | null>(null);
  const [windowData, setWindowData] = useState<MarketWindowResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingWindow, setLoadingWindow] = useState(false);
  const [timeframe, setTimeframe] = useState<Timeframe>("M5");
  const [requestedTimeframe, setRequestedTimeframe] = useState<Timeframe | null>(null);
  const [windowSize, setWindowSize] = useState<number>(2_000);
  const [pendingOffset, setPendingOffset] = useState(0);
  const [assumedSpreadPrice, setAssumedSpreadPrice] = useState(0.25);
  const [assumedSlippagePrice, setAssumedSlippagePrice] = useState(0.1);
  const [minimumRiskReward, setMinimumRiskReward] = useState(1.5);
  const [maximumRiskInAverageRanges, setMaximumRiskInAverageRanges] = useState(3.5);
  const [currentReport, setCurrentReport] = useState<AnalysisReport | null>(null);
  const [collectedReports, setCollectedReports] = useState<AnalysisReport[]>([]);
  const [windowCache, setWindowCache] = useState<Record<string, MarketWindowResponse>>({});
  const [showGradeA, setShowGradeA] = useState(true);
  const [showGradeB, setShowGradeB] = useState(true);
  const [showResearchSignals, setShowResearchSignals] = useState(false);
  const [showInvalidations, setShowInvalidations] = useState(false);
  const [showTradeLevels, setShowTradeLevels] = useState(true);
  const windowRequestSequence = useRef(0);

  const total = result?.timeframes[timeframe].candleCount ?? 0;
  const availableWindowSizes = WINDOW_SIZES.filter((size) => size <= (result?.meta.maxWindowCandles ?? 5_000));
  const maximumOffset = Math.max(0, total - windowSize);
  const safePendingOffset = Math.min(maximumOffset, pendingOffset);
  function downloadReportBundle(): void {
    if (collectedReports.length === 0) return;
    const bundle: AnalysisReportBundle = {
      bundleVersion: "1.0",
      exportedAtUtc: new Date().toISOString(),
      reportCount: collectedReports.length,
      reports: collectedReports,
    };
    downloadBlob(
      JSON.stringify(bundle, null, 2),
      "application/json",
      `xauusd-analysis-bundle-${collectedReports.length}-reports.json`,
    );
  }

  function downloadCurrentReport(format: "json" | "md"): void {
    if (!currentReport) return;
    const period = currentReport.summary.requestedFromUtc.slice(0, 10);
    if (format === "json") {
      downloadBlob(
        JSON.stringify(currentReport, null, 2),
        "application/json",
        `xauusd-report-${period}.json`,
      );
      return;
    }
    downloadBlob(
      createReadableReport(currentReport),
      "text/markdown;charset=utf-8",
      `xauusd-report-${period}.md`,
    );
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const fromDate = new Date(from);
      const toDate = new Date(to);
      if (!Number.isFinite(fromDate.getTime()) || !Number.isFinite(toDate.getTime())) {
        throw new Error("Please select valid start and end times.");
      }
      if (toDate <= fromDate) throw new Error("End time must be later than start time.");

      const response = await fetch("/api/market/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromUtc: fromDate.toISOString(),
          toUtc: toDate.toISOString(),
          assumedSpreadPrice,
          assumedSlippagePrice,
          minimumRiskReward,
          maximumRiskInAverageRanges,
        }),
      });
      if (!response.ok) throw new Error(await readError(response));

      const parsed = (await response.json()) as AnalyzeMarketResponse;
      setResult(parsed);
      setWindowData(parsed.initialWindow);
      setTimeframe(parsed.initialWindow.timeframe);
      setWindowSize(parsed.initialWindow.limit);
      setPendingOffset(parsed.initialWindow.offset);
      setCurrentReport(parsed.completeReport);
      setCollectedReports((previous) => {
        const withoutDuplicate = previous.filter((item) => item.analysisId !== parsed.completeReport.analysisId);
        return [...withoutDuplicate, parsed.completeReport].slice(-6);
      });
      setWindowCache({
        [windowCacheKey(
          parsed.initialWindow.timeframe,
          parsed.initialWindow.offset,
          parsed.initialWindow.limit,
        )]: parsed.initialWindow,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unexpected error.");
    } finally {
      setLoading(false);
    }
  }

  async function loadWindow(
    nextTimeframe: Timeframe,
    nextOffset: number,
    nextLimit: number,
  ): Promise<void> {
    if (!result) return;
    const requestedOffset = Math.max(0, nextOffset);
    const key = windowCacheKey(nextTimeframe, requestedOffset, nextLimit);
    const cachedWindow = windowCache[key];
    if (cachedWindow) {
      setWindowData(cachedWindow);
      setTimeframe(nextTimeframe);
      setWindowSize(cachedWindow.limit);
      setPendingOffset(cachedWindow.offset);
      setError(null);
      setRequestedTimeframe(null);
      return;
    }

    const requestSequence = ++windowRequestSequence.current;
    setRequestedTimeframe(nextTimeframe);
    setLoadingWindow(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        analysisId: result.analysisId,
        timeframe: nextTimeframe,
        offset: String(requestedOffset),
        limit: String(nextLimit),
      });
      addRecoveryParams(params, result.recoveryRequest);
      const response = await fetch(`/api/market/window?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await readError(response));
      const next = (await response.json()) as MarketWindowResponse;
      if (requestSequence !== windowRequestSequence.current) return;
      setWindowData(next);
      setTimeframe(nextTimeframe);
      setWindowSize(next.limit);
      setPendingOffset(next.offset);
      setWindowCache((previous) => ({
        ...previous,
        [windowCacheKey(nextTimeframe, next.offset, next.limit)]: next,
      }));
    } catch (caught) {
      if (requestSequence !== windowRequestSequence.current) return;
      setError(caught instanceof Error ? caught.message : "Could not load chart window.");
    } finally {
      if (requestSequence === windowRequestSequence.current) {
        setLoadingWindow(false);
        setRequestedTimeframe(null);
      }
    }
  }

  function selectTimeframe(next: Timeframe): void {
    if (!result) return;
    const nextTotal = result.timeframes[next].candleCount;
    const nextLimit = windowSize;
    const latestOffset = Math.max(0, nextTotal - nextLimit);
    void loadWindow(next, latestOffset, nextLimit);
  }

  function changeWindowSize(next: number): void {
    if (!result) return;
    const nextTotal = result.timeframes[timeframe].candleCount;
    const nextLimit = next;
    const latestOffset = Math.max(0, nextTotal - nextLimit);
    void loadWindow(timeframe, latestOffset, nextLimit);
  }

  function exportUrl(format: "csv" | "json"): string {
    if (!result) return "#";
    const params = new URLSearchParams({
      analysisId: result.analysisId,
      timeframe,
      format,
    });
    addRecoveryParams(params, result.recoveryRequest);
    return `/api/market/export?${params}`;
  }


  function tradeExportUrl(format: "csv" | "json"): string {
    if (!result) return "#";
    const params = new URLSearchParams({
      analysisId: result.analysisId,
      format,
    });
    addRecoveryParams(params, result.recoveryRequest);
    return `/api/market/trades/export?${params}`;
  }
  return (
    <div className="workspace">
      <section className="panel input-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">One-click analysis</p>
            <h2>Fetch and measure historical candles</h2>
          </div>
          <span className="status-pill">Up to 100K valid M1 candles</span>
        </div>

        <form onSubmit={submit} className="analysis-form">
          <label>
            Symbol
            <input value="XAUUSD" disabled />
          </label>
          <label>
            Start date and time
            <input type="datetime-local" value={from} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setFrom(event.target.value)} required />
          </label>
          <label>
            End date and time
            <input type="datetime-local" value={to} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setTo(event.target.value)} required />
          </label>
          <label>
            Assumed spread ($)
            <input type="number" min="0" max="20" step="0.01" value={assumedSpreadPrice} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setAssumedSpreadPrice(Number(event.target.value))} required />
          </label>
          <label>
            Assumed slippage ($)
            <input type="number" min="0" max="20" step="0.01" value={assumedSlippagePrice} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setAssumedSlippagePrice(Number(event.target.value))} required />
          </label>
          <label>
            Minimum R:R
            <input type="number" min="1" max="10" step="0.1" value={minimumRiskReward} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setMinimumRiskReward(Number(event.target.value))} required />
          </label>
          <label>
            Maximum stop (avg ranges)
            <input type="number" min="0.5" max="10" step="0.1" value={maximumRiskInAverageRanges} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setMaximumRiskInAverageRanges(Number(event.target.value))} required />
          </label>
          <button type="submit" className="analysis-submit" disabled={loading}>
            {loading ? "Fetching and analysing…" : "Analyse market data"}
          </button>
        </form>
        <p className="form-note">
          The selected interval uses [from,to) semantics. Phase 7 uses your spread/slippage assumptions for net risk-reward qualification; these are historical assumptions, not live broker verification. All engines remain closed-candle and no-lookahead.
        </p>
        {error ? <div className="error-box">{error}</div> : null}
      </section>

      {result && windowData ? (
        <>
          <AnalysisReportPanel
            summary={result.reportSummary}
            currentReport={currentReport}
            collectedReports={collectedReports}
            onDownloadBundle={downloadReportBundle}
            onDownloadCurrentReport={downloadCurrentReport}
            onClearReports={() => {
              setCollectedReports([]);
            }}
          />
          <QualityPanel result={result} />
          <MultiTimeframeStatePanel
            snapshot={windowData.marketStateAtWindowEnd ?? result.latestMarketState}
            summary={result.marketStateSummary}
          />
          <HypothesisOpportunityPanel
            snapshot={windowData.hypothesisOpportunityAtWindowEnd ?? result.latestHypothesisOpportunity}
            summary={result.hypothesisOpportunitySummary}
          />
          <SignalDecisionPanel
            snapshot={windowData.signalDecisionAtWindowEnd ?? result.latestSignalDecision}
            summary={result.signalDecisionSummary}
          />
          <TradeManagementPanel
            snapshot={windowData.tradePlanAtWindowEnd ?? result.latestTradePlan}
            summary={result.tradeManagementSummary}
          />
          <BehaviourSummaryPanel
            timeframe={timeframe}
            summary={result.behaviourSummaries[timeframe]}
          />
          <PriceBehaviourSummaryPanel
            timeframe={timeframe}
            summary={result.priceBehaviourSummaries[timeframe]}
          />

          <section className="panel chart-panel">
            <div className="panel-heading chart-heading">
              <div>
                <p className="eyebrow">Windowed chart inspection</p>
                <h2>
                  {result.meta.symbol} · {timeframe}
                  {requestedTimeframe ? ` → loading ${requestedTimeframe}` : ""}
                </h2>
              </div>
              <div className="actions export-actions">
                <a className="button-link" href={exportUrl("csv")}>Export {timeframe} behaviour CSV</a>
                <a className="button-link" href={exportUrl("json")}>Export {timeframe} JSON</a>
                <a className="button-link" href={tradeExportUrl("csv")}>Export trade plans CSV</a>
                <a className="button-link" href={tradeExportUrl("json")}>Export trade plans JSON</a>
              </div>
            </div>

            <div className="toolbar chart-toolbar">
              <div className="tabs" role="tablist" aria-label="Timeframe">
                {TIMEFRAMES.map((item) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={item === (requestedTimeframe ?? timeframe)}
                    aria-busy={loadingWindow && item === requestedTimeframe}
                    className={item === (requestedTimeframe ?? timeframe) ? "active" : ""}
                    key={item}
                    disabled={loadingWindow}
                    onClick={() => selectTimeframe(item)}
                  >
                    {item} ({result.timeframes[item].candleCount.toLocaleString()})
                  </button>
                ))}
              </div>

              <label className="inline-control">
                Server window
                <select
                  value={windowSize}
                  disabled={loadingWindow}
                  onChange={(event: React.ChangeEvent<HTMLSelectElement>) => changeWindowSize(Number(event.target.value))}
                >
                  {availableWindowSizes.map((size) => (
                    <option key={size} value={size}>{size.toLocaleString()} candles</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="marker-toolbar">
              <div className="marker-summary">
                <strong>Medium-accuracy trade markers</strong>
                <span>{windowData.signalMarkers.length.toLocaleString()} deduplicated A/B signals · {windowData.researchSignalMarkers.length.toLocaleString()} research events</span>
              </div>
              <label className="toggle-control">
                <input type="checkbox" checked={showGradeA} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setShowGradeA(event.target.checked)} />
                Grade A signals
              </label>
              <label className="toggle-control">
                <input type="checkbox" checked={showGradeB} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setShowGradeB(event.target.checked)} />
                Grade B signals
              </label>
              <label className="toggle-control">
                <input type="checkbox" checked={showResearchSignals} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setShowResearchSignals(event.target.checked)} />
                Phase 6 research markers
              </label>
              <label className="toggle-control">
                <input type="checkbox" checked={showInvalidations} disabled={!showResearchSignals} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setShowInvalidations(event.target.checked)} />
                Research invalidations
              </label>
              <label className="toggle-control">
                <input type="checkbox" checked={showTradeLevels} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setShowTradeLevels(event.target.checked)} />
                Latest entry/SL/TP
              </label>
              <div className="actions marker-actions">
                <button type="button" className="secondary" onClick={() => {
                  setShowGradeA(true);
                  setShowGradeB(true);
                  setShowResearchSignals(true);
                  setShowInvalidations(true);
                }}>Show research mode</button>
                <button type="button" className="secondary" onClick={() => {
                  setShowGradeA(true);
                  setShowGradeB(true);
                  setShowResearchSignals(false);
                  setShowInvalidations(false);
                }}>Trading view</button>
              </div>
            </div>

            {total > windowSize ? (
              <div className="range-control">
                <div>
                  <strong>Requested range</strong>
                  <span>
                    {(safePendingOffset + 1).toLocaleString()}–{Math.min(total, safePendingOffset + windowSize).toLocaleString()} of {total.toLocaleString()}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={maximumOffset}
                  step={Math.max(1, Math.floor(windowSize / 10))}
                  value={safePendingOffset}
                  disabled={loadingWindow}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => setPendingOffset(Number(event.target.value))}
                />
                <div className="actions range-actions">
                  <button
                    type="button"
                    className="secondary"
                    disabled={loadingWindow}
                    onClick={() => void loadWindow(timeframe, safePendingOffset, windowSize)}
                  >
                    {loadingWindow ? "Loading…" : "Load range"}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={loadingWindow}
                    onClick={() => void loadWindow(timeframe, maximumOffset, windowSize)}
                  >
                    Latest
                  </button>
                </div>
              </div>
            ) : null}

            <p className="form-note window-note">
              Loaded {windowData.candles.length.toLocaleString()} candles from server offset {windowData.offset.toLocaleString()}. Full 100K datasets are never pushed into React state at once.
              {windowData.recoveredFromSource
                ? " Vercel memory was unavailable, so this timeframe was rebuilt from Finage and is now cached in this browser tab."
                : " This timeframe was served without a serverless rebuild."}
            </p>
            <MarketChart
              candles={windowData.candles}
              signalMarkers={windowData.signalMarkers}
              researchSignalMarkers={windowData.researchSignalMarkers}
              tradePlan={windowData.tradePlanAtWindowEnd ?? result.latestTradePlan}
              showGradeA={showGradeA}
              showGradeB={showGradeB}
              showResearchSignals={showResearchSignals}
              showInvalidations={showInvalidations}
              showTradeLevels={showTradeLevels}
            />
            <DataTable
              candles={windowData.candles}
              completeness={windowData.completeness}
              behaviours={windowData.behaviours}
              priceBehaviours={windowData.priceBehaviours}
            />
          </section>
        </>
      ) : null}
    </div>
  );
}
