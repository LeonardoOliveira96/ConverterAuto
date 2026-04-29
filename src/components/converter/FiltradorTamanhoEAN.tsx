import { useCallback, useRef, useState } from 'react';
import { Upload, FileSpreadsheet, Filter, Download, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { motion } from 'framer-motion';
import * as XLSX from 'xlsx';
import { SpreadsheetRow } from '@/lib/converter-types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';

interface FiltradorTamanhoEANProps {
    onBack: () => void;
}

export function FiltradorTamanhoEAN({ onBack }: FiltradorTamanhoEANProps) {
    const [rows, setRows] = useState<SpreadsheetRow[] | null>(null);
    const [headers, setHeaders] = useState<string[]>([]);
    const [fileName, setFileName] = useState('');
    const [barcodeCol, setBarcodeCol] = useState('');
    const [referenceCode, setReferenceCode] = useState('7908654107829');
    const [removeEmpty, setRemoveEmpty] = useState(false);
    const [result, setResult] = useState<{ kept: number; removed: number } | null>(null);
    const [processedRows, setProcessedRows] = useState<SpreadsheetRow[] | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleFile = useCallback((file: File) => {
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

            setFileName(file.name);
            setHeaders((normalized[0] || []).map(String));
            setRows(normalized.slice(1) as SpreadsheetRow[]);
            setBarcodeCol('');
            setReferenceCode('');
            setResult(null);
            setProcessedRows(null);
        };
        reader.readAsArrayBuffer(file);
    }, []);

    const handleProcess = useCallback(() => {
        if (!rows || barcodeCol === '' || !referenceCode.trim()) return;

        const colIdx = parseInt(barcodeCol);
        const minDigits = referenceCode.trim().length;
        let kept = 0, removed = 0;

        const filtered = rows.filter((row) => {
            const val = String(row[colIdx] ?? '').trim();
            if (!val) {
                if (removeEmpty) { removed++; return false; }
                kept++;
                return true;
            }
            if (!/^\d+$/.test(val)) {
                removed++;
                return false;
            }
            if (val.length === minDigits) {
                kept++;
                return true;
            }
            removed++;
            return false;
        });

        setProcessedRows(filtered);
        setResult({ kept, removed });
    }, [rows, barcodeCol, referenceCode, removeEmpty]);

    const handleDownload = useCallback(() => {
        if (!processedRows || !headers) return;

        const colIdx = parseInt(barcodeCol);
        const wsData: string[][] = [
            headers,
            ...processedRows.map(row =>
                Array.from({ length: Math.max(row.length, headers.length) }, (_, i) => {
                    const v = row[i];
                    return v === null || v === undefined ? '' : String(v);
                })
            ),
        ];
        const ws = XLSX.utils.aoa_to_sheet(wsData);

        if (colIdx >= 0) {
            const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
            for (let r = range.s.r + 1; r <= range.e.r; r++) {
                const cellAddr = XLSX.utils.encode_cell({ r, c: colIdx });
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
        const baseName = fileName.replace(/\.[^.]+$/, '');
        XLSX.writeFile(wb, `${baseName}_filtrado.xlsx`);
    }, [processedRows, headers, fileName, barcodeCol]);

    const resetFile = useCallback(() => {
        setRows(null);
        setHeaders([]);
        setFileName('');
        setBarcodeCol('');
        setReferenceCode('');
        setResult(null);
        setProcessedRows(null);
    }, []);

    return (
        <div className="space-y-6">
            {/* Cabeçalho */}
            <div className="flex items-center gap-3">
                <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5 -ml-2">
                    <ArrowLeft className="w-4 h-4" />
                    Início
                </Button>
                <div className="h-4 w-px bg-border" />
                <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center">
                    <Filter className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                    <h2 className="font-heading font-semibold text-base text-foreground leading-tight">
                        Filtrar por Tamanho do Código de Barras
                    </h2>
                    <p className="text-xs text-muted-foreground">
                        Remove registros cujo código de barras tenha menos dígitos que o código de referência
                    </p>
                </div>
            </div>

            {/* Ferramenta */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                <Card className="p-6 border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30">
                    {!rows ? (
                        <div
                            className="border-2 border-dashed border-amber-300 dark:border-amber-700 rounded-lg p-10 flex flex-col items-center gap-3 cursor-pointer hover:border-amber-500 dark:hover:border-amber-500 transition-colors"
                            onClick={() => inputRef.current?.click()}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                                e.preventDefault();
                                const file = e.dataTransfer.files[0];
                                if (file) handleFile(file);
                            }}
                        >
                            <input
                                ref={inputRef}
                                type="file"
                                accept=".xlsx,.xls,.csv"
                                className="hidden"
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) handleFile(file);
                                    e.target.value = '';
                                }}
                            />
                            <Upload className="w-8 h-8 text-amber-400" />
                            <p className="text-sm text-amber-700 dark:text-amber-300 font-medium">
                                Arraste ou clique para carregar a planilha
                            </p>
                            <p className="text-xs text-muted-foreground text-center">
                                Selecione a coluna de códigos de barras e informe o código de referência
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {/* Info do arquivo */}
                            <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-100/60 dark:bg-amber-900/30">
                                <FileSpreadsheet className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-foreground truncate">{fileName}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {rows.length.toLocaleString('pt-BR')} linhas • {headers.length} colunas
                                    </p>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-xs text-amber-600 hover:text-amber-800 dark:text-amber-400 shrink-0"
                                    onClick={resetFile}
                                >
                                    Trocar arquivo
                                </Button>
                            </div>

                            {/* Coluna + código de referência */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <label className="text-xs font-semibold text-foreground">
                                        Coluna de códigos de barras
                                        <span className="block text-muted-foreground font-normal">
                                            Coluna que contém os códigos EAN/barras
                                        </span>
                                    </label>
                                    <Select value={barcodeCol} onValueChange={setBarcodeCol}>
                                        <SelectTrigger className="h-9 text-sm">
                                            <SelectValue placeholder="Selecionar..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {headers.map((h, i) => (
                                                <SelectItem key={i} value={String(i)}>
                                                    {h || `Coluna ${String.fromCharCode(65 + i)}`}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-semibold text-foreground">
                                        Código de referência
                                        <span className="block text-muted-foreground font-normal">
                                            Define a quantidade exata de dígitos aceitos
                                        </span>
                                    </label>
                                    <Input
                                        className="h-9 text-sm font-mono"
                                        placeholder="Ex: 7908654107829"
                                        value={referenceCode}
                                        onChange={(e) => setReferenceCode(e.target.value)}
                                    />
                                </div>
                            </div>

                            {/* Caixa de regras */}
                            <div className="p-3 rounded-lg bg-white/60 dark:bg-white/5 border border-amber-200 dark:border-amber-800 text-xs space-y-1.5">
                                <p className="font-semibold text-amber-800 dark:text-amber-200 mb-1.5">Regras de filtragem:</p>
                                <ul className="space-y-1 text-muted-foreground list-disc list-inside">
                                    <li>Mantém apenas códigos com quantidade de dígitos <strong>exatamente igual</strong> ao de referência</li>
                                    <li>Remove códigos com letras, espaços ou caracteres não numéricos</li>
                                    <li>Comparação por <strong>quantidade de dígitos</strong>, não pelo valor numérico</li>
                                </ul>
                                {referenceCode.trim() && (
                                    <p className="mt-2 text-amber-700 dark:text-amber-300 font-medium">
                                        Dígitos aceitos:{' '}
                                        <span className="font-mono font-bold">{referenceCode.trim().length}</span>
                                        {' '}(baseado em &ldquo;{referenceCode.trim()}&rdquo;)
                                    </p>
                                )}
                            </div>

                            {/* Checkbox: remover linhas vazias */}
                            <label className="flex items-center gap-2.5 cursor-pointer select-none w-fit">
                                <Checkbox
                                    id="remove-empty"
                                    checked={removeEmpty}
                                    onCheckedChange={(v) => setRemoveEmpty(v === true)}
                                />
                                <span className="text-sm text-foreground">
                                    Deseja remover linhas vazias?
                                </span>
                            </label>

                            {/* Resultado */}
                            {result && (
                                <motion.div
                                    initial={{ opacity: 0, y: -6 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="grid grid-cols-2 gap-2"
                                >
                                    <div className="p-2.5 rounded-lg bg-amber-100 dark:bg-amber-900/40 border border-amber-200 dark:border-amber-800 text-center">
                                        <p className="text-lg font-bold text-amber-700 dark:text-amber-300">{result.kept.toLocaleString('pt-BR')}</p>
                                        <p className="text-[11px] text-muted-foreground">registros mantidos</p>
                                    </div>
                                    <div className="p-2.5 rounded-lg bg-red-100 dark:bg-red-900/40 border border-red-200 dark:border-red-800 text-center">
                                        <p className="text-lg font-bold text-red-700 dark:text-red-300">{result.removed.toLocaleString('pt-BR')}</p>
                                        <p className="text-[11px] text-muted-foreground">registros removidos</p>
                                    </div>
                                </motion.div>
                            )}

                            {/* Ações */}
                            <div className="flex gap-2 pt-1">
                                {!result ? (
                                    <Button
                                        className="flex-1 bg-amber-600 hover:bg-amber-700 text-white gap-2"
                                        disabled={barcodeCol === '' || !referenceCode.trim()}
                                        onClick={handleProcess}
                                    >
                                        <Filter className="w-4 h-4" />
                                        Filtrar planilha
                                    </Button>
                                ) : (
                                    <>
                                        <Button
                                            variant="outline"
                                            className="flex-1"
                                            onClick={() => {
                                                setResult(null);
                                                setProcessedRows(null);
                                            }}
                                        >
                                            Ajustar
                                        </Button>
                                        <Button
                                            className="flex-1 bg-amber-600 hover:bg-amber-700 text-white gap-2"
                                            onClick={handleDownload}
                                        >
                                            <Download className="w-4 h-4" />
                                            Baixar planilha filtrada
                                        </Button>
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                </Card>
            </motion.div>
        </div>
    );
}
