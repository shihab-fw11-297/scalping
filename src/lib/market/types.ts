export type SourceTimeframe = "M1";
export type DerivedTimeframe = "M5" | "M15" | "H1" | "D1";
export type Timeframe = SourceTimeframe | DerivedTimeframe;
export type SignalOriginTimeframe = "M1" | "M5" | "M15";

/** [timestampMs, open, high, low, close, volume] */
export type CompactCandle = readonly [
  timestampMs: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number,
];

export type CandleCoverageStatus =
  | "COMPLETE"
  | "PARTIAL_REQUEST_BOUNDARY"
  | "EXPECTED_MARKET_CLOSURE"
  | "BOUNDARY_AND_CLOSURE"
  | "MISSING_DATA"
  | "PARTIAL_MISSING_DATA"
  | "OVERFULL";

export interface CandleCompleteness {
  actualChildren: number;
  expectedChildren: number;
  fullIntervalChildren: number;
  expectedClosedChildren: number;
  completenessPercent: number;
  status: CandleCoverageStatus;
}

export interface TimeframeDataset {
  candles: CompactCandle[];
  completeness: CandleCompleteness[];
}

export interface VisibleDatasetRange {
  /** Absolute index in the internally warmed-up dataset. */
  start: number;
  /** Exclusive absolute index in the internally warmed-up dataset. */
  end: number;
  /** Number of candles visible inside the user-requested interval. */
  total: number;
}

export interface FinageRawAggregate {
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
  t: number | string;
}

export interface DataIssue {
  type:
    | "INVALID_TIMESTAMP"
    | "INVALID_NUMBER"
    | "INVALID_OHLC"
    | "OUT_OF_RANGE"
    | "DUPLICATE_CONFLICT"
    | "EXPECTED_CLOSURE_CANDLE"
    | "STALE_PROVIDER_CANDLE";
  index: number;
  message: string;
}

export type GapClassification =
  | "EXPECTED_MARKET_CLOSURE"
  | "MISSING_TRADABLE_INTERVAL"
  | "MIXED_CLOSURE_AND_MISSING";

export interface GapRecord {
  fromTimestampMs: number;
  toTimestampMs: number;
  totalMissingCandles: number;
  missingTradableCandles: number;
  expectedClosedCandles: number;
  classification: GapClassification;
}

export interface RollingWindowSnapshot {
  windowMinutes: number;
  fromTimestampMs: number;
  toTimestampMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  candlesPresent: number;
  expectedCandles: number;
  completenessPercent: number;
}

export interface QualityReport {
  received: number;
  valid: number;
  contextValid: number;
  warmupCandles: number;
  invalid: number;
  filteredOutsideRange: number;
  duplicates: number;
  duplicateConflicts: number;
  outOfOrderDetected: boolean;
  closedMarketCandlesRemoved: number;
  staleCandlesRemoved: number;
  gapSafetyCandlesMarked: number;
  missingTradableCandles: number;
  expectedClosedCandles: number;
  gapCount: number;
  incompleteByTimeframe: Record<Timeframe, number>;
  coverageStatusByTimeframe: Record<Timeframe, Record<CandleCoverageStatus, number>>;
  issueSamples: DataIssue[];
  gapSamples: GapRecord[];
}

export type CandleDirection = "BULLISH" | "BEARISH" | "NEUTRAL";
export type BreakBehaviour =
  | "NONE"
  | "BULLISH_BODY_BREAK"
  | "BEARISH_BODY_BREAK"
  | "HIGH_WICK_BREAK"
  | "LOW_WICK_BREAK"
  | "OUTSIDE_BREAK";

export type CandleBehaviourTag =
  | "NORMAL"
  | "INSIDE_BAR"
  | "OUTSIDE_BAR"
  | "RANGE_EXPANSION"
  | "RANGE_COMPRESSION"
  | "BULLISH_DISPLACEMENT"
  | "BEARISH_DISPLACEMENT"
  | "UPPER_REJECTION"
  | "LOWER_REJECTION"
  | "WICK_SWEEP_HIGH"
  | "WICK_SWEEP_LOW"
  | "INDECISION"
  | "EXHAUSTION_CANDIDATE";

export interface LookbackComparison {
  lookback: 1 | 3 | 5 | 10 | 20;
  highBreak: boolean;
  lowBreak: boolean;
  closeChange: number;
  rangeVsAverage: number | null;
}

export interface CandleBehaviour {
  timestampMs: number;
  direction: CandleDirection;
  range: number;
  body: number;
  upperWick: number;
  lowerWick: number;
  bodyToRange: number;
  closeLocation: number;
  upperWickRatio: number;
  lowerWickRatio: number;
  rangeVsAverage20: number | null;
  bodyVsAverage20: number | null;
  overlapWithPrevious: number | null;
  breakBehaviour: BreakBehaviour;
  maximumHighBreakLookback: 0 | 1 | 3 | 5 | 10 | 20;
  maximumLowBreakLookback: 0 | 1 | 3 | 5 | 10 | 20;
  primaryTag: CandleBehaviourTag;
  tags: CandleBehaviourTag[];
  intensityScore: number;
  comparisons: LookbackComparison[];
}

export interface CandleBehaviourView {
  timestampMs: number;
  direction: CandleDirection;
  range: number;
  bodyToRange: number;
  rangeVsAverage20: number | null;
  overlapWithPrevious: number | null;
  breakBehaviour: BreakBehaviour;
  maximumHighBreakLookback: 0 | 1 | 3 | 5 | 10 | 20;
  maximumLowBreakLookback: 0 | 1 | 3 | 5 | 10 | 20;
  primaryTag: CandleBehaviourTag;
  intensityScore: number;
}

export interface BehaviourEvent {
  timestampMs: number;
  primaryTag: CandleBehaviourTag;
  direction: CandleDirection;
  intensityScore: number;
  rangeVsAverage20: number | null;
}

export interface CandleBehaviourSummary {
  candleCount: number;
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  averageRange: number;
  medianRange: number;
  p90Range: number;
  p95Range: number;
  averageBodyToRange: number;
  tagCounts: Record<CandleBehaviourTag, number>;
  strongestEvents: BehaviourEvent[];
}


export type PriceDirection = "BULLISH" | "BEARISH" | "NEUTRAL";

export type PricePhase =
  | "BALANCED"
  | "NOISY"
  | "COMPRESSION"
  | "EXPANSION"
  | "BULLISH_IMPULSE"
  | "BEARISH_IMPULSE"
  | "BULLISH_PULLBACK"
  | "BEARISH_PULLBACK"
  | "BULLISH_RECOVERY"
  | "BEARISH_RECOVERY"
  | "MOMENTUM_DECAY";

export type BreakAcceptanceState =
  | "NONE"
  | "BULLISH_ATTEMPT"
  | "BEARISH_ATTEMPT"
  | "BULLISH_ACCEPTED"
  | "BEARISH_ACCEPTED"
  | "BULLISH_FAILED"
  | "BEARISH_FAILED"
  | "BOTH_SIDES_FAILED";

export type MomentumCondition =
  | "NEUTRAL"
  | "STEADY_BULLISH"
  | "STEADY_BEARISH"
  | "ACCELERATING_BULLISH"
  | "ACCELERATING_BEARISH"
  | "DECAYING_BULLISH"
  | "DECAYING_BEARISH";

export type LateEntryRisk = "LOW" | "MEDIUM" | "HIGH";

export interface PriceBehaviour {
  timestampMs: number;
  netProgress3: number;
  netProgress5: number;
  netProgress10: number;
  netProgress20: number;
  grossTravel5: number;
  grossTravel20: number;
  efficiency3: number;
  efficiency5: number;
  efficiency10: number;
  efficiency20: number;
  speed3: number;
  speed5: number;
  speed10: number;
  speed20: number;
  averageOverlap5: number;
  alternationRate5: number;
  noiseScore: number;
  rangeRegimeRatio: number | null;
  phase: PricePhase;
  impulseDirection: PriceDirection;
  impulseStrength: number;
  impulseBars: number;
  pullbackDepthPercent: number | null;
  pullbackBars: number;
  recoverySpeedRatio: number | null;
  breakState: BreakAcceptanceState;
  breakLevel: number | null;
  breakLookback: 0 | 5 | 10 | 20;
  breakAgeBars: number;
  momentumCondition: MomentumCondition;
  accelerationRatio: number | null;
  extensionVsAverageRange20: number | null;
  freshnessScore: number;
  lateEntryRisk: LateEntryRisk;
}

