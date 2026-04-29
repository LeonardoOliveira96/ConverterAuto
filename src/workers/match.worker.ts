// ─── Types ────────────────────────────────────────────────────────────────────
export interface WorkerPoolItem {
  id: number;       // índice na sheet1.rows original
  norm: string;     // descrição normalizada
  barcode: string;
  valor: number;
  custo: number;
  estoque: number;
}

export interface WorkerP2Item {
  rowIdx: number;   // índice na sheet2.rows original
  rawDesc: string;  // descrição original (para log)
  normDesc: string; // descrição normalizada
  valor: number;
  custo: number;
  estoque: number;
}

export interface WorkerInput {
  pool: WorkerPoolItem[];
  p2Items: WorkerP2Item[];
  useValor: boolean;
  useCusto: boolean;
  useEstoque: boolean;
}

export interface MatchEntry {
  rowIdx: number;
  barcode: string;
  found: boolean;
  score: number; // 0–1, maior = melhor
  phase: 1 | 2;
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
// Fase 1 – Alta confiança: descrição + campos numéricos devem estar alinhados
const PHASE1_COMBINED = 0.76; // score combinado mínimo (~76%)
const PHASE1_TEXT_MIN = 0.63; // componente textual mínimo isolado
const PHASE1_TEXT_W   = 0.65; // 65% descrição, 35% numérico (valor/custo/estoque)

// Fase 2 – Complemento: descrição é o sinal dominante, numérico é auxiliar
// Aceita match mesmo que preços divirjam, desde que a descrição seja boa
const PHASE2_COMBINED = 0.54; // score combinado mínimo (mais permissivo)
const PHASE2_TEXT_MIN = 0.55; // componente textual mínimo
const PHASE2_TEXT_W   = 0.88; // 88% descrição, 12% numérico

const TOP_K = 8;               // candidatos máximos por item da P2

// ─── Worker entry point ───────────────────────────────────────────────────────
self.onmessage = function (e: MessageEvent<WorkerInput>) {
  const { pool, p2Items, useValor, useCusto, useEstoque } = e.data;
  const total = p2Items.length;

  const post = (msg: WorkerMessage) => (self as DedicatedWorkerGlobalScope).postMessage(msg);

  try {
    // ── Construir índice invertido de tokens ──────────────────────────────────
    post({ type: 'progress', done: 0, total, phase: 'Construindo índice de busca…' });

    const invertedIdx = new Map<string, number[]>();
    const tokenCache  = new Map<number, string[]>();
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

    /** Candidatos via índice invertido + fallback ao pool completo */
    function getCandidateIds(normDesc: string): Set<number> {
      const toks = tokenize(normDesc);
      const ids  = new Set<number>();
      for (const t of toks) invertedIdx.get(t)?.forEach((id) => ids.add(id));
      if (ids.size < 5) pool.forEach((item) => ids.add(item.id));
      return ids;
    }

    /** Score combinado (texto + numérico) para um par P2 ↔ P1 */
    function calcScore(
      p2: WorkerP2Item,
      p2Toks: string[],
      p1Id: number,
      textWeight: number,
    ): { textScore: number; combined: number } {
      const p1     = poolMap.get(p1Id)!;
      const p1Toks = tokenCache.get(p1Id)!;

      const jaccard   = tokenJaccard(p2Toks, p1Toks);
      const bigram    = bigramDice(p2.normDesc, p1.norm);
      const textScore = 0.5 * jaccard + 0.5 * bigram;

      const numFactors: number[] = [];
      if (useValor)   numFactors.push(numericProx(p2.valor,   p1.valor));
      if (useCusto)   numFactors.push(numericProx(p2.custo,   p1.custo));
      if (useEstoque) numFactors.push(numericProx(p2.estoque, p1.estoque));

      const combined = numFactors.length === 0
        ? textScore
        : textWeight * textScore + (1 - textWeight) * (numFactors.reduce((a, b) => a + b, 0) / numFactors.length);

      return { textScore, combined };
    }

    type Candidate = { id: number; textScore: number; combined: number };

    // ════════════════════════════════════════════════════════════════════════
    // FASE 1 — Alta confiança: descrição + validação numérica completa
    // Aceita apenas quando TODOS os sinais (texto + preços + estoque) concordam
    // ════════════════════════════════════════════════════════════════════════
    post({ type: 'progress', done: 0, total, phase: 'Fase 1: Calculando matches de alta confiança…' });

    const phase1Cands: Candidate[][] = Array.from({ length: total }, () => []);

    for (let i = 0; i < total; i++) {
      const p2     = p2Items[i];
      const p2Toks = tokenize(p2.normDesc);

      for (const id of getCandidateIds(p2.normDesc)) {
        const { textScore, combined } = calcScore(p2, p2Toks, id, PHASE1_TEXT_W);
        if (textScore >= PHASE1_TEXT_MIN && combined >= PHASE1_COMBINED) {
          phase1Cands[i].push({ id, textScore, combined });
        }
      }

      phase1Cands[i].sort((a, b) => b.combined - a.combined);
      if (phase1Cands[i].length > TOP_K) phase1Cands[i].length = TOP_K;

      if ((i + 1) % 150 === 0 || i === total - 1) {
        post({ type: 'progress', done: i + 1, total, phase: 'Fase 1: Calculando matches de alta confiança…' });
      }
    }

    // Atribuição greedy Fase 1 — mais confiantes escolhem primeiro
    post({ type: 'progress', done: 0, total, phase: 'Fase 1: Resolvendo correspondências definitivas…' });

    const usedIds    = new Set<number>();
    const assignment = new Map<number, { barcode: string; score: number; phase: 1 | 2 }>();

    const order1 = Array.from({ length: total }, (_, i) => i)
      .sort((a, b) => (phase1Cands[b][0]?.combined ?? 0) - (phase1Cands[a][0]?.combined ?? 0));

    for (const p2Idx of order1) {
      for (const cand of phase1Cands[p2Idx]) {
        if (!usedIds.has(cand.id)) {
          usedIds.add(cand.id);
          assignment.set(p2Idx, { barcode: poolMap.get(cand.id)!.barcode, score: cand.combined, phase: 1 });
          break;
        }
      }
    }

    const unmatched1 = Array.from({ length: total }, (_, i) => i).filter((i) => !assignment.has(i));
    const phase1Count = total - unmatched1.length;

    post({
      type:  'progress',
      done:  phase1Count,
      total,
      phase: `Fase 1 concluída: ${phase1Count} matches definitivos. Iniciando Fase 2 (${unmatched1.length} itens)…`,
    });

    // ════════════════════════════════════════════════════════════════════════
    // FASE 2 — Complemento: descrição dominante, numérico apenas como apoio
    // Processa SOMENTE itens não resolvidos na Fase 1.
    // Aceita match mesmo que preços não batam, desde que descrição seja boa.
    // ════════════════════════════════════════════════════════════════════════
    if (unmatched1.length > 0) {
      const phase2Cands: Candidate[][] = Array.from({ length: unmatched1.length }, () => []);

      for (let k = 0; k < unmatched1.length; k++) {
        const i      = unmatched1[k];
        const p2     = p2Items[i];
        const p2Toks = tokenize(p2.normDesc);

        // Fase 2 varre TODOS os candidatos disponíveis (não usados pela Fase 1)
        for (const item of pool) {
          if (usedIds.has(item.id)) continue;
          const { textScore, combined } = calcScore(p2, p2Toks, item.id, PHASE2_TEXT_W);
          if (textScore >= PHASE2_TEXT_MIN && combined >= PHASE2_COMBINED) {
            phase2Cands[k].push({ id: item.id, textScore, combined });
          }
        }

        phase2Cands[k].sort((a, b) => b.combined - a.combined);
        if (phase2Cands[k].length > TOP_K) phase2Cands[k].length = TOP_K;

        if ((k + 1) % 100 === 0 || k === unmatched1.length - 1) {
          post({
            type:  'progress',
            done:  k + 1,
            total: unmatched1.length,
            phase: 'Fase 2: Matches por descrição…',
          });
        }
      }

      // Atribuição greedy Fase 2 — candidato de maior score (sem duplicatas)
      const order2 = Array.from({ length: unmatched1.length }, (_, k) => k)
        .sort((a, b) => (phase2Cands[b][0]?.combined ?? 0) - (phase2Cands[a][0]?.combined ?? 0));

      for (const k of order2) {
        const p2Idx = unmatched1[k];
        for (const cand of phase2Cands[k]) {
          if (!usedIds.has(cand.id)) {
            usedIds.add(cand.id);
            assignment.set(p2Idx, { barcode: poolMap.get(cand.id)!.barcode, score: cand.combined, phase: 2 });
            break;
          }
        }
      }
    }

    // ── Montar resultado na ordem original ────────────────────────────────────
    const entries: MatchEntry[] = p2Items.map((_, i) => {
      const a = assignment.get(i);
      return a
        ? { rowIdx: i, barcode: a.barcode, found: true,  score: a.score, phase: a.phase }
        : { rowIdx: i, barcode: '',         found: false, score: 0,       phase: 1 as const };
    });

    post({ type: 'done', entries });

  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
