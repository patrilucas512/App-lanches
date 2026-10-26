import type { ManagerPeriodKey, ManagerPeriodRange } from "./types";

const labels: Record<ManagerPeriodKey, string> = {
  today: "Hoje", yesterday: "Ontem", "7d": "7 dias", "30d": "30 dias",
  month: "Mês atual", previous_month: "Mês anterior", custom: "Personalizado",
};

function partsAt(date: Date, timezone: string) {
  const values = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .formatToParts(date).reduce<Record<string, number>>((result, part) => { if (part.type !== "literal") result[part.type] = Number(part.value); return result; }, {});
  return { year: values.year, month: values.month, day: values.day, hour: values.hour, minute: values.minute, second: values.second };
}

function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, second: number, timezone: string) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const atGuess = partsAt(new Date(guess), timezone);
  const represented = Date.UTC(atGuess.year, atGuess.month - 1, atGuess.day, atGuess.hour, atGuess.minute, atGuess.second);
  return new Date(guess - (represented - guess));
}

function shiftDate(year: number, month: number, day: number, days: number) {
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

function localMidnight(date: Date, timezone: string, shift = 0) {
  const p = partsAt(date, timezone); const d = shiftDate(p.year, p.month, p.day, shift);
  return zonedToUtc(d.year, d.month, d.day, 0, 0, 0, timezone);
}

function localMonthStart(date: Date, timezone: string, monthShift = 0) {
  const p = partsAt(date, timezone); const d = new Date(Date.UTC(p.year, p.month - 1 + monthShift, 1));
  return zonedToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, timezone);
}

export function resolveManagerPeriod(key: ManagerPeriodKey, timezone: string, now = new Date(), customStart?: string, customEnd?: string): ManagerPeriodRange {
  let start: Date; let end: Date; let compareStart: Date; let compareEnd: Date; let comparisonLabel: string; let sameHour = false;
  if (key === "today") {
    start = localMidnight(now, timezone); end = now;
    const yesterday = localMidnight(now, timezone, -1); const p = partsAt(now, timezone);
    const d = shiftDate(p.year, p.month, p.day, -1);
    compareStart = yesterday; compareEnd = zonedToUtc(d.year, d.month, d.day, p.hour, p.minute, p.second, timezone);
    comparisonLabel = "mesmo horário de ontem"; sameHour = true;
  } else if (key === "yesterday") {
    start = localMidnight(now, timezone, -1); end = localMidnight(now, timezone);
    compareStart = localMidnight(now, timezone, -2); compareEnd = start; comparisonLabel = "dia anterior";
  } else if (key === "month" || key === "previous_month") {
    const offset = key === "month" ? 0 : -1;
    start = localMonthStart(now, timezone, offset); end = key === "month" ? now : localMonthStart(now, timezone, 0);
    compareStart = localMonthStart(now, timezone, offset - 1);
    compareEnd = key === "month" ? new Date(compareStart.getTime() + (end.getTime() - start.getTime())) : start;
    comparisonLabel = "mês anterior no mesmo intervalo";
  } else if (key === "custom" && customStart && customEnd) {
    const [sy, sm, sd] = customStart.split("-").map(Number); const [ey, em, ed] = customEnd.split("-").map(Number);
    start = zonedToUtc(sy, sm, sd, 0, 0, 0, timezone); end = zonedToUtc(ey, em, ed + 1, 0, 0, 0, timezone);
    const duration = end.getTime() - start.getTime(); compareEnd = start; compareStart = new Date(start.getTime() - duration); comparisonLabel = "período anterior equivalente";
  } else {
    const days = key === "30d" ? 30 : 7;
    start = localMidnight(now, timezone, -(days - 1)); end = now;
    const duration = end.getTime() - start.getTime(); compareEnd = start; compareStart = new Date(start.getTime() - duration); comparisonLabel = `${days} dias anteriores`;
  }
  return { key, label: labels[key], start: start.toISOString(), end: end.toISOString(), compareStart: compareStart.toISOString(), compareEnd: compareEnd.toISOString(), comparisonLabel, sameHour };
}

export const managerPeriodOptions: Array<{ key: ManagerPeriodKey; label: string }> = Object.entries(labels).map(([key, label]) => ({ key: key as ManagerPeriodKey, label }));