export interface PriceBehaviourView {
  timestampMs: number;
  phase: PricePhase;
  efficiency5: number;
  efficiency20: number;
  noiseScore: number;
  impulseDirection: PriceDirection;
  impulseStrength: number;
  impulseBars: number;
  pullbackDepthPercent: number | null;
  pullbackBars: number;
  recoverySpeedRatio: number | null;
  breakState: BreakAcceptanceState;
  breakLevel: number | null;
  breakLookback: 0 | 5 | 10 | 20;
  momentumCondition: MomentumCondition;
  accelerationRatio: number | null;
  extensionVsAverageRange20: number | null;
  freshnessScore: number;
  lateEntryRisk: LateEntryRisk;
}

export interface PriceBehaviourEvent {
  timestampMs: number;
  phase: PricePhase;
  score: number;
  impulseDirection: PriceDirection;
  impulseStrength: number;
  breakState: BreakAcceptanceState;
  momentumCondition: MomentumCondition;
  lateEntryRisk: LateEntryRisk;
}

export interface PriceBehaviourSummary {
  candleCount: number;
  averageEfficiency5: number;
  averageEfficiency20: number;
  averageNoiseScore: number;
  averageImpulseStrength: number;
  averagePullbackDepthPercent: number;
  averageRecoverySpeedRatio: number;
  pullbackSampleCount: number;
  recoverySampleCount: number;
  phaseCounts: Record<PricePhase, number>;
  breakStateCounts: Record<BreakAcceptanceState, number>;
  momentumCounts: Record<MomentumCondition, number>;
  lateEntryRiskCounts: Record<LateEntryRisk, number>;
  strongestEvents: PriceBehaviourEvent[];
}

export interface TimeframeMeta {
  timeframe: Timeframe;
  candleCount: number;
  firstTimestampMs: number | null;
  lastTimestampMs: number | null;
  incompleteCandles: number;
}

export interface SignalWindowNavigation {
  totalSignalsInPeriod: number;
  signalsInWindow: number;
  firstSignalOffset: number | null;
  previousSignalOffset: number | null;
  nextSignalOffset: number | null;
  lastSignalOffset: number | null;
  originCounts: Record<SignalOriginTimeframe, number>;
}

export interface MarketWindowResponse {
  analysisId: string;
  recoveredFromSource: boolean;
  timeframe: Timeframe;
  offset: number;
  limit: number;
  total: number;
  candles: CompactCandle[];
  completeness: CandleCompleteness[];
  behaviours: CandleBehaviourView[];
  priceBehaviours: PriceBehaviourView[];
  /** Deduplicated A/B trade-ready markers shown by default. */
  signalMarkers: ChartSignalMarker[];
  /** Phase 6 and Phase 12 research/blocked events retained for optional inspection. */
  researchSignalMarkers: ChartSignalMarker[];
  signalNavigation: SignalWindowNavigation;
  marketStateAtWindowEnd: MultiTimeframeStateSnapshot | null;
  hypothesisOpportunityAtWindowEnd: HypothesisOpportunitySnapshot | null;
  signalDecisionAtWindowEnd: SignalDecisionSnapshot | null;
  tradePlanAtWindowEnd: TradePlanSnapshot | null;
  sessionLiquidityAtWindowEnd: SessionLiquiditySnapshot | null;
}

export interface AnalyzeMarketMeta {
  symbol: string;
  source: "FINAGE";
  requestedFromUtc: string;
  requestedToUtc: string;
  contextFromUtc: string;
  warmupCalendarDays: number;
  warmupCandleCount: number;
  analysisProfile: "MEDIUM_ACCURACY_V1" | "SESSION_LIQUIDITY_QML_V1";
  intervalSemantics: "[from,to)";
  sourceTimeframe: "M1";
  fetchChunks: number;
  plannedFetchChunks: number;
  adaptiveSplitCount: number;
  processingMs: number;
  cacheExpiresAtUtc: string;
  weekendScheduleMode: "NEW_YORK_17" | "FIXED_UTC";
  dailyBoundaryMode: "UTC_MIDNIGHT" | "NEW_YORK_17";
  dailyBoundaryDescription: string;
  maxWindowCandles: number;
  tradeManagementSettings: TradeManagementSettings;
}

export interface AnalysisRecoveryRequest {
  fromUtc: string;
  toUtc: string;
  assumedSpreadPrice: number;
  assumedSlippagePrice: number;
  minimumRiskReward: number;
  maximumRiskInAverageRanges: number;
}

export interface AnalyzeMarketResponse {
  analysisId: string;
  recoveryRequest: AnalysisRecoveryRequest;
  meta: AnalyzeMarketMeta;
  quality: QualityReport;
  timeframes: Record<Timeframe, TimeframeMeta>;
  behaviourSummaries: Record<Timeframe, CandleBehaviourSummary>;
  priceBehaviourSummaries: Record<Timeframe, PriceBehaviourSummary>;
  marketStateSummary: MultiTimeframeStateSummary;
  sessionLiquiditySummary: SessionLiquiditySummary;
  latestSessionLiquidity: SessionLiquiditySnapshot | null;
  latestMarketState: MultiTimeframeStateSnapshot | null;
  hypothesisOpportunitySummary: HypothesisOpportunitySummary;
  latestHypothesisOpportunity: HypothesisOpportunitySnapshot | null;
  signalDecisionSummary: SignalDecisionSummary;
  latestSignalDecision: SignalDecisionSnapshot | null;
  tradeManagementSummary: TradeManagementSummary;
  latestTradePlan: TradePlanSnapshot | null;
  reportSummary: AnalysisReportSummary;
  completeReport: AnalysisReport;
  phase12: Phase12MultiTimeframeReport;
  rolling5hLatest: RollingWindowSnapshot | null;
  initialWindow: MarketWindowResponse;
}

export interface CachedAnalysis {
  id: string;
  createdAtMs: number;
  expiresAtMs: number;
  meta: AnalyzeMarketMeta;
  quality: QualityReport;
  datasets: Record<Timeframe, TimeframeDataset>;
  visibleRanges: Record<Timeframe, VisibleDatasetRange>;
  behaviourSummaries: Record<Timeframe, CandleBehaviourSummary>;
  priceBehaviourSummaries: Record<Timeframe, PriceBehaviourSummary>;
  marketStateSummary: MultiTimeframeStateSummary;
  sessionLiquiditySummary: SessionLiquiditySummary;
  latestSessionLiquidity: SessionLiquiditySnapshot | null;
  latestMarketState: MultiTimeframeStateSnapshot | null;
  hypothesisOpportunitySummary: HypothesisOpportunitySummary;
  latestHypothesisOpportunity: HypothesisOpportunitySnapshot | null;
  signalDecisionSummary: SignalDecisionSummary;
  latestSignalDecision: SignalDecisionSnapshot | null;
  tradeManagementSummary: TradeManagementSummary;
  latestTradePlan: TradePlanSnapshot | null;
  reportSummary: AnalysisReportSummary;
  phase12: Phase12MultiTimeframeReport;
  rolling5hLatest: RollingWindowSnapshot | null;
}

export type MarketStateAvailability = "AVAILABLE" | "PARTIAL" | "INSUFFICIENT_DATA";

export type DailyEnvironmentCondition =
  | "BULLISH_EXPANSION"
  | "BEARISH_EXPANSION"
  | "BULLISH_TREND"
  | "BEARISH_TREND"
  | "RANGE"
  | "COMPRESSION"
  | "NOISY"
  | "TRANSITION"
  | "INSUFFICIENT_DATA";

export type MarketMaturity = "FRESH" | "DEVELOPING" | "MATURE" | "EXTENDED" | "UNAVAILABLE";

export interface DailyEnvironmentState {
  sourceTimestampMs: number | null;
  availability: MarketStateAvailability;
  condition: DailyEnvironmentCondition;
  direction: PriceDirection;
  strength: number;
  rangePositionPercent: number | null;
  volatilityRatio: number | null;
  maturity: MarketMaturity;
}

export type RollingCampaignStage =
  | "BULLISH_IMPULSE"
  | "BEARISH_IMPULSE"
  | "BULLISH_PULLBACK"
  | "BEARISH_PULLBACK"
  | "BULLISH_RECOVERY"
  | "BEARISH_RECOVERY"
  | "BULLISH_DECAY"
  | "BEARISH_DECAY"
  | "COMPRESSION"
  | "BALANCE"
  | "SESSION_REOPEN"
  | "INSUFFICIENT_DATA";

