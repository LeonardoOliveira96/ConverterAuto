import { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import Fuse from 'fuse.js';
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
import { motion } from 'framer-motion';
import {
    Upload,
    FileSpreadsheet,
    ArrowLeft,
    Download,
    AlertTriangle,
    CheckCircle2,
    XCircle,
    ShieldCheck,
} from 'lucide-react';
import { SpreadsheetRow } from '@/lib/converter-types';

// ─── Types ────────────────────────────────────────────────────────────────────

type SheetData = {
    fileName: string;
    headers: string[];
    rows: SpreadsheetRow[];
};

type AuditMapping = {
    origDesc: string;
    origCodInterno: string;
    origCodBarras: string;
    origNCM: string;
    origCST: string;
    origValorVenda: string;
    origCusto: string;
    origEstoque: string;
    origUnidade: string;
    origCEST: string;
    genDesc: string;
    genCodInterno: string;
    genCodBarras: string;
    genNCM: string;
    genCST: string;
    genValorVenda: string;
    genCusto: string;
    genEstoque: string;
    genUnidade: string;
    genCEST: string;
};

type DiscrepancyEntry = {
    linhaGerada: number;
    descricao: string;
    campo: string;
    valorOriginal: string;
    valorGerado: string;
};

type AuditResult = {
    totalProdutos: number;
    encontrados: number;
    naoEncontrados: number;
    comDivergencia: number;
    semDivergencia: number;
    discrepancies: DiscrepancyEntry[];
    naoEncontradosList: string[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeText(text: unknown): string {
    return String(text ?? '')
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

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

// ─── Audit engine ─────────────────────────────────────────────────────────────

/**
 * SpreadsheetRow é um array numérico (SpreadsheetCell[]).
 * Converte o nome de coluna para o índice correspondente no cabeçalho.
 */
function colIdx(headers: string[], colName: string): number {
    return headers.indexOf(colName);
}

function cellVal(row: SpreadsheetRow, idx: number): SpreadsheetCell {
    return idx >= 0 ? row[idx] : undefined;
}

function runAudit(
    origRows: SpreadsheetRow[],
    origHeaders: string[],
    genRows: SpreadsheetRow[],
    genHeaders: string[],
    mapping: AuditMapping,
): AuditResult {
    const isActive = (val: string) => Boolean(val) && val !== '__none__';

    // Pre-compute column indices for every mapped field
    const oi = {
        desc:       colIdx(origHeaders, mapping.origDesc),
        codInterno: isActive(mapping.origCodInterno) ? colIdx(origHeaders, mapping.origCodInterno) : -1,
        codBarras:  isActive(mapping.origCodBarras)  ? colIdx(origHeaders, mapping.origCodBarras)  : -1,
        ncm:        isActive(mapping.origNCM)         ? colIdx(origHeaders, mapping.origNCM)         : -1,
        cst:        isActive(mapping.origCST)         ? colIdx(origHeaders, mapping.origCST)         : -1,
        valorVenda: isActive(mapping.origValorVenda)  ? colIdx(origHeaders, mapping.origValorVenda)  : -1,
        custo:      isActive(mapping.origCusto)       ? colIdx(origHeaders, mapping.origCusto)       : -1,
        estoque:    isActive(mapping.origEstoque)     ? colIdx(origHeaders, mapping.origEstoque)     : -1,
        unidade:    isActive(mapping.origUnidade)     ? colIdx(origHeaders, mapping.origUnidade)     : -1,
        cest:       isActive(mapping.origCEST)        ? colIdx(origHeaders, mapping.origCEST)        : -1,
    };

    const gi = {
        desc:       colIdx(genHeaders, mapping.genDesc),
        codInterno: isActive(mapping.genCodInterno) ? colIdx(genHeaders, mapping.genCodInterno) : -1,
        codBarras:  isActive(mapping.genCodBarras)  ? colIdx(genHeaders, mapping.genCodBarras)  : -1,
        ncm:        isActive(mapping.genNCM)         ? colIdx(genHeaders, mapping.genNCM)         : -1,
        cst:        isActive(mapping.genCST)         ? colIdx(genHeaders, mapping.genCST)         : -1,
        valorVenda: isActive(mapping.genValorVenda)  ? colIdx(genHeaders, mapping.genValorVenda)  : -1,
        custo:      isActive(mapping.genCusto)       ? colIdx(genHeaders, mapping.genCusto)       : -1,
        estoque:    isActive(mapping.genEstoque)     ? colIdx(genHeaders, mapping.genEstoque)     : -1,
        unidade:    isActive(mapping.genUnidade)     ? colIdx(genHeaders, mapping.genUnidade)     : -1,
        cest:       isActive(mapping.genCEST)        ? colIdx(genHeaders, mapping.genCEST)        : -1,
    };

    // Build searchable index from original rows
    const origItems = origRows.map((row, idx) => ({
        idx,
        desc: normalizeText(cellVal(row, oi.desc)),
        codInterno: oi.codInterno >= 0 ? String(cellVal(row, oi.codInterno) ?? '').trim() : '',
        row,
    }));

    // Fuse.js for fuzzy description matching
    const fuse = new Fuse(origItems, {
        keys: ['desc'],
        threshold: 0.35,
        includeScore: true,
    });

    const discrepancies: DiscrepancyEntry[] = [];
    const naoEncontradosList: string[] = [];
    let encontrados = 0;
    let comDivergencia = 0;

    genRows.forEach((genRow, genIdx) => {
        const genDescRaw  = String(cellVal(genRow, gi.desc) ?? '');
        const genDescNorm = normalizeText(genDescRaw);
        const genCodInterno = gi.codInterno >= 0
            ? String(cellVal(genRow, gi.codInterno) ?? '').trim()
            : '';

        // ── Match: prioridade 1 = código interno exato ─────────────────────────
        let origMatch: (typeof origItems)[0] | null = null;

        if (genCodInterno && oi.codInterno >= 0) {
            origMatch = origItems.find((o) => o.codInterno && o.codInterno === genCodInterno) ?? null;
        }

        // ── Match: prioridade 2 = fuzzy por descrição ──────────────────────────
        if (!origMatch) {
            const results = fuse.search(genDescNorm);
            if (results.length > 0 && (results[0].score ?? 1) < 0.35) {
                origMatch = results[0].item;
            }
        }

        if (!origMatch) {
            naoEncontradosList.push(genDescRaw || `Linha ${genIdx + 2}`);
            return;
        }

        encontrados++;
        const origRow     = origMatch.row;
        const linhaGerada = genIdx + 2;
        const descricao   = genDescRaw;
        let hasDivergencia = false;

        const addDisc = (campo: string, orig: string, gen: string) => {
            discrepancies.push({ linhaGerada, descricao, campo, valorOriginal: orig, valorGerado: gen });
            hasDivergencia = true;
        };

        // ── Descrição ──────────────────────────────────────────────────────────
        const origDescNorm = normalizeText(cellVal(origRow, oi.desc));
        if (origDescNorm !== genDescNorm) {
            addDisc(
                'Descrição do Produto',
                String(cellVal(origRow, oi.desc) ?? ''),
                genDescRaw,
            );
        }

        // ── Código Interno (exact) ─────────────────────────────────────────────
        if (oi.codInterno >= 0 && gi.codInterno >= 0) {
            const origCod = String(cellVal(origRow, oi.codInterno) ?? '').trim();
            const genCod  = String(cellVal(genRow,  gi.codInterno) ?? '').trim();
            if (origCod && genCod && origCod !== genCod) {
                addDisc('Código Interno', origCod, genCod);
            }
        }

        // ── Código de Barras (opcional) ────────────────────────────────────────
        if (oi.codBarras >= 0 && gi.codBarras >= 0) {
            const origCB = String(cellVal(origRow, oi.codBarras) ?? '').trim();
            const genCB  = String(cellVal(genRow,  gi.codBarras) ?? '').trim();
            if (origCB && genCB && origCB !== genCB) {
                addDisc('Código de Barras', origCB, genCB);
            }
        }

        // ── NCM (exact, somente dígitos) ───────────────────────────────────────
        if (oi.ncm >= 0 && gi.ncm >= 0) {
            const origNCM = String(cellVal(origRow, oi.ncm) ?? '').replace(/\D/g, '');
            const genNCM  = String(cellVal(genRow,  gi.ncm) ?? '').replace(/\D/g, '');
            if (origNCM && genNCM && origNCM !== genNCM) {
                addDisc('Código NCM', String(cellVal(origRow, oi.ncm) ?? ''), String(cellVal(genRow, gi.ncm) ?? ''));
            }
        }

        // ── CST (exact) ────────────────────────────────────────────────────────
        if (oi.cst >= 0 && gi.cst >= 0) {
            const origCST = String(cellVal(origRow, oi.cst) ?? '').trim();
            const genCST  = String(cellVal(genRow,  gi.cst) ?? '').trim();
            if (origCST && genCST && origCST !== genCST) {
                addDisc('CST', origCST, genCST);
            }
        }

        // ── Valor de Venda (tolerância ±0.05) ─────────────────────────────────
        if (oi.valorVenda >= 0 && gi.valorVenda >= 0) {
            const origVV = toNumber(cellVal(origRow, oi.valorVenda));
            const genVV  = toNumber(cellVal(genRow,  gi.valorVenda));
            if (Math.abs(origVV - genVV) > 0.05) {
                addDisc('Valor de Venda', origVV.toFixed(2), genVV.toFixed(2));
            }
        }

        // ── Custo (tolerância ±0.05) ───────────────────────────────────────────
        if (oi.custo >= 0 && gi.custo >= 0) {
            const origC = toNumber(cellVal(origRow, oi.custo));
            const genC  = toNumber(cellVal(genRow,  gi.custo));
            if (Math.abs(origC - genC) > 0.05) {
                addDisc('Custo', origC.toFixed(2), genC.toFixed(2));
            }
        }

        // ── Estoque (exact) ────────────────────────────────────────────────────
        if (oi.estoque >= 0 && gi.estoque >= 0) {
            const origE = toNumber(cellVal(origRow, oi.estoque));
            const genE  = toNumber(cellVal(genRow,  gi.estoque));
            if (origE !== genE) {
                addDisc('Quantidade em Estoque', origE.toString(), genE.toString());
            }
        }

        // ── Unidade (case-insensitive) ─────────────────────────────────────────
        if (oi.unidade >= 0 && gi.unidade >= 0) {
            const origU = String(cellVal(origRow, oi.unidade) ?? '').trim().toUpperCase();
            const genU  = String(cellVal(genRow,  gi.unidade) ?? '').trim().toUpperCase();
            if (origU && genU && origU !== genU) {
                addDisc('Unidade Entrada', origU, genU);
            }
        }

        // ── CEST (exact, somente dígitos) ──────────────────────────────────────
        if (oi.cest >= 0 && gi.cest >= 0) {
            const origCEST = String(cellVal(origRow, oi.cest) ?? '').replace(/\D/g, '');
            const genCEST  = String(cellVal(genRow,  gi.cest) ?? '').replace(/\D/g, '');
            if (origCEST && genCEST && origCEST !== genCEST) {
                addDisc('CEST', String(cellVal(origRow, oi.cest) ?? ''), String(cellVal(genRow, gi.cest) ?? ''));
            }
        }

        if (hasDivergencia) comDivergencia++;
    });

    return {
        totalProdutos: genRows.length,
        encontrados,
        naoEncontrados: naoEncontradosList.length,
        comDivergencia,
        semDivergencia: encontrados - comDivergencia,
        discrepancies,
        naoEncontradosList,
    };
}

// ─── Download helper ──────────────────────────────────────────────────────────

function downloadAuditReport(result: AuditResult, genFileName: string) {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Summary
    const summaryData = [
        ['Relatório de Auditoria de Exportação'],
        [''],
        ['Arquivo auditado:', genFileName],
        ['Total de produtos (planilha gerada):', result.totalProdutos],
        ['Encontrados na original:', result.encontrados],
        ['Não encontrados:', result.naoEncontrados],
        ['Com divergência:', result.comDivergencia],
        ['Sem divergência:', result.semDivergencia],
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Resumo');

    // Sheet 2: Discrepancies log
    if (result.discrepancies.length > 0) {
        const discData = [
            ['Linha', 'Produto', 'Campo Divergente', 'Valor Original', 'Valor Gerado'],
            ...result.discrepancies.map((d) => [
                d.linhaGerada,
                d.descricao,
                d.campo,
                d.valorOriginal,
                d.valorGerado,
            ]),
        ];
        const wsDisc = XLSX.utils.aoa_to_sheet(discData);
        XLSX.utils.book_append_sheet(wb, wsDisc, 'Divergências');
    }

    // Sheet 3: Not found
    if (result.naoEncontradosList.length > 0) {
        const nfData = [
            ['Produto não encontrado na planilha original'],
            ...result.naoEncontradosList.map((d) => [d]),
        ];
        const wsNF = XLSX.utils.aoa_to_sheet(nfData);
        XLSX.utils.book_append_sheet(wb, wsNF, 'Não Encontrados');
    }

    XLSX.writeFile(wb, `auditoria_${genFileName.replace(/\.[^.]+$/, '')}.xlsx`);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface FileUploadCardProps {
    label: string;
    description: string;
    accent: 'blue' | 'violet';
    data: SheetData | null;
    error: string;
    onFile: (f: File) => void;
}

function FileUploadCard({ label, description, accent, data, error, onFile }: FileUploadCardProps) {
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
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
        >
            <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${iconBg}`}>
                    <ShieldCheck className="w-5 h-5" />
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

// ─── Column mapping ───────────────────────────────────────────────────────────

interface MappingField {
    key: keyof AuditMapping;
    label: string;
    required: boolean;
}

interface ColumnMappingCardProps {
    title: string;
    accent: 'blue' | 'violet';
    headers: string[];
    fields: MappingField[];
    values: AuditMapping;
    onChange: (key: keyof AuditMapping, value: string) => void;
}

function ColumnMappingCard({ title, accent, headers, fields, values, onChange }: ColumnMappingCardProps) {
    const titleColor =
        accent === 'blue'
            ? 'text-blue-600 dark:text-blue-400'
            : 'text-violet-600 dark:text-violet-400';

    return (
        <Card className="p-6 flex flex-col gap-4">
            <p className={`font-heading font-semibold text-sm border-b pb-3 ${titleColor}`}>{title}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {fields.map(({ key, label, required }) => (
                    <div key={key} className="flex flex-col gap-1.5">
                        <Label className="text-xs font-medium text-muted-foreground">
                            {label}
                            {required && <span className="text-destructive ml-0.5">*</span>}
                        </Label>
                        <Select value={values[key]} onValueChange={(v) => onChange(key, v)}>
                            <SelectTrigger className="h-9 text-sm">
                                <SelectValue placeholder="Selecionar coluna…" />
                            </SelectTrigger>
                            <SelectContent>
                                {!required && (
                                    <SelectItem value="__none__">
                                        <span className="text-muted-foreground">— Não usar —</span>
                                    </SelectItem>
                                )}
                                {headers.map((h) => (
                                    <SelectItem key={h} value={h}>
                                        {h}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                ))}
            </div>
        </Card>
    );
}

// ─── Result view ──────────────────────────────────────────────────────────────

interface ResultViewProps {
    result: AuditResult;
    genFileName: string;
    onDownload: () => void;
}

function ResultView({ result, genFileName, onDownload }: ResultViewProps) {
    const pctOk = result.encontrados > 0
        ? Math.round((result.semDivergencia / result.encontrados) * 100)
        : 0;

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col gap-6"
        >
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Card className="p-5 flex flex-col gap-1">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Total</p>
                    <p className="text-3xl font-bold text-foreground">{result.totalProdutos}</p>
                    <p className="text-xs text-muted-foreground truncate">{genFileName}</p>
                </Card>

                <Card className="p-5 flex flex-col gap-1 border-green-200 dark:border-green-900">
                    <p className="text-xs text-green-700 dark:text-green-400 font-medium uppercase tracking-wide">OK</p>
                    <div className="flex items-end gap-1.5">
                        <p className="text-3xl font-bold text-green-700 dark:text-green-400">{result.semDivergencia}</p>
                        <p className="text-sm text-muted-foreground mb-1">({pctOk}%)</p>
                    </div>
                    <div className="h-1.5 bg-secondary rounded-full overflow-hidden mt-1">
                        <div
                            className="h-full bg-green-500 rounded-full transition-all duration-700"
                            style={{ width: `${pctOk}%` }}
                        />
                    </div>
                </Card>

                <Card className="p-5 flex flex-col gap-1 border-red-200 dark:border-red-900">
                    <p className="text-xs text-red-600 dark:text-red-400 font-medium uppercase tracking-wide">Divergências</p>
                    <p className="text-3xl font-bold text-red-600 dark:text-red-400">{result.comDivergencia}</p>
                    <p className="text-xs text-muted-foreground">produtos com erros</p>
                </Card>

                <Card className="p-5 flex flex-col gap-1 border-amber-200 dark:border-amber-900">
                    <p className="text-xs text-amber-700 dark:text-amber-400 font-medium uppercase tracking-wide">Não encontrados</p>
                    <p className="text-3xl font-bold text-amber-700 dark:text-amber-400">{result.naoEncontrados}</p>
                    <p className="text-xs text-muted-foreground">sem correspondência</p>
                </Card>
            </div>

            {/* Download */}
            <Card className="p-5 flex items-center justify-between gap-4">
                <div>
                    <p className="font-heading font-semibold text-sm text-foreground">Relatório de Auditoria</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Inclui resumo, log de divergências e itens não encontrados
                    </p>
                </div>
                <Button onClick={onDownload} className="gap-2 shrink-0">
                    <Download className="w-4 h-4" />
                    Baixar Relatório
                </Button>
            </Card>

            {/* Divergências */}
            {result.discrepancies.length > 0 && (
                <Card className="p-5 flex flex-col gap-3">
                    <div className="flex items-center gap-2 border-b pb-3">
                        <XCircle className="w-4 h-4 text-red-500" />
                        <p className="font-heading font-semibold text-sm text-foreground">
                            Log de Divergências ({result.discrepancies.length})
                        </p>
                    </div>
                    <div className="flex flex-col gap-1 max-h-80 overflow-y-auto pr-1">
                        {result.discrepancies.map((d, i) => (
                            <div
                                key={i}
                                className="flex flex-col gap-0.5 text-xs py-2 border-b border-border/50 last:border-0"
                            >
                                <div className="flex items-center gap-2">
                                    <span className="font-mono text-muted-foreground shrink-0">
                                        Linha {d.linhaGerada}
                                    </span>
                                    <span className="font-medium text-foreground truncate">{d.descricao}</span>
                                    <Badge variant="destructive" className="text-[10px] shrink-0 ml-auto">
                                        {d.campo}
                                    </Badge>
                                </div>
                                <div className="flex items-center gap-2 pl-1">
                                    <span className="text-green-700 dark:text-green-400">
                                        Original: <span className="font-mono">{d.valorOriginal}</span>
                                    </span>
                                    <span className="text-muted-foreground">→</span>
                                    <span className="text-red-600 dark:text-red-400">
                                        Gerado: <span className="font-mono">{d.valorGerado}</span>
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            {/* Não encontrados */}
            {result.naoEncontradosList.length > 0 && (
                <Card className="p-5 flex flex-col gap-3">
                    <div className="flex items-center gap-2 border-b pb-3">
                        <AlertTriangle className="w-4 h-4 text-amber-500" />
                        <p className="font-heading font-semibold text-sm text-foreground">
                            Itens não encontrados na original ({result.naoEncontradosList.length})
                        </p>
                    </div>
                    <div className="flex flex-col gap-1 max-h-64 overflow-y-auto pr-1">
                        {result.naoEncontradosList.map((desc, i) => (
                            <div
                                key={i}
                                className="flex items-start gap-2 text-xs py-1.5 border-b border-border/50 last:border-0"
                            >
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mt-0.5 flex-shrink-0" />
                                <span className="text-foreground break-all">{desc}</span>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            {/* Tudo OK */}
            {result.discrepancies.length === 0 && result.naoEncontradosList.length === 0 && (
                <Card className="p-8 flex flex-col items-center gap-3 border-green-200 dark:border-green-900 bg-green-50/30 dark:bg-green-950/10">
                    <CheckCircle2 className="w-12 h-12 text-green-500" />
                    <p className="font-heading font-semibold text-lg text-green-700 dark:text-green-400">
                        Planilha 100% consistente!
                    </p>
                    <p className="text-sm text-muted-foreground text-center">
                        Todos os {result.encontrados} produtos foram verificados sem nenhuma divergência.
                    </p>
                </Card>
            )}
        </motion.div>
    );
}

// ─── Stepper ──────────────────────────────────────────────────────────────────

const STEPS = [
    { label: 'Carregar Planilhas' },
    { label: 'Mapear Colunas' },
    { label: 'Resultado' },
];

function AuditStepper({ currentStep }: { currentStep: number }) {
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

// ─── Field definitions ────────────────────────────────────────────────────────

const ORIG_FIELDS: MappingField[] = [
    { key: 'origDesc', label: 'Descrição do Produto', required: true },
    { key: 'origCodInterno', label: 'Código Interno', required: true },
    { key: 'origCodBarras', label: 'Código de Barras', required: false },
    { key: 'origNCM', label: 'NCM', required: false },
    { key: 'origCST', label: 'CST', required: false },
    { key: 'origValorVenda', label: 'Valor de Venda', required: false },
    { key: 'origCusto', label: 'Custo', required: false },
    { key: 'origEstoque', label: 'Estoque', required: false },
    { key: 'origUnidade', label: 'Unidade Entrada', required: false },
    { key: 'origCEST', label: 'CEST', required: false },
];

const GEN_FIELDS: MappingField[] = [
    { key: 'genDesc', label: 'Descrição do Produto', required: true },
    { key: 'genCodInterno', label: 'Código Interno', required: false },
    { key: 'genCodBarras', label: 'Código de Barras', required: false },
    { key: 'genNCM', label: 'NCM', required: false },
    { key: 'genCST', label: 'CST', required: false },
    { key: 'genValorVenda', label: 'Valor de Venda', required: false },
    { key: 'genCusto', label: 'Custo', required: false },
    { key: 'genEstoque', label: 'Estoque', required: false },
    { key: 'genUnidade', label: 'Unidade Entrada', required: false },
    { key: 'genCEST', label: 'CEST', required: false },
];

const EMPTY_MAPPING: AuditMapping = {
    origDesc: '',
    origCodInterno: '',
    origCodBarras: '__none__',
    origNCM: '__none__',
    origCST: '__none__',
    origValorVenda: '__none__',
    origCusto: '__none__',
    origEstoque: '__none__',
    origUnidade: '__none__',
    origCEST: '__none__',
    genDesc: '',
    genCodInterno: '__none__',
    genCodBarras: '__none__',
    genNCM: '__none__',
    genCST: '__none__',
    genValorVenda: '__none__',
    genCusto: '__none__',
    genEstoque: '__none__',
    genUnidade: '__none__',
    genCEST: '__none__',
};

// ─── Main component ───────────────────────────────────────────────────────────

interface AuditValidationProps {
    onBack: () => void;
}

export function AuditValidation({ onBack }: AuditValidationProps) {
    const [step, setStep] = useState(0);

    const [origData, setOrigData] = useState<SheetData | null>(null);
    const [genData, setGenData] = useState<SheetData | null>(null);
    const [origError, setOrigError] = useState('');
    const [genError, setGenError] = useState('');

    const [mapping, setMapping] = useState<AuditMapping>(EMPTY_MAPPING);
    const [result, setResult] = useState<AuditResult | null>(null);

    const handleOrigFile = async (file: File) => {
        setOrigError('');
        try {
            const data = await loadSheetFile(file);
            setOrigData(data);
        } catch (e) {
            setOrigError((e as Error).message);
        }
    };

    const handleGenFile = async (file: File) => {
        setGenError('');
        try {
            const data = await loadSheetFile(file);
            setGenData(data);
        } catch (e) {
            setGenError((e as Error).message);
        }
    };

    const handleMappingChange = (key: keyof AuditMapping, value: string) => {
        setMapping((prev) => ({ ...prev, [key]: value }));
    };

    const canProceedStep0 = origData !== null && genData !== null;
    const canProceedStep1 = mapping.origDesc !== '' && mapping.genDesc !== '';

    const handleRunAudit = () => {
        if (!origData || !genData) return;
        const res = runAudit(origData.rows, origData.headers, genData.rows, genData.headers, mapping);
        setResult(res);
        setStep(2);
    };

    const handleDownload = () => {
        if (!result || !genData) return;
        downloadAuditReport(result, genData.fileName);
    };

    const handleReset = () => {
        setStep(0);
        setOrigData(null);
        setGenData(null);
        setOrigError('');
        setGenError('');
        setMapping(EMPTY_MAPPING);
        setResult(null);
    };

    return (
        <div className="flex flex-col gap-0">
            <AuditStepper currentStep={step} />

            {/* ── Step 0: Upload ── */}
            {step === 0 && (
                <motion.div
                    key="upload"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex flex-col gap-6"
                >
                    <div>
                        <h3 className="font-heading font-semibold text-base text-foreground mb-1">
                            Carregar Planilhas
                        </h3>
                        <p className="text-sm text-muted-foreground">
                            Carregue a planilha original (base oficial) e a planilha gerada pelo sistema para comparação.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <FileUploadCard
                            label="Planilha Original"
                            description="Base oficial — fonte da verdade"
                            accent="blue"
                            data={origData}
                            error={origError}
                            onFile={handleOrigFile}
                        />
                        <FileUploadCard
                            label="Planilha Gerada"
                            description="Exportada pelo sistema para auditoria"
                            accent="violet"
                            data={genData}
                            error={genError}
                            onFile={handleGenFile}
                        />
                    </div>

                    <div className="flex justify-between mt-2">
                        <Button variant="outline" onClick={onBack} className="gap-2">
                            <ArrowLeft className="w-4 h-4" />
                            Início
                        </Button>
                        <Button onClick={() => setStep(1)} disabled={!canProceedStep0} className="gap-2">
                            Configurar Colunas
                            <ShieldCheck className="w-4 h-4" />
                        </Button>
                    </div>
                </motion.div>
            )}

            {/* ── Step 1: Column mapping ── */}
            {step === 1 && (
                <motion.div
                    key="mapping"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex flex-col gap-6"
                >
                    <div>
                        <h3 className="font-heading font-semibold text-base text-foreground mb-1">
                            Mapear Colunas
                        </h3>
                        <p className="text-sm text-muted-foreground">
                            Associe as colunas de cada planilha aos campos que serão comparados.
                            Campos marcados com <span className="text-destructive font-medium">*</span> são obrigatórios.
                        </p>
                    </div>

                    <ColumnMappingCard
                        title="Planilha Original"
                        accent="blue"
                        headers={origData?.headers ?? []}
                        fields={ORIG_FIELDS}
                        values={mapping}
                        onChange={handleMappingChange}
                    />

                    <ColumnMappingCard
                        title="Planilha Gerada"
                        accent="violet"
                        headers={genData?.headers ?? []}
                        fields={GEN_FIELDS}
                        values={mapping}
                        onChange={handleMappingChange}
                    />

                    <div className="flex justify-between mt-2">
                        <Button variant="outline" onClick={() => setStep(0)} className="gap-2">
                            <ArrowLeft className="w-4 h-4" />
                            Voltar
                        </Button>
                        <Button onClick={handleRunAudit} disabled={!canProceedStep1} className="gap-2">
                            Executar Auditoria
                            <ShieldCheck className="w-4 h-4" />
                        </Button>
                    </div>
                </motion.div>
            )}

            {/* ── Step 2: Results ── */}
            {step === 2 && result && (
                <motion.div
                    key="result"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex flex-col gap-6"
                >
                    <ResultView result={result} genFileName={genData?.fileName ?? ''} onDownload={handleDownload} />

                    <div className="flex justify-between mt-2">
                        <Button variant="outline" onClick={handleReset} className="gap-2">
                            <ArrowLeft className="w-4 h-4" />
                            Nova Auditoria
                        </Button>
                        <Button variant="outline" onClick={onBack} className="gap-2">
                            Início
                        </Button>
                    </div>
                </motion.div>
            )}
        </div>
    );
}
