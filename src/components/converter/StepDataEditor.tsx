import { useCallback, useMemo, useState, useEffect, useRef } from 'react';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { motion } from 'framer-motion';
import {
    Plus,
    Trash2,
    Edit2,
    RotateCcw,
    Sparkles,
    ScanLine,
    Check,
    CheckCircle2,
    X,
    Link2,
    FileSpreadsheet,
    Upload,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import type { SpreadsheetRow } from '@/lib/converter-types';
import type { SheetType } from '@/lib/erp-fields';
import { getFieldsForType, autoSuggestMapping } from '@/lib/erp-fields';
import { applySpecialCharsClean, categorizeSpecialCharsInString, isCodeRelatedField } from '@/lib/preview-alterations';

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
    const [isCleanerOpen, setIsCleanerOpen] = useState(false);
    const [cleanerSelectedCols, setCleanerSelectedCols] = useState<Set<string>>(new Set());
    const [isNcmEditorOpen, setIsNcmEditorOpen] = useState(false);
    const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null);
    const [cellValue, setCellValue] = useState('');
    const [localRows, setLocalRows] = useState<SpreadsheetRow[]>(rows);
    const [localHeaders, setLocalHeaders] = useState<string[]>(headers);
    const [originalHeaders, setOriginalHeaders] = useState<string[]>(headers);
    const [hasChanges, setHasChanges] = useState(false);
    const [ncmColumnHeader, setNcmColumnHeader] = useState<string | null>(null);
    const [ncmEdits, setNcmEdits] = useState<Record<number, string>>({});
    const [isShortRowsOpen, setIsShortRowsOpen] = useState(false);
    const [shortRowsFilterCols, setShortRowsFilterCols] = useState<string[]>([]);
    const [shortRowsEdits, setShortRowsEdits] = useState<Record<string, string>>({});
    const [shortRowsToDelete, setShortRowsToDelete] = useState<Set<number>>(new Set());
    const [shortRowsPage, setShortRowsPage] = useState(0);
    const [showSummary, setShowSummary] = useState(false);
    const [changeSummary, setChangeSummary] = useState<{
        deletedColumns: string[];
        remainingColumns: string[];
        deletedRowsCount: number;
        originalRowsCount: number;
        renamedColumns: Array<{ from: string; to: string }>;
    } | null>(null);

    // Ref para o input de edição de célula
    const inputRef = useRef<HTMLInputElement>(null);

    // --- Cruzamento de planilhas ---
    const [isCrossRefOpen, setIsCrossRefOpen] = useState(false);
    const [crossRefHeaders, setCrossRefHeaders] = useState<string[]>([]);
    const [crossRefRows, setCrossRefRows] = useState<SpreadsheetRow[]>([]);
    const [crossRefFileName, setCrossRefFileName] = useState('');
    const [crossRefSourceCol, setCrossRefSourceCol] = useState('');
    const [crossRefLookupCol, setCrossRefLookupCol] = useState('');
    const [crossRefValueCol, setCrossRefValueCol] = useState('');
    const [crossRefNewColName, setCrossRefNewColName] = useState('');
    const crossRefInputRef = useRef<HTMLInputElement>(null);

    const systemFields = useMemo(() =>
        sheetType ? getFieldsForType(sheetType).map(f => f.name) : [],
        [sheetType]
    );

    // Sincronizar originalHeaders quando headers prop muda
    useEffect(() => {
        setOriginalHeaders(headers);
    }, [headers]);

    // Inicializar headers com sugestões automáticas APENAS na montagem inicial ou quando sheetType muda
    const hasInitializedRef = useRef(false);
    useEffect(() => {
        if (sheetType && originalHeaders.length > 0 && !hasInitializedRef.current) {
            hasInitializedRef.current = true;
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

    // Forçar foco no input quando editingCell mudar
    useEffect(() => {
        if (editingCell !== null && inputRef.current) {
            console.log(`🎯 [FORÇANDO FOCO] Input para célula Linha ${editingCell.row}, Coluna ${editingCell.col}`);
            // Usar setTimeout para garantir que o input esteja renderizado antes de dar foco
            requestAnimationFrame(() => {
                if (inputRef.current) {
                    inputRef.current.focus();
                    inputRef.current.select();
                    console.log(`✅ [FOCO APLICADO] Input agora tem foco!`);
                }
            });
        }
    }, [editingCell]);

    // Log quando o modal abre/fecha
    useEffect(() => {
        console.log(`${isOpen ? '📂 MODAL ABERTO' : '📁 Modal fechado'}`);
    }, [isOpen]);

    const handleCellClick = (rowIdx: number, colIdx: number) => {
        console.log(`🖱️ [CLIQUE NA CÉLULA] Linha ${rowIdx}, Coluna ${colIdx}`);
        if (rowIdx === -1) {
            console.log(`❌ rowIdx é -1, ignorando (provavelmente é header)`);
            return;
        }
        const value = localRows[rowIdx]?.[colIdx];
        console.log(`✏️ [ATIVANDO EDIÇÃO] Linha ${rowIdx}, Coluna ${colIdx}, Valor: "${value}"`);
        setEditingCell({ row: rowIdx, col: colIdx });
        setCellValue(String(value ?? ''));
    };

    const handleCellChange = (value: string) => {
        if (editingCell) {
            console.log(`📝 [MUDANÇA DE ESTADO] Linha ${editingCell.row}, Coluna ${editingCell.col}, Novo valor: "${value}"`);
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
        console.log(`💾 [SAÍDA DO INPUT] Salvando célula - Linha ${editingCell?.row}, Coluna ${editingCell?.col}, Valor: "${cellValue}"`);
        handleCellChange(cellValue);
        console.log(`🔄 [LIMPANDO ESTADO] Fechando input`);
        setEditingCell(null);
        setCellValue('');
    };

    const handleDeleteRow = (rowIdx: number) => {
        // Salvar qualquer célula em edição antes de deletar
        if (editingCell) {
            handleCellChange(cellValue);
        }

        const newRows = localRows.filter((_, idx) => idx !== rowIdx);
        setLocalRows(newRows);

        // Ajustar editingCell se necessário
        if (editingCell) {
            if (editingCell.row === rowIdx) {
                // Se estava editando a linha deletada, limpar
                setEditingCell(null);
                setCellValue('');
            } else if (editingCell.row > rowIdx) {
                // Se estava editando uma linha depois da deletada, apenas ajustar índice
                // PRESERVE cellValue - não limpar!
                setEditingCell({ row: editingCell.row - 1, col: editingCell.col });
            }
            // Se editingCell.row < rowIdx, não faz nada
        }
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
        // Calcular mudanças antes de aplicar
        const deletedColumns = headers.filter(h => !localHeaders.includes(h));
        const deletedRowsCount = rows.length - localRows.length;

        // Calcular colunas renomeadas
        const renamedColumns: Array<{ from: string; to: string }> = [];
        localHeaders.forEach((localHeader, idx) => {
            if (idx < headers.length) {
                const originalHeader = headers[idx];
                if (originalHeader !== localHeader && !deletedColumns.includes(originalHeader)) {
                    renamedColumns.push({ from: originalHeader, to: localHeader });
                }
            }
        });

        setChangeSummary({
            deletedColumns,
            remainingColumns: localHeaders,
            deletedRowsCount,
            originalRowsCount: rows.length,
            renamedColumns,
        });
        setShowSummary(true);

        onRowsChange(localRows);
        if (onHeadersChange && localHeaders !== headers) {
            onHeadersChange(localHeaders);
        }

        // Atualizar coluna NCM se for tipo produto
        if (sheetType === 'produto') {
            setNcmColumnHeader('Código NCM');
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
        console.log(`🗑️  [CLIQUE NO BOTÃO DELETAR] Tentando deletar coluna ${colIdx}: "${originalHeaders[colIdx]}"`);
        console.log(`📊 Estado atual - editingCell:`, editingCell, `cellValue:`, cellValue);
        if (window.confirm(`Tem certeza que deseja deletar a coluna "${originalHeaders[colIdx]}"? Esta ação não pode ser desfeita.`)) {
            console.log(`✅ [CONFIRMAÇÃO OK] Usuário confirmou deletar coluna ${colIdx}`);
            // Salvar célula em edição ANTES de modificar estrutura, se não for a coluna sendo deletada
            if (editingCell && editingCell.col !== colIdx) {
                console.log(`💾 Salvando célula em edição antes de deletar coluna`);
                handleCellChange(cellValue);
            }

            // Remover do header
            const newHeaders = localHeaders.filter((_, idx) => idx !== colIdx);
            setLocalHeaders(newHeaders);
            console.log(`✏️  Removido header, nova lista:`, newHeaders);

            // Remover a coluna de todos os rows
            const newRows = localRows.map(row =>
                row.filter((_, idx) => idx !== colIdx)
            );
            setLocalRows(newRows);
            console.log(`📊 Removido coluna de todos os rows`);

            // Remover do originalHeaders também
            const newOriginalHeaders = originalHeaders.filter((_, idx) => idx !== colIdx);
            setOriginalHeaders(newOriginalHeaders);

            // Remover coluna deletada do filtro de células curtas se estiver ativa
            const deletedColName = localHeaders[colIdx] || originalHeaders[colIdx];
            if (deletedColName) {
                setShortRowsFilterCols(prev => prev.filter(c => c !== deletedColName));
            }

            // Ajustar editingCell se necessário
            if (editingCell) {
                console.log(`🎯 Analisando editingCell:`, editingCell, `- Coluna deletada: ${colIdx}`);
                if (editingCell.col === colIdx) {
                    // Se estava editando a coluna deletada, limpar
                    console.log(`❌ Coluna sendo editada foi deletada, limpando editingCell`);
                    setEditingCell(null);
                    setCellValue('');
                } else if (editingCell.col > colIdx) {
                    // Se estava editando uma coluna depois da deletada, apenas ajustar índice
                    console.log(`↔️  Coluna sendo editada está após a deletada (${editingCell.col} > ${colIdx}), ajustando índice para ${editingCell.col - 1}`);
                    setEditingCell({ row: editingCell.row, col: editingCell.col - 1 });
                } else {
                    // Se editingCell.col < colIdx
                    console.log(`✅ Coluna sendo editada está ANTES da deletada (${editingCell.col} < ${colIdx}) - INPUT DEVE PERMANECER SELECIONADO!`);
                }
            } else {
                console.log(`ℹ️  Nenhum input selecionado no momento`);
            }
            setHasChanges(true);
            console.log(`🏁 Deleção de coluna concluída\n`);
        }
    };

    const countEmptyRows = useMemo(() => {
        return localRows.filter(row => row.every(cell => cell === '' || cell === undefined || cell === null)).length;
    }, [localRows]);

    const getEmptyCellsInColumn = (colIdx: number): number => {
        return localRows.filter(row => row[colIdx] === '' || row[colIdx] === undefined || row[colIdx] === null).length;
    };

    const handleDeleteEmptyRows = () => {
        // Salvar qualquer célula em edição antes de deletar
        if (editingCell) {
            handleCellChange(cellValue);
        }

        const emptyCount = countEmptyRows;
        if (emptyCount === 0) {
            alert('Não há linhas vazias para deletar.');
            return;
        }
        if (window.confirm(`Tem certeza que deseja deletar ${emptyCount} linha(s) vazia(s)? Esta ação não pode ser desfeita.`)) {
            const newRows = localRows.filter(row => row.some(cell => cell !== '' && cell !== undefined && cell !== null));

            // Rastrear qual é o novo índice da linha em edição
            if (editingCell) {
                const oldIdx = editingCell.row;
                let newIdx = 0;
                let countNonEmpty = 0;
                for (let i = 0; i < localRows.length; i++) {
                    const isRowEmpty = !localRows[i].some(cell => cell !== '' && cell !== undefined && cell !== null);
                    if (i <= oldIdx && !isRowEmpty) {
                        countNonEmpty++;
                    }
                }
                // Verificar se a linha em edição foi deletada
                const isEditingRowEmpty = !localRows[oldIdx].some(cell => cell !== '' && cell !== undefined && cell !== null);
                if (isEditingRowEmpty) {
                    setEditingCell(null);
                    setCellValue('');
                } else {
                    // Calcular novo índice
                    newIdx = countNonEmpty - 1;
                    if (newIdx >= 0 && newIdx < newRows.length) {
                        setEditingCell({ row: newIdx, col: editingCell.col });
                        // Preservar cellValue
                    }
                }
            }

            setLocalRows(newRows);
            setHasChanges(true);
        }
    };

    const handleDeleteEmptyRowsByColumn = (colIdx: number) => {
        // Salvar qualquer célula em edição antes de deletar
        if (editingCell) {
            handleCellChange(cellValue);
        }

        const emptyInColumn = getEmptyCellsInColumn(colIdx);
        if (emptyInColumn === 0) {
            alert('Não há células vazias nesta coluna.');
            return;
        }
        const columnName = localHeaders[colIdx] || originalHeaders[colIdx] || `Coluna ${toExcelCol(colIdx)}`;
        if (window.confirm(`Tem certeza que deseja deletar ${emptyInColumn} linha(s) vazia(s) na coluna "${columnName}"? Esta ação removerá essas linhas inteiras e não pode ser desfeita.`)) {
            const rowsToKeep = localRows.map((row, idx) => ({ row, idx }));
            const filteredRowsToKeep = rowsToKeep.filter(({ row }) => row[colIdx] !== '' && row[colIdx] !== undefined && row[colIdx] !== null);
            const newRows = filteredRowsToKeep.map(({ row }) => row);

            // Rastrear qual é o novo índice da linha em edição
            if (editingCell) {
                const oldIdx = editingCell.row;
                const keptRowData = filteredRowsToKeep.find(({ idx }) => idx === oldIdx);

                if (keptRowData) {
                    // A linha em edição foi mantida, encontrar seu novo índice
                    const newIdx = filteredRowsToKeep.indexOf(keptRowData);
                    setEditingCell({ row: newIdx, col: editingCell.col });
                    // Preservar cellValue
                } else {
                    // A linha em edição foi deletada, limpar
                    setEditingCell(null);
                    setCellValue('');
                }
            }

            setLocalRows(newRows);
            setHasChanges(true);
        }
    };

    const visibleRows = useMemo(() => localRows.slice(0, 100), [localRows]);

    // Contar caracteres especiais na planilha inteira
    const invalidCharsInfo = useMemo(() => {
        let totalInvalid = 0;
        const charTypes: Record<string, number> = {};
        const columnsWithIssues: Set<string> = new Set();
        const columnCounts: Record<string, number> = {};

        for (let colIdx = 0; colIdx < localHeaders.length; colIdx++) {
            const colName = localHeaders[colIdx];
            let colCount = 0;

            for (const row of localRows) {
                const val = String(row[colIdx] ?? '');
                const allowed = /[\w\s.,;:\-()@]/;
                for (const c of val) {
                    if (!allowed.test(c)) {
                        totalInvalid++;
                        colCount++;
                        const categories = categorizeSpecialCharsInString(val);
                        const cat = categories.find(x => x.char === c);
                        const label = cat?.label ?? 'símbolo';
                        charTypes[label] = (charTypes[label] ?? 0) + 1;
                    }
                }
            }

            if (colCount > 0) {
                columnsWithIssues.add(colName);
                columnCounts[colName] = colCount;
            }
        }

        return { totalInvalid, charTypes, columnsWithIssues: Array.from(columnsWithIssues), columnCounts };
    }, [localRows, localHeaders]);

    // Calcular linhas com células de menos de 3 caracteres (excluindo vazias)
    const shortCellsInfo = useMemo(() => {
        const shortRows: Array<{ rowIdx: number; colIdx: number; colName: string; value: string }> = [];
        for (let rowIdx = 0; rowIdx < localRows.length; rowIdx++) {
            for (let colIdx = 0; colIdx < localHeaders.length; colIdx++) {
                const val = String(localRows[rowIdx][colIdx] ?? '').trim();
                const isNumeric = !isNaN(Number(val)) && val !== '';
                if (val.length > 0 && val.length < 5 && (isNumeric ? val.length >= 3 : true)) {
                    shortRows.push({
                        rowIdx,
                        colIdx,
                        colName: localHeaders[colIdx] || originalHeaders[colIdx] || toExcelCol(colIdx),
                        value: val,
                    });
                }
            }
        }
        return shortRows;
    }, [localRows, localHeaders, originalHeaders]);

    // Colunas únicas com células curtas
    const shortCellsColumns = useMemo(() => {
        const cols = new Set<string>();
        shortCellsInfo.forEach(item => cols.add(item.colName));
        return Array.from(cols);
    }, [shortCellsInfo]);

    // Filtrar por colunas selecionadas
    const shortCellsFiltered = useMemo(() => {
        if (shortRowsFilterCols.length === 0) return shortCellsInfo;
        return shortCellsInfo.filter(item => shortRowsFilterCols.includes(item.colName));
    }, [shortCellsInfo, shortRowsFilterCols]);

    const SHORT_ROWS_PAGE_SIZE = 100;
    const shortCellsPageItems = useMemo(() =>
        shortCellsFiltered.slice(shortRowsPage * SHORT_ROWS_PAGE_SIZE, (shortRowsPage + 1) * SHORT_ROWS_PAGE_SIZE),
        [shortCellsFiltered, shortRowsPage]
    );
    const shortRowsTotalPages = Math.max(1, Math.ceil(shortCellsFiltered.length / SHORT_ROWS_PAGE_SIZE));

    const handleApplyShortRowsEdits = () => {
        const newRows = localRows.map((row, rowIdx) => {
            if (shortRowsToDelete.has(rowIdx)) return null;
            return row.map((cell, colIdx) => {
                const key = `${rowIdx}-${colIdx}`;
                return shortRowsEdits[key] !== undefined ? shortRowsEdits[key] : cell;
            });
        }).filter(Boolean) as typeof localRows;

        setLocalRows(newRows);
        setShortRowsEdits({});
        setShortRowsToDelete(new Set());
        setHasChanges(true);
        setIsShortRowsOpen(false);
    };

    // Remover caracteres especiais, acentos e vírgulas das colunas selecionadas (ou todas se nenhuma selecionada)
    const handleRemoveSpecialChars = () => {
        const colsToClean = cleanerSelectedCols.size > 0
            ? cleanerSelectedCols
            : new Set(localHeaders);

        const newRows = localRows.map(row =>
            row.map((cell, colIdx) => {
                if (!colsToClean.has(localHeaders[colIdx])) return cell;
                let val = String(cell ?? '');
                val = applySpecialCharsClean(val);
                val = val.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                val = val.replace(/,/g, '');
                val = val.replace(/\s{2,}/g, ' ').trim();
                return val;
            })
        );
        setLocalRows(newRows);
        setHasChanges(true);
        setCleanerSelectedCols(new Set());
        setIsCleanerOpen(false);
    };

    // Verificar NCM inválido (apenas para tipo produto e se coluna foi mapeada)
    const ncmInfo = useMemo(() => {
        if (sheetType !== 'produto' || !ncmColumnHeader) return { totalInvalid: 0, invalidLines: [] };

        let totalInvalid = 0;
        const invalidLines: Array<{ rowIdx: number; row: number; value: string; issue: string }> = [];

        const ncmColIdx = localHeaders.indexOf(ncmColumnHeader);

        if (ncmColIdx === -1) return { totalInvalid: 0, invalidLines: [] };

        for (let rowIdx = 0; rowIdx < localRows.length; rowIdx++) {
            const val = String(localRows[rowIdx][ncmColIdx] ?? '').trim();

            if (val === '') continue;

            const onlyDigits = val.replace(/\D/g, '');
            let issue = '';

            if (onlyDigits.length !== 8) {
                issue = `deve ter 8 dígitos (tem ${onlyDigits.length})`;
                totalInvalid++;
                invalidLines.push({ rowIdx, row: rowIdx + 1, value: val, issue });
            } else if (!/^\d{8}$/.test(onlyDigits)) {
                issue = 'contém caracteres não numéricos';
                totalInvalid++;
                invalidLines.push({ rowIdx, row: rowIdx + 1, value: val, issue });
            }
        }

        return { totalInvalid, invalidLines };
    }, [localRows, localHeaders, sheetType, ncmColumnHeader]);

    // Aplicar edições de NCM aos dados
    const handleApplyNcmEdits = () => {
        const ncmColIdx = localHeaders.indexOf(ncmColumnHeader || 'Código NCM');
        if (ncmColIdx === -1) return;

        const newRows = localRows.map((row, rowIdx) => {
            if (ncmEdits[rowIdx]) {
                const newRow = [...row];
                newRow[ncmColIdx] = ncmEdits[rowIdx];
                return newRow;
            }
            return row;
        });

        setLocalRows(newRows);
        setNcmEdits({});
        setIsNcmEditorOpen(false);
        setHasChanges(true);
    };

    // Preencher NCMs com menos de 8 dígitos usando zeros à esquerda
    const handleFillWithZero = () => {
        const newEdits = { ...ncmEdits };
        ncmInfo.invalidLines.forEach((item) => {
            const val = String(item.value || '').trim();
            const onlyDigits = val.replace(/\D/g, '');
            if (onlyDigits.length < 8 && onlyDigits.length > 0) {
                newEdits[item.rowIdx] = onlyDigits.padStart(8, '0');
            }
        });
        setNcmEdits(newEdits);
    };

    // --- Cruzamento de planilhas ---

    // Normaliza texto para comparação: minúsculas, sem acento, sem espaços duplos, "4 kg"→"4kg"
    const normalizeForCrossRef = (txt: string): string => {
        let r = txt.trim().toLowerCase();
        r = r.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        r = r.replace(/(\d+[.,]?\d*)\s+(lts|lt|pct|pkg|cx|un|kg|mg|ml|gr|g|l)\b/g, '$1$2');
        r = r.replace(/\s{2,}/g, ' ').trim();
        return r;
    };

    const handleCrossRefFileLoad = (file: File) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const data = new Uint8Array(e.target?.result as ArrayBuffer);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const json = XLSX.utils.sheet_to_json<SpreadsheetRow>(sheet, { header: 1 });
            const maxCols = Math.max(...json.map(r => Array.isArray(r) ? r.length : 0), 0);
            const normalized = json.map(row => {
                if (!Array.isArray(row)) return row;
                const r: SpreadsheetRow = new Array(maxCols);
                for (let i = 0; i < maxCols; i++) {
                    r[i] = (i < row.length && row[i] !== undefined && row[i] !== null) ? row[i] : '';
                }
                return r;
            });
            const secHeaders = (normalized[0] || []).map(String);
            const secRows = normalized.slice(1) as SpreadsheetRow[];
            setCrossRefFileName(file.name);
            setCrossRefHeaders(secHeaders);
            setCrossRefRows(secRows);
            setCrossRefSourceCol('');
            setCrossRefLookupCol('');
            setCrossRefValueCol('');
            setCrossRefNewColName('');
        };
        reader.readAsArrayBuffer(file);
    };

    const crossRefIsReady =
        crossRefHeaders.length > 0 &&
        crossRefSourceCol !== '' &&
        crossRefLookupCol !== '' &&
        crossRefValueCol !== '';

    const handleApplyCrossRef = () => {
        const sourceColIdx = parseInt(crossRefSourceCol);
        const lookupColIdx = parseInt(crossRefLookupCol);
        const valueColIdx = parseInt(crossRefValueCol);
        if (sourceColIdx === -1 || lookupColIdx === -1 || valueColIdx === -1) return;

        const newColName = crossRefNewColName.trim() || crossRefHeaders[valueColIdx] || `Coluna ${toExcelCol(valueColIdx)}`;

        // Montar mapa normalizado; detectar duplicatas
        const map = new Map<string, string>();
        for (const row of crossRefRows) {
            const key = normalizeForCrossRef(String(row[lookupColIdx] ?? ''));
            if (!key) continue;
            const val = String(row[valueColIdx] ?? '');
            if (map.has(key)) {
                map.set(key, 'DUPLICADO');
            } else {
                map.set(key, val);
            }
        }

        // Adicionar nova coluna em cada linha
        const newRows = localRows.map(row => {
            const sourceVal = normalizeForCrossRef(String(row[sourceColIdx] ?? ''));
            const result = sourceVal ? (map.get(sourceVal) ?? '') : '';
            return [...row, result];
        });

        setLocalRows(newRows);
        setLocalHeaders([...localHeaders, newColName]);
        setOriginalHeaders([...originalHeaders, newColName]);
        setHasChanges(true);
        setIsCrossRefOpen(false);
    };

    return (
        <>
            <div className="space-y-6">
                {/* Informações da Planilha */}
                <Card className="bg-card p-6">
                    <div className="grid grid-cols-3 gap-6 mb-6">
                        <div className="text-center">
                            <p className="text-sm text-muted-foreground mb-1">Total de Linhas</p>
                            <p className="text-2xl font-bold text-foreground">{localRows.length.toLocaleString('pt-BR')}</p>
                        </div>
                        <div className="text-center">
                            <p className="text-sm text-muted-foreground mb-1">Total de Colunas</p>
                            <p className="text-2xl font-bold text-foreground">{localHeaders.length}</p>
                        </div>
                        <div className="text-center">
                            <p className="text-sm text-muted-foreground mb-1">Tipo</p>
                            <p className="text-base font-semibold text-foreground capitalize">{sheetType || 'N/A'}</p>
                        </div>
                    </div>

                    {/* Botão Centralizado */}
                    <div className="flex justify-center">
                        <Button
                            variant="default"
                            size="lg"
                            onClick={() => setIsOpen(true)}
                            className="gap-2"
                        >
                            <Edit2 className="w-4 h-4" />
                            Editar Dados Personalizados
                        </Button>
                    </div>
                </Card>

                {/* Resumo de Alterações - Abaixo do botão */}
                {showSummary && changeSummary && (
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.3 }}
                    >
                        <Card className="bg-card p-6 border-l-4 border-l-emerald-500">
                            <div className="flex items-start justify-between mb-4">
                                <div className="flex items-center gap-2">
                                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                                    <h3 className="font-semibold text-lg text-foreground">Resumo de Alterações</h3>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setShowSummary(false)}
                                    className="h-6 w-6 p-0"
                                >
                                    <X className="w-4 h-4" />
                                </Button>
                            </div>

                            <div className="space-y-3">
                                {/* Linhas Removidas */}
                                <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800">
                                    <div className="flex items-center gap-2 mb-1">
                                        <Trash2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                                        <p className="font-semibold text-blue-900 dark:text-blue-100 text-sm">Linhas Removidas</p>
                                    </div>
                                    <p className="text-sm text-blue-800 dark:text-blue-200">
                                        <span className="font-bold text-base">{changeSummary.deletedRowsCount}</span> linhas apagadas
                                        {changeSummary.deletedRowsCount > 0 && (
                                            <span className="block text-xs mt-0.5 text-blue-700 dark:text-blue-300">
                                                {changeSummary.originalRowsCount} → {changeSummary.originalRowsCount - changeSummary.deletedRowsCount}
                                            </span>
                                        )}
                                    </p>
                                </div>

                                {/* Colunas Deletadas */}
                                {changeSummary.deletedColumns.length > 0 && (
                                    <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800">
                                        <div className="flex items-center gap-2 mb-2">
                                            <X className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                                            <p className="font-semibold text-amber-900 dark:text-amber-100 text-sm">Colunas Deletadas</p>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            {changeSummary.deletedColumns.map((col) => (
                                                <Badge key={col} variant="destructive" className="text-xs">
                                                    {col}
                                                </Badge>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Colunas Renomeadas */}
                                {changeSummary.renamedColumns.length > 0 && (
                                    <div className="p-3 rounded-lg bg-purple-50 dark:bg-purple-950 border border-purple-200 dark:border-purple-800">
                                        <div className="flex items-center gap-2 mb-2">
                                            <Edit2 className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                                            <p className="font-semibold text-purple-900 dark:text-purple-100 text-sm">Colunas Renomeadas</p>
                                        </div>
                                        <div className="space-y-2">
                                            {changeSummary.renamedColumns.map((rename, idx) => (
                                                <div key={idx} className="flex items-center gap-2 text-sm">
                                                    <span className="bg-purple-100 dark:bg-purple-900 text-purple-900 dark:text-purple-100 px-2 py-0.5 rounded text-xs font-mono">
                                                        {rename.from}
                                                    </span>
                                                    <span className="text-purple-600 dark:text-purple-400">→</span>
                                                    <span className="bg-purple-100 dark:bg-purple-900 text-purple-900 dark:text-purple-100 px-2 py-0.5 rounded text-xs font-mono">
                                                        {rename.to}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Colunas Restantes */}
                                <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800">
                                    <div className="flex items-center gap-2 mb-2">
                                        <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                                        <p className="font-semibold text-emerald-900 dark:text-emerald-100 text-sm">
                                            Colunas Restantes ({changeSummary.remainingColumns.length})
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {changeSummary.remainingColumns.map((col) => (
                                            <Badge key={col} className="text-xs bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                                                {col}
                                            </Badge>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </Card>
                    </motion.div>
                )}

                {/* Card de Limpeza de Caracteres */}
                <Card className="p-6 border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30">
                    <div className="text-center mb-4">
                        <div className="mb-3">
                            <Sparkles className="w-8 h-8 text-amber-500 mx-auto mb-2" />
                            <p className="text-sm text-muted-foreground">Caracteres inválidos encontrados</p>
                            <p className="text-3xl font-bold text-amber-600 dark:text-amber-400">
                                {invalidCharsInfo.totalInvalid}
                            </p>
                        </div>
                        {Object.entries(invalidCharsInfo.charTypes).length > 0 && (
                            <div className="flex flex-wrap gap-2 justify-center mb-4">
                                {Object.entries(invalidCharsInfo.charTypes).map(([type, count]) => (
                                    <Badge key={type} variant="outline" className="text-xs">
                                        {type}: {count}
                                    </Badge>
                                ))}
                            </div>
                        )}
                        {invalidCharsInfo.columnsWithIssues.length > 0 && (
                            <div className="mb-4 text-left p-3 rounded bg-amber-100/50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                                <p className="text-xs font-semibold text-amber-900 dark:text-amber-200 mb-2">Colunas afetadas:</p>
                                <div className="flex flex-wrap gap-1">
                                    {invalidCharsInfo.columnsWithIssues.map((col) => (
                                        <Badge key={col} className="text-[10px] bg-amber-500/20 text-amber-700 dark:text-amber-300">
                                            {col}
                                        </Badge>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="flex justify-center gap-3 flex-wrap">
                        <Button
                            variant="default"
                            size="lg"
                            onClick={() => setIsCleanerOpen(true)}
                            className="gap-2 bg-amber-600 hover:bg-amber-700"
                            disabled={invalidCharsInfo.totalInvalid === 0}
                        >
                            <Sparkles className="w-4 h-4" />
                            Limpar Caracteres Especiais
                        </Button>
                        <Button
                            variant="outline"
                            size="lg"
                            onClick={() => setIsShortRowsOpen(true)}
                            className="gap-2 border-amber-400 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30"
                            disabled={shortCellsInfo.length === 0}
                        >
                            <ScanLine className="w-4 h-4" />
                            Células curtas
                        </Button>
                    </div>
                </Card>

                {/* Card de Validação de NCM (apenas para tipo produto após salvar coluna NCM) */}
                {sheetType === 'produto' && ncmColumnHeader && (
                    <Card className="p-6 border border-orange-200 dark:border-orange-900 bg-orange-50 dark:bg-orange-950/30">
                        <div className="text-center mb-4">
                            <div className="mb-3">
                                <ScanLine className="w-8 h-8 text-orange-500 mx-auto mb-2" />
                                <p className="text-sm text-muted-foreground">NCM com numeração inválida</p>
                                <p className="text-3xl font-bold text-orange-600 dark:text-orange-400">
                                    {ncmInfo.totalInvalid}
                                </p>
                            </div>
                            {ncmInfo.invalidLines.length > 0 && (
                                <div className="text-left p-3 rounded bg-orange-100/50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 max-h-40 overflow-y-auto">
                                    <p className="text-xs font-semibold text-orange-900 dark:text-orange-200 mb-2">Linhas inválidas encontradas:</p>
                                    <div className="space-y-1">
                                        {ncmInfo.invalidLines.slice(0, 5).map((item, idx) => (
                                            <div key={idx} className="text-xs text-orange-800 dark:text-orange-300">
                                                Linha {item.row}: <span className="font-mono">"{item.value}"</span> - {item.issue}
                                            </div>
                                        ))}
                                        {ncmInfo.invalidLines.length > 5 && (
                                            <div className="text-xs text-orange-700 dark:text-orange-400 font-semibold">
                                                +{ncmInfo.invalidLines.length - 5} linha(s) mais...
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                        {ncmInfo.totalInvalid > 0 && (
                            <div className="flex justify-center gap-2">
                                <Button
                                    variant="default"
                                    size="lg"
                                    onClick={() => setIsNcmEditorOpen(true)}
                                    className="gap-2 bg-orange-600 hover:bg-orange-700"
                                >
                                    <Edit2 className="w-4 h-4" />
                                    Editar NCMs
                                </Button>
                            </div>
                        )}
                    </Card>
                )}

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

                        <div className="flex-1 overflow-hidden flex flex-col">
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="flex-1 overflow-hidden flex flex-col"
                            >
                                <div className="flex-1 overflow-auto">
                                    <div className="border rounded-lg bg-card inline-block min-w-full">
                                        <table className="border-collapse text-sm min-w-max">
                                            <thead className="bg-slate-100 dark:bg-slate-800 border-b sticky top-0 z-20">
                                                <tr className="font-semibold">
                                                    <th className="w-12 px-3 py-2 text-left text-xs font-semibold text-muted-foreground border-r bg-slate-100 dark:bg-slate-800">#</th>
                                                    {localHeaders.map((header, colIdx) => (
                                                        <th
                                                            key={`header-${colIdx}`}
                                                            className="px-3 py-2 border-r min-w-[220px] bg-slate-100 dark:bg-slate-800"
                                                        >
                                                            <div className="flex flex-col items-start gap-2.5">
                                                                {/* Nome original da planilha */}
                                                                <div className="w-full px-2 py-1.5 rounded bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800">
                                                                    <p className="text-[10px] text-blue-600 dark:text-blue-400 font-semibold uppercase tracking-wide mb-0.5">Planilha</p>
                                                                    <p className="text-xs text-foreground font-medium break-words">{originalHeaders[colIdx]}</p>
                                                                </div>
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
                                                    <th className="w-12 px-3 py-2 text-center text-xs font-semibold text-muted-foreground bg-slate-100 dark:bg-slate-800">Ação</th>
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
                                                                onClick={(e) => {
                                                                    console.log(`🖱️ [EVENT TD] Clique em TD detectado - Linha ${rowIdx}, Coluna ${colIdx}`);
                                                                    handleCellClick(rowIdx, colIdx);
                                                                }}
                                                            >
                                                                <div className="text-xs truncate max-w-xs break-words whitespace-normal">
                                                                    {editingCell?.row === rowIdx && editingCell?.col === colIdx ? (
                                                                        <div className="flex gap-1">
                                                                            <Input
                                                                                ref={inputRef}
                                                                                autoFocus
                                                                                value={cellValue}
                                                                                onChange={(e) => {
                                                                                    console.log(`⌨️  [DIGITAÇÃO NO INPUT] Novo valor: "${e.target.value}"`);
                                                                                    setCellValue(e.target.value);
                                                                                }}
                                                                                onClick={(e) => {
                                                                                    console.log(`🖱️ [CLIQUE NO INPUT] Evitando propagação`);
                                                                                    e.stopPropagation();
                                                                                }}
                                                                                onKeyDown={(e) => {
                                                                                    if (e.key === 'Enter') handleSaveCell();
                                                                                    if (e.key === 'Escape') setEditingCell(null);
                                                                                }}
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
                                </div>

                                {localRows.length === 0 && (
                                    <div className="py-12 text-center text-muted-foreground">
                                        Nenhuma linha de dados. Clique em &quot;Adicionar Linha&quot; para começar.
                                    </div>
                                )}
                            </motion.div>
                        </div>

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
                                    onClick={() => setIsCrossRefOpen(true)}
                                    className="gap-2 border-blue-400 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950"
                                >
                                    <Link2 className="w-4 h-4" />
                                    Cruzar Planilha
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

                        {/* Dialog de Cruzamento de Planilhas — aninhado para não fechar o modal pai */}
                        <Dialog open={isCrossRefOpen} onOpenChange={(open) => {
                            if (!open) {
                                setCrossRefSourceCol('');
                                setCrossRefLookupCol('');
                                setCrossRefValueCol('');
                                setCrossRefNewColName('');
                            }
                            setIsCrossRefOpen(open);
                        }}>
                            <DialogContent className="max-w-xl">
                                <DialogHeader className="text-left">
                                    <DialogTitle className="text-lg flex items-center gap-2">
                                        <Link2 className="w-5 h-5 text-blue-500" />
                                        Cruzar com Segunda Planilha
                                    </DialogTitle>
                                    <DialogDescription>
                                        Carregue uma segunda planilha, escolha as colunas de comparação e o valor a inserir.
                                        A comparação ignora maiúsculas, acentos e espaços extras.
                                    </DialogDescription>
                                </DialogHeader>

                                <div className="space-y-4">
                                    {crossRefHeaders.length === 0 ? (
                                        <div
                                            className="border-2 border-dashed border-blue-300 dark:border-blue-700 rounded-lg p-8 text-center cursor-pointer hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
                                            onClick={() => crossRefInputRef.current?.click()}
                                            onDragOver={(e) => e.preventDefault()}
                                            onDrop={(e) => {
                                                e.preventDefault();
                                                const file = e.dataTransfer.files[0];
                                                if (file) handleCrossRefFileLoad(file);
                                            }}
                                        >
                                            <FileSpreadsheet className="w-10 h-10 text-blue-400 mx-auto mb-3" />
                                            <p className="text-sm font-semibold text-blue-700 dark:text-blue-300 mb-1">
                                                Arraste ou clique para carregar a planilha base
                                            </p>
                                            <p className="text-xs text-muted-foreground">.xlsx, .xls, .csv</p>
                                            <input
                                                ref={crossRefInputRef}
                                                type="file"
                                                accept=".xlsx,.xls,.csv"
                                                className="hidden"
                                                onChange={(e) => {
                                                    const file = e.target.files?.[0];
                                                    if (file) handleCrossRefFileLoad(file);
                                                    e.target.value = '';
                                                }}
                                            />
                                        </div>
                                    ) : (
                                        <>
                                            <div className="flex items-center justify-between p-3 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800">
                                                <div className="flex items-center gap-2">
                                                    <FileSpreadsheet className="w-4 h-4 text-blue-500 shrink-0" />
                                                    <div>
                                                        <p className="text-xs font-semibold text-blue-900 dark:text-blue-100">{crossRefFileName}</p>
                                                        <p className="text-[10px] text-blue-600 dark:text-blue-400">{crossRefHeaders.length} colunas · {crossRefRows.length} linhas</p>
                                                    </div>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setCrossRefHeaders([]);
                                                        setCrossRefRows([]);
                                                        setCrossRefFileName('');
                                                        setCrossRefSourceCol('');
                                                        setCrossRefLookupCol('');
                                                        setCrossRefValueCol('');
                                                        setCrossRefNewColName('');
                                                    }}
                                                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                                                >
                                                    <Upload className="w-3.5 h-3.5" />
                                                    Trocar arquivo
                                                </button>
                                            </div>

                                            <div className="space-y-3">
                                                <div className="space-y-1">
                                                    <label className="text-xs font-semibold text-foreground">
                                                        Coluna desta planilha <span className="text-muted-foreground">(para comparar)</span>
                                                    </label>
                                                    <Select value={crossRefSourceCol} onValueChange={setCrossRefSourceCol}>
                                                        <SelectTrigger className="h-9 text-sm">
                                                            <SelectValue placeholder="Selecione a coluna de comparação..." />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {localHeaders.map((h, i) => (
                                                                <SelectItem key={i} value={String(i)}>{h || `Coluna ${toExcelCol(i)}`}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>

                                                <div className="flex items-center gap-2">
                                                    <div className="flex-1 h-px bg-border" />
                                                    <span className="text-xs text-muted-foreground font-medium">2ª Planilha ({crossRefFileName})</span>
                                                    <div className="flex-1 h-px bg-border" />
                                                </div>

                                                <div className="space-y-1">
                                                    <label className="text-xs font-semibold text-foreground">
                                                        Coluna de comparação <span className="text-muted-foreground">(deve casar com a de cima)</span>
                                                    </label>
                                                    <Select value={crossRefLookupCol} onValueChange={setCrossRefLookupCol}>
                                                        <SelectTrigger className="h-9 text-sm">
                                                            <SelectValue placeholder="Selecione a coluna de lookup..." />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {crossRefHeaders.map((h, i) => (
                                                                <SelectItem key={i} value={String(i)}>{h || `Coluna ${toExcelCol(i)}`}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>

                                                <div className="space-y-1">
                                                    <label className="text-xs font-semibold text-foreground">
                                                        Coluna cujo valor será inserido <span className="text-muted-foreground">(ex: Código de barras)</span>
                                                    </label>
                                                    <Select value={crossRefValueCol} onValueChange={(v) => {
                                                        setCrossRefValueCol(v);
                                                        if (!crossRefNewColName) setCrossRefNewColName(crossRefHeaders[parseInt(v)] || `Coluna ${toExcelCol(parseInt(v))}`);
                                                    }}>
                                                        <SelectTrigger className="h-9 text-sm">
                                                            <SelectValue placeholder="Selecione a coluna de valor..." />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {crossRefHeaders.map((h, i) => (
                                                                <SelectItem key={i} value={String(i)}>{h || `Coluna ${toExcelCol(i)}`}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>

                                                <div className="space-y-1">
                                                    <label className="text-xs font-semibold text-foreground">Nome da nova coluna</label>
                                                    <Input
                                                        placeholder={crossRefValueCol !== '' ? (crossRefHeaders[parseInt(crossRefValueCol)] || `Coluna ${toExcelCol(parseInt(crossRefValueCol))}`) : 'Nome da coluna...'}
                                                        value={crossRefNewColName}
                                                        onChange={(e) => setCrossRefNewColName(e.target.value)}
                                                        className="h-9 text-sm"
                                                    />
                                                </div>

                                                <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
                                                    <p className="text-xs text-blue-800 dark:text-blue-200">
                                                        <span className="font-semibold">Resultado:</span> nova coluna adicionada ao final.
                                                        Sem correspondência = célula em branco.
                                                        Descrições duplicadas na base = <span className="font-mono font-semibold">DUPLICADO</span>.
                                                    </p>
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>

                                <div className="flex gap-2 pt-2">
                                    <Button variant="outline" onClick={() => setIsCrossRefOpen(false)} className="flex-1">
                                        Cancelar
                                    </Button>
                                    <Button
                                        onClick={handleApplyCrossRef}
                                        disabled={!crossRefIsReady}
                                        className="flex-1 bg-blue-600 hover:bg-blue-700"
                                    >
                                        <Link2 className="w-4 h-4 mr-1" />
                                        Aplicar Cruzamento
                                    </Button>
                                </div>
                            </DialogContent>
                        </Dialog>
                    </DialogContent>
                </Dialog>

                {/* Dialog de Limpeza de Caracteres Especiais */}
                <Dialog open={isCleanerOpen} onOpenChange={(open) => {
                    if (!open) setCleanerSelectedCols(new Set());
                    setIsCleanerOpen(open);
                }}>
                    <DialogContent className="max-w-lg">
                        <DialogHeader className="text-left">
                            <DialogTitle className="text-lg flex items-center gap-2">
                                <Sparkles className="w-5 h-5 text-amber-500" />
                                Limpar Caracteres Especiais
                            </DialogTitle>
                            <DialogDescription>
                                Selecione as colunas que deseja limpar. Sem seleção, todas as colunas serão limpas.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-4">
                            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800">
                                <p className="text-sm font-medium text-amber-900 dark:text-amber-100 mb-2">
                                    ⚠️ Esta ação vai:
                                </p>
                                <ul className="text-xs text-amber-800 dark:text-amber-200 space-y-1">
                                    <li>✓ Remover caracteres especiais (@ # $ % & etc)</li>
                                    <li>✓ Remover acentuação (é → e)</li>
                                    <li>✓ Remover vírgulas</li>
                                    <li>✓ Substituir C/ → COM e S/ → SEM</li>
                                    <li>✓ Normalizar espaços</li>
                                </ul>
                            </div>

                            {invalidCharsInfo.columnsWithIssues.length > 0 && (
                                <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800">
                                    <div className="flex items-center justify-between mb-2">
                                        <p className="text-xs font-semibold text-blue-900 dark:text-blue-200">
                                            📍 Selecionar colunas ({invalidCharsInfo.columnsWithIssues.length} com problemas):
                                        </p>
                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                className="text-[10px] text-blue-700 dark:text-blue-300 underline"
                                                onClick={() => setCleanerSelectedCols(new Set(invalidCharsInfo.columnsWithIssues))}
                                            >
                                                Todas
                                            </button>
                                            <button
                                                type="button"
                                                className="text-[10px] text-blue-700 dark:text-blue-300 underline"
                                                onClick={() => setCleanerSelectedCols(new Set())}
                                            >
                                                Nenhuma
                                            </button>
                                        </div>
                                    </div>
                                    <ScrollArea className="max-h-44">
                                        <div className="space-y-1">
                                            {invalidCharsInfo.columnsWithIssues.map((col) => {
                                                const checked = cleanerSelectedCols.has(col);
                                                return (
                                                    <label
                                                        key={col}
                                                        className="flex items-center justify-between gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900"
                                                    >
                                                        <div className="flex items-center gap-2">
                                                            <Checkbox
                                                                checked={checked}
                                                                onCheckedChange={(v) => {
                                                                    setCleanerSelectedCols(prev => {
                                                                        const next = new Set(prev);
                                                                        if (v) next.add(col); else next.delete(col);
                                                                        return next;
                                                                    });
                                                                }}
                                                            />
                                                            <span className="text-xs text-blue-900 dark:text-blue-100">{col}</span>
                                                        </div>
                                                        <Badge className="text-[10px] bg-amber-500/20 text-amber-700 dark:text-amber-300 shrink-0">
                                                            {invalidCharsInfo.columnCounts[col]} char{invalidCharsInfo.columnCounts[col] !== 1 ? 's' : ''}
                                                        </Badge>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </ScrollArea>
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-2">
                                {Object.entries(invalidCharsInfo.charTypes).map(([type, count]) => (
                                    <div key={type} className="p-2 rounded bg-secondary/50 text-center">
                                        <p className="text-xs text-muted-foreground">{type}</p>
                                        <p className="text-lg font-bold text-foreground">{count}</p>
                                    </div>
                                ))}
                            </div>

                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    onClick={() => { setCleanerSelectedCols(new Set()); setIsCleanerOpen(false); }}
                                    className="flex-1"
                                >
                                    Cancelar
                                </Button>
                                <Button
                                    variant="default"
                                    onClick={handleRemoveSpecialChars}
                                    className="flex-1 bg-amber-600 hover:bg-amber-700"
                                >
                                    <Sparkles className="w-4 h-4 mr-1" />
                                    {cleanerSelectedCols.size > 0
                                        ? `Limpar ${cleanerSelectedCols.size} coluna${cleanerSelectedCols.size !== 1 ? 's' : ''}`
                                        : 'Limpar Tudo'}
                                </Button>
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>

                {/* Dialog de Células Curtas */}
                <Dialog open={isShortRowsOpen} onOpenChange={(open) => {
                    if (open) {
                        setShortRowsFilterCols([]);
                        setShortRowsPage(0);
                    } else {
                        setShortRowsEdits({});
                        setShortRowsToDelete(new Set());
                    }
                    setIsShortRowsOpen(open);
                }}>
                    <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
                        <DialogHeader className="text-left">
                            <DialogTitle className="text-lg flex items-center gap-2">
                                <ScanLine className="w-5 h-5 text-amber-500" />
                                Células com menos de 3 caracteres
                            </DialogTitle>
                            <DialogDescription>
                                Filtre por coluna, renomeie o valor ou marque a linha para deletar.
                            </DialogDescription>
                        </DialogHeader>

                        {/* Filtro de colunas */}
                        {shortCellsColumns.length > 0 && (
                            <div className="flex flex-wrap gap-2 px-1 pb-2 border-b items-center">
                                <span className="text-xs font-semibold text-muted-foreground">Filtrar colunas:</span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShortRowsPage(0);
                                        setShortRowsFilterCols(
                                            shortRowsFilterCols.length === shortCellsColumns.length ? [] : [...shortCellsColumns]
                                        );
                                    }}
                                    className={`px-2 py-0.5 rounded text-xs font-medium border transition-colors ${shortRowsFilterCols.length === shortCellsColumns.length
                                        ? 'bg-amber-700 text-white border-amber-700'
                                        : 'bg-background border-border text-muted-foreground hover:border-amber-400'
                                        }`}
                                >
                                    {shortRowsFilterCols.length === shortCellsColumns.length ? 'Desmarcar todos' : 'Selecionar todos'}
                                </button>
                                <div className="w-px h-4 bg-border" />
                                {shortCellsColumns.map(col => {
                                    const rowsInCol = shortCellsInfo.filter(i => i.colName === col).map(i => i.rowIdx);
                                    const allDeleted = rowsInCol.length > 0 && rowsInCol.every(idx => shortRowsToDelete.has(idx));
                                    return (
                                        <div key={col} className="flex items-center rounded border overflow-hidden">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setShortRowsPage(0);
                                                    setShortRowsFilterCols(prev =>
                                                        prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]
                                                    );
                                                }}
                                                className={`px-2 py-0.5 text-xs font-medium transition-colors ${shortRowsFilterCols.includes(col)
                                                    ? 'bg-amber-500 text-white'
                                                    : 'bg-background text-muted-foreground hover:bg-amber-50 dark:hover:bg-amber-950'
                                                    }`}
                                            >
                                                {col}
                                            </button>
                                            <button
                                                type="button"
                                                title={allDeleted ? `Desmarcar deleção das ${rowsInCol.length} linhas de "${col}"` : `Marcar todas as ${rowsInCol.length} linhas de "${col}" para deleção`}
                                                onClick={() => {
                                                    setShortRowsToDelete(prev => {
                                                        const next = new Set(prev);
                                                        if (allDeleted) rowsInCol.forEach(idx => next.delete(idx));
                                                        else rowsInCol.forEach(idx => next.add(idx));
                                                        return next;
                                                    });
                                                }}
                                                className={`px-1.5 py-0.5 border-l transition-colors ${allDeleted
                                                    ? 'bg-destructive text-destructive-foreground hover:bg-destructive/80'
                                                    : 'bg-background text-destructive hover:bg-destructive/10'
                                                    }`}
                                            >
                                                <Trash2 className="w-3 h-3" />
                                            </button>
                                        </div>
                                    );
                                })}
                                {shortRowsFilterCols.length > 0 && shortRowsFilterCols.length < shortCellsColumns.length && (
                                    <button
                                        type="button"
                                        onClick={() => { setShortRowsFilterCols([]); setShortRowsPage(0); }}
                                        className="px-2 py-0.5 rounded text-xs font-medium text-destructive hover:underline"
                                    >
                                        Limpar filtro
                                    </button>
                                )}
                            </div>
                        )}

                        <div className="flex-1 overflow-y-auto">
                            {shortCellsFiltered.length === 0 ? (
                                <div className="py-12 text-center text-muted-foreground">
                                    Nenhuma célula curta encontrada.
                                </div>
                            ) : (
                                <div className="border rounded-lg">
                                    <table className="w-full">
                                        <thead className="bg-muted sticky top-0">
                                            <tr>
                                                <th className="text-left text-xs font-semibold px-3 py-2 w-16">Linha</th>
                                                <th className="text-left text-xs font-semibold px-3 py-2">Coluna</th>
                                                <th className="text-left text-xs font-semibold px-3 py-2">Valor atual</th>
                                                <th className="text-left text-xs font-semibold px-3 py-2">Novo valor</th>
                                                <th className="text-left text-xs font-semibold px-3 py-2 w-20">Deletar linha</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {shortCellsPageItems.map((item, idx) => {
                                                const key = `${item.rowIdx}-${item.colIdx}`;
                                                const isDeleted = shortRowsToDelete.has(item.rowIdx);
                                                return (
                                                    <tr
                                                        key={idx}
                                                        className={`border-t transition-colors ${isDeleted
                                                            ? 'bg-destructive/10 opacity-50'
                                                            : idx % 2 === 0 ? 'bg-background' : 'bg-muted/30'
                                                            }`}
                                                    >
                                                        <td className="px-3 py-2">
                                                            <Badge className="bg-amber-600 text-white text-xs">
                                                                {item.rowIdx + 1}
                                                            </Badge>
                                                        </td>
                                                        <td className="px-3 py-2 text-sm text-muted-foreground">
                                                            {item.colName}
                                                        </td>
                                                        <td className="px-3 py-2 text-sm font-mono font-semibold text-foreground">
                                                            "{item.value}"
                                                            <Badge variant="outline" className="ml-2 text-[10px] text-amber-600 border-amber-400">
                                                                {item.value.length}
                                                            </Badge>
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            <Input
                                                                placeholder="Novo valor..."
                                                                value={shortRowsEdits[key] ?? ''}
                                                                disabled={isDeleted}
                                                                onChange={(e) => {
                                                                    const val = e.target.value;
                                                                    setShortRowsEdits(prev => {
                                                                        if (val === '') {
                                                                            const next = { ...prev };
                                                                            delete next[key];
                                                                            return next;
                                                                        }
                                                                        return { ...prev, [key]: val };
                                                                    });
                                                                }}
                                                                className="h-7 text-xs"
                                                            />
                                                        </td>
                                                        <td className="px-3 py-2 text-center">
                                                            <button
                                                                type="button"
                                                                onClick={() => setShortRowsToDelete(prev => {
                                                                    const next = new Set(prev);
                                                                    if (next.has(item.rowIdx)) next.delete(item.rowIdx);
                                                                    else next.add(item.rowIdx);
                                                                    return next;
                                                                })}
                                                                className={`p-1.5 rounded transition-colors ${isDeleted
                                                                    ? 'bg-destructive/20 text-destructive'
                                                                    : 'hover:bg-destructive/10 text-muted-foreground hover:text-destructive'
                                                                    }`}
                                                                title={isDeleted ? 'Cancelar deleção' : 'Marcar para deletar linha'}
                                                            >
                                                                <Trash2 className="w-4 h-4" />
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>

                        <div className="flex items-center justify-between mt-4 pt-4 border-t gap-2 flex-wrap">
                            <div className="flex gap-2 flex-wrap">
                                {shortRowsToDelete.size > 0 && (
                                    <Badge variant="destructive">{shortRowsToDelete.size} linha(s) para deletar</Badge>
                                )}
                                {Object.keys(shortRowsEdits).length > 0 && (
                                    <Badge className="bg-blue-600 text-white">{Object.keys(shortRowsEdits).length} célula(s) para renomear</Badge>
                                )}
                                {/* Paginação */}
                                {shortRowsTotalPages > 1 && (
                                    <div className="flex items-center gap-1 ml-2">
                                        <button
                                            type="button"
                                            disabled={shortRowsPage === 0}
                                            onClick={() => setShortRowsPage(p => p - 1)}
                                            className="px-2 py-0.5 text-xs rounded border disabled:opacity-40 hover:bg-muted"
                                        >
                                            &laquo;
                                        </button>
                                        <span className="text-xs text-muted-foreground">
                                            Pág. {shortRowsPage + 1}/{shortRowsTotalPages} &middot; {shortCellsFiltered.length} itens
                                        </span>
                                        <button
                                            type="button"
                                            disabled={shortRowsPage >= shortRowsTotalPages - 1}
                                            onClick={() => setShortRowsPage(p => p + 1)}
                                            className="px-2 py-0.5 text-xs rounded border disabled:opacity-40 hover:bg-muted"
                                        >
                                            &raquo;
                                        </button>
                                    </div>
                                )}
                            </div>
                            <div className="flex gap-2">
                                <Button variant="outline" onClick={() => {
                                    setShortRowsEdits({});
                                    setShortRowsToDelete(new Set());
                                    setIsShortRowsOpen(false);
                                }}>
                                    Cancelar
                                </Button>
                                <Button
                                    onClick={handleApplyShortRowsEdits}
                                    disabled={shortRowsToDelete.size === 0 && Object.keys(shortRowsEdits).length === 0}
                                    className="bg-amber-600 hover:bg-amber-700"
                                >
                                    <Check className="w-4 h-4 mr-1" />
                                    Aplicar
                                </Button>
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>

                {/* Dialog de Limpeza de Caracteres Especiais */}
                <Dialog open={isCleanerOpen} onOpenChange={(open) => {
                    if (!open) setCleanerSelectedCols(new Set());
                    setIsCleanerOpen(open);
                }}>
                    <DialogContent className="max-w-lg">
                        <DialogHeader className="text-left">
                            <DialogTitle className="text-lg flex items-center gap-2">
                                <Sparkles className="w-5 h-5 text-amber-500" />
                                Limpar Caracteres Especiais
                            </DialogTitle>
                            <DialogDescription>
                                Selecione as colunas que deseja limpar. Sem seleção, todas as colunas serão limpas.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-4">
                            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800">
                                <p className="text-sm font-medium text-amber-900 dark:text-amber-100 mb-2">
                                    ⚠️ Esta ação vai:
                                </p>
                                <ul className="text-xs text-amber-800 dark:text-amber-200 space-y-1">
                                    <li>✓ Remover caracteres especiais (@ # $ % & etc)</li>
                                    <li>✓ Remover acentuação (é → e)</li>
                                    <li>✓ Remover vírgulas</li>
                                    <li>✓ Substituir C/ → COM e S/ → SEM</li>
                                    <li>✓ Normalizar espaços</li>
                                </ul>
                            </div>

                            {invalidCharsInfo.columnsWithIssues.length > 0 && (
                                <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800">
                                    <div className="flex items-center justify-between mb-2">
                                        <p className="text-xs font-semibold text-blue-900 dark:text-blue-200">
                                            📍 Selecionar colunas ({invalidCharsInfo.columnsWithIssues.length} com problemas):
                                        </p>
                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                className="text-[10px] text-blue-700 dark:text-blue-300 underline"
                                                onClick={() => setCleanerSelectedCols(new Set(invalidCharsInfo.columnsWithIssues))}
                                            >
                                                Todas
                                            </button>
                                            <button
                                                type="button"
                                                className="text-[10px] text-blue-700 dark:text-blue-300 underline"
                                                onClick={() => setCleanerSelectedCols(new Set())}
                                            >
                                                Nenhuma
                                            </button>
                                        </div>
                                    </div>
                                    <ScrollArea className="max-h-44">
                                        <div className="space-y-1">
                                            {invalidCharsInfo.columnsWithIssues.map((col) => {
                                                const checked = cleanerSelectedCols.has(col);
                                                return (
                                                    <label
                                                        key={col}
                                                        className="flex items-center justify-between gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900"
                                                    >
                                                        <div className="flex items-center gap-2">
                                                            <Checkbox
                                                                checked={checked}
                                                                onCheckedChange={(v) => {
                                                                    setCleanerSelectedCols(prev => {
                                                                        const next = new Set(prev);
                                                                        if (v) next.add(col); else next.delete(col);
                                                                        return next;
                                                                    });
                                                                }}
                                                            />
                                                            <span className="text-xs text-blue-900 dark:text-blue-100">{col}</span>
                                                        </div>
                                                        <Badge className="text-[10px] bg-amber-500/20 text-amber-700 dark:text-amber-300 shrink-0">
                                                            {invalidCharsInfo.columnCounts[col]} char{invalidCharsInfo.columnCounts[col] !== 1 ? 's' : ''}
                                                        </Badge>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </ScrollArea>
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-2">
                                {Object.entries(invalidCharsInfo.charTypes).map(([type, count]) => (
                                    <div key={type} className="p-2 rounded bg-secondary/50 text-center">
                                        <p className="text-xs text-muted-foreground">{type}</p>
                                        <p className="text-lg font-bold text-foreground">{count}</p>
                                    </div>
                                ))}
                            </div>

                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    onClick={() => { setCleanerSelectedCols(new Set()); setIsCleanerOpen(false); }}
                                    className="flex-1"
                                >
                                    Cancelar
                                </Button>
                                <Button
                                    variant="default"
                                    onClick={handleRemoveSpecialChars}
                                    className="flex-1 bg-amber-600 hover:bg-amber-700"
                                >
                                    <Sparkles className="w-4 h-4 mr-1" />
                                    {cleanerSelectedCols.size > 0
                                        ? `Limpar ${cleanerSelectedCols.size} coluna${cleanerSelectedCols.size !== 1 ? 's' : ''}`
                                        : 'Limpar Tudo'}
                                </Button>
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>

                {/* Dialog de Células Curtas */}
                <Dialog open={isShortRowsOpen} onOpenChange={(open) => {
                    if (open) {
                        setShortRowsFilterCols([]);
                        setShortRowsPage(0);
                    } else {
                        setShortRowsEdits({});
                        setShortRowsToDelete(new Set());
                    }
                    setIsShortRowsOpen(open);
                }}>
                    <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
                        <DialogHeader className="text-left">
                            <DialogTitle className="text-lg flex items-center gap-2">
                                <ScanLine className="w-5 h-5 text-amber-500" />
                                Células com menos de 3 caracteres
                            </DialogTitle>
                            <DialogDescription>
                                Filtre por coluna, renomeie o valor ou marque a linha para deletar.
                            </DialogDescription>
                        </DialogHeader>

                        {shortCellsColumns.length > 0 && (
                            <div className="flex flex-wrap gap-2 px-1 pb-2 border-b items-center">
                                <span className="text-xs font-semibold text-muted-foreground">Filtrar colunas:</span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShortRowsPage(0);
                                        setShortRowsFilterCols(
                                            shortRowsFilterCols.length === shortCellsColumns.length ? [] : [...shortCellsColumns]
                                        );
                                    }}
                                    className={`px-2 py-0.5 rounded text-xs font-medium border transition-colors ${shortRowsFilterCols.length === shortCellsColumns.length
                                        ? 'bg-amber-700 text-white border-amber-700'
                                        : 'bg-background border-border text-muted-foreground hover:border-amber-400'
                                        }`}
                                >
                                    {shortRowsFilterCols.length === shortCellsColumns.length ? 'Desmarcar todos' : 'Selecionar todos'}
                                </button>
                                <div className="w-px h-4 bg-border" />
                                {shortCellsColumns.map(col => {
                                    const rowsInCol = shortCellsInfo.filter(i => i.colName === col).map(i => i.rowIdx);
                                    const allDeleted = rowsInCol.length > 0 && rowsInCol.every(idx => shortRowsToDelete.has(idx));
                                    return (
                                        <div key={col} className="flex items-center rounded border overflow-hidden">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setShortRowsPage(0);
                                                    setShortRowsFilterCols(prev =>
                                                        prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]
                                                    );
                                                }}
                                                className={`px-2 py-0.5 text-xs font-medium transition-colors ${shortRowsFilterCols.includes(col)
                                                    ? 'bg-amber-500 text-white'
                                                    : 'bg-background text-muted-foreground hover:bg-amber-50 dark:hover:bg-amber-950'
                                                    }`}
                                            >
                                                {col}
                                            </button>
                                            <button
                                                type="button"
                                                title={allDeleted ? `Desmarcar deleção das ${rowsInCol.length} linhas de "${col}"` : `Marcar todas as ${rowsInCol.length} linhas de "${col}" para deleção`}
                                                onClick={() => {
                                                    setShortRowsToDelete(prev => {
                                                        const next = new Set(prev);
                                                        if (allDeleted) rowsInCol.forEach(idx => next.delete(idx));
                                                        else rowsInCol.forEach(idx => next.add(idx));
                                                        return next;
                                                    });
                                                }}
                                                className={`px-1.5 py-0.5 border-l transition-colors ${allDeleted
                                                    ? 'bg-destructive text-destructive-foreground hover:bg-destructive/80'
                                                    : 'bg-background text-destructive hover:bg-destructive/10'
                                                    }`}
                                            >
                                                <Trash2 className="w-3 h-3" />
                                            </button>
                                        </div>
                                    );
                                })}
                                {shortRowsFilterCols.length > 0 && shortRowsFilterCols.length < shortCellsColumns.length && (
                                    <button
                                        type="button"
                                        onClick={() => { setShortRowsFilterCols([]); setShortRowsPage(0); }}
                                        className="px-2 py-0.5 rounded text-xs font-medium text-destructive hover:underline"
                                    >
                                        Limpar filtro
                                    </button>
                                )}
                            </div>
                        )}

                        <div className="flex-1 overflow-y-auto">
                            {shortCellsFiltered.length === 0 ? (
                                <div className="py-12 text-center text-muted-foreground">
                                    Nenhuma célula curta encontrada.
                                </div>
                            ) : (
                                <div className="border rounded-lg">
                                    <table className="w-full">
                                        <thead className="bg-muted sticky top-0">
                                            <tr>
                                                <th className="text-left text-xs font-semibold px-3 py-2 w-16">Linha</th>
                                                <th className="text-left text-xs font-semibold px-3 py-2">Coluna</th>
                                                <th className="text-left text-xs font-semibold px-3 py-2">Valor atual</th>
                                                <th className="text-left text-xs font-semibold px-3 py-2">Novo valor</th>
                                                <th className="text-left text-xs font-semibold px-3 py-2 w-20">Deletar linha</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {shortCellsPageItems.map((item, idx) => {
                                                const key = `${item.rowIdx}-${item.colIdx}`;
                                                const isDeleted = shortRowsToDelete.has(item.rowIdx);
                                                return (
                                                    <tr
                                                        key={idx}
                                                        className={`border-t transition-colors ${isDeleted
                                                            ? 'bg-destructive/10 opacity-50'
                                                            : idx % 2 === 0 ? 'bg-background' : 'bg-muted/30'
                                                            }`}
                                                    >
                                                        <td className="px-3 py-2">
                                                            <Badge className="bg-amber-600 text-white text-xs">
                                                                {item.rowIdx + 1}
                                                            </Badge>
                                                        </td>
                                                        <td className="px-3 py-2 text-sm text-muted-foreground">
                                                            {item.colName}
                                                        </td>
                                                        <td className="px-3 py-2 text-sm font-mono font-semibold text-foreground">
                                                            "{item.value}"
                                                            <Badge variant="outline" className="ml-2 text-[10px] text-amber-600 border-amber-400">
                                                                {item.value.length}
                                                            </Badge>
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            <Input
                                                                placeholder="Novo valor..."
                                                                value={shortRowsEdits[key] ?? ''}
                                                                disabled={isDeleted}
                                                                onChange={(e) => {
                                                                    const val = e.target.value;
                                                                    setShortRowsEdits(prev => {
                                                                        if (val === '') {
                                                                            const next = { ...prev };
                                                                            delete next[key];
                                                                            return next;
                                                                        }
                                                                        return { ...prev, [key]: val };
                                                                    });
                                                                }}
                                                                className="h-7 text-xs"
                                                            />
                                                        </td>
                                                        <td className="px-3 py-2 text-center">
                                                            <button
                                                                type="button"
                                                                onClick={() => setShortRowsToDelete(prev => {
                                                                    const next = new Set(prev);
                                                                    if (next.has(item.rowIdx)) next.delete(item.rowIdx);
                                                                    else next.add(item.rowIdx);
                                                                    return next;
                                                                })}
                                                                className={`p-1.5 rounded transition-colors ${isDeleted
                                                                    ? 'bg-destructive/20 text-destructive'
                                                                    : 'hover:bg-destructive/10 text-muted-foreground hover:text-destructive'
                                                                    }`}
                                                                title={isDeleted ? 'Cancelar deleção' : 'Marcar para deletar linha'}
                                                            >
                                                                <Trash2 className="w-4 h-4" />
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>

                        <div className="flex items-center justify-between mt-4 pt-4 border-t gap-2 flex-wrap">
                            <div className="flex gap-2 flex-wrap">
                                {shortRowsToDelete.size > 0 && (
                                    <Badge variant="destructive">{shortRowsToDelete.size} linha(s) para deletar</Badge>
                                )}
                                {Object.keys(shortRowsEdits).length > 0 && (
                                    <Badge className="bg-blue-600 text-white">{Object.keys(shortRowsEdits).length} célula(s) para renomear</Badge>
                                )}
                                {shortRowsTotalPages > 1 && (
                                    <div className="flex items-center gap-1 ml-2">
                                        <button
                                            type="button"
                                            disabled={shortRowsPage === 0}
                                            onClick={() => setShortRowsPage(p => p - 1)}
                                            className="px-2 py-0.5 text-xs rounded border disabled:opacity-40 hover:bg-muted"
                                        >
                                            &laquo;
                                        </button>
                                        <span className="text-xs text-muted-foreground">
                                            Pág. {shortRowsPage + 1}/{shortRowsTotalPages} &middot; {shortCellsFiltered.length} itens
                                        </span>
                                        <button
                                            type="button"
                                            disabled={shortRowsPage >= shortRowsTotalPages - 1}
                                            onClick={() => setShortRowsPage(p => p + 1)}
                                            className="px-2 py-0.5 text-xs rounded border disabled:opacity-40 hover:bg-muted"
                                        >
                                            &raquo;
                                        </button>
                                    </div>
                                )}
                            </div>
                            <div className="flex gap-2">
                                <Button variant="outline" onClick={() => {
                                    setShortRowsEdits({});
                                    setShortRowsToDelete(new Set());
                                    setIsShortRowsOpen(false);
                                }}>
                                    Cancelar
                                </Button>
                                <Button
                                    onClick={handleApplyShortRowsEdits}
                                    disabled={shortRowsToDelete.size === 0 && Object.keys(shortRowsEdits).length === 0}
                                    className="bg-amber-600 hover:bg-amber-700"
                                >
                                    <Check className="w-4 h-4 mr-1" />
                                    Aplicar
                                </Button>
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>

                {/* Dialog de Edição de NCM */}
                <Dialog open={isNcmEditorOpen} onOpenChange={setIsNcmEditorOpen}>
                    <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
                        <DialogHeader className="text-left">
                            <DialogTitle className="text-lg flex items-center gap-2">
                                <Edit2 className="w-5 h-5 text-blue-500" />
                                Editar NCMs Inválidos
                            </DialogTitle>
                            <DialogDescription>
                                Edite os NCM que não possuem exatamente 8 dígitos.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="flex-1 overflow-y-auto">
                            <div className="border rounded-lg">
                                <table className="w-full">
                                    <thead className="bg-muted sticky top-0">
                                        <tr>
                                            <th className="text-left text-xs font-semibold px-3 py-2 w-16">Linha</th>
                                            <th className="text-left text-xs font-semibold px-3 py-2">Valor Atual</th>
                                            <th className="text-left text-xs font-semibold px-3 py-2">Novo Valor</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {ncmInfo.invalidLines.map((item, idx) => (
                                            <tr
                                                key={item.rowIdx}
                                                className={`border-t ${idx % 2 === 0 ? 'bg-background' : 'bg-muted/30'}`}
                                            >
                                                <td className="px-3 py-2">
                                                    <Badge className="bg-blue-600 text-white text-xs">
                                                        {item.row}
                                                    </Badge>
                                                </td>
                                                <td className="px-3 py-2 text-sm text-muted-foreground font-mono">
                                                    {item.value || '-'}
                                                </td>
                                                <td className="px-3 py-2">
                                                    <Input
                                                        placeholder="12345678"
                                                        value={ncmEdits[item.rowIdx] || ''}
                                                        onChange={(e) => {
                                                            const value = e.target.value.replace(/\D/g, '').slice(0, 8);
                                                            if (value === '') {
                                                                const newEdits = { ...ncmEdits };
                                                                delete newEdits[item.rowIdx];
                                                                setNcmEdits(newEdits);
                                                            } else {
                                                                setNcmEdits((prev) => ({
                                                                    ...prev,
                                                                    [item.rowIdx]: value,
                                                                }));
                                                            }
                                                        }}
                                                        className="h-8 text-sm font-mono"
                                                        maxLength={8}
                                                    />
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div className="flex gap-2 mt-4 pt-4 border-t">
                            <Button
                                variant="outline"
                                onClick={() => {
                                    setNcmEdits({});
                                    setIsNcmEditorOpen(false);
                                }}
                            >
                                Cancelar
                            </Button>
                            <Button
                                variant="secondary"
                                onClick={handleFillWithZero}
                                disabled={!ncmInfo.invalidLines.some(item => {
                                    const onlyDigits = String(item.value || '').replace(/\D/g, '');
                                    return onlyDigits.length < 8 && onlyDigits.length > 0;
                                })}
                            >
                                Preencher com 0
                            </Button>
                            <div className="flex-1" />
                            <Button
                                variant="default"
                                onClick={handleApplyNcmEdits}
                                disabled={Object.keys(ncmEdits).length === 0}
                                className="bg-blue-600 hover:bg-blue-700"
                            >
                                <Check className="w-4 h-4 mr-1" />
                                Aplicar
                            </Button>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>
        </>
    );
}
