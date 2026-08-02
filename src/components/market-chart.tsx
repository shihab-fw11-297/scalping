"use client";

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type SeriesMarker,
  type UTCTimestamp,
} from "lightweight-charts";
import type { ChartSignalMarker, CompactCandle, SessionLiquiditySnapshot, TradePlanSnapshot } from "@/lib/market/types";

interface MarketChartProps {
  candles: readonly CompactCandle[];
  signalMarkers?: readonly ChartSignalMarker[];
  researchSignalMarkers?: readonly ChartSignalMarker[];
  tradePlan?: TradePlanSnapshot | null;
  sessionLiquidity?: SessionLiquiditySnapshot | null;
  showGradeA?: boolean;
  showGradeB?: boolean;
  showResearchSignals?: boolean;
  showInvalidations?: boolean;
  showTradeLevels?: boolean;
  showLiquidityLevels?: boolean;
}

function toChartData(candles: readonly CompactCandle[]): CandlestickData[] {
  return candles.map(([timestampMs, open, high, low, close]) => ({
    time: Math.floor(timestampMs / 1000) as UTCTimestamp,
    open,
    high,
    low,
    close,
  }));
}

function markerToSeries(
  marker: ChartSignalMarker,
  research: boolean,
): SeriesMarker<UTCTimestamp> {
  const isBuy = marker.action === "BUY";
  const isInvalidation = marker.lifecycle === "INVALIDATED";
  return {
    time: Math.floor(marker.timestampMs / 1000) as UTCTimestamp,
    position: isInvalidation ? "inBar" : isBuy ? "belowBar" : "aboveBar",
    shape: research
      ? isInvalidation
        ? "circle"
        : "square"
      : isBuy
        ? "arrowUp"
        : "arrowDown",
    color: research
      ? isInvalidation
        ? "#a3a3a3"
        : "#94a3b8"
      : isBuy
        ? "#22c55e"
        : "#ef4444",
    text: marker.label,
    size: research ? 0.65 : marker.grade === "A" ? 1.2 : 1,
  };
}

function toSeriesMarkers(
  tradeMarkers: readonly ChartSignalMarker[],
  researchMarkers: readonly ChartSignalMarker[],
  options: {
    showGradeA: boolean;
    showGradeB: boolean;
    showResearchSignals: boolean;
    showInvalidations: boolean;
  },
): SeriesMarker<UTCTimestamp>[] {
  const visible: SeriesMarker<UTCTimestamp>[] = [];
  for (const marker of tradeMarkers) {
    if (marker.grade === "A" && !options.showGradeA) continue;
    if (marker.grade === "B" && !options.showGradeB) continue;
    visible.push(markerToSeries(marker, false));
  }
  if (options.showResearchSignals) {
    for (const marker of researchMarkers) {
      if (marker.lifecycle === "INVALIDATED" && !options.showInvalidations) continue;
      visible.push(markerToSeries(marker, true));
    }
  }
  return visible.sort((left, right) => Number(left.time) - Number(right.time));
}

