import { useState, useCallback, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import type { WorkerInput, WorkerMessage, WorkerPoolItem, WorkerP2Item } from '@/workers/match.worker';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Upload,
    FileSpreadsheet,
    ArrowRight,
    ArrowLeft,
    Download,
    AlertTriangle,
    CheckCircle2,
    XCircle,
    Barcode,
    RefreshCw,
} from 'lucide-react';
import { SpreadsheetRow } from '@/lib/converter-types';

// ─── Types ───────────────────────────────────────────────────────────────────
type SheetData = {
    fileName: string;
    headers: string[];
    rows: SpreadsheetRow[];
};

type ColumnMapping = {
    p1Desc: string;
    p1Barcode: string;
    p1Estoque: string;
    p1ValorVenda: string;
    p1Custo: string;
    p2Desc: string;
    p2Estoque: string;
    p2ValorVenda: string;
    p2Custo: string;
};

type MatchLogEntry = {
    linha: number;
    descricao: string;
    tipo: 'encontrado' | 'nao_encontrado';
    codigoBarras?: string;
    score?: number;
    fase?: 1 | 2;
};

type MatchResult = {
    resultRows: SpreadsheetRow[];
    log: MatchLogEntry[];
    matched: number;
    unmatched: number;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function normalizeDesc(text: unknown): string {
    return String(text ?? '')
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Converte célula de planilha para número (suporta "R$ 1.234,56" → 1234.56) */
function toNumber(v: unknown): number {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    const s = String(v ?? '')
        .trim()
        .replace(/[R$\s]/g, '')
        .replace(/\./g, '')
        .replace(',', '.');
    const n = parseFloat(s);
    return isFinite(n) ? n : 0;
}

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

// ─── Sub-components ──────────────────────────────────────────────────────────
interface FileUploadCardProps {
    label: string;
    description: string;
    accent: 'blue' | 'violet';
    data: SheetData | null;
    error: string;
    onFile: (f: File) => void;
}

function FileUploadCard({
    label,
    description,
    accent,
    data,
    error,
    onFile,
}: FileUploadCardProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [dragging, setDragging] = useState(false);

    const accentClass =
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

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) onFile(file);
    };

    return (
        <Card
            className={`p-6 flex flex-col gap-4 transition-all duration-200 ${dragging ? `border-2 ${accentClass}` : 'border border-border'
                }`}
            onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
        >
            <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${iconBg}`}>
                    <Barcode className="w-5 h-5" />
                </div>
                <div>
                    <p className="font-heading font-semibold text-sm text-foreground">{label}</p>
                    <p className="text-xs text-muted-foreground">{description}</p>
                </div>
            </div>

            {data ? (
                <div className="flex items-center gap-3 rounded-lg bg-secondary/60 px-4 py-3">
                    <FileSpreadsheet className="w-5 h-5 text-primary flex-shrink-0" />
                    <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{data.fileName}</p>
                        <p className="text-xs text-muted-foreground">
                            {data.rows.length} linhas · {data.headers.length} colunas
                        </p>
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto shrink-0 text-xs"
                        onClick={() => inputRef.current?.click()}
                    >
                        Trocar
                    </Button>
                </div>
            ) : (
                <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border py-8 transition-colors hover:border-primary hover:bg-primary/5"
                >
                    <Upload className="w-8 h-8 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                        Arraste ou <span className="text-primary font-medium">clique para selecionar</span>
                    </span>
                    <span className="text-xs text-muted-foreground">.xlsx · .xls · .csv</span>
                </button>
            )}

            {error && (
                <p className="text-xs text-destructive flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {error}
                </p>
            )}

            <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleChange}
            />
        </Card>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
interface ColumnField {
    key: keyof ColumnMapping;
    label: string;
    required: boolean;
}

interface ColumnMappingCardProps {
    title: string;
    headers: string[];
    fields: ColumnField[];
    values: ColumnMapping;
    onFieldChange: (key: keyof ColumnMapping, value: string) => void;
}

function ColumnMappingCard({
    title,
    headers,
    fields,
    values,
    onFieldChange,
}: ColumnMappingCardProps) {
    return (
        <Card className="p-6 flex flex-col gap-5">
            <p className="font-heading font-semibold text-sm text-foreground border-b pb-3">{title}</p>
            {fields.map(({ key, label, required }) => (
                <div key={key} className="flex flex-col gap-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">
                        {label}
                        {required && <span className="text-destructive ml-0.5">*</span>}
                    </Label>
                    <Select
                        value={values[key]}
                        onValueChange={(v) => onFieldChange(key, v)}
                    >
                        <SelectTrigger className="h-9 text-sm">
                            <SelectValue placeholder="Selecionar coluna…" />
                        </SelectTrigger>
                        <SelectContent>
                            {!required && (
                                <SelectItem value="__none__">
                                    <span className="text-muted-foreground">— Não usar —</span>
                                </SelectItem>
                            )}
                            {headers.filter((h) => h !== '').map((h, i) => (
                                <SelectItem key={`${h}-${i}`} value={h}>
                                    {h}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            ))}
        </Card>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
interface ResultViewProps {
    result: MatchResult;
    sheet2FileName: string;
    onDownload: () => void;
}

function ResultView({ result, sheet2FileName, onDownload }: ResultViewProps) {
    const pct = result.log.length
        ? Math.round((result.matched / result.log.length) * 100)
        : 0;

    const unmatchedEntries = result.log.filter((l) => l.tipo === 'nao_encontrado');
    const phase1Count = result.log.filter((l) => l.tipo === 'encontrado' && l.fase === 1).length;
    const phase2Count = result.log.filter((l) => l.tipo === 'encontrado' && l.fase === 2).length;

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col gap-6"
        >
            {/* Summary cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Card className="p-5 flex flex-col gap-1">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                        Total de itens
                    </p>
                    <p className="text-3xl font-bold text-foreground">{result.log.length}</p>
                    <p className="text-xs text-muted-foreground">{sheet2FileName}</p>
                </Card>

                <Card className="p-5 flex flex-col gap-1 border-green-200 dark:border-green-900">
                    <p className="text-xs text-green-700 dark:text-green-400 font-medium uppercase tracking-wide">
                        Correspondências
                    </p>
                    <div className="flex items-end gap-2">
                        <p className="text-3xl font-bold text-green-700 dark:text-green-400">
                            {result.matched}
                        </p>
                        <p className="text-sm text-muted-foreground mb-1">({pct}%)</p>
                    </div>
                    <div className="h-1.5 bg-secondary rounded-full overflow-hidden mt-1">
                        <div
                            className="h-full bg-green-500 rounded-full transition-all duration-700"
                            style={{ width: `${pct}%` }}
                        />
                    </div>
                    <div className="flex gap-2 mt-2">
                        <span className="text-[10px] bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 px-1.5 py-0.5 rounded font-semibold">
                            F1—alta confiança: {phase1Count}
                        </span>
                        <span className="text-[10px] bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 px-1.5 py-0.5 rounded font-semibold">
                            F2—descrição: {phase2Count}
                        </span>
                    </div>
                </Card>

                <Card className="p-5 flex flex-col gap-1 border-amber-200 dark:border-amber-900">
                    <p className="text-xs text-amber-700 dark:text-amber-400 font-medium uppercase tracking-wide">
                        Não encontrados
                    </p>
                    <p className="text-3xl font-bold text-amber-700 dark:text-amber-400">
                        {result.unmatched}
                    </p>
                    <p className="text-xs text-muted-foreground">
                        Células deixadas em branco
                    </p>
                </Card>
            </div>

            {/* Download button */}
            <Card className="p-5 flex items-center justify-between gap-4">
                <div>
                    <p className="font-heading font-semibold text-sm text-foreground">
                        Planilha 2 com códigos de barras
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Resultado + aba de log incluídos no arquivo
                    </p>
                </div>
                <Button onClick={onDownload} className="gap-2 shrink-0">
                    <Download className="w-4 h-4" />
                    Baixar Excel
                </Button>
            </Card>

            {/* Log de não encontrados */}
            {unmatchedEntries.length > 0 && (
                <Card className="p-5 flex flex-col gap-3">
                    <div className="flex items-center gap-2 border-b pb-3">
                        <AlertTriangle className="w-4 h-4 text-amber-500" />
                        <p className="font-heading font-semibold text-sm text-foreground">
                            Log — Itens não encontrados ({unmatchedEntries.length})
                        </p>
                    </div>
                    <div className="flex flex-col gap-1 max-h-64 overflow-y-auto pr-1">
                        {unmatchedEntries.map((entry) => (
                            <div
                                key={entry.linha}
                                className="flex items-start gap-2 text-xs py-1.5 border-b border-border/50 last:border-0"
                            >
                                <XCircle className="w-3.5 h-3.5 text-amber-500 mt-0.5 flex-shrink-0" />
                                <span className="text-muted-foreground font-mono">
                                    Linha {entry.linha}
                                </span>
                                <span className="text-foreground break-all">{entry.descricao}</span>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            {/* Log de encontrados (collapsible summary) */}
            {result.matched > 0 && (
                <Card className="p-5 flex flex-col gap-3">
                    <div className="flex items-center gap-2 border-b pb-3">
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                        <p className="font-heading font-semibold text-sm text-foreground">
                            Log — Correspondências encontradas ({result.matched})
                        </p>
                    </div>
                    <div className="flex flex-col gap-1 max-h-64 overflow-y-auto pr-1">
                        {result.log
                            .filter((l) => l.tipo === 'encontrado')
                            .map((entry) => (
                                <div
                                    key={entry.linha}
                                    className="flex items-start gap-2 text-xs py-1.5 border-b border-border/50 last:border-0"
                                >
                                    <CheckCircle2 className="w-3.5 h-3.5 text-green-500 mt-0.5 flex-shrink-0" />
                                    <span className="text-muted-foreground font-mono">
                                        Linha {entry.linha}
                                    </span>
                                    <span className="text-foreground break-all flex-1">
                                        {entry.descricao}
                                    </span>
                                    <span className={`text-[9px] px-1 py-0.5 rounded font-bold shrink-0 ${entry.fase === 2
                                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400'
                                        : 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                                        }`}>
                                        F{entry.fase ?? 1}
                                    </span>
                                    <Badge variant="secondary" className="text-[10px] font-mono shrink-0">
                                        {entry.codigoBarras}
                                    </Badge>
                                </div>
                            ))}
                    </div>
                </Card>
            )}
        </motion.div>
    );
}

// ─── Stepper header mini ──────────────────────────────────────────────────────
const STEPS = [
    { label: 'Carregar Planilhas' },
    { label: 'Configurar Colunas' },
    { label: 'Resultado' },
];

function MatchStepper({ currentStep }: { currentStep: number }) {
    return (
        <nav className="flex items-center gap-1 mb-8 overflow-x-auto pb-1">
            {STEPS.map((s, i) => (
                <div key={i} className="flex items-center gap-1 shrink-0">
                    <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${i < currentStep
                            ? 'bg-primary text-primary-foreground'
                            : i === currentStep
                                ? 'bg-primary text-primary-foreground ring-4 ring-primary/20'
                                : 'bg-secondary text-secondary-foreground'
                            }`}
                    >
                        {i < currentStep ? '✓' : i + 1}
                    </div>
                    <span
                        className={`text-sm font-medium whitespace-nowrap ${i === currentStep ? 'text-foreground' : 'text-muted-foreground'
                            }`}
                    >
                        {s.label}
                    </span>
                    {i < STEPS.length - 1 && (
                        <div
                            className={`h-px w-8 mx-1 transition-colors ${i < currentStep ? 'bg-primary' : 'bg-border'
                                }`}
                        />
                    )}
                </div>
            ))}
        </nav>
    );
}

