import { useCallback, useRef, useState } from 'react';
import { Upload, FileSpreadsheet, Barcode, Download, CheckCircle2, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { motion } from 'framer-motion';
import * as XLSX from 'xlsx';
import { SpreadsheetRow } from '@/lib/converter-types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface SeparadorCodigoBarrasProps {
    onBack: () => void;
}

export function SeparadorCodigoBarras({ onBack }: SeparadorCodigoBarrasProps) {
    const [sepRows, setSepRows] = useState<SpreadsheetRow[] | null>(null);
    const [sepHeaders, setSepHeaders] = useState<string[]>([]);
    const [sepFileName, setSepFileName] = useState('');
    const [sepInputCol, setSepInputCol] = useState('');
    const [sepEanCol, setSepEanCol] = useState('');
    const [sepProductCol, setSepProductCol] = useState('');
    const [sepResult, setSepResult] = useState<{ withEan: number; noEan: number } | null>(null);
    const [sepProcessedRows, setSepProcessedRows] = useState<SpreadsheetRow[] | null>(null);
    const sepInputRef = useRef<HTMLInputElement>(null);

    const handleSepFile = useCallback((file: File) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const data = new Uint8Array(e.target?.result as ArrayBuffer);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const json = XLSX.utils.sheet_to_json<SpreadsheetRow>(sheet, { header: 1 });

            const maxCols = Math.max(...(json as SpreadsheetRow[]).map((r) => (Array.isArray(r) ? r.length : 0)), 0);
            const normalized = (json as SpreadsheetRow[]).map((row) => {
                if (!Array.isArray(row)) return row as SpreadsheetRow;
                const r: SpreadsheetRow = new Array(maxCols);
                for (let i = 0; i < maxCols; i++) {
                    r[i] = (i < row.length && row[i] !== undefined && row[i] !== null) ? row[i] : '';
                }
                return r;
            });

            setSepFileName(file.name);
            setSepHeaders((normalized[0] || []).map(String));
            setSepRows(normalized.slice(1) as SpreadsheetRow[]);
            setSepInputCol('');
            setSepEanCol('');
            setSepProductCol('');
            setSepResult(null);
            setSepProcessedRows(null);
        };
        reader.readAsArrayBuffer(file);
    }, []);

    const handleSeparate = useCallback(() => {
        if (!sepRows || sepInputCol === '' || sepProductCol === '') return;

        const inputIdx = parseInt(sepInputCol);
        const prodIdx = parseInt(sepProductCol);
        const eanIdx = sepEanCol !== '' ? parseInt(sepEanCol) : -1;
        let withEan = 0, noEan = 0;

        const processed = sepRows.map((row): SpreadsheetRow => {
            const newRow = [...row] as SpreadsheetRow;
            while (newRow.length <= Math.max(inputIdx, prodIdx, eanIdx)) newRow.push('');

            const val = String(newRow[inputIdx] ?? '').trim();
            if (!val) return newRow;

            const eanMatch = val.match(/^(\d{7,})\s+([\s\S]+)/);
            if (eanMatch) {
                if (eanIdx >= 0) newRow[eanIdx] = eanMatch[1];
                newRow[prodIdx] = eanMatch[2].trim();
                if (inputIdx !== prodIdx && inputIdx !== eanIdx) newRow[inputIdx] = '';
                withEan++;
            } else {
                const pluMatch = val.match(/^\d{1,6}\s+([\s\S]+)/);
                newRow[prodIdx] = pluMatch ? pluMatch[1].trim() : val;
                if (inputIdx !== prodIdx) newRow[inputIdx] = '';
                noEan++;
            }
            return newRow;
        });

        setSepProcessedRows(processed);
        setSepResult({ withEan, noEan });
    }, [sepRows, sepInputCol, sepEanCol, sepProductCol]);

    const handleDownloadSep = useCallback(() => {
        if (!sepProcessedRows || !sepHeaders) return;
        const eanIdx = sepEanCol !== '' ? parseInt(sepEanCol) : -1;

        const wsData: string[][] = [
            sepHeaders,
            ...sepProcessedRows.map(row =>
                Array.from({ length: Math.max(row.length, sepHeaders.length) }, (_, i) => {
                    const v = row[i];
                    return v === null || v === undefined ? '' : String(v);
                })
            ),
        ];
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        if (eanIdx >= 0) {
            const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
            for (let r = range.s.r + 1; r <= range.e.r; r++) {
                const cellAddr = XLSX.utils.encode_cell({ r, c: eanIdx });
                const cell = ws[cellAddr];
                if (cell && cell.v !== '') {
                    cell.t = 's';
                    cell.z = '@';
                    delete cell.w;
                }
            }
        }
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Planilha');
        const baseName = sepFileName.replace(/\.[^.]+$/, '');
        XLSX.writeFile(wb, `${baseName}_separado.xlsx`);
    }, [sepProcessedRows, sepHeaders, sepFileName, sepEanCol]);

    return (
        <div className="space-y-6">
            {/* Cabeçalho */}
            <div className="flex items-center gap-3">
                <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5 -ml-2">
                    <ArrowLeft className="w-4 h-4" />
                    Início
                </Button>
                <div className="h-4 w-px bg-border" />
                <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center">
                    <Barcode className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                </div>
                <div>
                    <h2 className="font-heading font-semibold text-base text-foreground leading-tight">
                        Separador de Código de Barras
                    </h2>
                    <p className="text-xs text-muted-foreground">
                        Lê coluna com "EAN Produto" e separa: EAN → coluna EAN, Produto → coluna Produto
                    </p>
                </div>
            </div>

            {/* Ferramenta */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                <Card className="p-6 border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30">
                    {!sepRows ? (
                        <div
                            className="border-2 border-dashed border-indigo-300 dark:border-indigo-700 rounded-lg p-10 flex flex-col items-center gap-3 cursor-pointer hover:border-indigo-500 dark:hover:border-indigo-500 transition-colors"
                            onClick={() => sepInputRef.current?.click()}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                                e.preventDefault();
                                const file = e.dataTransfer.files[0];
                                if (file) handleSepFile(file);
                            }}
                        >
                            <input
                                ref={sepInputRef}
                                type="file"
                                accept=".xlsx,.xls,.csv"
                                className="hidden"
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) handleSepFile(file);
                                    e.target.value = '';
                                }}
                            />
                            <Upload className="w-8 h-8 text-indigo-400" />
                            <p className="text-sm text-indigo-700 dark:text-indigo-300 font-medium">
                                Arraste ou clique para carregar a planilha
                            </p>
                            <p className="text-xs text-muted-foreground text-center">
                                Você escolherá qual coluna tem os dados e onde gravar cada saída
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {/* Info do arquivo */}
                            <div className="flex items-center gap-3 p-3 rounded-lg bg-indigo-100/60 dark:bg-indigo-900/30">
                                <FileSpreadsheet className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-foreground truncate">{sepFileName}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {sepRows.length.toLocaleString('pt-BR')} linhas • {sepHeaders.length} colunas
                                    </p>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-xs text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 shrink-0"
                                    onClick={() => {
                                        setSepRows(null);
                                        setSepHeaders([]);
                                        setSepFileName('');
                                        setSepInputCol('');
                                        setSepEanCol('');
                                        setSepProductCol('');
                                        setSepResult(null);
                                        setSepProcessedRows(null);
                                    }}
                                >
                                    Trocar arquivo
                                </Button>
                            </div>

                            {/* Seleção de colunas */}
                            <div className="grid grid-cols-3 gap-3">
                                <div className="space-y-1.5">
                                    <label className="text-xs font-semibold text-foreground">
                                        Coluna de entrada
                                        <span className="block text-muted-foreground font-normal">(tem EAN + produto ou só produto)</span>
                                    </label>
                                    <Select value={sepInputCol} onValueChange={setSepInputCol}>
                                        <SelectTrigger className="h-9 text-sm">
                                            <SelectValue placeholder="Selecionar..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {sepHeaders.map((h, i) => (
                                                <SelectItem key={i} value={String(i)}>
                                                    {h || `Coluna ${String.fromCharCode(65 + i)}`}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-semibold text-foreground">
                                        Coluna EAN (saída)
                                        <span className="block text-muted-foreground font-normal">(onde gravar o código de barras)</span>
                                    </label>
                                    <Select value={sepEanCol} onValueChange={setSepEanCol}>
                                        <SelectTrigger className="h-9 text-sm">
                                            <SelectValue placeholder="Selecionar..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {sepHeaders.map((h, i) => (
                                                <SelectItem key={i} value={String(i)}>
                                                    {h || `Coluna ${String.fromCharCode(65 + i)}`}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-semibold text-foreground">
                                        Coluna Produto (saída)
                                        <span className="block text-muted-foreground font-normal">(onde gravar só o nome)</span>
                                    </label>
                                    <Select value={sepProductCol} onValueChange={setSepProductCol}>
                                        <SelectTrigger className="h-9 text-sm">
                                            <SelectValue placeholder="Selecionar..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {sepHeaders.map((h, i) => (
                                                <SelectItem key={i} value={String(i)}>
                                                    {h || `Coluna ${String.fromCharCode(65 + i)}`}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            {/* Exemplo visual */}
                            <div className="p-3 rounded-lg bg-white/60 dark:bg-white/5 border border-indigo-200 dark:border-indigo-800 text-xs space-y-1.5">
                                <p className="font-semibold text-indigo-800 dark:text-indigo-200 mb-1.5">Como funciona:</p>
                                <div className="font-mono text-[11px] space-y-1">
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-muted-foreground">"17896071030042  BISC MABEL CREAM..."</span>
                                        <span className="text-indigo-400">→</span>
                                        <span className="text-emerald-700 dark:text-emerald-400">EAN: 17896071030042 | Produto: BISC MABEL CREAM...</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-muted-foreground">"CONECTOR P HASTE ATERRAMENTO..."</span>
                                        <span className="text-indigo-400">→</span>
                                        <span className="text-emerald-700 dark:text-emerald-400">EAN: (vazio) | Produto: CONECTOR P HASTE...</span>
                                    </div>
                                </div>
                            </div>

                            {/* Resultado */}
                            {sepResult && (
                                <motion.div
                                    initial={{ opacity: 0, y: -6 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="grid grid-cols-2 gap-2"
                                >
                                    <div className="p-2.5 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 border border-indigo-200 dark:border-indigo-800 text-center">
                                        <p className="text-lg font-bold text-indigo-700 dark:text-indigo-300">{sepResult.withEan}</p>
                                        <p className="text-[10px] text-indigo-600 dark:text-indigo-500">Com EAN extraído</p>
                                    </div>
                                    <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-center">
                                        <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">{sepResult.noEan}</p>
                                        <p className="text-[10px] text-emerald-600 dark:text-emerald-500">Só produto (sem EAN)</p>
                                    </div>
                                </motion.div>
                            )}

                            {/* Ações */}
                            <div className="flex gap-2">
                                <Button
                                    className="flex-1 gap-2 bg-indigo-600 hover:bg-indigo-700 text-white"
                                    disabled={sepInputCol === '' || sepProductCol === ''}
                                    onClick={handleSeparate}
                                >
                                    <Barcode className="w-4 h-4" />
                                    Separar / Normalizar
                                </Button>
                                {sepProcessedRows && (
                                    <Button
                                        variant="outline"
                                        className="gap-2 border-indigo-400 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/30"
                                        onClick={handleDownloadSep}
                                    >
                                        <Download className="w-4 h-4" />
                                        Baixar planilha
                                    </Button>
                                )}
                            </div>

                            {sepResult && (
                                <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    Processado! Clique em "Baixar planilha" para salvar.
                                </p>
                            )}
                        </div>
                    )}
                </Card>
            </motion.div>
        </div>
    );
}
