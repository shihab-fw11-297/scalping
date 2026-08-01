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
import type { ChartSignalMarker, CompactCandle, TradePlanSnapshot } from "@/lib/market/types";

interface MarketChartProps {
  candles: readonly CompactCandle[];
  signalMarkers?: readonly ChartSignalMarker[];
  tradePlan?: TradePlanSnapshot | null;
  showConfirmedSignals?: boolean;
  showContinuationSignals?: boolean;
  showInvalidations?: boolean;
  showTradeLevels?: boolean;
}

function toChartData(candles: readonly CompactCandle[]): CandlestickData[] {
  const result = new Array<CandlestickData>(candles.length);
  for (let index = 0; index < candles.length; index += 1) {
    const [timestampMs, open, high, low, close] = candles[index];
    result[index] = {
      time: Math.floor(timestampMs / 1000) as UTCTimestamp,
      open,
      high,
      low,
      close,
    };
  }
  return result;
}

function toSeriesMarkers(
  markers: readonly ChartSignalMarker[],
  options: {
    showConfirmedSignals: boolean;
    showContinuationSignals: boolean;
    showInvalidations: boolean;
  },
): SeriesMarker<UTCTimestamp>[] {
  const visible: SeriesMarker<UTCTimestamp>[] = [];
  for (const marker of markers) {
    if (marker.lifecycle === "CONFIRMED" && !options.showConfirmedSignals) continue;
    if (marker.lifecycle === "CONTINUATION" && !options.showContinuationSignals) continue;
    if (marker.lifecycle === "INVALIDATED" && !options.showInvalidations) continue;

    const isBuy = marker.action === "BUY";
    const isInvalidation = marker.lifecycle === "INVALIDATED";
    visible.push({
      time: Math.floor(marker.timestampMs / 1000) as UTCTimestamp,
      position: isInvalidation ? "inBar" : isBuy ? "belowBar" : "aboveBar",
      shape: isInvalidation ? "circle" : isBuy ? "arrowUp" : "arrowDown",
      color: isInvalidation ? "#facc15" : isBuy ? "#22c55e" : "#ef4444",
      text: marker.label,
      size: isInvalidation ? 0.7 : marker.lifecycle === "CONTINUATION" ? 0.8 : 1,
    });
  }
  return visible;
}

export function MarketChart({
  candles,
  signalMarkers = [],
  tradePlan = null,
  showConfirmedSignals = true,
  showContinuationSignals = true,
  showInvalidations = false,
  showTradeLevels = true,
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
      localization: {
        locale: "en-IN",
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
      borderVisible: false,
      priceFormat: {
        type: "price",
        precision: 2,
        minMove: 0.01,
      },
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
      toSeriesMarkers(signalMarkers, {
        showConfirmedSignals,
        showContinuationSignals,
        showInvalidations,
      }),
    );
  }, [signalMarkers, showConfirmedSignals, showContinuationSignals, showInvalidations]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    for (const line of priceLinesRef.current) series.removePriceLine(line);
    priceLinesRef.current = [];
    if (!showTradeLevels || !tradePlan?.entryZone || !tradePlan.structuralRisk || !tradePlan.targetSpace) return;

    const addLine = (price: number, title: string, color: string, lineStyle: LineStyle) => {
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
  }, [tradePlan, showTradeLevels]);

  return <div ref={containerRef} className="chart" aria-label="XAUUSD candlestick chart with optional signal markers" />;
}
