import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "XAUUSD Historical Market Intelligence Analyzer — Phase 7",
  description: "One-click Finage XAUUSD analysis with candle and price behaviour, synchronized multi-timeframe state, opportunity and signal lifecycles, plus analytical entry, stop, targets and trade management.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
