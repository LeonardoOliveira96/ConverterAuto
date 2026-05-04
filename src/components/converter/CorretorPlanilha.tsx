import { useState, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import Fuse from 'fuse.js';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Upload,
    Download,
    CheckCircle2,
    ArrowLeft,
    Wand2,
    AlertTriangle,
    RefreshCw,
    Loader2,
} from 'lucide-react';
import { SpreadsheetRow } from '@/lib/converter-types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CorretorPlanilhaProps {
    onBack: () => void;
}

type SheetData = {
    fileName: string;
    headers: string[];
    rows: SpreadsheetRow[];
};

type LogEntry = {
    linha: number;
    descricaoOriginal: string;
    descricaoLimpa: string;
    descricaoCorreta: string;
    status: 'corrigido' | 'nao_encontrado';
    score?: number;
    fase?: 1 | 2;
};

type CorrectionResult = {
    resultHeaders: string[];
    resultRows: string[][];
    log: LogEntry[];
    corrected: number;
    notFound: number;
};

type ProcessProgress = {
    current: number;
    total: number;
    lines: string[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CHUNK_SIZE = 150;

const P1_COL_PATTERNS: Record<string, string[]> = {
    descricao: ['DESCRI', 'PRODUTO', 'NOME'],
    unidade: ['UNIDADE', 'UNID', 'UND'],
    estoque: ['ESTOQUE', 'ESTQ', 'SALDO'],
    precoCusto: ['CUSTO', 'P CUSTO', 'P.CUSTO'],
    precoVenda: ['VENDA', 'P VENDA', 'P.VENDA'],
};

function detectColumn(headers: string[], patterns: string[]): string {
    const norm = headers.map((h) => String(h).toUpperCase().trim());
    for (const pattern of patterns) {
        const idx = norm.findIndex((h) => h.includes(pattern.trim()));
        if (idx !== -1) return String(idx);
    }
    return '';
}

/**
 * Remove iterativamente "lixo" do final da descrição:
 * unidades (UN, UNID, UND, KG, LT, ML, CX, PC, FD, SC)
 * e números (inteiros, decimais, negativos — ex: -3, -37,72, 36)
 * Repete até estabilizar para cobrir combinações como "UN -3" ou "KG -37,72".
 */
function cleanDescription(raw: unknown): string {
    let s = String(raw ?? '').trim().toUpperCase();
    // Remove duplos espaços internos antes de começar
    s = s.replace(/\s+/g, ' ').trim();

    let prev = '';
    while (prev !== s) {
        prev = s;
        // Remove unidade isolada no final
        s = s.replace(/\s+(UNID|UND|UN|KG|LT|ML|CX|PC|FD|SC)\s*$/, '');
        // Remove número no final: inteiro, decimal (vírgula ou ponto), negativo
        // Ex: -3  |  -37,72  |  36  |  1.234,56
        s = s.replace(/\s+-?\d[\d.,]*\s*$/, '');
        s = s.trim();
    }

    return s;
}

function normalizeForSearch(text: string): string {
    return text
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function loadSheetFile(file: File): Promise<SheetData> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const wb = XLSX.read(e.target?.result, { type: 'array' });
                const ws = wb.Sheets[wb.SheetNames[0]];
                const data = XLSX.utils.sheet_to_json<SpreadsheetRow>(ws, {
                    header: 1,
                    defval: '',
                });
                if (data.length < 2) {
                    reject(new Error('Planilha muito pequena ou vazia'));
                    return;
                }
                const headers = (data[0] as unknown[]).map(String);
                const rows = data
                    .slice(1)
                    .filter((r) => (r as unknown[]).some((c) => c !== '' && c != null));
                resolve({ fileName: file.name, headers, rows });
            } catch {
                reject(new Error('Erro ao ler o arquivo. Verifique o formato.'));
            }
        };
        reader.onerror = () => reject(new Error('Erro ao carregar o arquivo'));
        reader.readAsArrayBuffer(file);
    });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface FileUploadCardProps {
    label: string;
    description: string;
    accent: 'blue' | 'violet';
    data: SheetData | null;
    error: string;
    onFile: (f: File) => void;
    inputRef: React.RefObject<HTMLInputElement>;
}

