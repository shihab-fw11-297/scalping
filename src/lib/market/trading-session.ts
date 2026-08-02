export type XauTradingSession =
  | "ASIA"
  | "LONDON"
  | "NEW_YORK"
  | "LONDON_NEW_YORK_OVERLAP"
  | "OFF_HOURS";

const londonFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const newYorkFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function minutesInZone(timestampMs: number, formatter: Intl.DateTimeFormat): number {
  const parts = formatter.formatToParts(new Date(timestampMs));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

export function classifyXauTradingSession(timestampMs: number): XauTradingSession {
  const utc = new Date(timestampMs);
  const utcMinutes = utc.getUTCHours() * 60 + utc.getUTCMinutes();
  const londonMinutes = minutesInZone(timestampMs, londonFormatter);
  const newYorkMinutes = minutesInZone(timestampMs, newYorkFormatter);

  const londonActive = londonMinutes >= 7 * 60 && londonMinutes < 12 * 60;
  const newYorkActive = newYorkMinutes >= 8 * 60 && newYorkMinutes < 13 * 60;
  if (londonActive && newYorkActive) return "LONDON_NEW_YORK_OVERLAP";
  if (londonActive) return "LONDON";
  if (newYorkActive) return "NEW_YORK";
  if (utcMinutes >= 0 && utcMinutes < 6 * 60) return "ASIA";
  return "OFF_HOURS";
}
