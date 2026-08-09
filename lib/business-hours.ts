export type BusinessHour = {
  weekday: number;
  opens_at: string | null;
  closes_at: string | null;
  closed: boolean;
};

const timeZone = "America/Sao_Paulo";

function parts(date: Date) {
  const values = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(values.find(item => item.type === type)?.value || 0);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute"), second: value("second") };
}

function pseudoTimestamp(date: Date) {
  const value = parts(date);
  return Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute, value.second);
}

function localDateAtOffset(now: Date, dayOffset: number) {
  const value = parts(now);
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day + dayOffset));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), weekday: date.getUTCDay() };
}

function timeMilliseconds(value: string) {
  const [hour = 0, minute = 0, second = 0] = value.split(":").map(Number);
  return ((hour * 60 + minute) * 60 + second) * 1000;
}

export function saoPauloDateKey(date: Date) {
  const value = parts(date);
  return `${value.year}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
}

export function getCurrentOperatingWindow(hours: BusinessHour[], now = new Date()) {
  if (!hours.length) return { configured: false, isOpen: true, start: Number.NEGATIVE_INFINITY, end: Number.POSITIVE_INFINITY };
  const localNow = pseudoTimestamp(now);
  for (const dayOffset of [-1, 0]) {
    const localDate = localDateAtOffset(now, dayOffset);
    const schedule = hours.find(item => item.weekday === localDate.weekday);
    if (!schedule || schedule.closed || !schedule.opens_at || !schedule.closes_at) continue;
    const midnight = Date.UTC(localDate.year, localDate.month - 1, localDate.day);
    const start = midnight + timeMilliseconds(schedule.opens_at);
    let end = midnight + timeMilliseconds(schedule.closes_at);
    if (end <= start) end += 24 * 60 * 60 * 1000;
    if (localNow >= start && localNow < end) return { configured: true, isOpen: true, start, end };
  }
  return { configured: true, isOpen: false, start: 0, end: 0 };
}

export function isDateInOperatingWindow(dateValue: string | null | undefined, window: ReturnType<typeof getCurrentOperatingWindow>) {
  if (!window.configured) return true;
  if (!window.isOpen || !dateValue) return false;
  const value = pseudoTimestamp(new Date(dateValue));
  return value >= window.start && value < window.end;
}

export function currentWeekDateKeys(now = new Date()) {
  const value = parts(now);
  const current = new Date(Date.UTC(value.year, value.month - 1, value.day));
  const mondayOffset = current.getUTCDay() === 0 ? -6 : 1 - current.getUTCDay();
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(current.getTime() + (mondayOffset + index) * 86400000);
    return `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, "0")}-${String(day.getUTCDate()).padStart(2, "0")}`;
  });
}
