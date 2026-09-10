import { NextRequest } from "next/server";
import { ok } from "@/lib/api-helpers";
import { formularySearch } from "@/lib/safety/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/formulary/search?q=dolo — autocomplete over the brand formulary. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const rows = formularySearch(q, 8).map((b) => ({
    brand: b.brand,
    molecule: b.molecule,
    form: b.form,
    atc: b.atc,
    aware: b.aware,
    priceInr: b.priceInr,
  }));
  return ok({ rows });
}