function FileUploadCard({ label, description, accent, data, error, onFile, inputRef }: FileUploadCardProps) {
    const [dragging, setDragging] = useState(false);

    const borderIdle =
        accent === 'blue'
            ? 'border-blue-200 dark:border-blue-800 hover:border-blue-400'
            : 'border-violet-200 dark:border-violet-800 hover:border-violet-400';
    const borderDrag =
        accent === 'blue'
            ? 'border-blue-400 bg-blue-50 dark:bg-blue-950/20'
            : 'border-violet-400 bg-violet-50 dark:bg-violet-950/20';
    const iconBg =
        accent === 'blue'
            ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400'
            : 'bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400';

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) onFile(file);
    };

    return (
        <Card
            className={`p-5 border-2 border-dashed transition-all duration-150 cursor-pointer select-none ${
                data
                    ? 'border-solid border-green-400 dark:border-green-600'
                    : dragging
                    ? borderDrag
                    : borderIdle
            }`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
        >
            <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onFile(f);
                    e.target.value = '';
                }}
            />
            <div className="flex flex-col items-center text-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    data ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400' : iconBg
                }`}>
                    {data ? <CheckCircle2 className="w-5 h-5" /> : <Upload className="w-5 h-5" />}
                </div>
                <div>
                    <p className="font-semibold text-sm text-foreground">{label}</p>
                    {data ? (
                        <>
                            <p className="text-xs text-green-600 dark:text-green-400 font-medium mt-0.5">{data.fileName}</p>
                            <p className="text-xs text-muted-foreground">{data.rows.length} linhas · {data.headers.length} colunas</p>
                        </>
                    ) : (
                        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                    )}
                </div>
                {error && (
                    <div className="flex items-center gap-1 text-destructive text-xs">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        {error}
                    </div>
                )}
                {!data && (
                    <p className="text-[10px] text-muted-foreground">Clique ou arraste um arquivo .xlsx / .xls / .csv</p>
                )}
            </div>
        </Card>
    );
}

interface ColumnSelectProps {
    label: string;
    headers: string[];
    value: string;
    onChange: (v: string) => void;
    optional?: boolean;
}

function ColumnSelect({ label, headers, value, onChange, optional }: ColumnSelectProps) {
    const selectValue = value === '' ? (optional ? '__none__' : '') : value;
    return (
        <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{label}</Label>
            <Select value={selectValue} onValueChange={(v) => onChange(v === '__none__' ? '' : v)}>
                <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Selecione a coluna..." />
                </SelectTrigger>
                <SelectContent>
                    {optional && <SelectItem value="__none__">(nenhuma — manter original)</SelectItem>}
                    {headers.map((h, i) => (
                        <SelectItem key={i} value={String(i)}>
                            {h || `Coluna ${i + 1}`}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}

// ─── Progress Panel ───────────────────────────────────────────────────────────

interface ProgressPanelProps {
    progress: ProcessProgress;
}

function ProgressPanel({ progress }: ProgressPanelProps) {
    const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
    const logRef = useRef<HTMLDivElement>(null);
    const prevLen = useRef(0);

    if (logRef.current && progress.lines.length !== prevLen.current) {
        prevLen.current = progress.lines.length;
        requestAnimationFrame(() => {
            if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
        });
    }

    return (
        <Card className="p-5 space-y-4">
            <div className="flex items-center gap-3">
                <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0" />
                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm font-medium text-foreground">Processando planilha…</span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                            {progress.current} / {progress.total} linhas ({pct}%)
                        </span>
                    </div>
                    <Progress value={pct} className="h-2" />
                </div>
            </div>
            <div
                ref={logRef}
                className="bg-muted/50 rounded-md border text-[11px] font-mono leading-relaxed p-3 h-40 overflow-y-auto space-y-0.5"
            >
                {progress.lines.map((line, i) => {
                    const isError = line.startsWith('[!]');
                    const isOk = line.startsWith('[v]');
                    const isInfo = line.startsWith('[.]');
                    return (
                        <p
                            key={i}
                            className={
                                isError
                                    ? 'text-amber-600 dark:text-amber-400'
                                    : isOk
                                    ? 'text-green-600 dark:text-green-400'
                                    : isInfo
                                    ? 'text-blue-600 dark:text-blue-400'
                                    : 'text-muted-foreground'
                            }
                        >
                            {line}
                        </p>
                    );
                })}
                {progress.lines.length === 0 && (
                    <p className="text-muted-foreground">Iniciando…</p>
                )}
            </div>
        </Card>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function CorretorPlanilha({ onBack }: CorretorPlanilhaProps) {
    const [phase, setPhase] = useState<'upload' | 'config' | 'processing' | 'result'>('upload');

    const [p1, setP1] = useState<SheetData | null>(null);
    const [p1Error, setP1Error] = useState('');
    const [p2, setP2] = useState<SheetData | null>(null);
    const [p2Error, setP2Error] = useState('');

    // Planilha 1 — mapeamento
    const [p1Desc, setP1Desc] = useState('');
    const [p1Unidade, setP1Unidade] = useState('');
    const [p1Estoque, setP1Estoque] = useState('');
    const [p1Custo, setP1Custo] = useState('');
    const [p1Venda, setP1Venda] = useState('');

    // Planilha 2 — colunas a sobrescrever (se vazio, mantém original)
    const [p2Desc, setP2Desc] = useState('');
    const [p2Unidade, setP2Unidade] = useState('');
    const [p2Estoque, setP2Estoque] = useState('');
    const [p2Custo, setP2Custo] = useState('');
    const [p2Venda, setP2Venda] = useState('');

    const [threshold, setThreshold] = useState(0.4);
    const [progress, setProgress] = useState<ProcessProgress>({ current: 0, total: 0, lines: [] });
    const [result, setResult] = useState<CorrectionResult | null>(null);
    const [showAllLog, setShowAllLog] = useState(false);

    const p1Ref = useRef<HTMLInputElement>(null);
    const p2Ref = useRef<HTMLInputElement>(null);

    // ── File handlers ─────────────────────────────────────────────────────────

    const handleP1File = useCallback(async (file: File) => {
        setP1Error('');
        try {
            const data = await loadSheetFile(file);
            setP1(data);
            setP1Desc(detectColumn(data.headers, P1_COL_PATTERNS.descricao));
            setP1Unidade(detectColumn(data.headers, P1_COL_PATTERNS.unidade));
            setP1Estoque(detectColumn(data.headers, P1_COL_PATTERNS.estoque));
            setP1Custo(detectColumn(data.headers, P1_COL_PATTERNS.precoCusto));
            setP1Venda(detectColumn(data.headers, P1_COL_PATTERNS.precoVenda));
        } catch (e) {
            setP1Error((e as Error).message);
        }
    }, []);

    const handleP2File = useCallback(async (file: File) => {
        setP2Error('');
        try {
            const data = await loadSheetFile(file);
            setP2(data);
            setP2Desc(detectColumn(data.headers, P1_COL_PATTERNS.descricao));
            setP2Unidade(detectColumn(data.headers, P1_COL_PATTERNS.unidade));
            setP2Estoque(detectColumn(data.headers, P1_COL_PATTERNS.estoque));
            setP2Custo(detectColumn(data.headers, P1_COL_PATTERNS.precoCusto));
            setP2Venda(detectColumn(data.headers, P1_COL_PATTERNS.precoVenda));
        } catch (e) {
            setP2Error((e as Error).message);
        }
    }, []);

    const canProceedToConfig = p1 !== null && p2 !== null;
    const canProcess = p1Desc !== '' && p2Desc !== '';

    // ── Processing (async, chunked) ───────────────────────────────────────────

    const handleProcess = useCallback(async () => {
        if (!p1 || !p2 || !canProcess) return;

        setPhase('processing');
        setProgress({ current: 0, total: p2.rows.length, lines: [] });

        const addLine = (line: string) =>
            setProgress((prev) => ({ ...prev, lines: [...prev.lines, line] }));
        const setCurrent = (n: number) =>
            setProgress((prev) => ({ ...prev, current: n }));

        await tick();

        // Build P1 index
        addLine('[.] Lendo Planilha 1 — construindo indice de busca...');
        await tick();

        const d1      = parseInt(p1Desc);
        const uIdx1   = p1Unidade !== '' ? parseInt(p1Unidade)  : -1;
        const eIdx1   = p1Estoque !== '' ? parseInt(p1Estoque)  : -1;
        const cIdx1   = p1Custo   !== '' ? parseInt(p1Custo)    : -1;
        const vIdx1   = p1Venda   !== '' ? parseInt(p1Venda)    : -1;

        type P1Item = {
            idx: number;
            descOriginal: string;
            descNorm: string;
            unidade: string;
            estoque: string;
            precoCusto: string;
            precoVenda: string;
        };

        const items: P1Item[] = p1.rows.map((row, idx) => {
            const r = row as unknown[];
            const desc = String(r[d1] ?? '');
            return {
                idx,
                descOriginal: desc,
                descNorm: normalizeForSearch(desc),
                unidade:    uIdx1 >= 0 ? String(r[uIdx1] ?? '') : '',
                estoque:    eIdx1 >= 0 ? String(r[eIdx1] ?? '') : '',
                precoCusto: cIdx1 >= 0 ? String(r[cIdx1] ?? '') : '',
                precoVenda: vIdx1 >= 0 ? String(r[vIdx1] ?? '') : '',
            };
        });

        addLine(`[v] Indice criado com ${items.length} produto(s)`);
        await tick();

        // ── Fase 1: precisão alta (threshold do usuário) ──────────────────────
        const fuseP1 = new Fuse(items, {
            keys: ['descNorm'],
            threshold,                 // definido pelo slider (padrão 0.4 = 60%)
            includeScore: true,
            ignoreLocation: true,
            minMatchCharLength: 3,
        });

        // ── Fase 2: fallback mais flexível (máx 0.65) ─────────────────────────
        const thresholdP2 = Math.min(threshold + 0.2, 0.65);
        const fuseP2 = new Fuse(items, {
            keys: ['descNorm'],
            threshold: thresholdP2,
            includeScore: true,
            ignoreLocation: true,
            minMatchCharLength: 2,
        });

        // P2 column indices
        const d2    = parseInt(p2Desc);
        const uIdx2 = p2Unidade !== '' ? parseInt(p2Unidade) : -1;
        const eIdx2 = p2Estoque !== '' ? parseInt(p2Estoque) : -1;
        const cIdx2 = p2Custo   !== '' ? parseInt(p2Custo)   : -1;
        const vIdx2 = p2Venda   !== '' ? parseInt(p2Venda)   : -1;

        addLine(`[.] Fase 1: similaridade >= ${Math.round((1 - threshold) * 100)}%  |  Fase 2 (fallback): >= ${Math.round((1 - thresholdP2) * 100)}%`);
        addLine(`[.] Processando ${p2.rows.length} linha(s) da Planilha 2...`);
        await tick();

        const resultRows: string[][] = [];
        const log: LogEntry[] = [];
        let corrected = 0;
        let notFound  = 0;
        let correctedP2 = 0;

        for (let start = 0; start < p2.rows.length; start += CHUNK_SIZE) {
            const end = Math.min(start + CHUNK_SIZE, p2.rows.length);

            for (let i = start; i < end; i++) {
                const row = p2.rows[i] as unknown[];

                // Preserva toda a linha original da P2
                const maxLen = Math.max(
                    row.length, d2 + 1,
                    uIdx2 + 1, eIdx2 + 1, cIdx2 + 1, vIdx2 + 1
                );
                const newRow: string[] = Array.from({ length: maxLen }, (_, k) =>
                    k < row.length ? String(row[k] ?? '') : ''
                );

                const rawDesc     = String(row[d2] ?? '');
                const cleanedDesc = cleanDescription(rawDesc);
                const normClean   = normalizeForSearch(cleanedDesc);

                if (!normClean) {
                    notFound++;
                    resultRows.push(newRow);
                    log.push({ linha: i + 2, descricaoOriginal: rawDesc, descricaoLimpa: cleanedDesc, descricaoCorreta: '', status: 'nao_encontrado' });
                    continue;
                }

                // Fase 1 — Fuse já ordena por score: matches[0] é sempre o melhor
                const matchesP1 = fuseP1.search(normClean);
                let finalMatch = matchesP1.length > 0 ? matchesP1[0] : null;
                let fase: 1 | 2 = 1;

                if (!finalMatch) {
                    // Fase 2 — fallback, também escolhe o melhor (matches[0])
                    const matchesP2 = fuseP2.search(normClean);
                    if (matchesP2.length > 0) {
                        finalMatch = matchesP2[0];
                        fase = 2;
                    }
                }

                if (finalMatch) {
                    // Sobrescreve apenas as colunas mapeadas; o restante fica intacto
                    newRow[d2] = finalMatch.item.descOriginal;
                    if (uIdx2 >= 0) newRow[uIdx2] = finalMatch.item.unidade;
                    if (eIdx2 >= 0) newRow[eIdx2] = finalMatch.item.estoque;
                    if (cIdx2 >= 0) newRow[cIdx2] = finalMatch.item.precoCusto;
                    if (vIdx2 >= 0) newRow[vIdx2] = finalMatch.item.precoVenda;

                    corrected++;
                    if (fase === 2) correctedP2++;
                    resultRows.push(newRow);
                    log.push({ linha: i + 2, descricaoOriginal: rawDesc, descricaoLimpa: cleanedDesc, descricaoCorreta: finalMatch.item.descOriginal, status: 'corrigido', score: finalMatch.score, fase });
                } else {
                    notFound++;
                    resultRows.push(newRow);
                    log.push({ linha: i + 2, descricaoOriginal: rawDesc, descricaoLimpa: cleanedDesc, descricaoCorreta: '', status: 'nao_encontrado' });
                }
            }

            setCurrent(end);
            addLine(`[v] Linhas ${start + 1}–${end} — ${corrected} corrigido(s) ate agora`);
            await tick(); // yield para o React re-renderizar
        }

        if (correctedP2 > 0) {
            addLine(`[!] ${correctedP2} item(ns) encontrado(s) apenas na Fase 2 (verifique no log)`);
            await tick();
        }

        addLine(`[v] Concluido! ${corrected} corrigido(s), ${notFound} nao encontrado(s).`);
        await tick();

        setResult({
            resultHeaders: p2.headers,
            resultRows,
            log,
            corrected,
            notFound,
        });
        setPhase('result');
    }, [p1, p2, p1Desc, p1Unidade, p1Estoque, p1Custo, p1Venda,
        p2Desc, p2Unidade, p2Estoque, p2Custo, p2Venda, threshold, canProcess]);

    // ── Download ──────────────────────────────────────────────────────────────

    const handleDownload = useCallback(() => {
        if (!result || !p2) return;
        const wb = XLSX.utils.book_new();

        const ws = XLSX.utils.aoa_to_sheet([result.resultHeaders, ...result.resultRows]);
        XLSX.utils.book_append_sheet(wb, ws, 'Planilha Corrigida');

        const logHdr = ['Linha', 'Descricao Original', 'Descricao Limpa',
            'Correspondencia Planilha 1', 'Status', 'Similaridade'];
        const logData = result.log.map((e) => [
            e.linha,
            e.descricaoOriginal,
            e.descricaoLimpa,
            e.descricaoCorreta,
            e.status === 'corrigido' ? 'Corrigido' : 'Nao encontrado',
            e.score !== undefined ? `${((1 - e.score) * 100).toFixed(1)}%` : '',
        ]);
        const wsLog = XLSX.utils.aoa_to_sheet([logHdr, ...logData]);
        XLSX.utils.book_append_sheet(wb, wsLog, 'Log de Alteracoes');

        const base = p2.fileName.replace(/\.[^/.]+$/, '');
        XLSX.writeFile(wb, `${base}_corrigido.xlsx`);
    }, [result, p2]);

    // ── Reset / Back ──────────────────────────────────────────────────────────

    const handleReset = () => {
        setPhase('upload');
        setP1(null); setP2(null);
        setP1Error(''); setP2Error('');
        setP1Desc(''); setP1Unidade(''); setP1Estoque(''); setP1Custo(''); setP1Venda('');
        setP2Desc(''); setP2Unidade(''); setP2Estoque(''); setP2Custo(''); setP2Venda('');
        setResult(null);
        setShowAllLog(false);
        setProgress({ current: 0, total: 0, lines: [] });
    };

    const handleBack = () => {
        if (phase === 'upload') onBack();
        else if (phase === 'result') setPhase('config');
        else if (phase === 'config') setPhase('upload');
        else onBack();
    };

    const similarityPct = Math.round((1 - threshold) * 100);

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-start gap-3">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleBack}
                    disabled={phase === 'processing'}
                    className="gap-1 mt-0.5 shrink-0"
                >
                    <ArrowLeft className="w-4 h-4" />
                    {phase === 'upload' ? 'Inicio' : 'Voltar'}
                </Button>
                <div>
                    <h2 className="font-heading text-xl font-bold text-foreground">
                        Correcao Inteligente de Planilha
                    </h2>
                    <p className="text-sm text-muted-foreground">
                        Corrige automaticamente uma planilha desorganizada com base em uma planilha correta
                    </p>
                </div>
            </div>

            <AnimatePresence mode="wait">

                {/* Upload */}
                {phase === 'upload' && (
                    <motion.div
                        key="upload"
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="space-y-4"
                    >
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <FileUploadCard
                                label="Planilha 1 — Correta"
                                description="Fonte de dados confiavel. Deve conter DESCRICAO, UNIDADE, ESTOQUE, PRECO CUSTO e PRECO VENDA."
                                accent="blue"
                                data={p1}
                                error={p1Error}
                                onFile={handleP1File}
                                inputRef={p1Ref}
                            />
                            <FileUploadCard
                                label="Planilha 2 — Desorganizada"
                                description="Planilha a ser corrigida. Apenas a descricao dos produtos sera usada para identificar os itens."
                                accent="violet"
                                data={p2}
                                error={p2Error}
                                onFile={handleP2File}
                                inputRef={p2Ref}
                            />
                        </div>
                        {canProceedToConfig && (
                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-end">
                                <Button onClick={() => setPhase('config')} className="gap-2">
                                    <Wand2 className="w-4 h-4" />
                                    Configurar e Corrigir
                                </Button>
                            </motion.div>
                        )}
                    </motion.div>
                )}

                {/* Configuracao */}
                {phase === 'config' && p1 && p2 && (
                    <motion.div
                        key="config"
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="space-y-6"
                    >
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">

                            {/* Planilha 1 */}
                            <Card className="p-5 space-y-4">
                                <div>
                                    <h3 className="font-semibold text-sm text-foreground">Planilha 1 — Fonte de dados</h3>
                                    <p className="text-xs text-muted-foreground mt-0.5">{p1.fileName} · {p1.rows.length} linhas</p>
                                </div>
                                <ColumnSelect label="Descricao *"   headers={p1.headers} value={p1Desc}    onChange={setP1Desc} />
                                <ColumnSelect label="Unidade"       headers={p1.headers} value={p1Unidade} onChange={setP1Unidade} optional />
                                <ColumnSelect label="Estoque"       headers={p1.headers} value={p1Estoque} onChange={setP1Estoque} optional />
                                <ColumnSelect label="Preco Custo"   headers={p1.headers} value={p1Custo}   onChange={setP1Custo}   optional />
                                <ColumnSelect label="Preco Venda"   headers={p1.headers} value={p1Venda}   onChange={setP1Venda}   optional />
                            </Card>

                            {/* Planilha 2 + threshold */}
                            <div className="space-y-4">
                                <Card className="p-5 space-y-4">
                                    <div>
                                        <h3 className="font-semibold text-sm text-foreground">Planilha 2 — Colunas a sobrescrever</h3>
                                        <p className="text-xs text-muted-foreground mt-0.5">{p2.fileName} · {p2.rows.length} linhas</p>
                                    </div>
                                    <ColumnSelect label="Descricao *"                         headers={p2.headers} value={p2Desc}    onChange={setP2Desc} />
                                    <ColumnSelect label="Unidade (sobrescrever com P1)"        headers={p2.headers} value={p2Unidade} onChange={setP2Unidade} optional />
                                    <ColumnSelect label="Estoque (sobrescrever com P1)"        headers={p2.headers} value={p2Estoque} onChange={setP2Estoque} optional />
                                    <ColumnSelect label="Preco Custo (sobrescrever com P1)"    headers={p2.headers} value={p2Custo}   onChange={setP2Custo}   optional />
                                    <ColumnSelect label="Preco Venda (sobrescrever com P1)"    headers={p2.headers} value={p2Venda}   onChange={setP2Venda}   optional />
                                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                                        Colunas nao mapeadas permanecem <strong className="text-foreground">intactas</strong> na saida.
                                    </p>
                                </Card>

                                <Card className="p-5 space-y-3">
                                    <div>
                                        <h3 className="font-semibold text-sm text-foreground">Sensibilidade da Busca</h3>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            Similaridade minima: <strong className="text-foreground">{similarityPct}%</strong>
                                        </p>
                                    </div>
                                    <Slider
                                        min={0} max={100} step={5}
                                        value={[similarityPct]}
                                        onValueChange={([v]) => setThreshold(+(1 - v / 100).toFixed(2))}
                                        className="w-full"
                                    />
                                    <div className="flex justify-between text-[10px] text-muted-foreground">
                                        <span>Mais permissivo</span>
                                        <span>Mais rigoroso</span>
                                    </div>
                                </Card>
                            </div>
                        </div>

                        <div className="flex justify-end">
                            <Button onClick={handleProcess} disabled={!canProcess} className="gap-2">
                                <Wand2 className="w-4 h-4" />
                                Corrigir Planilha
                            </Button>
                        </div>
                    </motion.div>
                )}

                {/* Processando */}
                {phase === 'processing' && (
                    <motion.div
                        key="processing"
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                    >
                        <ProgressPanel progress={progress} />
                    </motion.div>
                )}

                {/* Resultado */}
                {phase === 'result' && result && (
                    <motion.div
                        key="result"
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="space-y-6"
                    >
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <Card className="p-4 text-center">
                                <p className="text-2xl font-bold text-foreground">{result.corrected + result.notFound}</p>
                                <p className="text-xs text-muted-foreground mt-1">Total de linhas</p>
                            </Card>
                            <Card className="p-4 text-center">
                                <p className="text-2xl font-bold text-green-600 dark:text-green-400">{result.corrected}</p>
                                <p className="text-xs text-muted-foreground mt-1">Corrigidos</p>
                            </Card>
                            <Card className="p-4 text-center">
                                <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{result.notFound}</p>
                                <p className="text-xs text-muted-foreground mt-1">Nao encontrados</p>
                            </Card>
                            <Card className="p-4 text-center">
                                <p className="text-2xl font-bold text-foreground">
                                    {result.corrected + result.notFound > 0
                                        ? Math.round((result.corrected / (result.corrected + result.notFound)) * 100)
                                        : 0}%
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">Taxa de acerto</p>
                            </Card>
                        </div>

                        <div className="flex flex-wrap gap-3">
                            <Button onClick={handleDownload} className="gap-2">
                                <Download className="w-4 h-4" />
                                Baixar Planilha Corrigida
                            </Button>
                            <Button variant="outline" onClick={handleReset} className="gap-2">
                                <RefreshCw className="w-4 h-4" />
                                Nova Correcao
                            </Button>
                        </div>

                        <Card className="overflow-hidden">
                            <div className="p-4 border-b flex items-center justify-between">
                                <h3 className="font-semibold text-sm text-foreground">Log de Alteracoes</h3>
                                <Badge variant="secondary">{result.log.length} entradas</Badge>
                            </div>
                            <div className="divide-y max-h-[420px] overflow-y-auto">
                                {(showAllLog ? result.log : result.log.slice(0, 25)).map((entry, i) => (
                                    <div key={i} className="px-4 py-2.5 flex items-start gap-3 text-sm">
                                        <span className="text-xs text-muted-foreground w-10 shrink-0 pt-0.5 tabular-nums">
                                            L{entry.linha}
                                        </span>
                                        <div className="flex-1 min-w-0 space-y-0.5">
                                            <p className="text-xs text-muted-foreground truncate">
                                                {entry.descricaoOriginal || '(vazio)'}
                                            </p>
                                            {entry.status === 'corrigido' && entry.descricaoCorreta && (
                                                <p className="text-xs font-medium text-foreground truncate">
                                                    → {entry.descricaoCorreta}
                                                </p>
                                            )}
                                        </div>
                                        {entry.status === 'corrigido' ? (
                                            <Badge
                                                variant="outline"
                                                className={`shrink-0 text-[10px] ${
                                                    entry.fase === 2
                                                        ? 'text-blue-700 border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:text-blue-400'
                                                        : 'text-green-700 border-green-200 bg-green-50 dark:bg-green-950/20 dark:text-green-400'
                                                }`}
                                            >
                                                {entry.score !== undefined
                                                    ? `${((1 - entry.score) * 100).toFixed(0)}% F${entry.fase ?? 1}`
                                                    : 'OK'}
                                            </Badge>
                                        ) : (
                                            <Badge variant="outline" className="text-amber-700 border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:text-amber-400 shrink-0 text-[10px]">
                                                Nao encontrado
                                            </Badge>
                                        )}
                                    </div>
                                ))}
                            </div>
                            {result.log.length > 25 && (
                                <div className="p-3 border-t text-center">
                                    <Button variant="ghost" size="sm" onClick={() => setShowAllLog((v) => !v)}>
                                        {showAllLog ? 'Mostrar menos' : `Ver todas as ${result.log.length} entradas`}
                                    </Button>
                                </div>
                            )}
                        </Card>
                    </motion.div>
                )}

            </AnimatePresence>
        </div>
    );
}
