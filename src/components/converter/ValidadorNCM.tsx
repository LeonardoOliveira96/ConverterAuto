import { useCallback, useRef, useState } from 'react';
import { Upload, FileSpreadsheet, ClipboardCheck, Download, ArrowLeft, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { motion } from 'framer-motion';
import * as XLSX from 'xlsx';
import { SpreadsheetRow } from '@/lib/converter-types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface ValidadorNCMProps {
    onBack: () => void;
}

export function ValidadorNCM({ onBack }: ValidadorNCMProps) {
    const [rows, setRows] = useState<SpreadsheetRow[] | null>(null);
    const [headers, setHeaders] = useState<string[]>([]);
    const [fileName, setFileName] = useState('');
    const [ncmCol, setNcmCol] = useState('');
    const [result, setResult] = useState<{ valid: number; cleared: number } | null>(null);
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
            setNcmCol('');
            setResult(null);
            setProcessedRows(null);
        };
        reader.readAsArrayBuffer(file);
    }, []);

    const handleProcess = useCallback(() => {
        if (!rows || ncmCol === '') return;

        const colIdx = parseInt(ncmCol);
        let valid = 0, cleared = 0;

        const processed = rows.map((row): SpreadsheetRow => {
            const newRow = [...row] as SpreadsheetRow;
            const val = String(newRow[colIdx] ?? '').trim();

            // Célula vazia — não mexe
            if (!val) return newRow;

            // Válido: exatamente 8 dígitos numéricos
            if (/^\d{8}$/.test(val)) {
                valid++;
                return newRow;
            }

            // Inválido — limpa só a célula NCM
            newRow[colIdx] = '';
            cleared++;
            return newRow;
        });

        setProcessedRows(processed);
        setResult({ valid, cleared });
    }, [rows, ncmCol]);

    const handleDownload = useCallback(() => {
        if (!processedRows || !headers) return;

        const colIdx = parseInt(ncmCol);
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

        // Formata coluna NCM como texto para preservar zeros à esquerda
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
        XLSX.writeFile(wb, `${baseName}_ncm_validado.xlsx`);
    }, [processedRows, headers, fileName, ncmCol]);

    const resetFile = useCallback(() => {
        setRows(null);
        setHeaders([]);
        setFileName('');
        setNcmCol('');
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
                <div className="w-8 h-8 rounded-lg bg-sky-100 dark:bg-sky-900/50 flex items-center justify-center">
                    <ClipboardCheck className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                </div>
                <div>
                    <h2 className="font-heading font-semibold text-base text-foreground leading-tight">
                        Validador de NCM
                    </h2>
                    <p className="text-xs text-muted-foreground">
                        Limpa NCMs inválidos (diferente de 8 dígitos numéricos) sem remover linhas
                    </p>
                </div>
            </div>

            {/* Ferramenta */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                <Card className="p-6 border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/30">
                    {!rows ? (
                        <div
                            className="border-2 border-dashed border-sky-300 dark:border-sky-700 rounded-lg p-10 flex flex-col items-center gap-3 cursor-pointer hover:border-sky-500 dark:hover:border-sky-500 transition-colors"
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
                            <Upload className="w-8 h-8 text-sky-400" />
                            <p className="text-sm text-sky-700 dark:text-sky-300 font-medium">
                                Arraste ou clique para carregar a planilha
                            </p>
                            <p className="text-xs text-muted-foreground text-center">
                                Selecione a coluna NCM para validar os códigos
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {/* Info do arquivo */}
                            <div className="flex items-center gap-3 p-3 rounded-lg bg-sky-100/60 dark:bg-sky-900/30">
                                <FileSpreadsheet className="w-5 h-5 text-sky-600 dark:text-sky-400 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-foreground truncate">{fileName}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {rows.length.toLocaleString('pt-BR')} linhas • {headers.length} colunas
                                    </p>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-xs text-sky-600 hover:text-sky-800 dark:text-sky-400 shrink-0"
                                    onClick={resetFile}
                                >
                                    Trocar arquivo
                                </Button>
                            </div>

                            {/* Seleção de coluna */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-foreground">
                                    Coluna NCM
                                    <span className="block text-muted-foreground font-normal">
                                        Coluna que contém os códigos NCM a validar
                                    </span>
                                </label>
                                <Select value={ncmCol} onValueChange={setNcmCol}>
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

                            {/* Caixa de regras */}
                            <div className="p-3 rounded-lg bg-white/60 dark:bg-white/5 border border-sky-200 dark:border-sky-800 text-xs space-y-1.5">
                                <p className="font-semibold text-sky-800 dark:text-sky-200 mb-1.5">Regras de validação:</p>
                                <ul className="space-y-1 text-muted-foreground list-disc list-inside">
                                    <li>NCM válido: <strong>exatamente 8 dígitos numéricos</strong></li>
                                    <li>NCM inválido (menos de 8, mais de 8, ou com letras/símbolos): célula é <strong>apagada</strong></li>
                                    <li>A linha inteira é preservada — apenas a célula NCM é limpa</li>
                                    <li>Células já vazias são mantidas sem alteração</li>
                                </ul>
                                <div className="mt-2 flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
                                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                    <p>NCMs inválidos são apagados, não corrigidos automaticamente.</p>
                                </div>
                            </div>

                            {/* Resultado */}
                            {result && (
                                <motion.div
                                    initial={{ opacity: 0, y: -6 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="grid grid-cols-2 gap-2"
                                >
                                    <div className="p-2.5 rounded-lg bg-sky-100 dark:bg-sky-900/40 border border-sky-200 dark:border-sky-800 text-center">
                                        <p className="text-lg font-bold text-sky-700 dark:text-sky-300">{result.valid.toLocaleString('pt-BR')}</p>
                                        <p className="text-[11px] text-muted-foreground">NCMs válidos (mantidos)</p>
                                    </div>
                                    <div className="p-2.5 rounded-lg bg-red-100 dark:bg-red-900/40 border border-red-200 dark:border-red-800 text-center">
                                        <p className="text-lg font-bold text-red-700 dark:text-red-300">{result.cleared.toLocaleString('pt-BR')}</p>
                                        <p className="text-[11px] text-muted-foreground">NCMs inválidos (limpos)</p>
                                    </div>
                                </motion.div>
                            )}

                            {/* Ações */}
                            <div className="flex gap-2 pt-1">
                                {!result ? (
                                    <Button
                                        className="flex-1 bg-sky-600 hover:bg-sky-700 text-white gap-2"
                                        disabled={ncmCol === ''}
                                        onClick={handleProcess}
                                    >
                                        <ClipboardCheck className="w-4 h-4" />
                                        Validar NCMs
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
                                            className="flex-1 bg-sky-600 hover:bg-sky-700 text-white gap-2"
                                            onClick={handleDownload}
                                        >
                                            <Download className="w-4 h-4" />
                                            Baixar planilha validada
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
