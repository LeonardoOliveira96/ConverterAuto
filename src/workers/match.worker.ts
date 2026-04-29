// ─── Types ────────────────────────────────────────────────────────────────────
export interface WorkerPoolItem {
  id: number;       // índice na sheet1.rows original
  norm: string;     // descrição normalizada
  barcode: string;
  valor: number;
  estoque: number;
}

export interface WorkerP2Item {
  rowIdx: number;   // índice na sheet2.rows original
  rawDesc: string;  // descrição original (para log)
  normDesc: string; // descrição normalizada
  valor: number;
  estoque: number;
}

export interface WorkerInput {
  pool: WorkerPoolItem[];
  p2Items: WorkerP2Item[];
  useValor: boolean;
  useEstoque: boolean;
}

export interface MatchEntry {
  rowIdx: number;
  barcode: string;
  found: boolean;
  score: number; // 0–1, maior = melhor
}

export type WorkerMessage =
  | { type: 'progress'; done: number; total: number; phase: string }
  | { type: 'done'; entries: MatchEntry[] }
  | { type: 'error'; message: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────
function tokenize(norm: string): string[] {
  return norm.split(' ').filter((t) => t.length >= 2);
}

/**
 * Jaccard sobre conjuntos de tokens (nível de palavras).
 * Captura bem variações de ordem e presença/ausência de palavras.
 */
function tokenJaccard(t1: string[], t2: string[]): number {
  if (!t1.length || !t2.length) return 0;
  const s1 = new Set(t1);
  const s2 = new Set(t2);
  let inter = 0;
  s1.forEach((t) => { if (s2.has(t)) inter++; });
  return inter / (s1.size + s2.size - inter);
}

/**
 * Dice coefficient sobre bigramas de caracteres.
 * Captura bem variações de ortografia / abreviações.
 */
function bigramDice(a: string, b: string): number {
  if (!a.length || !b.length) return 0;
  if (a === b) return 1;

  const pairs = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const p = s[i] + s[i + 1];
      m.set(p, (m.get(p) ?? 0) + 1);
    }
    return m;
  };

  const pA = pairs(a);
  const pB = pairs(b);
  let inter = 0;
  pA.forEach((v, k) => { inter += Math.min(v, pB.get(k) ?? 0); });

  const total = Math.max(0, a.length - 1) + Math.max(0, b.length - 1);
  return total === 0 ? 1 : (2 * inter) / total;
}

/** Proximidade numérica: 1 = igual, 0 = totalmente diferente, 0.5 = desconhecido */
function numericProx(a: number, b: number): number {
  if (!a || !b) return 0.5;
  return Math.min(a, b) / Math.max(a, b);
}

// ─── Constantes ───────────────────────────────────────────────────────────────
const MATCH_THRESHOLD = 0.30;  // pontuação mínima para considerar um match válido
const TOP_K = 6;               // quantos candidatos manter por item da P2

// ─── Worker entry point ───────────────────────────────────────────────────────
self.onmessage = function (e: MessageEvent<WorkerInput>) {
  const { pool, p2Items, useValor, useEstoque } = e.data;
  const total = p2Items.length;

  const post = (msg: WorkerMessage) => (self as DedicatedWorkerGlobalScope).postMessage(msg);

  try {
    // ── Fase 1: Construir índice invertido de tokens ──────────────────────────
    post({ type: 'progress', done: 0, total, phase: 'Construindo índice de tokens (P1)…' });

    /** token → lista de poolIds que contêm esse token */
    const invertedIdx = new Map<string, number[]>();
    /** poolId → tokens pré-calculados */
    const tokenCache  = new Map<number, string[]>();
    /** poolId → PoolItem (lookup O(1)) */
    const poolMap     = new Map<number, WorkerPoolItem>();

    for (const item of pool) {
      poolMap.set(item.id, item);
      const toks = tokenize(item.norm);
      tokenCache.set(item.id, toks);
      for (const t of toks) {
        const arr = invertedIdx.get(t);
        if (arr) arr.push(item.id);
        else invertedIdx.set(t, [item.id]);
      }
    }

    // ── Fase 2: Pontuar candidatos para cada item da P2 ──────────────────────
    post({ type: 'progress', done: 0, total, phase: 'Calculando similaridade…' });

    type Candidate = { id: number; score: number };
    const allCandidates: Candidate[][] = [];

    for (let i = 0; i < total; i++) {
      const p2 = p2Items[i];
      const p2Toks = tokenize(p2.normDesc);

      // Candidatos via índice invertido (O(tokens × candidatos_por_token))
      const candIds = new Set<number>();
      for (const t of p2Toks) {
        invertedIdx.get(t)?.forEach((id) => candIds.add(id));
      }

      // Fallback: se poucos candidatos por token, busca no pool completo
      if (candIds.size < 5) {
        pool.forEach((item) => candIds.add(item.id));
      }

      // Pontuar candidatos
      const scored: Candidate[] = [];
      for (const id of candIds) {
        const p1     = poolMap.get(id)!;
        const p1Toks = tokenCache.get(id)!;

        // Similaridade textual (principal) — média Jaccard + Dice
        const jaccard = tokenJaccard(p2Toks, p1Toks);
        const bigram  = bigramDice(p2.normDesc, p1.norm);
        let score     = 0.5 * jaccard + 0.5 * bigram;

        // Validação numérica (secundária, peso pequeno)
        if (useValor || useEstoque) {
          let numSum = 0, cnt = 0;
          if (useValor)   { numSum += numericProx(p2.valor,   p1.valor);   cnt++; }
          if (useEstoque) { numSum += numericProx(p2.estoque, p1.estoque); cnt++; }
          score = 0.85 * score + 0.15 * (numSum / Math.max(cnt, 1));
        }

        if (score >= MATCH_THRESHOLD) scored.push({ id, score });
      }

      // Manter os TOP_K melhores
      scored.sort((a, b) => b.score - a.score);
      allCandidates.push(scored.slice(0, TOP_K));

      if ((i + 1) % 100 === 0 || i === total - 1) {
        post({ type: 'progress', done: i + 1, total, phase: 'Calculando similaridade…' });
      }
    }

    // ── Fase 3: Atribuição greedy por confiança (sem duplicatas) ─────────────
    // Itens mais confiantes escolhem primeiro → evita que baixa confiança
    // "roube" o código de barras de quem tinha certeza.
    post({ type: 'progress', done: 0, total, phase: 'Resolvendo correspondências únicas…' });

    const order = Array.from({ length: total }, (_, i) => i);
    order.sort((a, b) => (allCandidates[b][0]?.score ?? 0) - (allCandidates[a][0]?.score ?? 0));

    const usedIds   = new Set<number>();
    const assignment = new Map<number, { barcode: string; score: number }>();

    for (const p2Idx of order) {
      let assigned = false;
      for (const cand of allCandidates[p2Idx]) {
        if (!usedIds.has(cand.id)) {
          usedIds.add(cand.id);
          assignment.set(p2Idx, { barcode: poolMap.get(cand.id)!.barcode, score: cand.score });
          assigned = true;
          break;
        }
      }
      if (!assigned) assignment.set(p2Idx, { barcode: '', score: 0 });
    }

    // ── Fase 4: Montar resultado na ordem original ────────────────────────────
    const entries: MatchEntry[] = p2Items.map((_, i) => {
      const a = assignment.get(i)!;
      return { rowIdx: i, barcode: a.barcode, found: a.barcode !== '', score: a.score };
    });

    post({ type: 'done', entries });

  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
