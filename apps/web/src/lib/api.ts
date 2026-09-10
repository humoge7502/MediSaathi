/**
 * Typed API client - envelope contract mirrors packages/contracts.
 * Regenerate against the live OpenAPI schema at contract freeze.
 */
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

export interface Envelope<T = Record<string, unknown>> {
  ok: boolean;
  data: T | null;
  error: string | null;
  meta: Record<string, unknown>;
}

export interface ExtractionField {
  raw_text: string;
  brand_text: string;
  strength: string;
  dose: string;
  frequency: string;
  duration: string;
  confidence: number;
  source: string;
}

export interface ProvenanceEntry {
  kind: string;
  name: string;
  source: string;
  snapshot: string;
}

export interface Verdict {
  kind: string;
  headline: string;
  detail: string;
  max_interaction_severity: string;
  refusal_reason: string | null;
  provenance: ProvenanceEntry[];
}

export interface ConfirmItem {
  field_index: number;
  raw_text: string;
  confidence: number;
  reason: string;
}

export interface PlanSlot {
  slot: string;
  value: string;
  verified: boolean;
}

export interface AudioSegment {
  kind: string;
  text: string;
  slot_refs: string[];
}

export interface SpokenPlan {
  language: string;
  slots: PlanSlot[];
  segments: AudioSegment[];
  script: string;
  audio_url: string | null;
  disclaimer: string;
}

export interface PriceRow {
  brand: string;
  molecule: string;
  unit_price_inr: number | null;
  generic_available: boolean;
  generic_price_inr: number | null;
  generic_brand: string | null;
  savings_inr: number | null;
  source: string;
}

export interface PriceReport {
  rows: PriceRow[];
  summary: {
    unit_total_inr: number;
    generic_total_inr: number;
    savings_total_inr: number;
    snapshot: string;
  };
}

export interface SafetyReport {
  medications: { brand: string; molecule: string; form: string; aware_class: string }[];
  interactions: { molecule_a: string; molecule_b: string; severity: string; mechanism: string; source: string }[];
  contraindications: { molecule: string; condition_code: string; severity: string; note: string }[];
  duplicates: { atc: string; brands: string[]; note: string }[];
  warnings: string[];
  checks: Record<string, boolean>;
}

export interface PrescriptionState {
  prescription_id: string;
  sample_id: string;
  extraction: { fields: ExtractionField[]; engine: string; latency_ms: number } | null;
  safety: SafetyReport | null;
  verdict: Verdict | null;
  confirm_queue: ConfirmItem[];
}

export interface FormularyResult {
  brand: string;
  molecule: string;
  form: string;
  jas_price_inr: number | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<Envelope<T>> {
  const res = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    headers: init?.method ? { "Content-Type": init.method === "POST" ? undefined : undefined } : undefined,
    ...init,
  } as RequestInit);
  if (!res.ok && res.status !== 409) {
    const detail = await res.json().catch(() => null);
    const err = new Error(
      (detail && (detail as { detail?: string }).detail) || `API ${res.status}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return res.json();
}

export const api = {
  start: (sampleId: string, context = "") =>
    request<PrescriptionState>(
      `/api/v1/prescriptions?sample_id=${sampleId}&context=${context}`,
      { method: "POST" }),
  upload: (image: File, context = "") => {
    const form = new FormData();
    form.append("image", image);
    return request<PrescriptionState>(
      `/api/v1/prescriptions/upload?context=${context}`, { method: "POST", body: form });
  },
  state: (id: string) => request<PrescriptionState>(`/api/v1/prescriptions/${id}`),
  confirm: (
    id: string,
    body: { field_index: number; brand_text: string; accepted: boolean },
  ) =>
    request<PrescriptionState>(`/api/v1/prescriptions/${id}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  plan: (id: string, lang: "en" | "ta" | "hi" = "en") =>
    request<SpokenPlan>(`/api/v1/prescriptions/${id}/explanation?lang=${lang}`),
  price: (id: string) => request<PriceReport>(`/api/v1/prescriptions/${id}/price`),
  search: (q: string) =>
    request<{ results: FormularyResult[] }>(
      `/api/v1/formulary/search?q=${encodeURIComponent(q)}`),
  judgeCases: () =>
    request<{
      sealed: { sample_id: string; description: string; expect_verdict: string }[];
      script_seconds: number;
      cached_mode_recommended: boolean;
    }>("/api/v1/judge/cases"),
  judgeCached: (sampleId: string) =>
    request<Envelope<PrescriptionState> | Envelope<SpokenPlan> | Record<string, unknown>>(
      `/api/v1/judge/cases/${sampleId}/cached`),
  metrics: () =>
    request<{
      pipeline_started_total: number;
      refused_total: number;
      confirm_queue_total: number;
      verdicts: Record<string, number>;
    }>("/metrics"),
};

/** Browser TTS: speak each segment; resolve when the whole plan finishes. */
export async function speak(
  segments: AudioSegment[],
  lang: "en" | "ta" | "hi",
  onSegment?: (index: number) => void,
): Promise<void> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const voiceLang = lang === "ta" ? "ta-IN" : lang === "hi" ? "hi-IN" : "en-IN";
  for (let i = 0; i < segments.length; i++) {
    onSegment?.(i);
    await new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(segments[i].text);
      u.lang = voiceLang;
      u.rate = 0.95;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      synth.speak(u);
      // Safety: never hang forever if the voice engine stalls.
      setTimeout(resolve, 12000);
    });
  }
  onSegment?.(-1);
}

export function stopSpeaking(): void {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}
