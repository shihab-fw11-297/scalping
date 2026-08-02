import {
  createSessionLiquidityIndex,
  sessionLiquidityAtIndex,
} from "../src/lib/market/session-liquidity";
import { createSignalDecisionIndex } from "../src/lib/market/signal-decision";
import {
  createTradeManagementIndex,
  createTradeReadyMarkersForWindow,
} from "../src/lib/market/trade-management";
import type { LiquidityLevelType } from "../src/lib/market/types";
import { datasetsFrom, generateQmlFixture } from "./qml-fixture";

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isHighSide(type: LiquidityLevelType | null): boolean {
  return type === null || type.endsWith("HIGH") || type === "EQUAL_HIGHS";
}

function isLowSide(type: LiquidityLevelType | null): boolean {
  return type === null || type.endsWith("LOW") || type === "EQUAL_LOWS";
}

function mirrorPrices(candles: ReturnType<typeof generateQmlFixture>): ReturnType<typeof generateQmlFixture> {
  const pivot = 6_000;
  return candles.map((candle) => [
    candle[0],
    pivot - candle[1],
    pivot - candle[3],
    pivot - candle[2],
    pivot - candle[4],
    candle[5],
  ]);
}

const candles = generateQmlFixture(40_000);
const datasets = datasetsFrom(candles);
const liquidityIndex = createSessionLiquidityIndex(datasets, "NEW_YORK_17");
const confirmations: number[] = [];
for (let candleIndex = 0; candleIndex < candles.length; candleIndex += 1) {
  const snapshot = sessionLiquidityAtIndex(liquidityIndex, candleIndex);
  if (snapshot?.qml.stage === "RETEST_CONFIRMED" && (candleIndex === 0 || sessionLiquidityAtIndex(liquidityIndex, candleIndex - 1)?.qml.stage !== "RETEST_CONFIRMED")) {
    confirmations.push(candleIndex);
  }
}

invariant(confirmations.length >= 1, "Balanced QML fixture produced no complete sweep→MSS→retest confirmation.");
invariant(confirmations.length <= 8, "QML detector is flooding the fixture with confirmations.");
const firstIndex = confirmations[0];
const first = sessionLiquidityAtIndex(liquidityIndex, firstIndex);
invariant(first !== null, "First QML confirmation snapshot is unavailable.");
invariant(first.qml.sweep !== null && first.qml.structureShift !== null, "QML confirmation is missing sweep or structure evidence.");
invariant(first.qml.sweep.timestampMs < first.qml.structureShift.timestampMs, "MSS was recorded before the liquidity sweep.");
invariant(first.qml.structureShift.timestampMs <= first.qml.timestampMs, "Retest confirmation occurred before MSS.");
invariant(first.qml.structureShift.type === "MSS" || first.qml.structureShift.score >= 78, "Weak BOS incorrectly qualified as QML structure shift.");
invariant(first.qml.retestCount >= 1 && first.qml.retestCount <= 2, "QML confirmation violated first/second-retest medium policy.");
invariant(first.qml.score >= 62, "QML confirmation score is below medium threshold.");
invariant(first.qml.direction === "BULLISH" ? isHighSide(first.qml.targetType) : isLowSide(first.qml.targetType), "QML target is not on the opposite directional liquidity side.");

const prefixCandles = candles.slice(0, firstIndex);
const prefixIndex = createSessionLiquidityIndex(datasetsFrom(prefixCandles), "NEW_YORK_17");
invariant(prefixIndex.summary.qmlRetestConfirmedCount === 0, "QML confirmation used future retest data.");

const signalIndex = createSignalDecisionIndex(datasets, { dailyBoundaryMode: "NEW_YORK_17" });
invariant(signalIndex.summary.confirmedByFamily.SESSION_LIQUIDITY_QML >= 1, "Phase 6 did not confirm the mature QML chain.");
const tradeIndex = createTradeManagementIndex(datasets, { dailyBoundaryMode: "NEW_YORK_17" });
const qmlPlans = tradeIndex.plans.filter((plan) => plan.family === "SESSION_LIQUIDITY_QML");
const qmlReady = qmlPlans.filter((plan) => plan.quality.tradeReady);
invariant(qmlPlans.length >= 1, "Phase 7 did not create a QML trade plan.");
invariant(qmlReady.length >= 1, "Medium QML policy produced no A/B trade-ready plan.");
invariant(qmlReady.every((plan) => plan.quality.grade === "A" || plan.quality.grade === "B"), "Non-A/B QML plan leaked into trading view.");
invariant(qmlReady.every((plan) => !plan.rejectionReasons.includes("ENTRY_ALREADY_LATE")), "Controlled first-to-second retest allowance was incorrectly marked as chase.");


