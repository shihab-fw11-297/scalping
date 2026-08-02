export type XauTradingSession =
  | "ASIA"
  | "LONDON"
  | "NEW_YORK"
  | "LONDON_NEW_YORK_OVERLAP"
  | "OFF_HOURS";

export type CoreTradingSession = "ASIA" | "LONDON" | "NEW_YORK";

export interface SessionMembership {
  active: Record<CoreTradingSession, boolean>;
  key: Record<CoreTradingSession, string>;
  minutesFromOpen: Record<CoreTradingSession, number | null>;
}

interface ZonedClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function formatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

const londonFormatter = formatter("Europe/London");
const newYorkFormatter = formatter("America/New_York");

function readClock(timestampMs: number, source: Intl.DateTimeFormat): ZonedClock {
  const parts = source.formatToParts(new Date(timestampMs));
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
  };
}

function utcClock(timestampMs: number): ZonedClock {
  const date = new Date(timestampMs);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  };
}

function dateKey(clock: ZonedClock): string {
  return `${clock.year.toString().padStart(4, "0")}-${clock.month.toString().padStart(2, "0")}-${clock.day.toString().padStart(2, "0")}`;
}

function minutes(clock: ZonedClock): number {
  return clock.hour * 60 + clock.minute;
}

/**
 * Range-building windows used for deterministic liquidity references:
 * Asia range: 00:00-06:00 UTC, London opening range: 07:00-10:00 Europe/London,
 * New York opening range: 08:00-10:00 America/New_York. DST is handled by Intl.
 * Execution-session classification is intentionally broader and is handled separately below.
 */
export function getSessionMembership(timestampMs: number): SessionMembership {
  const utc = utcClock(timestampMs);
  const london = readClock(timestampMs, londonFormatter);
  const newYork = readClock(timestampMs, newYorkFormatter);
  const utcMinute = minutes(utc);
  const londonMinute = minutes(london);
  const newYorkMinute = minutes(newYork);
  const asiaOpen = 0;
  const londonOpen = 7 * 60;
  const newYorkOpen = 8 * 60;
  const asia = utcMinute >= asiaOpen && utcMinute < 6 * 60;
  const londonActive = londonMinute >= londonOpen && londonMinute < 10 * 60;
  const newYorkActive = newYorkMinute >= newYorkOpen && newYorkMinute < 10 * 60;
  return {
    active: { ASIA: asia, LONDON: londonActive, NEW_YORK: newYorkActive },
    key: {
      ASIA: `ASIA:${dateKey(utc)}`,
      LONDON: `LONDON:${dateKey(london)}`,
      NEW_YORK: `NEW_YORK:${dateKey(newYork)}`,
    },
    minutesFromOpen: {
      ASIA: asia ? utcMinute - asiaOpen : null,
      LONDON: londonActive ? londonMinute - londonOpen : null,
      NEW_YORK: newYorkActive ? newYorkMinute - newYorkOpen : null,
    },
  };
}

export function classifyXauTradingSession(timestampMs: number): XauTradingSession {
  const utc = utcClock(timestampMs);
  const london = readClock(timestampMs, londonFormatter);
  const newYork = readClock(timestampMs, newYorkFormatter);
  const utcMinute = minutes(utc);
  const londonMinute = minutes(london);
  const newYorkMinute = minutes(newYork);
  const asia = utcMinute >= 0 && utcMinute < 6 * 60;
  const londonExecution = londonMinute >= 7 * 60 && londonMinute < 16 * 60;
  const newYorkExecution = newYorkMinute >= 8 * 60 && newYorkMinute < 13 * 60;
  if (londonExecution && newYorkExecution) return "LONDON_NEW_YORK_OVERLAP";
  if (londonExecution) return "LONDON";
  if (newYorkExecution) return "NEW_YORK";
  if (asia) return "ASIA";
  return "OFF_HOURS";
}

export function isActiveExecutionSession(session: XauTradingSession): boolean {
  return session === "LONDON" || session === "NEW_YORK" || session === "LONDON_NEW_YORK_OVERLAP";
}