export interface RollingCampaignState {
  fromTimestampMs: number | null;
  toTimestampMs: number;
  availability: MarketStateAvailability;
  stage: RollingCampaignStage;
  direction: PriceDirection;
  strength: number;
  efficiency: number;
  rangePositionPercent: number | null;
  recentProgressRatio: number | null;
  candlesPresent: number;
}

export type HourlyLocationZone =
  | "ABOVE_RANGE"
  | "RANGE_HIGH"
  | "UPPER_QUARTILE"
  | "MID_RANGE"
  | "LOWER_QUARTILE"
  | "RANGE_LOW"
  | "BELOW_RANGE"
  | "UNAVAILABLE";

export type HourlyLocationCondition =
  | "WITH_TREND_PULLBACK"
  | "WITH_TREND_EXTENDED"
  | "COUNTERTREND_CORRECTION"
  | "BREAKOUT_LOCATION"
  | "BREAKDOWN_LOCATION"
  | "RANGE_LOCATION"
  | "TRANSITION_LOCATION"
  | "INSUFFICIENT_DATA";

export interface HourlyLocationState {
  sourceTimestampMs: number | null;
  availability: MarketStateAvailability;
  zone: HourlyLocationZone;
  condition: HourlyLocationCondition;
  direction: PriceDirection;
  rangePositionPercent: number | null;
  distanceToUpperInAverageRanges: number | null;
  distanceToLowerInAverageRanges: number | null;
  locationQuality: number;
}

export type IntradayNarrativeState =
  | "BULLISH_PRESSURE"
  | "BEARISH_PRESSURE"
  | "BULLISH_CORRECTION"
  | "BEARISH_CORRECTION"
  | "BULLISH_ACCEPTANCE"
  | "BEARISH_ACCEPTANCE"
  | "FAILED_BREAK"
  | "COMPRESSION"
  | "EXPANSION"
  | "ROTATION"
  | "NOISY"
  | "BALANCED"
  | "INSUFFICIENT_DATA";

export interface IntradayNarrative {
  sourceTimestampMs: number | null;
  availability: MarketStateAvailability;
  state: IntradayNarrativeState;
  direction: PriceDirection;
  strength: number;
  pressureScore: number;
}

export type SetupConstructionState =
  | "IDLE"
  | "COMPRESSION_BUILDING"
  | "BULLISH_PRESSURE"
  | "BEARISH_PRESSURE"
  | "BULLISH_BREAK_ATTEMPT"
  | "BEARISH_BREAK_ATTEMPT"
  | "BULLISH_ACCEPTANCE"
  | "BEARISH_ACCEPTANCE"
  | "BULLISH_PULLBACK"
  | "BEARISH_PULLBACK"
  | "BULLISH_RECOVERY"
  | "BEARISH_RECOVERY"
  | "FAILED_BREAK"
  | "EXTENDED"
  | "NOISY"
  | "INSUFFICIENT_DATA";

export interface SetupConstructionContext {
  sourceTimestampMs: number | null;
  availability: MarketStateAvailability;
  state: SetupConstructionState;
  direction: PriceDirection;
  constructionScore: number;
  freshnessScore: number;
  lateEntryRisk: LateEntryRisk;
}

export type ExecutionContextState =
  | "CALM"
  | "BULLISH_IGNITION"
  | "BEARISH_IGNITION"
  | "BULLISH_CONTINUATION"
  | "BEARISH_CONTINUATION"
  | "BULLISH_PULLBACK"
  | "BEARISH_PULLBACK"
  | "BULLISH_RECOVERY"
  | "BEARISH_RECOVERY"
  | "BULLISH_BREAK_ATTEMPT"
  | "BEARISH_BREAK_ATTEMPT"
  | "BULLISH_BREAK_ACCEPTED"
  | "BEARISH_BREAK_ACCEPTED"
  | "FAILED_BREAK"
  | "EXTENDED"
  | "NOISY";

export type ExecutionQuality = "CLEAN" | "MIXED" | "LATE" | "NOISY";

export interface ExecutionContext {
  sourceTimestampMs: number;
  state: ExecutionContextState;
  direction: PriceDirection;
  quality: ExecutionQuality;
  intensity: number;
  freshnessScore: number;
  lateEntryRisk: LateEntryRisk;
}

export type TimeframeAlignment =
  | "FRESH_ALIGNMENT"
  | "MATURE_ALIGNMENT"
  | "PRODUCTIVE_DISAGREEMENT"
  | "DESTRUCTIVE_DISAGREEMENT"
  | "MIXED"
  | "NEUTRAL"
  | "INSUFFICIENT_DATA";

export type CompositeMarketState =
  | "TREND_CONTINUATION"
  | "CORRECTION"
  | "ROTATION"
  | "EXPANSION"
  | "COMPRESSION"
  | "RANGE"
  | "NOISE"
  | "TRANSITION"
  | "INSUFFICIENT_DATA";

export interface CompositeTimeframeState {
  direction: PriceDirection;
  alignment: TimeframeAlignment;
  state: CompositeMarketState;
  evidenceScore: number;
  agreementCount: number;
  conflictCount: number;
  availableLayers: number;
}

export interface MultiTimeframeStateSnapshot {
  timestampMs: number;
  daily: DailyEnvironmentState;
  rolling5h: RollingCampaignState;
  hourly: HourlyLocationState;
  m15: IntradayNarrative;
  m5: SetupConstructionContext;
  m1: ExecutionContext;
  composite: CompositeTimeframeState;
}

export interface MultiTimeframeStateEvent {
  timestampMs: number;
  direction: PriceDirection;
  alignment: TimeframeAlignment;
  state: CompositeMarketState;
  evidenceScore: number;
}

export interface MultiTimeframeStateSummary {
  sampleCount: number;
  directionCounts: Record<PriceDirection, number>;
  alignmentCounts: Record<TimeframeAlignment, number>;
  stateCounts: Record<CompositeMarketState, number>;
  averageEvidenceScore: number;
  strongestEvents: MultiTimeframeStateEvent[];
}



export type LiquidityLevelType =
  | "PREVIOUS_DAY_HIGH"
  | "PREVIOUS_DAY_LOW"
  | "PREVIOUS_WEEK_HIGH"
  | "PREVIOUS_WEEK_LOW"
  | "ASIA_HIGH"
  | "ASIA_LOW"
  | "LONDON_HIGH"
  | "LONDON_LOW"
  | "NEW_YORK_HIGH"
  | "NEW_YORK_LOW"
  | "M15_SWING_HIGH"
  | "M15_SWING_LOW"
  | "H1_SWING_HIGH"
  | "H1_SWING_LOW"
  | "EQUAL_HIGHS"
  | "EQUAL_LOWS";

export type LiquidityLevelSide = "HIGH" | "LOW";
export type LiquidityLevelStatus = "ACTIVE" | "SWEPT" | "BROKEN";

export interface LiquidityLevelSnapshot {
  id: string;
  type: LiquidityLevelType;
  side: LiquidityLevelSide;
  price: number;
  formedAtMs: number;
  availableAtMs: number;
  strength: number;
  touches: number;
  freshnessBars: number;
  obstacleClass: ObstacleClass;
  status: LiquidityLevelStatus;
}

export type StructureBreakType = "BOS" | "MSS";

export interface LiquiditySweepSnapshot {
  timestampMs: number;
  direction: Exclude<OpportunityDirection, "NEUTRAL">;
  levelId: string;
  levelType: LiquidityLevelType;
  levelPrice: number;
  penetrationDistance: number;
  penetrationInAverageRanges: number;
  reclaimed: boolean;
  reclaimStrength: number;
  score: number;
}

export interface StructureShiftSnapshot {
  timestampMs: number;
  direction: Exclude<OpportunityDirection, "NEUTRAL">;
  type: StructureBreakType;
  brokenSwingPrice: number;
  brokenSwingTimestampMs: number;
  closeBeyondDistance: number;
  displacementScore: number;
  score: number;
}

export type QmlSetupStage =
  | "NONE"
  | "LIQUIDITY_SWEPT"
  | "MSS_CONFIRMED"
  | "RETEST_WAIT"
  | "RETEST_CONFIRMED"
  | "INVALIDATED"
  | "EXPIRED";

