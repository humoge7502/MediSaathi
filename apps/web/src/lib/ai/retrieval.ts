/**
 * Zero-dependency BM25 retrieval over the knowledge corpus.
 * Deterministic, fast, and fully explainable — which is the point:
 * the retrieval step must be auditable in a safety-adjacent product.
 */

import { KNOWLEDGE, type KnowledgeChunk } from "./knowledge";

const STOP = new Set(["the", "a", "an", "is", "are", "of", "to", "and", "in", "on", "for", "with", "my", "me", "i", "it", "can", "do", "does", "what", "why", "how", "should", "you", "your"]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

interface Indexed {
  chunk: KnowledgeChunk;
  tf: Map<string, number>;
  len: number;
}

const index: Indexed[] = [];
const df: Map<string, number> = new Map();

(function build() {
  for (const chunk of KNOWLEDGE) {
    const tokens = tokenize(`${chunk.title} ${chunk.molecules.join(" ")} ${chunk.molecules.join(" ")} ${chunk.text}`);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of new Set(tokens)) df.set(t, (df.get(t) ?? 0) + 1);
    index.push({ chunk, tf, len: tokens.length });
  }
})();

const AVG_LEN = index.reduce((a, x) => a + x.len, 0) / index.length;

const K1 = 1.5;
const B = 0.75;

export interface Retrieved {
  chunk: KnowledgeChunk;
  score: number;
}

export function retrieve(query: string, topK = 3, extraBoostMolecules: string[] = []): Retrieved[] {
  const qTokens = tokenize(query);
  const boost = new Set(extraBoostMolecules.map((m) => m.toLowerCase()));

  const N = index.length;
  const scored: Retrieved[] = index.map((doc) => {
    let score = 0;
    for (const t of qTokens) {
      const f = doc.tf.get(t);
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
      score += (idf * (f * (K1 + 1))) / (f + K1 * (1 - B + B * (doc.len / AVG_LEN)));
    }
    // med-context boost: the user's own medicines pull their chunks in
    for (const m of boost) {
      if (doc.chunk.molecules.includes(m)) score += 1.5;
    }
    return { chunk: doc.chunk, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.filter((s) => s.score > 0).slice(0, topK);
}
