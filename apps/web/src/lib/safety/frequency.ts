/**
 * The administration-interval law — mirror of `apps/api/app/safety/frequency.py`.
 *
 * A frequency code carries two independent facts: doses per *administration day*
 * and days *between* administration days. Collapsing them into one float is what
 * let a weekly drug be scheduled every day: `0.14 doses/day` renders as one slot
 * per day in any generator that iterates days. The axes stay separate here.
 *
 * Unknown codes return null. Callers must queue the line — defaulting an unread
 * frequency to once-daily invents a schedule the prescription never asked for.
 */

export interface Frequency {
  code: string;
  dosesPerDay: number;
  /** days between administration days; 1 = daily */
  intervalDays: number;
  /** taken when needed: no fixed clock, must never generate slots */
  asNeeded: boolean;
  /** one administration total, then the schedule ends */
  single: boolean;
}

/** Doses per calendar day, exact (1/7 for weekly, not 0.14). */
export function dailyFactor(f: Frequency): number {
  if (f.asNeeded || f.single) return f.dosesPerDay;
  return f.dosesPerDay / f.intervalDays;
}

const DAILY: Record<string, number> = {
  OD: 1, QD: 1, "Q.D": 1, "ONCE DAILY": 1, "1X DAILY": 1,
  "ONCE A DAY": 1, "ONE TIME DAILY": 1, "1 TIME DAILY": 1,
  DAILY: 1, "EVERY DAY": 1, "ONCE EVERY DAY": 1,
  HS: 1, QHS: 1, "AT BEDTIME": 1,
  BD: 2, BID: 2, "B.D": 2, "TWICE DAILY": 2, "1-0-1": 2, "1+0+1": 2,
  "TWICE A DAY": 2, "TWICE EVERY DAY": 2,
  TDS: 3, TID: 3, "T.D.S": 3, "THRICE DAILY": 3, "1-1-1": 3, "THREE TIMES A DAY": 3,
  QID: 4, "Q.I.D": 4, "FOUR TIMES DAILY": 4, "1-1-1-1": 4,
  "TWO TIMES DAILY": 2, "THREE TIMES DAILY": 3,
  "2 TIMES DAILY": 2, "3 TIMES DAILY": 3, "4 TIMES DAILY": 4,
  "1-0-0": 1, "1-0-1-0": 2, "1-1-0": 2, "0-0-1": 1, "0-1-1": 2,
};

/** code -> [doses per administration day, days between administration days] */
const INTERVAL: Record<string, [number, number]> = {
  QOD: [1, 2], ALT: [1, 2], "EVERY OTHER DAY": [1, 2], "1-0-0-1-0-0": [1, 2],
  "ALTERNATE DAYS": [1, 2], "ALTERNATE DAY": [1, 2], "ON ALTERNATE DAYS": [1, 2],
  QWK: [1, 7], QW: [1, 7], WK: [1, 7], WEEKLY: [1, 7],
  "1X WEEKLY": [1, 7], "ONCE WEEKLY": [1, 7], "7D": [1, 7],
  "ONCE A WEEK": [1, 7], "EVERY WEEK": [1, 7], "ONCE EVERY WEEK": [1, 7],
  BIW: [2, 7], "TWICE WEEKLY": [2, 7],
  Q2W: [1, 14], "EVERY 2 WEEKS": [1, 14], "14D": [1, 14], BIWEEKLY: [1, 14],
  Q3W: [1, 21], "EVERY 3 WEEKS": [1, 21],
  QM: [1, 30], MONTHLY: [1, 30], OM: [1, 30], "EVERY MONTH": [1, 30], "30D": [1, 30],
  "ONCE MONTHLY": [1, 30], "ONCE A MONTH": [1, 30],
};