export type QmlReasonCode =
  | "IMPORTANT_LIQUIDITY_SWEPT"
  | "LEVEL_RECLAIMED"
  | "MSS_BODY_CLOSE"
  | "DISPLACEMENT_PRESENT"
  | "QML_SHOULDER_IDENTIFIED"
  | "FIRST_RETEST_CONFIRMED"
  | "SECOND_RETEST_CONFIRMED"
  | "ACTIVE_SESSION_CONTEXT"
  | "OPPOSITE_LIQUIDITY_AVAILABLE"
  | "COUNTER_HTF_PRESSURE"
  | "MID_RANGE_LOCATION"
  | "RETEST_TOO_LATE"
  | "HEAD_INVALIDATED"
  | "DATA_NOT_READY";

export interface QmlSetupSnapshot {
  timestampMs: number;
  direction: OpportunityDirection;
  stage: QmlSetupStage;
  score: number;
  sweep: LiquiditySweepSnapshot | null;
  structureShift: StructureShiftSnapshot | null;
  qmlLevel: number | null;
  shoulderPrice: number | null;
  headPrice: number | null;
  invalidationPrice: number | null;
  entryLower: number | null;
  entryUpper: number | null;
  targetPrice: number | null;
  targetType: LiquidityLevelType | null;
  retestCount: number;
  firstRetest: boolean;
  ageBars: number;
  reasons: QmlReasonCode[];
  blockers: QmlReasonCode[];
}

export type MarketLocationZone =
  | "ABOVE_PREVIOUS_DAY"
  | "UPPER_EXTERNAL_LIQUIDITY"
  | "RANGE_UPPER_EDGE"
  | "RANGE_MIDDLE"
  | "RANGE_LOWER_EDGE"
  | "LOWER_EXTERNAL_LIQUIDITY"
  | "BELOW_PREVIOUS_DAY"
  | "UNAVAILABLE";

export interface SessionLiquiditySnapshot {
  timestampMs: number;
  activeSession: import("./trading-session").XauTradingSession;
  location: MarketLocationZone;
  previousDayHigh: number | null;
  previousDayLow: number | null;
  previousWeekHigh: number | null;
  previousWeekLow: number | null;
  asiaHigh: number | null;
  asiaLow: number | null;
  londonHigh: number | null;
  londonLow: number | null;
  newYorkHigh: number | null;
  newYorkLow: number | null;
  nearestLiquidityAbove: LiquidityLevelSnapshot | null;
  nearestLiquidityBelow: LiquidityLevelSnapshot | null;
  latestSweep: LiquiditySweepSnapshot | null;
  latestStructureShift: StructureShiftSnapshot | null;
  qml: QmlSetupSnapshot;
  dataReady: boolean;
}

export interface SessionLiquidityCoverageBreakdown {
  complete: number;
  expectedMarketClosure: number;
  boundaryAndClosure: number;
  partialUsable: number;
  partialRejected: number;
  missingData: number;
  overfull: number;
}

export interface SessionLiquidityReadinessDiagnostics {
  d1TotalClosed: number;
  d1UsableClosed: number;
  h1TotalClosed: number;
  h1UsableClosed: number;
  minimumRequiredD1: number;
  minimumRequiredH1: number;
  d1RejectedByCoverage: number;
  h1RejectedByCoverage: number;
  d1Coverage: SessionLiquidityCoverageBreakdown;
  h1Coverage: SessionLiquidityCoverageBreakdown;
  lastFailureReasons: string[];
}

export interface SessionLiquiditySummary {
  sampleCount: number;
  dataReadySamples: number;
  sweepCount: number;
  bullishSweepCount: number;
  bearishSweepCount: number;
  bosCount: number;
  mssCount: number;
  qmlWatchCount: number;
  qmlMssCount: number;
  qmlRetestConfirmedCount: number;
  qmlInvalidatedCount: number;
  qmlExpiredCount: number;
  qmlGradeReadyCount: number;
  sessionCounts: Record<import("./trading-session").XauTradingSession, number>;
  locationCounts: Record<MarketLocationZone, number>;
  strongestQmlSetups: QmlSetupSnapshot[];
  readiness: SessionLiquidityReadinessDiagnostics;
}

export type HypothesisDirection = "BULLISH" | "BEARISH" | "RANGE";

export type HypothesisState =
  | "DORMANT"
  | "WEAK"
  | "ACTIVE"
  | "LEADING"
  | "CONFLICTED";

export type HypothesisEvidenceCode =
  | "DAILY_BULLISH"
  | "DAILY_BEARISH"
  | "DAILY_RANGE_OR_COMPRESSION"
  | "CAMPAIGN_BULLISH"
  | "CAMPAIGN_BEARISH"
  | "CAMPAIGN_BALANCED"
  | "HOURLY_BULLISH_LOCATION"
  | "HOURLY_BEARISH_LOCATION"
  | "HOURLY_RANGE_LOCATION"
  | "M15_BULLISH_PRESSURE"
  | "M15_BEARISH_PRESSURE"
  | "M15_ROTATION_OR_COMPRESSION"
  | "M5_BULLISH_CONSTRUCTION"
  | "M5_BEARISH_CONSTRUCTION"
  | "M5_RANGE_CONSTRUCTION"
  | "M1_BULLISH_EXECUTION"
  | "M1_BEARISH_EXECUTION"
  | "M1_CALM_OR_MIXED"
  | "FRESH_ALIGNMENT"
  | "PRODUCTIVE_DISAGREEMENT"
  | "DESTRUCTIVE_DISAGREEMENT"
  | "COMPOSITE_RANGE"
  | "COMPOSITE_COMPRESSION"
  | "COMPOSITE_NOISE"
  | "HIGH_LATE_ENTRY_RISK"
  | "PARTIAL_HIGHER_TIMEFRAME_DATA"
  | "MOMENTUM_BULLISH"
  | "MOMENTUM_BEARISH"
  | "MOMENTUM_DECAY"
  | "BREAK_BULLISH_ACCEPTED"
  | "BREAK_BEARISH_ACCEPTED"
  | "BREAK_BULLISH_FAILED"
  | "BREAK_BEARISH_FAILED";

export interface HypothesisEvaluation {
  direction: HypothesisDirection;
  state: HypothesisState;
  score: number;
  supportScore: number;
  contradictionScore: number;
  support: HypothesisEvidenceCode[];
  contradictions: HypothesisEvidenceCode[];
}

export type OpportunityFamily =
  | "PRESSURE_RELEASE"
  | "FAILED_BREAK_REVERSAL"
  | "IMPULSE_RELOAD"
  | "TIMEFRAME_ROTATION"
  | "SESSION_LIQUIDITY_QML";

export type OpportunityDirection = "BULLISH" | "BEARISH" | "NEUTRAL";

export type OpportunityStage =
  | "ABSENT"
  | "WATCH"
  | "DEVELOPING"
  | "MATURE_CANDIDATE"
  | "DEGRADED";

export type OpportunityEvidenceCode =
  | "COMPRESSION_CONTEXT"
  | "DIRECTIONAL_PRESSURE"
  | "BREAK_ATTEMPT"
  | "BREAK_ACCEPTED"
  | "BREAK_FAILED"
  | "OPPOSITE_RECOVERY"
  | "HIGHER_TIMEFRAME_SUPPORT"
  | "FAVOURABLE_HOURLY_LOCATION"
  | "CONTROLLED_PULLBACK"
  | "RECOVERY_CONFIRMED"
  | "PRODUCTIVE_TIMEFRAME_DISAGREEMENT"
  | "LOWER_TIMEFRAME_ROTATION"
  | "FRESH_EXECUTION"
  | "STRONG_EXECUTION"
  | "RANGE_EDGE_CONTEXT"
  | "MOMENTUM_ACCELERATION"
  | "MOMENTUM_DECAY"
  | "NOISY_MARKET"
  | "DESTRUCTIVE_TIMEFRAME_CONFLICT"
  | "HIGH_LATE_ENTRY_RISK"
  | "PARTIAL_DATA"
  | "DIRECTION_CONFLICT"
  | "MISSING_TRIGGER"
  | "EXTENDED_MOVE"
  | "MAJOR_LIQUIDITY_LOCATION"
  | "LIQUIDITY_SWEEP"
  | "LEVEL_RECLAIM"
  | "MARKET_STRUCTURE_SHIFT"
  | "QML_LEVEL_DEFINED"
  | "FIRST_RETEST"
  | "SECOND_RETEST"
  | "ACTIVE_SESSION"
  | "OPPOSITE_LIQUIDITY_TARGET"
  | "RETEST_NOT_CONFIRMED"
  | "QML_INVALIDATED";

