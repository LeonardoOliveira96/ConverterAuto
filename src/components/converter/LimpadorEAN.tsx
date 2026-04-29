import { useCallback, useRef, useState } from 'react';
import { Upload, FileSpreadsheet, ScanLine, Download, CheckCircle2, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { motion } from 'framer-motion';
import * as XLSX from 'xlsx';
import { SpreadsheetRow } from '@/lib/converter-types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Detecta EAN (8–14 dígitos) no início da célula seguido de texto
const _RX_BARCODE_SPLIT = /^(\d{8,14})\s+([\s\S]+)/;

interface LimpadorEANProps {
    onBack: () => void;
}

export function LimpadorEAN({ onBack }: LimpadorEANProps) {
    const [cleanRows, setCleanRows] = useState<SpreadsheetRow[] | null>(null);
    const [cleanHeaders, setCleanHeaders] = useState<string[]>([]);
    const [cleanFileName, setCleanFileName] = useState('');
    const [cleanSourceCol, setCleanSourceCol] = useState('');
    const [cleanDestCol, setCleanDestCol] = useState('');
    const [cleanResult, setCleanResult] = useState<{ separated: number; plain: number; skipped: number } | null>(null);
    const [cleanProcessedRows, setCleanProcessedRows] = useState<SpreadsheetRow[] | null>(null);
    const cleanInputRef = useRef<HTMLInputElement>(null);

    const handleCleanFile = useCallback((file: File) => {
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

            setCleanFileName(file.name);
            setCleanHeaders((normalized[0] || []).map(String));
            setCleanRows(normalized.slice(1) as SpreadsheetRow[]);
            setCleanSourceCol('');
            setCleanDestCol('');
            setCleanResult(null);
            setCleanProcessedRows(null);
        };
        reader.readAsArrayBuffer(file);
    }, []);

    const handleCleanProcess = useCallback(() => {
        if (!cleanRows || cleanSourceCol === '' || cleanDestCol === '') return;

        const srcIdx = parseInt(cleanSourceCol);
        const dstIdx = parseInt(cleanDestCol);
        let separated = 0, plain = 0, skipped = 0;

        const processed = cleanRows.map((row): SpreadsheetRow => {
            const newRow = [...row] as SpreadsheetRow;
            while (newRow.length <= Math.max(srcIdx, dstIdx)) newRow.push('');

            const srcVal = String(newRow[srcIdx] ?? '').trim();
            if (!srcVal) return newRow;

            const dstVal = String(newRow[dstIdx] ?? '').trim();

            const match = _RX_BARCODE_SPLIT.exec(srcVal);
            if (match) {
                const barcode = match[1];
                const description = match[2].replace(/\s+/g, ' ').trim();
                newRow[srcIdx] = barcode;
                if (dstVal === '') {
                    newRow[dstIdx] = description;
                    separated++;
                } else {
                    skipped++;
                }
            } else {
                if (dstVal === '') {
                    newRow[dstIdx] = srcVal.replace(/\s+/g, ' ').trim();
                    plain++;
                } else {
                    skipped++;
                }
            }
            return newRow;
        });

        setCleanProcessedRows(processed);
        setCleanResult({ separated, plain, skipped });
    }, [cleanRows, cleanSourceCol, cleanDestCol]);

    const handleDownloadClean = useCallback(() => {
        if (!cleanProcessedRows || !cleanHeaders) return;

        const srcIdx = parseInt(cleanSourceCol);
        const wsData: string[][] = [
            cleanHeaders,
            ...cleanProcessedRows.map(row =>
                Array.from({ length: Math.max(row.length, cleanHeaders.length) }, (_, i) => {
                    const v = row[i];
                    return v === null || v === undefined ? '' : String(v);
                })
            ),
        ];
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        if (srcIdx >= 0) {
            const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
            for (let r = range.s.r + 1; r <= range.e.r; r++) {
                const cellAddr = XLSX.utils.encode_cell({ r, c: srcIdx });
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
        const baseName = cleanFileName.replace(/\.[^.]+$/, '');
        XLSX.writeFile(wb, `${baseName}_limpo.xlsx`);
    }, [cleanProcessedRows, cleanHeaders, cleanFileName, cleanSourceCol]);

    return (
        <div className="space-y-6">
            {/* Cabeçalho */}
            <div className="flex items-center gap-3">
                <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5 -ml-2">
                    <ArrowLeft className="w-4 h-4" />
                    Início
                </Button>
                <div className="h-4 w-px bg-border" />
                <div className="w-8 h-8 rounded-lg bg-teal-100 dark:bg-teal-900/50 flex items-center justify-center">
                    <ScanLine className="w-4 h-4 text-teal-600 dark:text-teal-400" />
                </div>
                <div>
                    <h2 className="font-heading font-semibold text-base text-foreground leading-tight">
                        Limpador EAN + Descrição
                    </h2>
                    <p className="text-xs text-muted-foreground">
                        Separa código de barras (8–14 dígitos) da descrição em uma única coluna
                    </p>
                </div>
            </div>

            {/* Ferramenta */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                <Card className="p-6 border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/30">
                    {!cleanRows ? (
                        <div
                            className="border-2 border-dashed border-teal-300 dark:border-teal-700 rounded-lg p-10 flex flex-col items-center gap-3 cursor-pointer hover:border-teal-500 dark:hover:border-teal-500 transition-colors"
                            onClick={() => cleanInputRef.current?.click()}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                                e.preventDefault();
                                const file = e.dataTransfer.files[0];
                                if (file) handleCleanFile(file);
                            }}
                        >
                            <input
                                ref={cleanInputRef}
                                type="file"
                                accept=".xlsx,.xls,.csv"
                                className="hidden"
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) handleCleanFile(file);
                                    e.target.value = '';
                                }}
                            />
                            <Upload className="w-8 h-8 text-teal-400" />
                            <p className="text-sm text-teal-700 dark:text-teal-300 font-medium">
                                Arraste ou clique para carregar a planilha
                            </p>
                            <p className="text-xs text-muted-foreground text-center">
                                Escolha a coluna de entrada e a coluna onde gravar a descrição limpa
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {/* Info do arquivo */}
                            <div className="flex items-center gap-3 p-3 rounded-lg bg-teal-100/60 dark:bg-teal-900/30">
                                <FileSpreadsheet className="w-5 h-5 text-teal-600 dark:text-teal-400 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-foreground truncate">{cleanFileName}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {cleanRows.length.toLocaleString('pt-BR')} linhas • {cleanHeaders.length} colunas
                                    </p>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-xs text-teal-600 hover:text-teal-800 dark:text-teal-400 shrink-0"
                                    onClick={() => {
                                        setCleanRows(null);
                                        setCleanHeaders([]);
                                        setCleanFileName('');
                                        setCleanSourceCol('');
                                        setCleanDestCol('');
                                        setCleanResult(null);
                                        setCleanProcessedRows(null);
                                    }}
                                >
                                    Trocar arquivo
                                </Button>
                            </div>

                            {/* Seleção de colunas */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <label className="text-xs font-semibold text-foreground">
                                        Coluna de entrada
                                        <span className="block text-muted-foreground font-normal">(ex: "Cód.Bar." — tem EAN + descrição misturado)</span>
                                    </label>
                                    <Select value={cleanSourceCol} onValueChange={setCleanSourceCol}>
                                        <SelectTrigger className="h-9 text-sm">
                                            <SelectValue placeholder="Selecionar..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {cleanHeaders.map((h, i) => (
                                                <SelectItem key={i} value={String(i)}>
                                                    {h || `Coluna ${String.fromCharCode(65 + i)}`}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-semibold text-foreground">
                                        Coluna de destino
                                        <span className="block text-muted-foreground font-normal">(onde gravar a descrição — não sobrescreve se já preenchida)</span>
                                    </label>
                                    <Select value={cleanDestCol} onValueChange={setCleanDestCol}>
                                        <SelectTrigger className="h-9 text-sm">
                                            <SelectValue placeholder="Selecionar..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {cleanHeaders.map((h, i) => (
                                                <SelectItem key={i} value={String(i)}>
                                                    {h || `Coluna ${String.fromCharCode(65 + i)}`}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            {/* Exemplo visual */}
                            <div className="p-3 rounded-lg bg-white/60 dark:bg-white/5 border border-teal-200 dark:border-teal-800 text-xs space-y-1.5">
                                <p className="font-semibold text-teal-800 dark:text-teal-200 mb-1.5">Como funciona:</p>
                                <div className="font-mono text-[11px] space-y-1.5">
                                    <div className="space-y-0.5">
                                        <p className="text-muted-foreground">"17896071030042  BISC MABEL CREAM CRACKER 600G UN"</p>
                                        <div className="flex gap-3 pl-2">
                                            <span className="text-teal-500">→</span>
                                            <span>
                                                <span className="text-foreground">Col. original: </span>
                                                <span className="text-emerald-700 dark:text-emerald-400">"17896071030042"</span>
                                            </span>
                                            <span>
                                                <span className="text-foreground">Col. destino: </span>
                                                <span className="text-emerald-700 dark:text-emerald-400">"BISC MABEL CREAM CRACKER 600G UN"</span>
                                            </span>
                                        </div>
                                    </div>
                                    <div className="space-y-0.5">
                                        <p className="text-muted-foreground">"CONECTOR P HASTE ATERRAMENTO GRA UN"</p>
                                        <div className="flex gap-3 pl-2">
                                            <span className="text-teal-500">→</span>
                                            <span>
                                                <span className="text-foreground">Col. original: </span>
                                                <span className="text-muted-foreground">permanece igual</span>
                                            </span>
                                            <span>
                                                <span className="text-foreground">Col. destino: </span>
                                                <span className="text-emerald-700 dark:text-emerald-400">"CONECTOR P HASTE ATERRAMENTO GRA UN"</span>
                                            </span>
                                        </div>
                                    </div>
                                    <p className="text-amber-600 dark:text-amber-400 mt-1">
                                        ⚠ Coluna destino só é preenchida se estiver <strong>vazia</strong>
                                    </p>
                                </div>
                            </div>

                            {/* Resultado */}
                            {cleanResult && (
                                <motion.div
                                    initial={{ opacity: 0, y: -6 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="grid grid-cols-3 gap-2"
                                >
                                    <div className="p-2.5 rounded-lg bg-teal-100 dark:bg-teal-900/40 border border-teal-200 dark:border-teal-800 text-center">
                                        <p className="text-lg font-bold text-teal-700 dark:text-teal-300">{cleanResult.separated}</p>
                                        <p className="text-[10px] text-teal-600 dark:text-teal-500">EAN separado</p>
                                    </div>
                                    <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-center">
                                        <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">{cleanResult.plain}</p>
                                        <p className="text-[10px] text-emerald-600 dark:text-emerald-500">Só descrição</p>
                                    </div>
                                    <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-center">
                                        <p className="text-lg font-bold text-amber-700 dark:text-amber-400">{cleanResult.skipped}</p>
                                        <p className="text-[10px] text-amber-600 dark:text-amber-500">Destino já preenchido</p>
                                    </div>
                                </motion.div>
                            )}

                            {/* Ações */}
                            <div className="flex gap-2">
                                <Button
                                    className="flex-1 gap-2 bg-teal-600 hover:bg-teal-700 text-white"
                                    disabled={cleanSourceCol === '' || cleanDestCol === '' || cleanSourceCol === cleanDestCol}
                                    onClick={handleCleanProcess}
                                >
                                    <ScanLine className="w-4 h-4" />
                                    Separar EAN e Descrição
                                </Button>
                                {cleanProcessedRows && (
                                    <Button
                                        variant="outline"
                                        className="gap-2 border-teal-400 text-teal-700 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-900/30"
                                        onClick={handleDownloadClean}
                                    >
                                        <Download className="w-4 h-4" />
                                        Baixar planilha
                                    </Button>
                                )}
                            </div>

                            {cleanResult && (
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
