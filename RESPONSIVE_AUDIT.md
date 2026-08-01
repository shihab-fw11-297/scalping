# Responsive UI Audit

The Phase 1–7 analysis application was audited as a data-dense trading dashboard rather than a simple marketing page. The responsive layer covers the fetch form, reports, metric cards, multi-timeframe state panels, signal controls, chart, entry/SL/TP controls and the 29-column behaviour table.

## Audited viewports

| Viewport | Form columns | Chart size | Root overflow | Minimum control height | Result |
|---|---:|---:|---:|---:|---|
| 320 × 568 | 1 | 298 × 300 | 0 px | 44 px | Passed |
| 375 × 812 | 1 | 337 × 406 | 0 px | 44 px | Passed |
| 430 × 932 | 1 | 390 × 450 | 0 px | 44 px | Passed |
| 768 × 1024 | 2 | 708 × 560 | 0 px | 44 px | Passed |
| 844 × 390 landscape | 2 | 781 × 281 | 0 px | 44 px | Passed |
| 1024 × 768 | 3 | 937 × 476 | 0 px | 44 px | Passed |
| 1440 × 900 | 4 | 1336 × 558 | 0 px | 44 px | Passed |
| 1920 × 1080 | 4 | 1710 × 713 | 0 px | 44 px | Passed |

The complete machine-readable measurements are stored in `RESPONSIVE_VIEWPORT_AUDIT.json`.

## Responsive behaviour

- Phone: one-column form and cards, full-width actions, stacked marker toggles and range controls.
- Tablet: two-column inputs, single-column report layout and horizontally scrollable timeframe tabs when required.
- Laptop: three-column form with compact but readable chart controls.
- Desktop: four-column form and dense horizontal dashboards.
- Wide desktop: increased page width, chart height and panel padding.
- Landscape mobile: chart height is constrained by available screen height.
- Behaviour table: horizontal scrolling is intentional because removing analytical fields would hide information. The UTC column remains sticky.

## Limitations of this environment

The visual audit used Chromium with a representative DOM fixture and the production stylesheet. The npm registry did not provide the dependency set, so the dependency-backed Next.js build and a populated real application route could not be launched here. The target-machine browser smoke test remains required.