export interface OpportunityCandidate {
  family: OpportunityFamily;
  direction: OpportunityDirection;
  stage: OpportunityStage;
  score: number;
  contextScore: number;
  developmentScore: number;
  triggerScore: number;
  freshnessScore: number;
  evidence: OpportunityEvidenceCode[];
  blockers: OpportunityEvidenceCode[];
}

export type OpportunityAvailability = "NONE" | "WATCH" | "CANDIDATE";

export interface HypothesisOpportunitySnapshot {
  timestampMs: number;
  hypotheses: [HypothesisEvaluation, HypothesisEvaluation, HypothesisEvaluation];
  leadingHypothesis: HypothesisDirection;
  leadingHypothesisScore: number;
  opportunityAvailability: OpportunityAvailability;
  opportunities: OpportunityCandidate[];
  bestOpportunity: OpportunityCandidate | null;
}

export interface OpportunityEvent {
  timestampMs: number;
  family: OpportunityFamily;
  direction: OpportunityDirection;
  stage: OpportunityStage;
  score: number;
}

export interface HypothesisOpportunitySummary {
  sampleCount: number;
  leadingHypothesisCounts: Record<HypothesisDirection, number>;
  opportunityStageCounts: Record<OpportunityStage, number>;
  opportunityFamilyCounts: Record<OpportunityFamily, number>;
  matureCandidateCount: number;
  averageLeadingHypothesisScore: number;
  averageBestOpportunityScore: number;
  strongestOpportunities: OpportunityEvent[];
}

export type SignalLifecycleState =
  | "OBSERVING"
  | "WATCH"
  | "ARMED"
  | "CONFIRMED"
  | "CONTINUATION"
  | "INVALIDATED"
  | "NO_TRADE";

export type SignalAction = "BUY" | "SELL" | "NONE";

export type SignalDecisionReasonCode =
  | "OPPORTUNITY_OBSERVED"
  | "DEVELOPMENT_PERSISTED"
  | "MATURE_CANDIDATE"
  | "HYPOTHESIS_ALIGNED"
  | "REVERSAL_OR_ROTATION_EXCEPTION"
  | "CLEAN_EXECUTION"
  | "FRESH_TRIGGER"
  | "FAST_TRACK_CONFIRMATION"
  | "CONFIRMATION_PERSISTED"
  | "CONTINUATION_AFTER_PULLBACK"
  | "DUPLICATE_SUPPRESSED"
  | "CANDIDATE_GRACE_PERIOD"
  | "CANDIDATE_EXPIRED"
  | "CANDIDATE_DEGRADED"
  | "DIRECTION_FLIPPED"
  | "HYPOTHESIS_INVALIDATED"
  | "NOISY_OR_PARTIAL_DATA"
  | "LATE_OR_EXTENDED"
  | "TRIGGER_INCOMPLETE"
  | "COOLDOWN_ACTIVE"
  | "NO_QUALIFIED_OPPORTUNITY";

export type NoTradeReasonCode =
  | "NO_OPPORTUNITY"
  | "PARTIAL_DATA"
  | "NOISY_MARKET"
  | "DESTRUCTIVE_TIMEFRAME_CONFLICT"
  | "LATE_ENTRY"
  | "EXTENDED_MOVE"
  | "DIRECTION_CONFLICT"
  | "MISSING_TRIGGER"
  | "COOLDOWN"
  | "AMBIGUOUS_HYPOTHESES";

export interface SignalTrackSnapshot {
  family: OpportunityFamily;
  direction: OpportunityDirection;
  lifecycle: SignalLifecycleState;
  action: SignalAction;
  candidateStage: OpportunityStage;
  candidateScore: number;
  hypothesisScore: number;
  episodeId: string | null;
  ageBars: number;
  startedAtMs: number | null;
  armedAtMs: number | null;
  confirmedAtMs: number | null;
  expiresAtMs: number | null;
  referencePrice: number | null;
  reasons: SignalDecisionReasonCode[];
  noTradeReasons: NoTradeReasonCode[];
  opportunityBlockers: OpportunityEvidenceCode[];
  isNewEvent: boolean;
}

export interface SignalDecisionSnapshot {
  timestampMs: number;
  lifecycle: SignalLifecycleState;
  action: SignalAction;
  primaryTrack: SignalTrackSnapshot | null;
  tracks: SignalTrackSnapshot[];
  activeTrackCount: number;
  actionableTrackCount: number;
  noTradeReasons: NoTradeReasonCode[];
  semantics: "DECISION_SIGNAL_NOT_EXECUTION_PERMISSION";
}

export interface SignalDecisionEvent {
  timestampMs: number;
  family: OpportunityFamily;
  direction: OpportunityDirection;
  lifecycle: "CONFIRMED" | "CONTINUATION" | "INVALIDATED";
  action: SignalAction;
  score: number;
  referencePrice: number;
  episodeId: string;
}

export interface SignalDecisionSummary {
  sampleCount: number;
  lifecycleCounts: Record<SignalLifecycleState, number>;
  actionCounts: Record<SignalAction, number>;
  confirmedByFamily: Record<OpportunityFamily, number>;
  confirmedByDirection: Record<"BULLISH" | "BEARISH", number>;
  noTradeReasonCounts: Record<NoTradeReasonCode, number>;
  confirmedSignalCount: number;
  continuationSignalCount: number;
  invalidationCount: number;
  duplicateSuppressedCount: number;
  expiredCandidateCount: number;
  armedEpisodeCount: number;
  averageWatchToArmedBars: number;
  averageArmedToConfirmedBars: number;
  strongestSignals: SignalDecisionEvent[];
  recentEvents: SignalDecisionEvent[];
}


export interface SignalDecisionHistoryItem {
  timestampMs: number;
  family: OpportunityFamily;
  direction: OpportunityDirection;
  lifecycle: "CONFIRMED" | "CONTINUATION" | "INVALIDATED";
  action: SignalAction;
  candidateScore: number;
  referencePrice: number;
  episodeId: string | null;
  reasons: SignalDecisionReasonCode[];
  noTradeReasons: NoTradeReasonCode[];
}

export interface SignalDecisionHistoryResponse {
  analysisId: string;
  offset: number;
  limit: number;
  total: number;
  items: SignalDecisionHistoryItem[];
}

export interface TradeManagementSettings {
  assumedSpreadPrice: number;
  assumedSlippagePrice: number;
  minimumRiskReward: number;
  maximumRiskInAverageRanges: number;
}

export interface ExecutionCostAssumption {
  assumedSpreadPrice: number;
  assumedSlippagePrice: number;
  totalEstimatedCost: number;
  liveVerified: false;
  source: "USER_CONFIGURED_HISTORICAL_ASSUMPTION";
}

export type TradePlanStatus =
  | "NO_SIGNAL"
  | "REJECTED"
  | "WAIT_ENTRY"
  | "ENTRY_VALID"
  | "ACTIVE"
  | "TARGET1_HIT"
  | "TARGET2_HIT"
  | "COMPLETED"
  | "EXPIRED"
  | "INVALIDATED"
  | "AMBIGUOUS_INTRABAR";

export type TradeHealthState =
  | "NOT_ACTIVE"
  | "HEALTHY"
  | "STALLED"
  | "WEAKENING"
  | "TARGET_PROGRESS"
  | "INVALIDATED"
  | "AMBIGUOUS";

export type ExecutionQualification =
  | "NOT_EVALUATED"
  | "BLOCKED"
  | "QUALIFIED_CANDLE_DATA"
  | "ANALYTICAL_ONLY";

export type TradePlanReasonCode =
  | "PHASE6_CONFIRMED"
  | "PHASE6_CONTINUATION"
  | "FAMILY_SPECIFIC_ENTRY"
  | "STRUCTURAL_INVALIDATION_DEFINED"
  | "TARGET_SPACE_AVAILABLE"
  | "MINIMUM_RR_PASSED"
  | "ENTRY_INSIDE_ZONE"
  | "ENTRY_WAITING_RETEST"
  | "QML_SECOND_RETEST_ALLOWED"
  | "NO_CHASE_LIMIT_DEFINED"
  | "EXPIRY_DEFINED"
  | "EXPECTED_MOVEMENT_ESTIMATED"
  | "ENTRY_TOUCHED"
  | "TP1_REACHED"
  | "TP2_REACHED"
  | "TP3_REACHED"
  | "STOP_REACHED"
  | "THESIS_PROGRESSING"
  | "THESIS_STALLED"
  | "THESIS_WEAKENING";