const secondRetestCandles = generateQmlFixture(20_000);
// Deterministically make the first touch indecisive and the next touch a valid
// recovery close. This proves the balanced policy does not silently become
// first-retest-only.
secondRetestCandles[14_356] = [secondRetestCandles[14_356][0], 2725.13, 2725.20, 2724.72, 2724.75, 1];
secondRetestCandles[14_357] = [secondRetestCandles[14_357][0], 2724.75, 2724.97, 2724.70, 2724.90, 1];
const secondRetestIndex = createSessionLiquidityIndex(datasetsFrom(secondRetestCandles), "NEW_YORK_17");
const secondRetest = sessionLiquidityAtIndex(secondRetestIndex, 14_357);
invariant(secondRetest?.qml.stage === "RETEST_CONFIRMED", "Controlled second retest did not confirm.");
invariant(secondRetest.qml.retestCount === 2, "Controlled second retest count is incorrect.");
invariant(secondRetest.qml.reasons.includes("SECOND_RETEST_CONFIRMED"), "Second retest was mislabeled as a first retest.");
invariant(secondRetest.qml.score >= 62, "Controlled second retest fell below the medium QML threshold.");

const mirroredCandles = mirrorPrices(candles.slice(0, 20_000));
const mirroredLiquidityIndex = createSessionLiquidityIndex(datasetsFrom(mirroredCandles), "NEW_YORK_17");
const bearishConfirmations: number[] = [];
for (let candleIndex = 0; candleIndex < mirroredCandles.length; candleIndex += 1) {
  const snapshot = sessionLiquidityAtIndex(mirroredLiquidityIndex, candleIndex);
  const previous = candleIndex > 0 ? sessionLiquidityAtIndex(mirroredLiquidityIndex, candleIndex - 1) : null;
  if (snapshot?.qml.stage === "RETEST_CONFIRMED" && previous?.qml.stage !== "RETEST_CONFIRMED") {
    bearishConfirmations.push(candleIndex);
  }
}
invariant(bearishConfirmations.length >= 1, "Mirrored fixture produced no bearish QML confirmation.");
const firstBearish = sessionLiquidityAtIndex(mirroredLiquidityIndex, bearishConfirmations[0]);
invariant(firstBearish?.qml.direction === "BEARISH", "Direction-symmetric QML verification did not produce a bearish setup.");
invariant(isLowSide(firstBearish.qml.targetType), "Bearish QML target is not below price-side liquidity.");
const mirroredSignalIndex = createSignalDecisionIndex(datasetsFrom(mirroredCandles), { dailyBoundaryMode: "NEW_YORK_17" });
invariant(mirroredSignalIndex.summary.confirmedByFamily.SESSION_LIQUIDITY_QML >= 1, "Phase 6 did not confirm bearish QML.");
const mirroredTradeIndex = createTradeManagementIndex(datasetsFrom(mirroredCandles), { dailyBoundaryMode: "NEW_YORK_17" });
const mirroredReady = mirroredTradeIndex.plans.filter((plan) => plan.family === "SESSION_LIQUIDITY_QML" && plan.quality.tradeReady);
invariant(mirroredReady.length >= 1, "Phase 7 did not create a bearish A/B QML plan.");
invariant(mirroredReady.some((plan) => plan.direction === "BEARISH"), "Bearish QML plan direction was lost before Phase 7.");

const markers = createTradeReadyMarkersForWindow(
  tradeIndex,
  "M1",
  candles,
  0,
  candles.length,
  "NEW_YORK_17",
);
const qmlMarkers = markers.filter((marker) => marker.family === "SESSION_LIQUIDITY_QML");
invariant(qmlMarkers.length >= 1, "QML A/B marker is missing from trading view.");
invariant(qmlMarkers.every((marker) => marker.label.includes("QML")), "QML marker label is not explicit.");

console.log(JSON.stringify({
  ok: true,
  confirmations: confirmations.length,
  firstConfirmationIndex: firstIndex,
  firstConfirmation: {
    direction: first.qml.direction,
    stage: first.qml.stage,
    score: first.qml.score,
    sweepType: first.qml.sweep.levelType,
    structureType: first.qml.structureShift.type,
    retestCount: first.qml.retestCount,
    targetType: first.qml.targetType,
  },
  qmlConfirmedSignals: signalIndex.summary.confirmedByFamily.SESSION_LIQUIDITY_QML,
  qmlPlans: qmlPlans.length,
  qmlTradeReady: qmlReady.length,
  qmlMarkers: qmlMarkers.length,
  bearishConfirmations: bearishConfirmations.length,
  bearishTradeReady: mirroredReady.length,
  controlledSecondRetest: {
    stage: secondRetest.qml.stage,
    score: secondRetest.qml.score,
    retestCount: secondRetest.qml.retestCount,
  },
  totalTradeReady: tradeIndex.summary.tradeReadySignalCount,
  semantics: "SYNTHETIC_REGRESSION_NOT_PROFITABILITY_PROOF",
}, null, 2));