const SINGLE = new Set(["STAT", "ST", "IMMEDIATELY", "ONCE", "ONE DOSE", "SINGLE DOSE", "X1"]);
const AS_NEEDED = new Set(["SOS", "PRN", "AS NEEDED", "WHENEVER REQUIRED", "NEED DOSE"]);
/** Bedtime synonyms, canonicalized to HS so the dose lands at night, not 09:00. */
const BEDTIME = new Set(["AT NIGHT", "NOCTE", "NIGHTLY", "AT BEDTIME", "BEDTIME"]);

/**
 * A slot code at the start of a frequency string, and whatever qualifies it:
 * "0-0-1" alone or "0-0-1 weekly", where the code names the hours of the day and
 * the words name the interval between administration days. `parseFrequency`
 * composes the two instead of reading the code and dropping the qualifier.
 * Mirror of `_TAC_HEAD_RE`.
 */
const TAC_HEAD_RE = /^(\d+(?:\s*[-+.]\s*\d+){1,3})\s*(.*)$/;
/**
 * Prose intervals: days, weeks and months. A parser that only understands days
 * drops the other two, and the line then carries no frequency at all — so no
 * interval rule can fire on it. Mirror of `_EVERY_RE` in apps/api/app/safety/
 * frequency.py.
 */
const EVERY_RE = /(?:every|q)\s*(\d+)\s*(days?|d\b|weeks?|w\b|months?|mo\b|m\b)/i;
const EVERY_UNIT_DAYS: Record<string, number> = {
  d: 1, day: 1, days: 1, w: 7, week: 7, weeks: 7, m: 30, mo: 30, month: 30, months: 30,
};
const HOURS_RE = /^(?:q\s*)?(\d+)\s*(?:HOURLY|HR\.?|H|HOURS?)$/i;

/* Ordered raw-text frequency vocabulary — a verbatim mirror of
 * `LINE_FREQ_TOKENS` in apps/api/app/safety/dosing.py. These tokens are the
 * raw-text REACH of the interval law: a code that exists in the tables but not
 * here is invisible on a line written in plain English, which is how Indian
 * prescriptions are actually written. "Tab Folitrax daily" was that case — bare
 * "daily" is the most common way an oral-methotrexate never-event is written.
 * ORDER IS SIGNIFICANT: alternation is first-match-wins, so every multi-word
 * form must precede the shorter form it contains. The two lists are compared,
 * in order, by a drift test in apps/api/tests/test_interval_law.py. */
/* LINE_FREQ_TOKENS BEGIN */
export const LINE_FREQ_TOKENS: readonly string[] = [
  "ONCE DAILY", "ONCE A DAY", "1 TIME DAILY", "ONE TIME DAILY", "1X DAILY",
  "TWICE DAILY", "TWICE A DAY", "TWICE EVERY DAY", "2 TIMES DAILY",
  "TWO TIMES DAILY", "THREE TIMES DAILY", "3 TIMES DAILY", "THRICE DAILY",
  "FOUR TIMES DAILY", "4 TIMES DAILY",
  "DAILY", "EVERY DAY", "ONCE EVERY DAY",
  "AT BEDTIME", "BEDTIME", "AT NIGHT", "NOCTE",
  "EVERY OTHER DAY", "ON ALTERNATE DAYS", "ALTERNATE DAYS", "ALTERNATE DAY",
  "ONCE WEEKLY", "ONCE A WEEK", "EVERY WEEK", "1X WEEKLY", "TWICE WEEKLY",
  "BIWEEKLY", "EVERY 2 WEEKS", "EVERY 3 WEEKS", "WEEKLY", "MONTHLY",
  "ONCE MONTHLY", "ONCE A MONTH", "EVERY MONTH",
  "AS NEEDED", "NEED DOSE", "WHENEVER REQUIRED",
  "IMMEDIATELY", "SINGLE DOSE", "ONE DOSE",
  "OD", "QD", "BD", "BID", "TDS", "TID", "QID", "HS", "QHS",
  "QWK", "QW", "QOD", "QM", "Q2W", "Q3W", "BIW", "ALT", "STAT", "SOS", "PRN",
];
/* LINE_FREQ_TOKENS END */