export type TradePlanRejectionCode =
  | "NO_CONFIRMED_SIGNAL"
  | "NEUTRAL_DIRECTION"
  | "PARTIAL_SOURCE_DATA"
  | "INVALID_ENTRY_ZONE"
  | "INVALID_STRUCTURAL_STOP"
  | "STOP_DISTANCE_TOO_SMALL"
  | "STOP_DISTANCE_TOO_WIDE"
  | "TARGET_SPACE_INSUFFICIENT"
  | "RR_BELOW_MINIMUM"
  | "ENTRY_ALREADY_LATE"
  | "SIGNAL_EXPIRED"
  | "STRUCTURE_INVALIDATED"
  | "INTRABAR_SEQUENCE_UNKNOWN"
  | "SUPERSEDED_BY_NEW_SIGNAL"
  | "QUALITY_BELOW_MEDIUM"
  | "TIMEFRAME_ROTATION_CONTEXT_ONLY"
  | "DUPLICATE_MARKET_EPISODE";

export type TradePlanLimitationCode =
  | "HISTORICAL_OHLC_ONLY"
  | "LIVE_SPREAD_UNVERIFIED"
  | "BROKER_CONTRACT_UNAVAILABLE";

export interface EntryZone {
  lower: number;
  upper: number;
  preferred: number;
  noChasePrice: number;
  validForBars: number;
  expiresAtMs: number;
}

export interface StructuralRiskPlan {
  invalidationPrice: number;
  stopLossPrice: number;
  safetyBuffer: number;
  riskDistance: number;
  estimatedExecutionCost: number;
  totalRiskWithCosts: number;
  riskInAverageRanges: number;
}

export type TargetLevelSource =
  | "R_MULTIPLE"
  | "M1_SWING"
  | "M5_SWING"
  | "M15_SWING"
  | "H1_SWING"
  | "M15_RANGE_BOUNDARY"
  | "H1_RANGE_BOUNDARY"
  | "PREVIOUS_DAY_HIGH"
  | "PREVIOUS_DAY_LOW"
  | "PREVIOUS_WEEK_HIGH"
  | "PREVIOUS_WEEK_LOW"
  | "ASIA_HIGH"
  | "ASIA_LOW"
  | "LONDON_HIGH"
  | "LONDON_LOW"
  | "NEW_YORK_HIGH"
  | "NEW_YORK_LOW"
  | "QML_OPPOSITE_LIQUIDITY"
  | "EXPECTED_10M_CAPACITY"
  | "EXPANSION";

export type ObstacleClass = "SOFT" | "MEDIUM" | "HARD";

export type TradeQualityGrade = "A" | "B" | "C" | "BLOCKED";

export interface TradeQualityComponents {
  pattern: number;
  regime: number;
  location: number;
  alignment: number;
  timing: number;
  target: number;
  session: number;
}

export interface TradeQualityAssessment {
  score: number;
  grade: TradeQualityGrade;
  tradeReady: boolean;
  session: import("./trading-session").XauTradingSession;
  components: TradeQualityComponents;
  positiveReasons: string[];
  negativeReasons: string[];
  semantics: "MEDIUM_ACCURACY_SCORE_NOT_PROFITABILITY_PROOF";
}

export interface TradeTarget {
  name: "TP1" | "TP2" | "TP3";
  price: number;
  rewardDistance: number;
  riskReward: number;
  source: TargetLevelSource;
}

export interface TargetSpacePlan {
  nearestObstaclePrice: number | null;
  nearestObstacleSource: Exclude<TargetLevelSource, "R_MULTIPLE" | "EXPECTED_10M_CAPACITY" | "EXPANSION"> | null;
  nearestObstacleClass: ObstacleClass | null;
  obstacleDistance: number | null;
  decisionObstaclePrice: number | null;
  decisionObstacleSource: Exclude<TargetLevelSource, "R_MULTIPLE" | "EXPECTED_10M_CAPACITY" | "EXPANSION"> | null;
  decisionObstacleClass: Exclude<ObstacleClass, "SOFT"> | null;
  decisionObstacleDistance: number | null;
  softObstacleCount: number;
  mediumObstacleCount: number;
  hardObstacleCount: number;
  expected10MinuteCapacity: number;
  limitingFactor: "HISTORICAL_OBSTACLE" | "EXPECTED_10M_CAPACITY";
  obstacleCandidatesEvaluated: number;
  usedExpansionFallback: boolean;
  availableDistance: number;
  availableRiskReward: number;
  targets: TradeTarget[];
}

export interface ExpectedMovementPlan {
  expected5MinuteDistance: number;
  expected10MinuteDistance: number;
  expectedFirstProgressBars: number;
  basisAverageRange20: number;
  confidence: "LOW" | "MEDIUM" | "HIGH";
}

export interface FilledExecutionMetrics {
  actualRiskDistance: number;
  actualTotalRiskWithCosts: number;
  actualRiskRewardToTp1: number;
}

export interface PositionSizingLimitation {
  status: "BROKER_CONTRACT_REQUIRED";
  message: string;
}

export interface TradePlanSnapshot {
  timestampMs: number;
  originTimeframe: "M1";
  executionTimeframe: "M1";
  confirmationTimeframe: "M5";
  biasTimeframe: "M15";
  planId: string | null;
  family: OpportunityFamily | null;
  direction: OpportunityDirection;
  action: SignalAction;
  status: TradePlanStatus;
  health: TradeHealthState;
  executionQualification: ExecutionQualification;
  signalTimestampMs: number | null;
  enteredAtMs: number | null;
  entryPrice: number | null;
  entryZone: EntryZone | null;
  structuralRisk: StructuralRiskPlan | null;
  targetSpace: TargetSpacePlan | null;
  quality: TradeQualityAssessment | null;
  expectedMovement: ExpectedMovementPlan | null;
  filledExecution: FilledExecutionMetrics | null;
  executionCosts: ExecutionCostAssumption;
  currentProtectiveStopPrice: number | null;
  managementAction: "WAIT" | "ENTER_IN_ZONE" | "HOLD" | "MOVE_STOP_TO_BREAK_EVEN" | "TRAIL_STOP_TO_TP1" | "EXIT" | "NO_ACTION";
  barsSinceSignal: number;
  barsSinceEntry: number;
  maximumFavourableExcursion: number;
  maximumAdverseExcursion: number;
  progressInRiskUnits: number;
  reasons: TradePlanReasonCode[];
  rejectionReasons: TradePlanRejectionCode[];
  limitations: TradePlanLimitationCode[];
  positionSizing: PositionSizingLimitation;
  semantics: "ANALYTICAL_TRADE_PLAN_NOT_LIVE_EXECUTION";
}

export interface TradePlanEvent {
  timestampMs: number;
  originTimeframe: "M1";
  executionTimeframe: "M1";
  confirmationTimeframe: "M5";
  biasTimeframe: "M15";
  planId: string;
  family: OpportunityFamily;
  direction: Exclude<OpportunityDirection, "NEUTRAL">;
  action: Exclude<SignalAction, "NONE">;
  status: TradePlanStatus;
  entryPrice: number | null;
  stopLossPrice: number;
  tp1Price: number;
  tp2Price: number | null;
  candidateScore: number;
  riskRewardToTp1: number;
  qualityScore: number;
  qualityGrade: TradeQualityGrade;
  tradeReady: boolean;
  marketEpisodeId: string;
}

export interface TradeManagementSummary {
  sampleCount: number;
  createdPlanCount: number;
  qualifiedPlanCount: number;
  rejectedPlanCount: number;
  enteredPlanCount: number;
  expiredPlanCount: number;
  invalidatedPlanCount: number;
  ambiguousPlanCount: number;
  tp1HitCount: number;
  tp2HitCount: number;
  completedPlanCount: number;
  tradeReadySignalCount: number;
  gradeCounts: Record<TradeQualityGrade, number>;
  averageQualityScore: number;
  duplicateEpisodeCount: number;
  statusCounts: Record<TradePlanStatus, number>;
  rejectionReasonCounts: Record<TradePlanRejectionCode, number>;
  limitationCounts: Record<TradePlanLimitationCode, number>;
  averageRiskDistance: number;
  averageTp1RiskReward: number;
  averageBarsToEntry: number;
  strongestPlans: TradePlanEvent[];
  recentEvents: TradePlanEvent[];
}

