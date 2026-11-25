const DAY_MS = 86_400_000;
const cairoCalendar = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
});

export function calendarDayAt(at: Date): string {
  const parts = cairoCalendar.formatToParts(at);
  const part = (type: string) => parts.find((value) => value.type === type)!.value;
  return `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`;
}

export function readCalendarDay(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-") || value.startsWith("9999-")) return null;
  const at = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(at.getTime()) && at.toISOString().slice(0, 10) === value ? value : null;
}

export function addCalendarDays(day: string, count: number): string {
  const at = new Date(`${day}T12:00:00.000Z`);
  at.setUTCDate(at.getUTCDate() + count);
  return at.toISOString().slice(0, 10);
}

export function cairoDayStart(day: string): Date {
  const noon = new Date(`${day}T12:00:00.000Z`).getTime();
  let low = noon - 2 * DAY_MS;
  let high = noon + DAY_MS;
  // Cairo can skip midnight or repeat 23:00; find the first instant of the calendar day.
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (calendarDayAt(new Date(middle)) < day) low = middle + 1;
    else high = middle;
  }
  return new Date(low);
}

export function cairoDayBounds(day: string): { start: Date; endExclusive: Date } {
  return { start: cairoDayStart(day), endExclusive: cairoDayStart(addCalendarDays(day, 1)) };
}

export const RANGE_LABELS = {
  today: "اليوم", yesterday: "أمس", "7d": "آخر 7 أيام", "30d": "آخر 30 يومًا",
  month: "هذا الشهر", "previous-month": "الشهر السابق", custom: "نطاق مخصص",
} as const;
export type RangePreset = keyof typeof RANGE_LABELS;
export interface DashboardRange {
  preset: RangePreset;
  fromDay: string;
  toDay: string;
  start: string;
  endExclusive: string;
  previousStart: string;
  previousEndExclusive: string;
  dayCount: number;
  label: string;
}

export function resolveDashboardRange(
  params: Record<string, string | string[] | undefined>, now = new Date(),
): { range: DashboardRange; error: string | null } {
  const today = calendarDayAt(now);
  const preset = typeof params.range === "string" && Object.hasOwn(RANGE_LABELS, params.range)
    ? params.range as RangePreset : "7d";
  let fromDay = today;
  let toDay = today;
  let error: string | null = null;
  if (preset === "yesterday") fromDay = toDay = addCalendarDays(today, -1);
  else if (preset === "7d" || preset === "30d") fromDay = addCalendarDays(today, preset === "7d" ? -6 : -29);
  else if (preset === "month") fromDay = `${today.slice(0, 7)}-01`;
  else if (preset === "previous-month") {
    toDay = addCalendarDays(`${today.slice(0, 7)}-01`, -1);
    fromDay = `${toDay.slice(0, 7)}-01`;
  } else if (preset === "custom") {
    const from = readCalendarDay(params.from);
    const to = readCalendarDay(params.to);
    if (!from || !to || from > to) error = "اختر تاريخ بداية ونهاية صحيحين وبالترتيب.";
    else if ((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY_MS >= 366) {
      error = "النطاق المخصص يدعم حتى 366 يومًا في المرة الواحدة.";
    } else { fromDay = from; toDay = to; }
  }
  const start = cairoDayStart(fromDay);
  const end = cairoDayStart(addCalendarDays(toDay, 1));
  const duration = end.getTime() - start.getTime();
  return {
    range: {
      preset, fromDay, toDay, start: start.toISOString(), endExclusive: end.toISOString(),
      previousStart: new Date(start.getTime() - duration).toISOString(), previousEndExclusive: start.toISOString(),
      dayCount: Math.round((Date.parse(`${toDay}T12:00:00Z`) - Date.parse(`${fromDay}T12:00:00Z`)) / DAY_MS) + 1,
      label: RANGE_LABELS[preset],
    },
    error,
  };
}
