# Benchmark Report — Phase 7 Complete

## Latest synthetic 100K pipeline run

```text
Input M1 candles:              100,000
M5 candles:                     20,000
M15 candles:                     6,667
H1 candles:                      1,667
D1 candles:                         70

Phase 4 state samples:         100,000
Phase 5 hypothesis samples:    100,000
Phase 6 decision samples:      100,000
Phase 7 plans created:             327
Phase 7 plans qualified:           170
Phase 7 plans rejected:            157
Phase 7 entries observed:            71
Phase 7 intrabar ambiguous:          98
Phase 7 completed plans:              29

Complete Phase 1–7:          ~2,203 ms
Measured heap delta:          ~35.66 MB
```

These are deterministic synthetic workload counts, not win-rate, profitability or live-execution claims.

## Browser payload

```text
Full server dataset:          100,000 candles
Browser M1 window:              5,000 candles
Serialized payload:             4.94 MB
Feature + serialization:      ~294 ms
Payload guard:                 <8 MB
```

The browser receives one Phase 7 snapshot for the selected window end. Full plan history is paginated or streamed through the dedicated trade export endpoint.

## Isolated Phase 7 verification fixture

```text
Samples:                       40,000
Plans:                            133
Qualified:                         68
Rejected:                          65
Entries:                           27
Invalidated:                       22
Intrabar ambiguous:                41
TP1 transitions:                    1
Completed plans:                    5
Phase 7 verification:            ~840–846 ms
```

The fixture deliberately exercises structural rejection, target-space rejection, entry ambiguity, invalidation and no-lookahead behaviour.

## Complexity

- O(N) Phase 7 lifecycle traversal
- fixed four-family runtime
- O(1) per-candle active-plan updates
- bounded M1/M5/M15/H1 obstacle work only when a plan is created
- compact typed arrays for historical state
- O(log N) historical timestamp lookup
- backpressure-aware streamed trade-plan export

## Excluded from timing

- Finage network latency
- HTTP transfer
- actual Next.js server overhead
- React and chart rendering
- browser garbage collection
- live broker quote and order latency

## Automatic report and marker measurements

```text
40K verification signal events:       446
40K verification trade plans:         133
M1 markers in final 5K window:          36
M5-aligned markers:                     36
Complete 40K JSON report:          ~0.48 MB
```

Latest regression after adding windowed signal markers:

```text
Complete synthetic Phase 1–7:     ~2.33 seconds
Measured heap delta:               ~33.22 MB
5K browser payload with markers:    4.94 MB
Browser payload guard:              <8 MB
```

The six-report collection stores reports only, not raw 100K candle arrays. It is capped at six reports in browser-tab memory.

## Responsive viewport measurements

The responsive visual fixture produced zero document-level horizontal overflow at all audited viewports:

```text
320×568, 375×812, 430×932,
768×1024, 844×390 landscape,
1024×768, 1440×900, 1920×1080
```

The chart scaled from 298×300 on the 320px fixture to 1710×713 on the 1920px fixture. All non-range form/action controls retained a minimum height of 44px. Responsive CSS does not alter Phase 1–7 server processing complexity or the 100K market benchmark.