export interface TradePlanHistoryItem extends TradePlanEvent {
  signalTimestampMs: number;
  enteredAtMs: number | null;
  finalHealth: TradeHealthState;
  maximumFavourableExcursion: number;
  maximumAdverseExcursion: number;
  highestTargetHit: 0 | 1 | 2 | 3;
  entryZone: EntryZone;
  structuralRisk: StructuralRiskPlan;
  targetSpace: TargetSpacePlan;
  quality: TradeQualityAssessment;
  expectedMovement: ExpectedMovementPlan;
  filledExecution: FilledExecutionMetrics | null;
  executionCosts: ExecutionCostAssumption;
  reasons: TradePlanReasonCode[];
  rejectionReasons: TradePlanRejectionCode[];
  limitations: TradePlanLimitationCode[];
  semantics: "ANALYTICAL_TRADE_PLAN_NOT_LIVE_EXECUTION";
}

export interface TradePlanHistoryResponse {
  analysisId: string;
  offset: number;
  limit: number;
  total: number;
  items: TradePlanHistoryItem[];
}

export type Phase12SignalPermission = "TRADE_READY" | "PAPER_TRADE" | "RESEARCH_ONLY" | "BLOCKED";
export type Phase12SignalSource = "LEGACY_M1_ENGINE" | "NATIVE_TIMEFRAME_ENGINE";
export type Phase12Outcome = "WIN" | "LOSS" | "OPEN" | "AMBIGUOUS" | "NO_ENTRY";

export interface Phase12NativeSignal {
  signalId: string;
  timestampMs: number;
  originTimeframe: SignalOriginTimeframe;
  executionTimeframe: SignalOriginTimeframe;
  confirmationTimeframe: "M5" | "M15" | "H1";
  confirmationDirection: PriceDirection;
  confirmationPassed: boolean;
  biasTimeframe: "M15" | "H1" | "D1";
  biasDirection: PriceDirection;
  biasPassed: boolean;
  source: Phase12SignalSource;
  family: OpportunityFamily;
  direction: Exclude<OpportunityDirection, "NEUTRAL">;
  action: Exclude<SignalAction, "NONE">;
  score: number;
  grade: TradeQualityGrade;
  permission: Phase12SignalPermission;
  entryPrice: number;
  stopLossPrice: number;
  tp1Price: number;
  riskReward: number;
  dataIntegrityGrade: DataIntegrityGrade;
  reasons: string[];
  warnings: string[];
  outcome: Phase12Outcome;
  realizedR: number | null;
}

export interface Phase12TimeframeSignalSummary {
  originTimeframe: SignalOriginTimeframe;
  generated: number;
  tradeReady: number;
  paperTrade: number;
  researchOnly: number;
  blocked: number;
  gradeA: number;
  gradeB: number;
  wins: number;
  losses: number;
  open: number;
  expectancyR: number | null;
  familyCounts: Record<OpportunityFamily, number>;
}

export interface Phase12MultiTimeframeReport {
  architecture: "NATIVE_M1_M5_M15_WITH_HTF_CONTEXT";
  signals: Phase12NativeSignal[];
  timeframeSummaries: Record<SignalOriginTimeframe, Phase12TimeframeSignalSummary>;
  totalSignals: number;
  totalTradeReady: number;
  qmlReadinessFixed: boolean;
  qmlReadinessDiagnostics: SessionLiquidityReadinessDiagnostics;
  diagnostics: string[];
  semantics: "NATIVE_TIMEFRAME_SIGNALS_NOT_PROFITABILITY_PROOF";
}

export interface ChartSignalMarker {
  timestampMs: number;
  eventTimestampMs: number;
  family: OpportunityFamily;
  direction: OpportunityDirection;
  lifecycle: "CONFIRMED" | "CONTINUATION" | "INVALIDATED";
  action: SignalAction;
  score: number;
  referencePrice: number;
  label: string;
  markerKind?: "TRADE_READY" | "RESEARCH";
  grade?: TradeQualityGrade;
  planStatus?: TradePlanStatus;
  originTimeframe?: SignalOriginTimeframe;
  executionTimeframe?: SignalOriginTimeframe;
  signalSource?: Phase12SignalSource;
  permission?: Phase12SignalPermission;
}

export interface AnalysisReportTopCount {
  code: string;
  count: number;
}

export interface AnalysisReportSummary {
  reportVersion: "1.0";
  generatedAtUtc: string;
  requestedFromUtc: string;
  requestedToUtc: string;
  symbol: string;
  processingMs: number;
  dataQuality: {
    received: number;
    validM1Candles: number;
    contextM1Candles: number;
    warmupM1Candles: number;
    invalidRecords: number;
    duplicates: number;
    duplicateConflicts: number;
    closedMarketCandlesRemoved: number;
    staleCandlesRemoved: number;
    gapSafetyCandlesMarked: number;
    missingTradableCandles: number;
    expectedClosedCandles: number;
    gapCount: number;
    qualityFlags: string[];
  };
  latestContext: {
    compositeMarketState: CompositeMarketState;
    compositeDirection: PriceDirection;
    alignment: TimeframeAlignment;
    leadingHypothesis: HypothesisDirection;
    leadingHypothesisScore: number;
    signalAction: SignalAction;
    signalLifecycle: SignalLifecycleState;
    tradePlanStatus: TradePlanStatus;
    tradePlanAction: SignalAction;
    activeSession: import("./trading-session").XauTradingSession;
    marketLocation: MarketLocationZone;
    qmlStage: QmlSetupStage;
    qmlDirection: OpportunityDirection;
    qmlScore: number;
  };
  signalOverview: {
    confirmed: number;
    continuations: number;
    invalidations: number;
    buyDecisions: number;
    sellDecisions: number;
    duplicateSuppressed: number;
    expiredCandidates: number;
    confirmedByFamily: Record<OpportunityFamily, number>;
    topNoTradeReasons: AnalysisReportTopCount[];
  };
  tradeOverview: {
    created: number;
    qualified: number;
    rejected: number;
    entered: number;
    expired: number;
    invalidated: number;
    ambiguous: number;
    tp1Hit: number;
    tp2Hit: number;
    completed: number;
    tradeReadySignals: number;
    gradeA: number;
    gradeB: number;
    gradeC: number;
    blockedGrade: number;
    averageQualityScore: number;
    duplicateEpisodesSuppressed: number;
    averageRiskDistance: number;
    averageTp1RiskReward: number;
    averageBarsToEntry: number;
    topRejectionReasons: AnalysisReportTopCount[];
  };
  observedRates: {
    qualificationRatePercent: number;
    entryFillRatePercent: number;
    tp1ProgressRatePercent: number;
    completionRatePercent: number;
    intrabarAmbiguityRatePercent: number;
    invalidationsPer100Decisions: number;
  };
  comparisonMetrics: Record<string, number>;
  keyFindings: string[];
  diagnosticFlags: string[];
  semantics: "OBSERVED_HISTORICAL_ANALYSIS_NOT_PROFITABILITY_PROOF";
}

export interface AnalysisReportFamilyBreakdown {
  confirmedSignals: number;
  continuationSignals: number;
  invalidations: number;
  plansCreated: number;
  plansQualified: number;
  entriesObserved: number;
  tp1Hit: number;
  completed: number;
  ambiguous: number;
  gradeA: number;
  gradeB: number;
  tradeReady: number;
}


export type DataIntegrityGrade = "A_DATA" | "B_DATA" | "C_DATA" | "INVALID_DATA";
export type AmbiguityPolicy = "UNRESOLVED" | "CONSERVATIVE" | "CLOSE_CONFIRMATION";

export interface TradeDataIntegrity {
  grade: DataIntegrityGrade;
  overallMissingRatePercent: number;
  previousGapDistanceBars: number | null;
  nextGapDistanceBars: number | null;
  nearestGapDistanceBars: number | null;
  safeForPerformance: boolean;
  maximumAllowedSignalGrade: "A" | "B" | "RESEARCH_ONLY" | "BLOCKED";
  reasons: string[];
}

export interface AnalyticalTradeOutcome {
  outcome: "WIN" | "LOSS" | "BREAK_EVEN" | "OPEN" | "NO_ENTRY" | "AMBIGUOUS" | "UNRESOLVED";
  exitReason: "TP1" | "TP2" | "TP3" | "STOP_LOSS" | "BREAK_EVEN" | "EXPIRED" | "NO_ENTRY" | "AMBIGUOUS" | "OPEN";
  exitPrice: number | null;
  exitTimestampMs: number | null;
  realizedR: number | null;
  mfeR: number | null;
  maeR: number | null;
  holdingMinutes: number | null;
  barsToTp1: number | null;
  barsToStop: number | null;
  semantics: "ANALYTICAL_OHLC_OUTCOME_NOT_BROKER_PNL";
}

