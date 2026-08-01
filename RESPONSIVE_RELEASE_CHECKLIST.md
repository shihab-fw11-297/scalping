# Responsive Release Checklist

## Global layout

- [x] 280px minimum document safeguard
- [x] 320px phone layout
- [x] 375px and 430px phone layouts
- [x] 768px tablet layout
- [x] Short landscape mobile layout
- [x] 1024px laptop layout
- [x] 1440px desktop layout
- [x] 1920px wide desktop layout
- [x] No document-level horizontal overflow in audited viewports
- [x] Safe-area-aware page padding
- [x] Long headings and values wrap instead of overflowing
- [x] Reduced-motion preference supported

## Input and action controls

- [x] Four-column wide-desktop analysis form
- [x] Three-column laptop analysis form
- [x] Two-column tablet analysis form
- [x] Single-column phone analysis form
- [x] Full-width mobile submit action
- [x] Minimum 44px touch target for buttons, links, inputs and selects
- [x] Visible keyboard focus states
- [x] Mobile-safe datetime and number inputs
- [x] Export buttons wrap and stack by viewport

## Dashboard cards

- [x] Metrics use responsive auto-fit columns
- [x] State, hypothesis, opportunity, signal and trade cards collapse safely
- [x] Report cards become single-column on tablets
- [x] Report collection controls stack on small screens
- [x] Long diagnostic flags and evidence codes wrap
- [x] Status pills wrap without clipping

## Chart controls

- [x] Timeframe tabs scroll horizontally when needed
- [x] Server-window selector moves below tabs on tablets
- [x] Marker toggles use touch-friendly card controls
- [x] Show/hide signal buttons stack on phones
- [x] Requested-range controls stack on phones
- [x] Chart height adapts to viewport width and height
- [x] Short landscape screens receive a dedicated chart-height rule
- [x] TradingView chart remains auto-sized

## Data table

- [x] Wide behaviour table stays inside its panel
- [x] Horizontal touch scrolling enabled
- [x] Sticky UTC timestamp column
- [x] Mobile swipe guidance shown
- [x] Keyboard-focusable labelled table region
- [x] Table height adapts to small screens
- [x] Full data remains available; fields are not silently removed

## Verification

- [x] CSS parsed without syntax errors
- [x] Static TypeScript/TSX syntax transpilation passed
- [x] Responsive verification script passed
- [x] Chromium visual fixture tested at eight viewports
- [x] Root overflow was zero at all eight viewports
- [x] Minimum non-range control height was 44px at all viewports
- [x] Existing Phase 1–7 engine code was not changed

## External runtime gate

- [ ] Install npm dependencies on target machine
- [ ] Run full Next.js production build
- [ ] Inspect real chart and populated dashboard in Chrome, Safari and Firefox
- [ ] Test native iOS and Android datetime controls