/** Prose/numeric forms matched as one token and handed to parseFrequency. */
export const LINE_FREQ_PROSE = String.raw`\d+\s*(?:HOURLY|HOURS?)|Q\d+[DHWM]|(?:EVERY|Q)\s+\d+\s+(?:DAYS?|WEEKS?|MONTHS?)`;

/** The raw-line frequency pattern.
 *
 * TAC slot counts are a single small digit, and the look-behind is what keeps a
 * glued dose out of the code: "Tab Lyrica 75 - 1-0-1" otherwise reads as 75-1-0
 * = 76 administrations a day.
 *
 * The optional prefix handles the other half of that line. A prescription is
 * written "<brand> <dose> - <regimen>", and "Amlong 5 - 1-0-0" legally starts a
 * slot code at the 5, reading 1+5 = 6 administrations a day and inventing a
 * 30 mg/day amlodipine course out of a 5 mg one. A DASH WITH SPACES ON BOTH
 * SIDES is the line's separator, not a slot join: a real code is written tight
 * ("1-0-0"), and a code whose own slots are spaced ("1 - 0 - 1") still matches,
 * because the prefix needs a digit before the dash. Mirror of `_LINE_FREQ`. */
const TAC_LINE_RE = /(?<![\d.-])(?:\d+\s+[-–—]\s+)?([0-6]\s*[-+]\s*[0-6]\s*[-+]\s*(?:[0-6](?:\s*[-+]\s*[0-6])?))(?![\d-])/;
const WORD_ALT = LINE_FREQ_TOKENS.map((t) => t.replace(/ +/g, "\\s+")).join("|") + "|" + LINE_FREQ_PROSE;
const WORD_LINE_RE = new RegExp(`\\b(?:${WORD_ALT})\\b`, "i");
/**
 * A slot code and an interval word are written together on the same line
 * ("0-0-1 weekly"), and the pair is one instruction: which hours, and how often
 * that day comes around. Capturing the code alone fed a correct weekly course to
 * the interval law as a daily one. Mirror of `_LINE_FREQ`'s qualifier branch.
 */
const LINE_QUALIFIER_RE = new RegExp(`^[\\s,]+((?:${WORD_ALT}))\\b`, "i");

/**
 * Pull the frequency out of one raw prescription line, or "" when it states
 * none. Used by the normalizer: the parity corpus and the product path hand the
 * engine a text line, not structured fields, so this is the only way the
 * interval law can see a schedule at all.
 */
export function extractLineFrequency(raw: string): string {
  const tac = TAC_LINE_RE.exec(raw);
  if (tac) {
    // group 1 is the code itself; group 0 may carry the dose the line separated
    // with " - ", which is not part of the regimen.
    const code = tac[1].replace(/\s+/g, "");
    const rest = raw.slice((tac.index ?? 0) + tac[0].length);
    const qualifier = LINE_QUALIFIER_RE.exec(rest);
    if (qualifier?.[1]) return `${code} ${qualifier[1]}`.toUpperCase().replace(/\s+/g, " ");
    return code;
  }
  const word = WORD_LINE_RE.exec(raw);
  return word ? word[0].toUpperCase().replace(/\s+/g, " ") : "";
}

function normalizeCode(freq: string): string {
  return freq.replace(/\u00a0/g, " ").trim().toUpperCase().replace(/\s+/g, " ").replace(/\.$/, "");
}

