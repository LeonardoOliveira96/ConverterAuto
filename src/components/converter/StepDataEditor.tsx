import { useCallback, useMemo, useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { motion } from 'framer-motion';
import {
    Plus,
    Trash2,
    Edit2,
    RotateCcw,
} from 'lucide-react';
import type { SpreadsheetRow } from '@/lib/converter-types';
import type { SheetType } from '@/lib/erp-fields';
import { getFieldsForType, autoSuggestMapping } from '@/lib/erp-fields';

interface StepDataEditorProps {
    headers: string[];
    rows: SpreadsheetRow[];
    onRowsChange: (rows: SpreadsheetRow[]) => void;
    onHeadersChange?: (headers: string[]) => void;
    sheetType?: SheetType;
}

function toExcelCol(index: number): string {
    let col = '';
    let n = index + 1;
    while (n > 0) {
        const rem = (n - 1) % 26;
        col = String.fromCharCode(65 + rem) + col;
        n = Math.floor((n - 1) / 26);
    }
    return col;
}

export function StepDataEditor({ headers, rows, onRowsChange, onHeadersChange, sheetType }: StepDataEditorProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null);
    const [cellValue, setCellValue] = useState('');
    const [localRows, setLocalRows] = useState<SpreadsheetRow[]>(rows);
    const [localHeaders, setLocalHeaders] = useState<string[]>(headers);
    const [originalHeaders, setOriginalHeaders] = useState<string[]>(headers);
    const [hasChanges, setHasChanges] = useState(false);

    const systemFields = useMemo(() =>
        sheetType ? getFieldsForType(sheetType).map(f => f.name) : [],
        [sheetType]
    );

    // Sincronizar originalHeaders quando headers prop muda
    useEffect(() => {
        setOriginalHeaders(headers);
    }, [headers]);

    // Inicializar headers com sugestões automáticas quando sheetType muda
    useEffect(() => {
        if (sheetType && originalHeaders.length > 0) {
            const fields = getFieldsForType(sheetType);
            // autoSuggestMapping retorna: { "Campo Sistema": "Coluna Arquivo" }
            const suggestions = autoSuggestMapping(originalHeaders, fields);

            // Inverter: para cada coluna original, encontrar qual campo foi sugerido
            const suggestedHeaders = originalHeaders.map(header => {
                const suggestedField = Object.entries(suggestions).find(([_, col]) => col === header)?.[0];
                return suggestedField || header; // Se não tiver sugestão, mantém o original
            });
            setLocalHeaders(suggestedHeaders);
        }
    }, [sheetType, originalHeaders]);

    const handleCellClick = (rowIdx: number, colIdx: number) => {
        if (rowIdx === -1) {
            return;
        }
        const value = localRows[rowIdx]?.[colIdx];
        setEditingCell({ row: rowIdx, col: colIdx });
        setCellValue(String(value ?? ''));
    };

    const handleCellChange = (value: string) => {
        if (editingCell) {
            if (editingCell.row === -1) {
                // Editing header
                const newHeaders = localHeaders.map((h, idx) =>
                    idx === editingCell.col ? value : h
                );
                setLocalHeaders(newHeaders);
            } else {
                // Editing data row
                const newRows = localRows.map((row, rIdx) =>
                    rIdx === editingCell.row
                        ? row.map((cell, cIdx) => (cIdx === editingCell.col ? value : cell))
                        : row
                );
                setLocalRows(newRows);
            }
            setHasChanges(true);
        }
    };

    const handleSaveCell = () => {
        handleCellChange(cellValue);
        setEditingCell(null);
        setCellValue('');
    };

    const handleDeleteRow = (rowIdx: number) => {
        const newRows = localRows.filter((_, idx) => idx !== rowIdx);
        setLocalRows(newRows);
        setHasChanges(true);
    };

    const handleAddRow = () => {
        const newRow = new Array(headers.length).fill('');
        setLocalRows([...localRows, newRow]);
        setHasChanges(true);
    };

    const handleReset = () => {
        setLocalRows(rows);
        setHasChanges(false);
        setEditingCell(null);
    };

    const handleApply = () => {
        onRowsChange(localRows);
        if (onHeadersChange && localHeaders !== headers) {
            onHeadersChange(localHeaders);
        }
        setHasChanges(false);
        setIsOpen(false);
    };

    const handleHeaderChange = (colIdx: number, value: string) => {
        if (value === '__manual__') {
            const newValue = prompt('Digite o nome da coluna:', localHeaders[colIdx]);
            if (newValue !== null) {
                const newHeaders = localHeaders.map((h, idx) =>
                    idx === colIdx ? newValue : h
                );
                setLocalHeaders(newHeaders);
                setHasChanges(true);
            }
        } else if (value) {
            const newHeaders = localHeaders.map((h, idx) =>
                idx === colIdx ? value : h
            );
            setLocalHeaders(newHeaders);
            setHasChanges(true);
        }
    };

    const handleDeleteColumn = (colIdx: number) => {
        if (window.confirm(`Tem certeza que deseja deletar a coluna "${originalHeaders[colIdx]}"? Esta ação não pode ser desfeita.`)) {
            // Remover do header
            const newHeaders = localHeaders.filter((_, idx) => idx !== colIdx);
            setLocalHeaders(newHeaders);

            // Remover a coluna de todos os rows
            const newRows = localRows.map(row =>
                row.filter((_, idx) => idx !== colIdx)
            );
            setLocalRows(newRows);

            // Remover do originalHeaders também
            const newOriginalHeaders = originalHeaders.filter((_, idx) => idx !== colIdx);
            setOriginalHeaders(newOriginalHeaders);

            setHasChanges(true);
        }
    };

    const countEmptyRows = useMemo(() => {
        return localRows.filter(row => row.every(cell => cell === '' || cell === undefined || cell === null)).length;
    }, [localRows]);

    const getEmptyCellsInColumn = (colIdx: number): number => {
        return localRows.filter(row => row[colIdx] === '' || row[colIdx] === undefined || row[colIdx] === null).length;
    };

    const handleDeleteEmptyRows = () => {
        const emptyCount = countEmptyRows;
        if (emptyCount === 0) {
            alert('Não há linhas vazias para deletar.');
            return;
        }
        if (window.confirm(`Tem certeza que deseja deletar ${emptyCount} linha(s) vazia(s)? Esta ação não pode ser desfeita.`)) {
            const newRows = localRows.filter(row => row.some(cell => cell !== '' && cell !== undefined && cell !== null));
            setLocalRows(newRows);
            setHasChanges(true);
        }
    };

    const handleDeleteEmptyRowsByColumn = (colIdx: number) => {
        const emptyInColumn = getEmptyCellsInColumn(colIdx);
        if (emptyInColumn === 0) {
            alert('Não há células vazias nesta coluna.');
            return;
        }
        const columnName = localHeaders[colIdx] || originalHeaders[colIdx] || `Coluna ${toExcelCol(colIdx)}`;
        if (window.confirm(`Tem certeza que deseja deletar ${emptyInColumn} linha(s) vazia(s) na coluna "${columnName}"? Esta ação removerá essas linhas inteiras e não pode ser desfeita.`)) {
            const newRows = localRows.filter(row => row[colIdx] !== '' && row[colIdx] !== undefined && row[colIdx] !== null);
            setLocalRows(newRows);
            setHasChanges(true);
        }
    };

    const visibleRows = useMemo(() => localRows.slice(0, 100), [localRows]);

    return (
        <>
            <Button
                variant="outline"
                size="sm"
                onClick={() => setIsOpen(true)}
                className="gap-2"
            >
                <Edit2 className="w-4 h-4" />
                Editar Dados Personalizados
            </Button>

            <Dialog open={isOpen} onOpenChange={setIsOpen}>
                <DialogContent className="max-w-[min(96rem,calc(100vw-1.5rem))] w-full h-[min(92vh,900px)] flex flex-col p-0 gap-0 overflow-hidden sm:rounded-lg">
                    <DialogHeader className="px-6 pt-6 pb-3 border-b shrink-0 text-left space-y-1">
                        <DialogTitle className="flex items-center gap-2 font-heading">
                            <Edit2 className="w-5 h-5 text-primary" />
                            Editor de Dados Personalizado
                        </DialogTitle>
                        <DialogDescription>
                            {sheetType ? (
                                <span>
                                    Use os <span className="font-semibold text-foreground">selects nos headers</span> para trocar os nomes das colunas pelos campos do sistema.
                                    Use a <span className="font-semibold text-foreground">lixeira (🗑)</span> para remover linhas.
                                </span>
                            ) : (
                                <span>Clique em qualquer célula para editar. Use a <span className="font-semibold text-foreground">lixeira (🗑)</span> para remover linhas.</span>
                            )}
                            {localRows.length > 100 && (
                                <span className="block mt-1 font-semibold text-amber-600 dark:text-amber-400">
                                    ℹ Mostrando apenas as primeiras 100 linhas de {localRows.length} para melhor desempenho
                                </span>
                            )}
                        </DialogDescription>
                    </DialogHeader>

                    <ScrollArea className="flex-1 overflow-hidden">
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="p-6 space-y-4"
                        >
                            {/* Info e ação para linhas vazias */}
                            {countEmptyRows > 0 && (
                                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2">
                                        <Badge variant="destructive">{countEmptyRows}</Badge>
                                        <span className="text-sm font-medium text-amber-900 dark:text-amber-100">
                                            {countEmptyRows === 1 ? 'linha vazia encontrada' : 'linhas vazias encontradas'}
                                        </span>
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="destructive"
                                        onClick={handleDeleteEmptyRows}
                                        className="gap-1.5"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                        Deletar linhas vazias
                                    </Button>
                                </div>
                            )}

                            <div className="border rounded-lg overflow-auto bg-card">
                                <table className="w-full border-collapse text-sm">
                                    <thead>
                                        <tr className="bg-primary/10 border-b sticky top-0 font-semibold">
                                            <th className="w-12 px-3 py-2 text-left text-xs font-semibold text-muted-foreground border-r">#</th>
                                            {localHeaders.map((header, colIdx) => (
                                                <th
                                                    key={`header-${colIdx}`}
                                                    className="px-3 py-2 border-r min-w-[220px]"
                                                >
                                                    <div className="flex flex-col items-start gap-2.5">
                                                        <div className="flex items-center justify-between w-full">
                                                            <div className="text-[10px] font-mono font-bold text-muted-foreground px-1.5 py-0.5 bg-secondary/40 rounded">
                                                                {toExcelCol(colIdx)}
                                                            </div>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleDeleteColumn(colIdx)}
                                                                className="p-1.5 hover:bg-destructive/20 rounded transition-colors"
                                                                title="Deletar coluna inteira"
                                                            >
                                                                <Trash2 className="w-4 h-4 text-destructive" />
                                                            </button>
                                                        </div>
                                                        {/* Nome original da coluna da planilha */}
                                                        <div className="w-full">
                                                            <div className="text-[10px] text-muted-foreground/60 font-semibold uppercase tracking-wide">
                                                                ORIGINAL
                                                            </div>
                                                            <div className="text-sm font-semibold text-foreground break-words mt-0.5">
                                                                {originalHeaders[colIdx]}
                                                            </div>
                                                        </div>
                                                        {/* Contador de células vazias */}
                                                        {getEmptyCellsInColumn(colIdx) > 0 && (
                                                            <div className="flex items-center gap-2 w-full">
                                                                <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                                                                    {getEmptyCellsInColumn(colIdx)} vazi{getEmptyCellsInColumn(colIdx) === 1 ? 'a' : 'as'}
                                                                </span>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleDeleteEmptyRowsByColumn(colIdx)}
                                                                    className="p-1 hover:bg-destructive/20 rounded transition-colors flex-shrink-0"
                                                                    title={`Deletar linhas vazias nesta coluna`}
                                                                >
                                                                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                                                                </button>
                                                            </div>
                                                        )}
                                                        {sheetType ? (
                                                            <Select value={header} onValueChange={(value) => handleHeaderChange(colIdx, value)}>
                                                                <SelectTrigger className="h-8 text-xs w-full">
                                                                    <SelectValue placeholder="Selecione um campo..." />
                                                                </SelectTrigger>
                                                                <SelectContent className="max-h-[300px]">
                                                                    <SelectItem value="__manual__" className="text-amber-600 dark:text-amber-400 font-medium">
                                                                        ✏️ Digitar manualmente...
                                                                    </SelectItem>
                                                                    {systemFields.map((field) => (
                                                                        <SelectItem key={field} value={field}>
                                                                            {field}
                                                                        </SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        ) : (
                                                            <span className="text-xs font-semibold text-foreground">{header}</span>
                                                        )}
                                                    </div>
                                                </th>
                                            ))}
                                            <th className="w-12 px-3 py-2 text-center text-xs font-semibold text-muted-foreground">Ação</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {visibleRows.map((row, rowIdx) => (
                                            <tr key={rowIdx} className="border-b hover:bg-muted/50 transition-colors">
                                                <td className="w-12 px-3 py-2 text-xs font-mono text-muted-foreground border-r bg-secondary/30">
                                                    {rowIdx + 1}
                                                </td>
                                                {row.map((cell, colIdx) => (
                                                    <td
                                                        key={`${rowIdx}-${colIdx}`}
                                                        className="px-3 py-2 border-r cursor-pointer hover:bg-primary/5 transition-colors"
                                                        onClick={() => handleCellClick(rowIdx, colIdx)}
                                                    >
                                                        <div className="text-xs truncate max-w-xs break-words whitespace-normal">
                                                            {editingCell?.row === rowIdx && editingCell?.col === colIdx ? (
                                                                <div className="flex gap-1">
                                                                    <Input
                                                                        autoFocus
                                                                        value={cellValue}
                                                                        onChange={(e) => setCellValue(e.target.value)}
                                                                        onKeyDown={(e) => {
                                                                            if (e.key === 'Enter') handleSaveCell();
                                                                            if (e.key === 'Escape') setEditingCell(null);
                                                                        }}
                                                                        onBlur={handleSaveCell}
                                                                        className="h-7 text-xs px-2"
                                                                    />
                                                                </div>
                                                            ) : (
                                                                <span className="text-foreground">{String(cell ?? '')}</span>
                                                            )}
                                                        </div>
                                                    </td>
                                                ))}
                                                <td className="w-12 px-3 py-2 text-center">
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant="ghost"
                                                        className="h-6 w-6 p-0"
                                                        onClick={() => handleDeleteRow(rowIdx)}
                                                    >
                                                        <Trash2 className="w-3 h-3 text-destructive" />
                                                    </Button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {localRows.length === 0 && (
                                <div className="py-12 text-center text-muted-foreground">
                                    Nenhuma linha de dados. Clique em &quot;Adicionar Linha&quot; para começar.
                                </div>
                            )}
                        </motion.div>
                    </ScrollArea>

                    <div className="px-6 py-4 border-t shrink-0 flex justify-between items-center gap-2 bg-card/80 flex-wrap">
                        <div className="flex items-center gap-2">
                            <Badge variant="secondary">
                                {localRows.length} linha(s)
                            </Badge>
                            {hasChanges && (
                                <Badge variant="destructive" className="animate-pulse">
                                    Alterações não salvas
                                </Badge>
                            )}
                        </div>
                        <div className="flex gap-2 flex-wrap">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={handleAddRow}
                                className="gap-2"
                            >
                                <Plus className="w-4 h-4" />
                                Adicionar Linha
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={handleReset}
                                disabled={!hasChanges}
                                className="gap-2"
                            >
                                <RotateCcw className="w-4 h-4" />
                                Descartar
                            </Button>
                            <Button
                                type="button"
                                onClick={handleApply}
                                disabled={!hasChanges}
                                className="gap-2"
                            >
                                Salvar Alterações
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setIsOpen(false)}
                            >
                                Fechar
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