export interface ShadowPlanOutcome {
  evaluated: boolean;
  entryFilled: boolean;
  outcome: "TP1" | "STOP" | "NO_FILL" | "AMBIGUOUS" | "OPEN";
  barsToEntry: number | null;
  barsToOutcome: number | null;
  maximumFavourableExcursionR: number;
  maximumAdverseExcursionR: number;
  rejectionWouldHaveAvoidedLoss: boolean;
  rejectionWouldHaveMissedWinner: boolean;
  semantics: "SHADOW_REPLAY_FOR_RULE_CALIBRATION_ONLY";
}

export interface TraderReasoning {
  thesis: string;
  whyTradeExists: string[];
  whyNotHigherGrade: string[];
  invalidationNarrative: string;
  targetNarrative: string;
  dataWarning: string | null;
}

export interface Phase10TradePlanAnalytics {
  planId: string;
  dataIntegrity: TradeDataIntegrity;
  outcome: AnalyticalTradeOutcome;
  shadowOutcome: ShadowPlanOutcome | null;
  traderReasoning: TraderReasoning;
}

export interface ScoreCalibrationBucket {
  bucket: string;
  plans: number;
  entries: number;
  resolved: number;
  wins: number;
  losses: number;
  breakEven: number;
  ambiguous: number;
  winRatePercent: number | null;
  averageRealizedR: number | null;
  averageMfeR: number | null;
  averageMaeR: number | null;
}

export interface RejectionRuleCalibration {
  code: TradePlanRejectionCode;
  rejectedPlans: number;
  shadowEntries: number;
  lossesAvoided: number;
  winnersMissed: number;
  noFill: number;
  ambiguous: number;
}

export interface Phase10CalibrationReport {
  qmlDataReady: boolean;
  dataIntegrityGrade: DataIntegrityGrade;
  officialPerformanceValid: boolean;
  ambiguityPolicies: Record<AmbiguityPolicy, { resolved: number; wins: number; losses: number; winRatePercent: number | null }>;
  aggregateRealizedR: number;
  profitFactorR: number | null;
  scoreBuckets: ScoreCalibrationBucket[];
  rejectionRules: RejectionRuleCalibration[];
  tradeAnalytics: Phase10TradePlanAnalytics[];
  diagnostics: string[];
  semantics: "PHASE10_CALIBRATION_NOT_PROFITABILITY_GUARANTEE";
}


export type Phase11AuditGrade = "A" | "B" | "C" | "BLOCKED";
export type Phase11DeploymentPermission = "LIVE_CANDIDATE" | "PAPER_TRADE" | "RESEARCH_ONLY" | "BLOCKED";
export type Phase11SystemVerdict = "LIVE_CANDIDATE" | "PAPER_READY" | "DEVELOPING" | "NOT_READY";

export type ScalpingAuditHardVetoCode =
  | "PLAN_REJECTED"
  | "SOURCE_DATA_INVALID"
  | "DATA_GAP_NEAR_SIGNAL"
  | "PARTIAL_SOURCE_DATA"
  | "NOISE_REGIME"
  | "RANGE_MIDDLE_REVERSAL"
  | "QML_CONTEXT_NOT_READY"
  | "QML_RETEST_NOT_CONFIRMED"
  | "THIRD_OR_LATER_RETEST"
  | "TIMEFRAME_ROTATION_CONTEXT_ONLY"
  | "ENTRY_ALREADY_LATE"
  | "INVALID_STRUCTURAL_STOP"
  | "RR_BELOW_MINIMUM";

export interface Phase11AuditComponent {
  category:
    | "DATA_INTEGRITY"
    | "HTF_CONTEXT"
    | "SESSION_QUALITY"
    | "LIQUIDITY_LOCATION"
    | "SETUP_STRUCTURE"
    | "ENTRY_QUALITY"
    | "RISK_STRUCTURE"
    | "TARGET_QUALITY"
    | "STATISTICAL_EVIDENCE";
  score: number;
  maxScore: number;
  checks: string[];
  warnings: string[];
}

export interface Phase11SignalAudit {
  planId: string;
  family: OpportunityFamily;
  direction: Exclude<OpportunityDirection, "NEUTRAL">;
  signalTimestampMs: number;
  technicalScore: number;
  evidenceScore: number;
  totalScore: number;
  grade: Phase11AuditGrade;
  deploymentPermission: Phase11DeploymentPermission;
  suggestedRiskPercent: number;
  hardVetoes: ScalpingAuditHardVetoCode[];
  softWarnings: string[];
  components: Phase11AuditComponent[];
  context: {
    session: import("./trading-session").XauTradingSession;
    regime: CompositeMarketState;
    alignment: TimeframeAlignment;
    marketLocation: MarketLocationZone;
    qmlStage: QmlSetupStage;
    retestCount: number;
  };
  semantics: "PROFESSIONAL_SCALPING_AUDIT_NOT_PROFITABILITY_GUARANTEE";
}

export interface Phase11PerformanceSlice {
  key: string;
  plans: number;
  entered: number;
  resolved: number;
  wins: number;
  losses: number;
  breakEven: number;
  ambiguous: number;
  aggregateR: number;
  expectancyR: number | null;
  winRatePercent: number | null;
  profitFactorR: number | null;
  averageWinnerR: number | null;
  averageLoserR: number | null;
  maximumDrawdownR: number;
  maximumLosingStreak: number;
}

export interface Phase11ForwardValidation {
  method: "CHRONOLOGICAL_70_30_HOLDOUT";
  calibration: Phase11PerformanceSlice;
  forward: Phase11PerformanceSlice;
  sampleSufficient: boolean;
  positive: boolean;
}

export interface Phase11SystemGate {
  code: string;
  passed: boolean;
  current: number | string | boolean | null;
  required: string;
  requiredForLive: boolean;
}

export interface Phase11ScalpingAuditReport {
  systemScore: number;
  systemVerdict: Phase11SystemVerdict;
  liveReady: boolean;
  technicalMaximumScore: 90;
  totalMaximumScore: 100;
  auditCounts: Record<Phase11AuditGrade, number>;
  permissionCounts: Record<Phase11DeploymentPermission, number>;
  overallPerformance: Phase11PerformanceSlice;
  familyPerformance: Phase11PerformanceSlice[];
  sessionPerformance: Phase11PerformanceSlice[];
  regimePerformance: Phase11PerformanceSlice[];
  gradePerformance: Phase11PerformanceSlice[];
  forwardValidation: Phase11ForwardValidation;
  gates: Phase11SystemGate[];
  hardVetoCounts: Record<string, number>;
  planAudits: Phase11SignalAudit[];
  diagnostics: string[];
  semantics: "PHASE11_SCALPING_AUDIT_REQUIRES_FORWARD_VALIDATION_BEFORE_LIVE_USE";
}

export interface AnalysisReport {
  analysisId: string;
  summary: AnalysisReportSummary;
  engineConfiguration: Record<string, unknown>;
  timeframeSummaries: {
    candleBehaviour: Record<Timeframe, CandleBehaviourSummary>;
    priceBehaviour: Record<Timeframe, PriceBehaviourSummary>;
    marketState: MultiTimeframeStateSummary;
    sessionLiquidity: SessionLiquiditySummary;
    hypothesesAndOpportunities: HypothesisOpportunitySummary;
    signalDecision: SignalDecisionSummary;
    tradeManagement: TradeManagementSummary;
  };
  familyBreakdown: Record<OpportunityFamily, AnalysisReportFamilyBreakdown>;
  signalEvents: SignalDecisionHistoryItem[];
  tradePlans: TradePlanHistoryItem[];
  dataIssueSamples: DataIssue[];
  gapSamples: GapRecord[];
  phase10: Phase10CalibrationReport;
  phase11: Phase11ScalpingAuditReport;
  phase12: Phase12MultiTimeframeReport;
  semantics: "COMPLETE_HISTORICAL_ANALYSIS_REPORT_FOR_COMPARISON_AND_REVIEW";
}

export interface AnalysisReportBundle {
  bundleVersion: "1.0";
  exportedAtUtc: string;
  reportCount: number;
  reports: AnalysisReport[];
}
