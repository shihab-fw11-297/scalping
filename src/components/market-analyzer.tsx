"use client";

import { useMemo, useState } from "react";
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
  const [windowSize, setWindowSize] = useState<number>(2_000);
  const [pendingOffset, setPendingOffset] = useState(0);
  const [assumedSpreadPrice, setAssumedSpreadPrice] = useState(0.25);
  const [assumedSlippagePrice, setAssumedSlippagePrice] = useState(0.1);
  const [minimumRiskReward, setMinimumRiskReward] = useState(1.5);
  const [maximumRiskInAverageRanges, setMaximumRiskInAverageRanges] = useState(3.5);
  const [currentReport, setCurrentReport] = useState<AnalysisReport | null>(null);
  const [collectedReports, setCollectedReports] = useState<AnalysisReport[]>([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [showConfirmedSignals, setShowConfirmedSignals] = useState(true);
  const [showContinuationSignals, setShowContinuationSignals] = useState(true);
  const [showInvalidations, setShowInvalidations] = useState(false);
  const [showTradeLevels, setShowTradeLevels] = useState(true);

  const total = result?.timeframes[timeframe].candleCount ?? 0;
  const availableWindowSizes = WINDOW_SIZES.filter((size) => size <= (result?.meta.maxWindowCandles ?? 5_000));
  const maximumOffset = Math.max(0, total - windowSize);
  const safePendingOffset = Math.min(maximumOffset, pendingOffset);


  async function loadCompleteReport(analysisId: string): Promise<void> {
    setReportLoading(true);
    try {
      const params = new URLSearchParams({ analysisId, format: "json" });
      const response = await fetch(`/api/market/report?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await readError(response));
      const report = (await response.json()) as AnalysisReport;
      setCurrentReport(report);
      setCollectedReports((previous) => {
        const withoutDuplicate = previous.filter((item) => item.analysisId !== report.analysisId);
        return [...withoutDuplicate, report].slice(-6);
      });
    } catch (caught) {
      setError(caught instanceof Error
        ? `Analysis loaded, but complete report generation failed: ${caught.message}`
        : "Analysis loaded, but complete report generation failed.");
    } finally {
      setReportLoading(false);
    }
  }

  function downloadReportBundle(): void {
    if (collectedReports.length === 0) return;
    const bundle: AnalysisReportBundle = {
      bundleVersion: "1.0",
      exportedAtUtc: new Date().toISOString(),
      reportCount: collectedReports.length,
      reports: collectedReports,
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `xauusd-analysis-bundle-${collectedReports.length}-reports.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
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
      setCurrentReport(null);
      void loadCompleteReport(parsed.analysisId);
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
    setLoadingWindow(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        analysisId: result.analysisId,
        timeframe: nextTimeframe,
        offset: String(Math.max(0, nextOffset)),
        limit: String(nextLimit),
      });
      const response = await fetch(`/api/market/window?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await readError(response));
      const next = (await response.json()) as MarketWindowResponse;
      setWindowData(next);
      setTimeframe(nextTimeframe);
      setWindowSize(nextLimit);
      setPendingOffset(next.offset);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load chart window.");
    } finally {
      setLoadingWindow(false);
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
    return `/api/market/export?${params}`;
  }


  function tradeExportUrl(format: "csv" | "json"): string {
    if (!result) return "#";
    const params = new URLSearchParams({
      analysisId: result.analysisId,
      format,
    });
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
            analysisId={result.analysisId}
            summary={result.reportSummary}
            currentReport={currentReport}
            collectedReports={collectedReports}
            reportLoading={reportLoading}
            onDownloadBundle={downloadReportBundle}
            onClearReports={() => {
              setCollectedReports([]);
              setCurrentReport(null);
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
                <h2>{result.meta.symbol} · {timeframe}</h2>
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
                    aria-selected={item === timeframe}
                    className={item === timeframe ? "active" : ""}
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
                <strong>Chart signal markers</strong>
                <span>{windowData.signalMarkers.length.toLocaleString()} events in loaded window</span>
              </div>
              <label className="toggle-control">
                <input type="checkbox" checked={showConfirmedSignals} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setShowConfirmedSignals(event.target.checked)} />
                Confirmed BUY/SELL
              </label>
              <label className="toggle-control">
                <input type="checkbox" checked={showContinuationSignals} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setShowContinuationSignals(event.target.checked)} />
                Continuations
              </label>
              <label className="toggle-control">
                <input type="checkbox" checked={showInvalidations} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setShowInvalidations(event.target.checked)} />
                Invalidations
              </label>
              <label className="toggle-control">
                <input type="checkbox" checked={showTradeLevels} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setShowTradeLevels(event.target.checked)} />
                Latest entry/SL/TP
              </label>
              <div className="actions marker-actions">
                <button type="button" className="secondary" onClick={() => {
                  setShowConfirmedSignals(true);
                  setShowContinuationSignals(true);
                  setShowInvalidations(true);
                }}>Show all signals</button>
                <button type="button" className="secondary" onClick={() => {
                  setShowConfirmedSignals(false);
                  setShowContinuationSignals(false);
                  setShowInvalidations(false);
                }}>Hide signals</button>
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
            </p>
            <MarketChart
              candles={windowData.candles}
              signalMarkers={windowData.signalMarkers}
              tradePlan={windowData.tradePlanAtWindowEnd ?? result.latestTradePlan}
              showConfirmedSignals={showConfirmedSignals}
              showContinuationSignals={showContinuationSignals}
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
