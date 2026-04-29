import { useCallback, useRef, useState } from 'react';
import { Upload, FileSpreadsheet, Scissors, Download, CheckCircle2, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { motion } from 'framer-motion';
import * as XLSX from 'xlsx';
import { SpreadsheetRow } from '@/lib/converter-types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

// ─── Extração de unidade (apenas no final da string) ─────────────────────────
const VALID_UNITS = ['UN', 'KG', 'LT', 'ML', 'CX', 'PC', 'FD', 'SC', 'CA', 'CJ', 'JG', 'LA', 'BJ', 'M2', 'MT', 'CT', 'BI', 'FA', 'VL', 'KT', 'JO', 'PR', 'DP', 'RO', 'M'] as const;
type ValidUnit = typeof VALID_UNITS[number];

const FALLBACK_UNITS = new Set([
    'UN', 'KG', 'LT', 'ML', 'CX', 'PC', 'FD', 'SC',
    'PA', 'FR', 'PT', 'VD', 'DZ', 'BD', 'RL', 'MT',
    'CA', 'CJ', 'JG', 'LA', 'BJ', 'M2',
    'CT', 'BI', 'FA', 'VL', 'KT', 'JO', 'PR', 'DP', 'RO',
]);

const _RX_TRAIL_NUMS = /(\s+-?\d+)+\s*$/;

const _RX_UNIT_END = new RegExp(
    `(?:(?<=\\s)|(?<=\\d))(${VALID_UNITS.join('|')})\\s*$`,
    'i'
);

function extractUnit(raw: string): { unit: ValidUnit; cleaned: string } | null {
    const match = _RX_UNIT_END.exec(raw);
    if (!match) return null;
    const unit = match[1].toUpperCase() as ValidUnit;
    const cleaned = raw.slice(0, match.index).trimEnd();
    return { unit, cleaned };
}

function extractUnitFallback(raw: string): { unit: string; cleaned: string } | null {
    const trimmed = raw.trimEnd();
    if (trimmed.length < 3) return null;
    const last2 = trimmed.slice(-2).toUpperCase();
    if (!FALLBACK_UNITS.has(last2)) return null;
    const cleaned = trimmed.slice(0, -2).trimEnd();
    return { unit: last2, cleaned };
}

interface ExtractorUnidadesProps {
    onBack: () => void;
}

export function ExtractorUnidades({ onBack }: ExtractorUnidadesProps) {
    const [unitRows, setUnitRows] = useState<SpreadsheetRow[] | null>(null);
    const [unitHeaders, setUnitHeaders] = useState<string[]>([]);
    const [unitFileName, setUnitFileName] = useState('');
    const [unitSourceCol, setUnitSourceCol] = useState('');
    const [unitDestCol, setUnitDestCol] = useState('');
    const [unitResult, setUnitResult] = useState<{
        extracted: number;
        skipped: number;
        unchanged: number;
    } | null>(null);
    const [unitProcessedRows, setUnitProcessedRows] = useState<SpreadsheetRow[] | null>(null);
    const unitInputRef = useRef<HTMLInputElement>(null);

    const handleUnitFile = useCallback((file: File) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const data = new Uint8Array(e.target?.result as ArrayBuffer);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const json = XLSX.utils.sheet_to_json<SpreadsheetRow>(sheet, { header: 1 });

            const maxCols = Math.max(...json.map((r) => (Array.isArray(r) ? r.length : 0)), 0);
            const normalized = json.map((row) => {
                if (!Array.isArray(row)) return row as SpreadsheetRow;
                const r: SpreadsheetRow = new Array(maxCols);
                for (let i = 0; i < maxCols; i++) {
                    r[i] = (i < row.length && row[i] !== undefined && row[i] !== null) ? row[i] : '';
                }
                return r;
            });

            setUnitFileName(file.name);
            setUnitHeaders((normalized[0] || []).map(String));
            setUnitRows(normalized.slice(1) as SpreadsheetRow[]);
            setUnitSourceCol('');
            setUnitDestCol('');
            setUnitResult(null);
            setUnitProcessedRows(null);
        };
        reader.readAsArrayBuffer(file);
    }, []);

    const handleExtractUnits = useCallback(() => {
        if (!unitRows || unitSourceCol === '' || unitDestCol === '') return;

        const srcIdx = parseInt(unitSourceCol);
        const dstIdx = parseInt(unitDestCol);
        let extracted = 0, skipped = 0, unchanged = 0;

        const processed = unitRows.map((row) => {
            const newRow = [...row] as SpreadsheetRow;
            while (newRow.length <= Math.max(srcIdx, dstIdx)) newRow.push('');

            const srcVal = String(newRow[srcIdx] ?? '').trim();
            if (!srcVal) { unchanged++; return newRow; }

            const stripped = srcVal.replace(_RX_TRAIL_NUMS, '').trimEnd();

            const dstVal = String(newRow[dstIdx] ?? '').trim();
            if (dstVal !== '') {
                if (stripped !== srcVal) newRow[srcIdx] = stripped;
                skipped++;
                return newRow;
            }

            const result = extractUnit(stripped) ?? extractUnitFallback(stripped);
            if (!result) {
                if (stripped !== srcVal) newRow[srcIdx] = stripped;
                unchanged++;
                return newRow;
            }

            newRow[srcIdx] = result.cleaned;
            newRow[dstIdx] = result.unit;
            extracted++;
            return newRow;
        });

        setUnitProcessedRows(processed);
        setUnitResult({ extracted, skipped, unchanged });
    }, [unitRows, unitSourceCol, unitDestCol]);

    const handleDownloadUnit = useCallback(() => {
        if (!unitProcessedRows || !unitHeaders) return;

        const wsData: string[][] = [
            unitHeaders,
            ...unitProcessedRows.map(row =>
                Array.from({ length: Math.max(row.length, unitHeaders.length) }, (_, i) => {
                    const v = row[i];
                    return v === null || v === undefined ? '' : String(v);
                })
            ),
        ];
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Planilha');
        const baseName = unitFileName.replace(/\.[^.]+$/, '');
        XLSX.writeFile(wb, `${baseName}_unidades.xlsx`);
    }, [unitProcessedRows, unitHeaders, unitFileName]);

    return (
        <div className="space-y-6">
            {/* Cabeçalho */}
            <div className="flex items-center gap-3">
                <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5 -ml-2">
                    <ArrowLeft className="w-4 h-4" />
                    Início
                </Button>
                <div className="h-4 w-px bg-border" />
                <div className="w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-900/50 flex items-center justify-center">
                    <Scissors className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                </div>
                <div>
                    <h2 className="font-heading font-semibold text-base text-foreground leading-tight">
                        Extrator de Unidades
                    </h2>
                    <p className="text-xs text-muted-foreground">
                        Extrai unidades do final da descrição (UN, KG, LT, ML, CX, PC, FD, SC)
                    </p>
                </div>
            </div>

            {/* Ferramenta */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                <Card className="p-6 border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/30">
                    {!unitRows ? (
                        <div
                            className="border-2 border-dashed border-violet-300 dark:border-violet-700 rounded-lg p-10 flex flex-col items-center gap-3 cursor-pointer hover:border-violet-500 dark:hover:border-violet-500 transition-colors"
                            onClick={() => unitInputRef.current?.click()}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                                e.preventDefault();
                                const file = e.dataTransfer.files[0];
                                if (file) handleUnitFile(file);
                            }}
                        >
                            <input
                                ref={unitInputRef}
                                type="file"
                                accept=".xlsx,.xls,.csv"
                                className="hidden"
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) handleUnitFile(file);
                                    e.target.value = '';
                                }}
                            />
                            <Upload className="w-8 h-8 text-violet-400" />
                            <p className="text-sm text-violet-700 dark:text-violet-300 font-medium">
                                Arraste ou clique para carregar a planilha
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {/* Info do arquivo */}
                            <div className="flex items-center gap-3 p-3 rounded-lg bg-violet-100/60 dark:bg-violet-900/30">
                                <FileSpreadsheet className="w-5 h-5 text-violet-600 dark:text-violet-400 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-foreground truncate">{unitFileName}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {unitRows.length.toLocaleString('pt-BR')} linhas • {unitHeaders.length} colunas
                                    </p>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-xs text-violet-600 hover:text-violet-800 dark:text-violet-400 shrink-0"
                                    onClick={() => {
                                        setUnitRows(null);
                                        setUnitHeaders([]);
                                        setUnitFileName('');
                                        setUnitSourceCol('');
                                        setUnitDestCol('');
                                        setUnitResult(null);
                                        setUnitProcessedRows(null);
                                    }}
                                >
                                    Trocar arquivo
                                </Button>
                            </div>

                            {/* Seleção de colunas */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <label className="text-xs font-semibold text-foreground">
                                        Coluna de origem <span className="text-muted-foreground">(descrição)</span>
                                    </label>
                                    <Select value={unitSourceCol} onValueChange={setUnitSourceCol}>
                                        <SelectTrigger className="h-9 text-sm">
                                            <SelectValue placeholder="Selecionar..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {unitHeaders.map((h, i) => (
                                                <SelectItem key={i} value={String(i)}>
                                                    {h || `Coluna ${String.fromCharCode(65 + i)}`}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-semibold text-foreground">
                                        Coluna de destino <span className="text-muted-foreground">(unidade)</span>
                                    </label>
                                    <Select value={unitDestCol} onValueChange={setUnitDestCol}>
                                        <SelectTrigger className="h-9 text-sm">
                                            <SelectValue placeholder="Selecionar..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {unitHeaders.map((h, i) => (
                                                <SelectItem key={i} value={String(i)}>
                                                    {h || `Coluna ${String.fromCharCode(65 + i)}`}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            {/* Exemplos */}
                            <div className="p-3 rounded-lg bg-white/60 dark:bg-white/5 border border-violet-200 dark:border-violet-800 text-xs space-y-1">
                                <p className="font-semibold text-violet-800 dark:text-violet-200 mb-1.5">Exemplos:</p>
                                <div className="grid grid-cols-1 gap-1 font-mono text-[11px]">
                                    <div className="flex items-center gap-2">
                                        <span className="text-muted-foreground">"ABRACADEIRA NYLON 4X200 UN"</span>
                                        <span className="text-violet-500">→</span>
                                        <span className="text-foreground">"ABRACADEIRA NYLON 4X200"</span>
                                        <Badge variant="outline" className="text-[10px] py-0 border-violet-400 text-violet-700 dark:text-violet-300">UN</Badge>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-muted-foreground">"ABA ADESIVA KISS 48UN"</span>
                                        <span className="text-violet-500">→</span>
                                        <span className="text-foreground">"ABA ADESIVA KISS 48"</span>
                                        <Badge variant="outline" className="text-[10px] py-0 border-violet-400 text-violet-700 dark:text-violet-300">UN</Badge>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-muted-foreground">"ALGUM PRODUTO FUN"</span>
                                        <span className="text-red-400">→</span>
                                        <span className="text-muted-foreground">sem alteração (FUN ≠ unidade)</span>
                                    </div>
                                </div>
                            </div>

                            {/* Resultado */}
                            {unitResult && (
                                <motion.div
                                    initial={{ opacity: 0, y: -6 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="grid grid-cols-3 gap-2"
                                >
                                    <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-center">
                                        <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">{unitResult.extracted}</p>
                                        <p className="text-[10px] text-emerald-600 dark:text-emerald-500">Extraídas</p>
                                    </div>
                                    <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-center">
                                        <p className="text-lg font-bold text-amber-700 dark:text-amber-400">{unitResult.skipped}</p>
                                        <p className="text-[10px] text-amber-600 dark:text-amber-500">Já tinham unidade</p>
                                    </div>
                                    <div className="p-2.5 rounded-lg bg-muted/40 border text-center">
                                        <p className="text-lg font-bold text-foreground">{unitResult.unchanged}</p>
                                        <p className="text-[10px] text-muted-foreground">Sem unidade</p>
                                    </div>
                                </motion.div>
                            )}

                            {/* Ações */}
                            <div className="flex gap-2">
                                <Button
                                    className="flex-1 gap-2 bg-violet-600 hover:bg-violet-700 text-white"
                                    disabled={unitSourceCol === '' || unitDestCol === '' || unitSourceCol === unitDestCol}
                                    onClick={handleExtractUnits}
                                >
                                    <Scissors className="w-4 h-4" />
                                    Extrair Unidades
                                </Button>
                                {unitProcessedRows && (
                                    <Button
                                        variant="outline"
                                        className="gap-2 border-violet-400 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/30"
                                        onClick={handleDownloadUnit}
                                    >
                                        <Download className="w-4 h-4" />
                                        Baixar planilha
                                    </Button>
                                )}
                            </div>

                            {unitResult && unitResult.extracted > 0 && (
                                <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    Processado! Clique em "Baixar planilha" para salvar o resultado.
                                </p>
                            )}
                        </div>
                    )}
                </Card>
            </motion.div>
        </div>
    );
}