export function MarketChart({
  candles,
  signalMarkers = [],
  researchSignalMarkers = [],
  tradePlan = null,
  sessionLiquidity = null,
  showGradeA = true,
  showGradeB = true,
  showResearchSignals = false,
  showInvalidations = false,
  showTradeLevels = true,
  showLiquidityLevels = true,
}: MarketChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markerPrimitiveRef = useRef<{ setMarkers(markers: SeriesMarker<UTCTimestamp>[]): void } | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#0f172a" },
        textColor: "#cbd5e1",
      },
      grid: {
        vertLines: { color: "#1e293b" },
        horzLines: { color: "#1e293b" },
      },
      crosshair: { mode: CrosshairMode.MagnetOHLC },
      rightPriceScale: { borderColor: "#334155" },
      timeScale: {
        borderColor: "#334155",
        timeVisible: true,
        secondsVisible: false,
      },
      localization: { locale: "en-IN" },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      borderVisible: false,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });

    chartRef.current = chart;
    seriesRef.current = series;
    markerPrimitiveRef.current = createSeriesMarkers(series, [], { autoScale: false });

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markerPrimitiveRef.current = null;
      priceLinesRef.current = [];
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;
    const frame = requestAnimationFrame(() => {
      series.setData(toChartData(candles));
      chart.timeScale().fitContent();
    });
    return () => cancelAnimationFrame(frame);
  }, [candles]);

  useEffect(() => {
    markerPrimitiveRef.current?.setMarkers(
      toSeriesMarkers(signalMarkers, researchSignalMarkers, {
        showGradeA,
        showGradeB,
        showResearchSignals,
        showInvalidations,
      }),
    );
  }, [signalMarkers, researchSignalMarkers, showGradeA, showGradeB, showResearchSignals, showInvalidations]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    for (const line of priceLinesRef.current) series.removePriceLine(line);
    priceLinesRef.current = [];
    const addLine = (price: number, title: string, color: string, lineStyle: LineStyle) => {
      if (!Number.isFinite(price)) return;
      const line = series.createPriceLine({
        price,
        title,
        color,
        lineWidth: 1,
        lineStyle,
        axisLabelVisible: true,
      });
      priceLinesRef.current.push(line);
    };

    if (showLiquidityLevels && sessionLiquidity) {
      if (sessionLiquidity.previousDayHigh !== null) addLine(sessionLiquidity.previousDayHigh, "PDH", "#c084fc", LineStyle.Dotted);
      if (sessionLiquidity.previousDayLow !== null) addLine(sessionLiquidity.previousDayLow, "PDL", "#c084fc", LineStyle.Dotted);
      if (sessionLiquidity.previousWeekHigh !== null) addLine(sessionLiquidity.previousWeekHigh, "PWH", "#a78bfa", LineStyle.Dashed);
      if (sessionLiquidity.previousWeekLow !== null) addLine(sessionLiquidity.previousWeekLow, "PWL", "#a78bfa", LineStyle.Dashed);
      if (sessionLiquidity.asiaHigh !== null) addLine(sessionLiquidity.asiaHigh, "ASIA H", "#fbbf24", LineStyle.Dotted);
      if (sessionLiquidity.asiaLow !== null) addLine(sessionLiquidity.asiaLow, "ASIA L", "#fbbf24", LineStyle.Dotted);
      if (sessionLiquidity.londonHigh !== null) addLine(sessionLiquidity.londonHigh, "LONDON H", "#fb923c", LineStyle.Dotted);
      if (sessionLiquidity.londonLow !== null) addLine(sessionLiquidity.londonLow, "LONDON L", "#fb923c", LineStyle.Dotted);
      if (sessionLiquidity.newYorkHigh !== null) addLine(sessionLiquidity.newYorkHigh, "NY H", "#60a5fa", LineStyle.Dotted);
      if (sessionLiquidity.newYorkLow !== null) addLine(sessionLiquidity.newYorkLow, "NY L", "#60a5fa", LineStyle.Dotted);
      if (sessionLiquidity.qml.qmlLevel !== null && sessionLiquidity.qml.stage !== "NONE") addLine(sessionLiquidity.qml.qmlLevel, "QML", "#22d3ee", LineStyle.Dashed);
      if (sessionLiquidity.qml.targetPrice !== null && sessionLiquidity.qml.stage !== "NONE") addLine(sessionLiquidity.qml.targetPrice, "QML TARGET", "#34d399", LineStyle.Dashed);
    }

    if (!showTradeLevels || !tradePlan?.entryZone || !tradePlan.structuralRisk || !tradePlan.targetSpace) {
      return () => {
        const activeSeries = seriesRef.current;
        if (!activeSeries) return;
        for (const line of priceLinesRef.current) activeSeries.removePriceLine(line);
        priceLinesRef.current = [];
      };
    }

    addLine(tradePlan.entryZone.lower, "ENTRY ZONE LOW", "#7dd3fc", LineStyle.Dotted);
    const entryLinePrice = tradePlan.entryPrice ?? tradePlan.entryZone.preferred;
    addLine(
      entryLinePrice,
      `${tradePlan.entryPrice === null ? "ENTRY" : "FILLED"} ${tradePlan.action}`,
      "#38bdf8",
      LineStyle.Dashed,
    );
    addLine(tradePlan.entryZone.upper, "ENTRY ZONE HIGH", "#7dd3fc", LineStyle.Dotted);
    addLine(tradePlan.entryZone.noChasePrice, "NO CHASE", "#facc15", LineStyle.Dashed);
    addLine(tradePlan.structuralRisk.stopLossPrice, "INITIAL SL", "#f87171", LineStyle.Solid);
    if (
      tradePlan.currentProtectiveStopPrice !== null &&
      Math.abs(tradePlan.currentProtectiveStopPrice - tradePlan.structuralRisk.stopLossPrice) > 1e-9
    ) {
      addLine(tradePlan.currentProtectiveStopPrice, "PROTECTIVE SL", "#fb923c", LineStyle.Dashed);
    }
    for (const target of tradePlan.targetSpace.targets) {
      addLine(target.price, target.name, "#4ade80", target.name === "TP1" ? LineStyle.Solid : LineStyle.Dotted);
    }

    return () => {
      const activeSeries = seriesRef.current;
      if (!activeSeries) return;
      for (const line of priceLinesRef.current) activeSeries.removePriceLine(line);
      priceLinesRef.current = [];
    };
  }, [tradePlan, sessionLiquidity, showTradeLevels, showLiquidityLevels]);

  return <div ref={containerRef} className="chart" aria-label="XAUUSD candlestick chart with medium-accuracy A/B trade markers" />;
}