// ─── Main component ───────────────────────────────────────────────────────────
interface MatchPlanilhasProps {
    onBack: () => void;
}

const EMPTY_MAPPING: ColumnMapping = {
    p1Desc: '',
    p1Barcode: '',
    p1Estoque: '',
    p1ValorVenda: '',
    p1Custo: '',
    p2Desc: '',
    p2Estoque: '',
    p2ValorVenda: '',
    p2Custo: '',
};

export function MatchPlanilhas({ onBack }: MatchPlanilhasProps) {
    const [step, setStep] = useState(0);
    const [sheet1, setSheet1] = useState<SheetData | null>(null);
    const [sheet2, setSheet2] = useState<SheetData | null>(null);
    const [error1, setError1] = useState('');
    const [error2, setError2] = useState('');
    const [mapping, setMapping] = useState<ColumnMapping>(EMPTY_MAPPING);
    const [result, setResult] = useState<MatchResult | null>(null);
    const [processing, setProcessing] = useState(false);
    const [progress, setProgress] = useState({ done: 0, total: 0, phase: '' });
    const workerRef = useRef<Worker | null>(null);

    // Cleanup worker ao desmontar o componente
    useEffect(() => () => { workerRef.current?.terminate(); }, []);

    const handleFieldChange = useCallback(
        (key: keyof ColumnMapping, value: string) => {
            setMapping((prev) => ({ ...prev, [key]: value === '__none__' ? '' : value }));
        },
        [],
    );

    const handleFile = useCallback((which: 1 | 2, file: File) => {
        if (which === 1) setError1('');
        else setError2('');
        loadSheetFile(file)
            .then((data) => {
                if (which === 1) setSheet1(data);
                else setSheet2(data);
            })
            .catch((err: Error) => {
                if (which === 1) setError1(err.message);
                else setError2(err.message);
            });
    }, []);

    /**
     * Lança o Web Worker de match.
     * Roda em thread separada — não bloqueia a UI e usa outro núcleo do CPU.
     */
    function launchWorker(s1: SheetData, s2: SheetData, map: ColumnMapping) {
        // Termina worker anterior se ainda estiver rodando
        workerRef.current?.terminate();

        const p1DescIdx = s1.headers.indexOf(map.p1Desc);
        const p1BarcodeIdx = s1.headers.indexOf(map.p1Barcode);
        const p1ValorIdx = map.p1ValorVenda ? s1.headers.indexOf(map.p1ValorVenda) : -1;
        const p1CustoIdx = map.p1Custo ? s1.headers.indexOf(map.p1Custo) : -1;
        const p1EstoqueIdx = map.p1Estoque ? s1.headers.indexOf(map.p1Estoque) : -1;

        const pool: WorkerPoolItem[] = [];
        s1.rows.forEach((row, i) => {
            const r = row as unknown[];
            const barcode = String(r[p1BarcodeIdx] ?? '').trim();
            const desc = normalizeDesc(r[p1DescIdx]);
            if (!barcode || !desc) return;
            pool.push({
                id: i,
                norm: desc,
                barcode,
                valor: p1ValorIdx >= 0 ? toNumber(r[p1ValorIdx]) : 0,
                custo: p1CustoIdx >= 0 ? toNumber(r[p1CustoIdx]) : 0,
                estoque: p1EstoqueIdx >= 0 ? toNumber(r[p1EstoqueIdx]) : 0,
            });
        });

        const p2DescIdx = s2.headers.indexOf(map.p2Desc);
        const p2ValorIdx = map.p2ValorVenda ? s2.headers.indexOf(map.p2ValorVenda) : -1;
        const p2CustoIdx = map.p2Custo ? s2.headers.indexOf(map.p2Custo) : -1;
        const p2EstoqueIdx = map.p2Estoque ? s2.headers.indexOf(map.p2Estoque) : -1;

        const p2Items: WorkerP2Item[] = s2.rows.map((row, i) => {
            const r = row as unknown[];
            return {
                rowIdx: i,
                rawDesc: String(r[p2DescIdx] ?? ''),
                normDesc: normalizeDesc(r[p2DescIdx]),
                valor: p2ValorIdx >= 0 ? toNumber(r[p2ValorIdx]) : 0,
                custo: p2CustoIdx >= 0 ? toNumber(r[p2CustoIdx]) : 0,
                estoque: p2EstoqueIdx >= 0 ? toNumber(r[p2EstoqueIdx]) : 0,
            };
        });

        const useValor = p1ValorIdx >= 0 && p2ValorIdx >= 0 && map.p1ValorVenda !== '';
        const useCusto = p1CustoIdx >= 0 && p2CustoIdx >= 0 && map.p1Custo !== '';
        const useEstoque = p1EstoqueIdx >= 0 && p2EstoqueIdx >= 0 && map.p1Estoque !== '';

        console.log('[Match] Iniciando Web Worker — P1:', pool.length, 'itens | P2:', p2Items.length, 'itens');
        console.log('[Match] useValor:', useValor, '| useCusto:', useCusto, '| useEstoque:', useEstoque);

        setProcessing(true);
        setProgress({ done: 0, total: s2.rows.length, phase: 'Iniciando worker…' });

        const worker = new Worker(
            new URL('../../workers/match.worker.ts', import.meta.url),
            { type: 'module' },
        );
        workerRef.current = worker;

        const t0 = performance.now();

        worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
            const msg = ev.data;

            if (msg.type === 'progress') {
                setProgress({ done: msg.done, total: msg.total, phase: msg.phase });

            } else if (msg.type === 'done') {
                const log: MatchLogEntry[] = [];
                const resultRows: SpreadsheetRow[] = [];

                for (const entry of msg.entries) {
                    const origRow = s2.rows[entry.rowIdx];
                    const rawDesc = p2Items[entry.rowIdx]?.rawDesc ?? '';
                    resultRows.push([...(origRow as SpreadsheetRow), entry.barcode]);

                    if (entry.found) {
                        log.push({
                            linha: entry.rowIdx + 2,
                            descricao: rawDesc,
                            tipo: 'encontrado',
                            codigoBarras: entry.barcode,
                            score: entry.score,
                            fase: entry.phase,
                        });
                    } else {
                        log.push({ linha: entry.rowIdx + 2, descricao: rawDesc, tipo: 'nao_encontrado' });
                        console.log(`[Match] Linha ${entry.rowIdx + 2} — NÃO encontrado: "${rawDesc}"`);
                    }
                }

                const matched = log.filter((l) => l.tipo === 'encontrado').length;
                const unmatched = log.filter((l) => l.tipo === 'nao_encontrado').length;
                const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
                console.log(`[Match] Concluído em ${elapsed}s — Encontrados: ${matched} | Não encontrados: ${unmatched}`);

                setResult({ resultRows, log, matched, unmatched });
                setProcessing(false);
                worker.terminate();
                workerRef.current = null;

            } else {
                console.error('[Match Worker] Erro:', msg.message);
                setProcessing(false);
                worker.terminate();
                workerRef.current = null;
            }
        };

        worker.onerror = (ev) => {
            console.error('[Match Worker] Erro não tratado:', ev.message);
            setProcessing(false);
            workerRef.current = null;
        };

        worker.postMessage({ pool, p2Items, useValor, useCusto, useEstoque } satisfies WorkerInput);
    }

    const handleDownload = () => {
        if (!result || !sheet2) return;
        const wb = XLSX.utils.book_new();

        // Aba principal com resultado
        const headerRow = [...sheet2.headers, 'CODIGO_BARRAS_MATCH'];
        const wsData = [headerRow, ...result.resultRows];
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        XLSX.utils.book_append_sheet(wb, ws, 'Resultado');

        // Aba de log
        const logHeader = ['Linha', 'Descrição', 'Status', 'Código de Barras'];
        const logRows = result.log.map((l) => [
            l.linha,
            l.descricao,
            l.tipo === 'encontrado' ? 'Encontrado' : 'Não encontrado',
            l.codigoBarras ?? '',
        ]);
        const wsLog = XLSX.utils.aoa_to_sheet([logHeader, ...logRows]);
        XLSX.utils.book_append_sheet(wb, wsLog, 'Log de Match');

        const outName = sheet2.fileName.replace(/\.[^.]+$/, '') + '_com_barcode.xlsx';
        XLSX.writeFile(wb, outName);
    };

    const canNext = () => {
        if (step === 0) return !!sheet1 && !!sheet2;
        if (step === 1)
            return !!mapping.p1Desc && !!mapping.p1Barcode && !!mapping.p2Desc;
        return false;
    };

    const handleReset = () => {
        workerRef.current?.terminate();
        workerRef.current = null;
        setStep(0);
        setSheet1(null);
        setSheet2(null);
        setError1('');
        setError2('');
        setMapping(EMPTY_MAPPING);
        setResult(null);
        setProcessing(false);
    };

    const handleNext = () => {
        if (step === 1) {
            setResult(null);
            setStep(2);
            if (sheet1 && sheet2) launchWorker(sheet1, sheet2, mapping);
        } else {
            setStep((s) => s + 1);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
        >
            <MatchStepper currentStep={step} />

            <AnimatePresence mode="wait">
                {/* ── Step 0: Upload ── */}
                {step === 0 && (
                    <motion.div
                        key="upload"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        className="grid grid-cols-1 md:grid-cols-2 gap-6"
                    >
                        <FileUploadCard
                            label="Planilha 1 — COM código de barras"
                            description="Planilha base que contém EAN / código de barras"
                            accent="blue"
                            data={sheet1}
                            error={error1}
                            onFile={(f) => handleFile(1, f)}
                        />
                        <FileUploadCard
                            label="Planilha 2 — SEM código de barras"
                            description="Planilha que receberá os códigos correspondentes"
                            accent="violet"
                            data={sheet2}
                            error={error2}
                            onFile={(f) => handleFile(2, f)}
                        />
                    </motion.div>
                )}

                {/* ── Step 1: Column mapping ── */}
                {step === 1 && sheet1 && sheet2 && (
                    <motion.div
                        key="mapping"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        className="grid grid-cols-1 md:grid-cols-2 gap-6"
                    >
                        <ColumnMappingCard
                            title="Planilha 1 — com código de barras"
                            headers={sheet1.headers}
                            fields={[
                                { key: 'p1Desc', label: 'Descrição do produto', required: true },
                                { key: 'p1Barcode', label: 'Código de barras (EAN)', required: true },
                                { key: 'p1ValorVenda', label: 'Preço de venda (opcional)', required: false },
                                { key: 'p1Custo', label: 'Preço de custo (opcional)', required: false },
                                { key: 'p1Estoque', label: 'Estoque (opcional)', required: false },
                            ]}
                            values={mapping}
                            onFieldChange={handleFieldChange}
                        />
                        <ColumnMappingCard
                            title="Planilha 2 — sem código de barras"
                            headers={sheet2.headers}
                            fields={[
                                { key: 'p2Desc', label: 'Descrição do produto', required: true },
                                { key: 'p2ValorVenda', label: 'Preço de venda (opcional)', required: false },
                                { key: 'p2Custo', label: 'Preço de custo (opcional)', required: false },
                                { key: 'p2Estoque', label: 'Estoque (opcional)', required: false },
                            ]}
                            values={mapping}
                            onFieldChange={handleFieldChange}
                        />
                    </motion.div>
                )}

                {/* ── Step 2: Result ── */}
                {step === 2 && (
                    <motion.div
                        key="result"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                    >
                        {processing || !result ? (
                            <div className="flex flex-col items-center justify-center py-20 gap-6">
                                <RefreshCw className="w-8 h-8 text-primary animate-spin" />
                                <div className="flex flex-col items-center gap-3 w-full max-w-sm">
                                    <p className="text-sm font-medium text-foreground">
                                        {progress.phase || 'Iniciando…'}
                                    </p>
                                    {progress.total > 0 && (
                                        <>
                                            <p className="text-xs text-muted-foreground">
                                                {progress.done.toLocaleString('pt-BR')} de {progress.total.toLocaleString('pt-BR')} itens
                                            </p>
                                            <div className="w-full h-2.5 bg-secondary rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-primary rounded-full transition-all duration-200"
                                                    style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                                                />
                                            </div>
                                            <p className="text-xs text-muted-foreground font-mono font-bold">
                                                {Math.round((progress.done / progress.total) * 100)}%
                                            </p>
                                        </>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <ResultView
                                result={result}
                                sheet2FileName={sheet2?.fileName ?? ''}
                                onDownload={handleDownload}
                            />
                        )}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── Navigation ── */}
            <div className="flex justify-between mt-8">
                {step < 2 ? (
                    <>
                        <Button
                            variant="outline"
                            onClick={step === 0 ? onBack : () => setStep((s) => s - 1)}
                            className="gap-2"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            {step === 0 ? 'Início' : 'Voltar'}
                        </Button>
                        <Button onClick={handleNext} disabled={!canNext()} className="gap-2">
                            {step === 1 ? 'Executar Match' : 'Próximo'}
                            <ArrowRight className="w-4 h-4" />
                        </Button>
                    </>
                ) : (
                    <>
                        <Button
                            variant="outline"
                            onClick={() => {
                                workerRef.current?.terminate();
                                workerRef.current = null;
                                setResult(null);
                                setProcessing(false);
                                setStep(1);
                            }}
                            className="gap-2"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            Reconfigurar
                        </Button>
                        <Button variant="outline" onClick={handleReset} className="gap-2">
                            <RefreshCw className="w-4 h-4" />
                            Novo Match
                        </Button>
                    </>
                )}
            </div>
        </motion.div>
    );
}
