/** Client-side fetch helpers + shared types for the Vaidya UI. */

export type VerdictKind = "pass" | "interaction" | "combination" | "contraindication" | "duplicate" | "confirm_queue" | "refused";

export interface Finding {
  kind: "interaction" | "combination" | "contraindication" | "duplicate" | "dose";
  severity: "none" | "mild" | "moderate" | "severe";
  mechanism?: string;
  note?: string;
  a?: string;
  b?: string;
  molecules?: string[];
  molecule?: string;
  brands?: string[];
  rule?: string;
  condition?: string;
  source?: string;
}

export interface ConfirmItem {
  line: number;
  rawText: string;
  reason: string;
}

export interface ConfirmedMed {
  line: number;
  rawText: string;
  brand: string | null;
  molecule: string;
  strengthMg: number | null;
  frequency: string;
  durationDays: number | null;
}

export interface VerifyResult {
  prescriptionId: string | null;
  verdict: VerdictKind;
  headline: string;
  findings: Finding[];
  confirmed: ConfirmedMed[];
  confirmQueue: ConfirmItem[];
  aggregateDailyMg: Record<string, number>;
  extractionEngine: string;
  extractionNote?: string;
  confidence: number;
  snapshot?: string;
  engineMs?: number;
  pipelineMs?: number;
}

export interface TodayDose {
  id: string;
  medicationId: string;
  brand: string;
  molecule: string;
  doseMg: number;
  time: string;
  status: string;
  note?: string | null;
}

export interface TodayPayload {
  patient: { id: string; name: string; contexts: string } | null;
  plan: { id: string; label: string; createdAt: string; prescriptionVerdict?: string | null } | null;
  medications: { id: string; brand: string; molecule: string; doseMg: number; frequency: string; times: string[]; durationDays: number }[];
  doses: TodayDose[];
}

export interface Analytics {
  adherencePct: number | null;
  mprPct: number | null;
  currentStreak: number;
  bestStreak: number;
  riskEvents: number;
  days: { date: string; taken: number; skipped: number; missed: number; pending: number }[];
  perMedication: { medicationId: string; brand: string; adherencePct: number | null }[];
}

export interface CopilotResult {
  kind: "grounded" | "refused_scope" | "refused_low_confidence" | "service_unavailable" | "emergency";
  answer: string;
  citations: { n: number; id: string; title: string; source: string }[];
  retrievalScores: number[];
  latencyMs: number;
  guarded: boolean;
}

export interface FamilyPayload {
  patient: { name: string; contexts: string } | null;
  joinCode: string | null;
  links: { id: string; caregiverName: string; relation: string; code: string }[];
  events: { id: string; kind: string; severity: string; message: string; acknowledged: boolean; createdAt: string }[];
}

export interface Metrics {
  verifications: number;
  refusals: number;
  findingsRaised: number;
  plansStarted: number;
  prescriptions: number;
  plans: number;
  escalationEvents: number;
  dataset: { snapshot: string; brands: number; interactions: number; contraindications: number };
}

export const CONTEXT_LABELS: { code: string; label: string }[] = [
  { code: "pregnancy", label: "Pregnant" },
  { code: "age_under_12", label: "Child under 12" },
  { code: "age_under_16", label: "Child under 16" },
  { code: "age_under_18", label: "Child under 18" },
  { code: "peptic_ulcer", label: "Peptic ulcer" },
  { code: "renal_severe", label: "Severe kidney disease" },
  { code: "hepatic_severe", label: "Severe liver disease" },
  { code: "asthma_aspirin_sensitive", label: "Aspirin-sensitive asthma" },
  { code: "myasthenia_gravis", label: "Myasthenia gravis" },
  { code: "hyperkalemia", label: "High potassium" },
  { code: "active_bleeding", label: "Active bleeding" },
  { code: "heart_failure", label: "Heart failure" },
  { code: "epilepsy", label: "Epilepsy" },
  { code: "gout", label: "Gout" },
];

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const json = (await res.json()) as { ok: boolean; data?: T; error?: string };
  if (!json.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json.data as T;
}

export function post<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, { method: "POST", body: JSON.stringify(body) });
}

export const SAMPLE_RX: { id: string; label: string; text: string; contexts: string[] }[] = [
  {
    id: "clean",
    label: "Clean chronic plan",
    contexts: [],
    text: "Telma 40 mg OD 30 days\nGlycomet 500 mg BD 30 days",
  },
  {
    id: "warfarin",
    label: "Warfarin + aspirin",
    contexts: [],
    text: "Warf 5 mg OD 30 days\nEcosprin 75 mg OD 30 days",
  },
  {
    id: "duplicate",
    label: "Duplicate paracetamol brands",
    contexts: [],
    text: "Dolo 650 mg TDS 5 days\nCrocin Advance 650 mg TDS 5 days",
  },
  {
    id: "triple",
    label: "Triple whammy (AKI risk)",
    contexts: [],
    text: "Losar 50 mg OD 30 days\nLasix 40 mg OD 30 days\nBrufen 400 mg TDS 5 days",
  },
  {
    id: "qt",
    label: "QT stack",
    contexts: [],
    text: "Ciplox 500 mg BD 7 days\nAzithral 500 mg OD 3 days\nZofran ODT 4 mg TDS 3 days",
  },
  {
    id: "child",
    label: "Child + doxycycline",
    contexts: ["age_under_12"],
    text: "Doxy-1 100 mg BD 5 days",
  },
  {
    id: "renal",
    label: "Metformin + renal disease",
    contexts: ["renal_severe"],
    text: "Glycomet 500 mg TDS 30 days",
  },
  {
    id: "warfpreg",
    label: "Warfarin in pregnancy",
    contexts: ["pregnancy"],
    text: "Warf 5 mg OD 30 days",
  },
  {
    id: "garbage",
    label: "Unreadable input (refusal)",
    contexts: [],
    text: "blurry smear... cannot read... scribble",
  },
];