/** Resolve a raw frequency token, or null when it is not legible. */
export function parseFrequency(freq: string | null | undefined): Frequency | null {
  const raw = (freq ?? "").trim();
  if (!raw) return null;
  const normalized = normalizeCode(raw);
  const key = BEDTIME.has(normalized) ? "HS" : normalized;

  if (SINGLE.has(key)) return { code: key, dosesPerDay: 1, intervalDays: 1, asNeeded: false, single: true };
  if (AS_NEEDED.has(key)) return { code: key, dosesPerDay: 1, intervalDays: 1, asNeeded: true, single: false };
  if (DAILY[key] !== undefined)
    return { code: key, dosesPerDay: DAILY[key], intervalDays: 1, asNeeded: false, single: false };
  if (INTERVAL[key])
    return { code: key, dosesPerDay: INTERVAL[key][0], intervalDays: INTERVAL[key][1], asNeeded: false, single: false };

  // A slot code is tried BEFORE the prose interval: "1-1-0 every 3 weeks"
  // contains prose an interval-only read matches first and reports as ONE dose a
  // day, because that search never notices the leading code already answered the
  // question. Mirror of the same ordering in `app/safety/frequency.py`.
  const tac = TAC_HEAD_RE.exec(raw.replace(/ /g, " ").trim());
  if (tac) {
    const head = tac[1];
    const qualifier = tac[2].replace(/^[\s.]+|[\s.]+$/g, "");
    const parts = (head.match(/\d+/g) ?? []).slice(0, 4).map(Number);
    // A TAC slot count is a single small digit: "75-1-0" is a dose glued to the
    // code, and reading it as a frequency would invent 76 doses a day.
    if (parts.some((p) => p > 6)) return null;
    const total = parts.reduce((a, b) => a + b, 0);
    if (total === 0) return null;
    if (!qualifier)
      return { code: key, dosesPerDay: total, intervalDays: 1, asNeeded: false, single: false };
    // A slot code says WHICH hours of the day; the word after it says how often
    // that day comes around. "0-0-1 weekly" — the way a correct weekly course is
    // written on an Indian prescription — is one dose at bedtime once a week, and
    // reading the code alone scheduled it daily.
    const sub = parseFrequency(qualifier);
    if (!sub) return null;
    if (sub.asNeeded || sub.single) return sub;
    return {
      code: key, dosesPerDay: total, intervalDays: sub.intervalDays,
      asNeeded: false, single: false,
    };
  }

  const every = EVERY_RE.exec(raw);
  if (every) {
    const factor = EVERY_UNIT_DAYS[every[2].toLowerCase()];
    const gap = factor ? parseInt(every[1], 10) * factor : 0;
    if (gap >= 1 && gap <= 180) return { code: key, dosesPerDay: 1, intervalDays: gap, asNeeded: false, single: false };
  }

  const hourly = HOURS_RE.exec(key);
  if (hourly) {
    const gapH = parseInt(hourly[1], 10);
    if (gapH >= 1 && 24 % gapH === 0)
      return { code: key, dosesPerDay: Math.max(1, Math.floor(24 / gapH)), intervalDays: 1, asNeeded: false, single: false };
  }

  return null;
}

/** Doses per calendar day, or null when illegible — never a guessed 1.0. */
export function frequencyPerDayCode(freq: string | null | undefined): number | null {
  const f = parseFrequency(freq);
  return f === null ? null : dailyFactor(f);
}

/** Clock times for one administration day, by doses-per-day. */
export function clockTimes(dosesPerDay: number): string[] {
  switch (Math.max(1, Math.round(dosesPerDay))) {
    case 1: return ["09:00"];
    case 2: return ["09:00", "21:00"];
    case 3: return ["08:00", "14:00", "21:00"];
    case 4: return ["08:00", "12:00", "16:00", "21:00"];
    default: return ["09:00"];
  }
}

/** HS-family codes are bedtime doses, not morning ones. */
export function preferredTimes(f: Frequency): string[] {
  if (f.code === "HS" || f.code === "QHS" || f.code === "AT BEDTIME") return ["21:30"];
  if (f.code === "QWK" || f.code === "WEEKLY" || f.code === "ONCE WEEKLY" || f.code === "QW" || f.code === "WK")
    return ["09:00"];
  return clockTimes(f.dosesPerDay);
}
