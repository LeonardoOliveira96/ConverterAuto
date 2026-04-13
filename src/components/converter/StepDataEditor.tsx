import { useCallback, useMemo, useState } from 'react';
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
import { motion } from 'framer-motion';
import {
  Plus,
  Trash2,
  Edit2,
  RotateCcw,
} from 'lucide-react';
import type { SpreadsheetRow } from '@/lib/converter-types';

interface StepDataEditorProps {
  headers: string[];
  rows: SpreadsheetRow[];
  onRowsChange: (rows: SpreadsheetRow[]) => void;
  onHeadersChange?: (headers: string[]) => void;
}

export function StepDataEditor({ headers, rows, onRowsChange, onHeadersChange }: StepDataEditorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null);
  const [cellValue, setCellValue] = useState('');
  const [localRows, setLocalRows] = useState<SpreadsheetRow[]>(rows);
  const [localHeaders, setLocalHeaders] = useState<string[]>(headers);
  const [hasChanges, setHasChanges] = useState(false);

  const handleCellClick = (rowIdx: number, colIdx: number) => {
    if (rowIdx === -1) {
      // Header edit
      setEditingCell({ row: -1, col: colIdx });
      setCellValue(String(localHeaders[colIdx] ?? ''));
    } else {
      const value = localRows[rowIdx]?.[colIdx];
      setEditingCell({ row: rowIdx, col: colIdx });
      setCellValue(String(value ?? ''));
    }
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
              Clique em qualquer célula para editar. Você pode adicionar ou remover linhas conforme necessário.
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
              className="p-6"
            >
              <div className="border rounded-lg overflow-auto bg-card">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-primary/10 border-b sticky top-0 font-semibold">
                      <th className="w-12 px-3 py-2 text-left text-xs font-semibold text-muted-foreground border-r">#</th>
                      {localHeaders.map((header, colIdx) => (
                        <th
                          key={`header-${colIdx}`}
                          className="px-3 py-2 border-r cursor-pointer hover:bg-primary/20 transition-colors min-w-[150px]"
                          onClick={() => handleCellClick(-1, colIdx)}
                        >
                          <div className="text-xs truncate max-w-xs break-words whitespace-normal">
                            {editingCell?.row === -1 && editingCell?.col === colIdx ? (
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
                            ) : (
                              <span className="text-foreground font-semibold">{header}</span>
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
