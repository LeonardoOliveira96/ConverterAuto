import { useMemo, useState } from 'react';
import { SheetType, getFieldsForType } from '@/lib/erp-fields';
import {
  CleaningOptions,
  ValidationError,
  SpreadsheetRow,
  ShortDescriptionEdits,
} from '@/lib/converter-types';
import {
  buildCleanKey,
  buildRemoveKey,
  buildShortDescKey,
  categorizeSpecialCharsInString,
  isCodeRelatedField,
  applySpecialCharsClean,
  removeDescriptionHashtags,
  type CharCategory,
} from '@/lib/preview-alterations';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  CheckCircle2,
  Trash2,
  Sparkles,
  Filter,
  LayoutGrid,
  Undo2,
  Ban,
  Type,
  List,
  FileX,
  Eraser,
  ScanLine,
  TriangleAlert,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';

/** Mesma lógica de limpeza da descrição usada no processamento (antes de override manual). */
function pipelineProductDescription(raw: string, options: CleaningOptions): string {
  let val = String(raw ?? '');
  if (options.removeSpecialChars) {
    const { result } = removeDescriptionHashtags(val);
    val = applySpecialCharsClean(result);
  }
  if (options.normalizeText) val = val.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return val;
}

/** Validar NCM: deve ter exatamente 8 dígitos e sem padrões suspeitos. */
function validateNCM(ncm: string): { valid: boolean; issueType?: 'size-mismatch' | 'suspicious-pattern'; reason?: string } {
  const cleaned = String(ncm ?? '').trim();

  if (!cleaned) return { valid: true }; // Vazio é ok

  // Remover espaços para análise
  const digitsOnly = cleaned.replace(/\s/g, '');

  // Verificar se tem apenas dígitos
  if (!/^\d+$/.test(digitsOnly)) {
    return { valid: false, issueType: 'suspicious-pattern', reason: 'NCM contém caracteres não numéricos' };
  }

  // Verificar tamanho (deve ser 8)
  if (digitsOnly.length !== 8) {
    return { valid: false, issueType: 'size-mismatch', reason: `NCM deve ter 8 dígitos, mas tem ${digitsOnly.length}` };
  }

  // Verificar padrões suspeitos (todos iguais: 11111111, 00000000, etc)
  if (/^(.)\1{7}$/.test(digitsOnly)) {
    return { valid: false, issueType: 'suspicious-pattern', reason: 'NCM parece inválido (dígitos repetidos)' };
  }

  // Verificar padrões como 11111 0000 (parte repetida)
  if (/^(\d)\1{4,}\s*(\d)\2{3,}$/.test(cleaned) || /^(\d)\1{4,}(\d)\2{3,}$/.test(digitsOnly)) {
    return { valid: false, issueType: 'suspicious-pattern', reason: 'NCM parece inválido (padrão suspeito detectado)' };
  }

  return { valid: true };
}

interface StepValidationProps {
  sheetType: SheetType;
  rows: SpreadsheetRow[];
  headers: string[];
  mapping: Record<string, string>;
  options: CleaningOptions;
  onOptionsChange: (options: CleaningOptions) => void;
  excludedAlterationKeys: string[];
  onExcludedAlterationKeysChange: (keys: string[]) => void;
  shortDescriptionEdits: ShortDescriptionEdits;
  onShortDescriptionEditsChange: (edits: ShortDescriptionEdits) => void;
  manuallyRemovedRows: number[];
  onManuallyRemovedRowsChange: (rows: number[]) => void;
}

interface PreviewItem {
  row: number;
  action: 'remove' | 'clean' | 'short-desc' | 'ncm-invalid';
  reason: string;
  field?: string;
  originalValue?: string;
  cleanedValue?: string;
  charsRemoved?: number;
  removedChars?: string;
  alterationKey: string;
  charCategories?: CharCategory[];
  issueType?: 'size-mismatch' | 'suspicious-pattern';
}

type ModalFilter = 'all' | 'blank' | 'special' | 'codes' | 'short-desc' | 'valid-fields';

interface ValidField {
  row: number;
  description: string;
  internalCode: string;
  ncm: string;
  stock: string;
}

export function StepValidation({
  sheetType,
  rows,
  headers,
  mapping,
  options,
  onOptionsChange,
  excludedAlterationKeys,
  onExcludedAlterationKeysChange,
  shortDescriptionEdits,
  onShortDescriptionEditsChange,
  manuallyRemovedRows,
  onManuallyRemovedRowsChange,
}: StepValidationProps) {
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [modalFilter, setModalFilter] = useState<ModalFilter>('all');
  const [shortDescFieldFilter, setShortDescFieldFilter] = useState<'all' | 'desc' | 'codigo'>('all');
  const [ncmEdits, setNcmEdits] = useState<Record<string, string>>({});
  const [validFieldsSearch, setValidFieldsSearch] = useState('');
  const [validFieldsLineSearch, setValidFieldsLineSearch] = useState('');

  const errors = useMemo(() => {
    const fields = getFieldsForType(sheetType);
    const requiredFields = fields.filter(f => f.required);
    const errs: ValidationError[] = [];

    for (let i = 0; i < Math.min(rows.length, 500); i++) {
      const row = rows[i];
      for (const field of requiredFields) {
        const sourceCol = mapping[field.name];
        if (!sourceCol) continue;
        const colIndex = headers.indexOf(sourceCol);
        if (colIndex === -1) continue;
        const value = row[colIndex];
        if (value === undefined || value === null || String(value).trim() === '') {
          errs.push({ row: i + 2, field: field.name, message: `Campo obrigatório vazio` });
        }
      }
    }
    return errs;
  }, [sheetType, rows, headers, mapping]);

  const preview = useMemo(() => {
    const fields = getFieldsForType(sheetType);
    const requiredFields = fields.filter(f => f.required);
    const items: PreviewItem[] = [];
    const limit = Math.min(rows.length, 500);

    for (let i = 0; i < limit; i++) {
      const row = rows[i];
      const sheetRow = i + 2;

      // HIERARQUIA: Verificar campos obrigatórios PRIMEIRO (Descrição e Código Interno)
      let willBeRemoved = false;

      if (options.removeEmptyRequired) {
        for (const rf of requiredFields) {
          const src = mapping[rf.name];
          if (!src) continue;
          const ci = headers.indexOf(src);
          if (ci === -1) continue;
          const val = row[ci];
          if (val === undefined || val === null || String(val).trim() === '') {
            items.push({
              row: sheetRow,
              action: 'remove',
              reason: `Campo obrigatório "${rf.name}" está vazio`,
              field: rf.name,
              originalValue: String(val ?? '(vazio)'),
              alterationKey: buildRemoveKey(sheetRow, rf.name),
            });
            willBeRemoved = true;
            break;
          }
        }
      }

      if (options.removeEmptyDescription && sheetType === 'produto') {
        const descSrc = mapping['Descrição do Produto'];
        if (descSrc) {
          const ci = headers.indexOf(descSrc);
          if (ci !== -1) {
            const val = row[ci];
            if (!val || String(val).trim() === '') {
              if (!items.some(it => it.row === sheetRow && it.action === 'remove')) {
                items.push({
                  row: sheetRow,
                  action: 'remove',
                  reason: 'Descrição do Produto está vazia',
                  field: 'Descrição do Produto',
                  originalValue: '(vazio)',
                  alterationKey: buildRemoveKey(sheetRow, 'Descrição do Produto'),
                });
              }
              willBeRemoved = true;
            }
          }
        }
      }

      // Se a linha vai ser removida, pula as outras validações (NCM, etc)
      if (willBeRemoved) continue;

      if (options.removeSpecialChars) {
        for (const field of fields) {
          const src = mapping[field.name];
          if (!src) continue;
          const ci = headers.indexOf(src);
          if (ci === -1) continue;
          const val = String(row[ci] ?? '');
          if (val.trim() === '') continue;

          let hashtagCount = 0;
          let baseVal = val;

          // Para descrição: remover hashtags (#palavra) antes da limpeza geral
          if (field.name === 'Descrição do Produto') {
            const { result, count } = removeDescriptionHashtags(val);
            hashtagCount = count;
            baseVal = result;
          }

          const cleaned = applySpecialCharsClean(baseVal);

          if (cleaned !== val) {
            const specialChars = val.split('').filter(c => /[^\w\s.,;:\-()@]/.test(c));
            const removedChars = specialChars.join('');
            const removedCount = specialChars.length;

            let reason: string;
            if (hashtagCount > 0 && removedCount > 0) {
              reason = `${hashtagCount} hashtag(s) + ${removedCount} caractere(s) especial(is) removido(s) do campo "${field.name}"`;
            } else if (hashtagCount > 0) {
              reason = `${hashtagCount} hashtag(s) removida(s) do campo "${field.name}"`;
            } else {
              reason = `${removedCount} caractere(s) especial(is) removido(s) do campo "${field.name}"`;
            }

            items.push({
              row: sheetRow,
              action: 'clean',
              reason,
              field: field.name,
              originalValue: val,
              cleanedValue: cleaned,
              charsRemoved: removedCount,
              removedChars,
              alterationKey: buildCleanKey(sheetRow, field.name),
              charCategories: categorizeSpecialCharsInString(val),
            });
          }
        }
      }

      if (options.normalizeText) {
        for (const field of fields) {
          const src = mapping[field.name];
          if (!src) continue;
          const ci = headers.indexOf(src);
          if (ci === -1) continue;
          const val = String(row[ci] ?? '');
          const normalized = val.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          if (normalized !== val && val.trim() !== '') {
            if (!items.some(it => it.row === sheetRow && it.action === 'clean' && it.field === field.name)) {
              items.push({
                row: sheetRow,
                action: 'clean',
                reason: `Acentos serão removidos do campo "${field.name}"`,
                field: field.name,
                originalValue: val,
                cleanedValue: normalized,
                alterationKey: buildCleanKey(sheetRow, field.name),
              });
            }
          }
        }
      }

      if (sheetType === 'produto') {
        // Verificar Descrição do Produto
        if (mapping['Descrição do Produto']) {
          const descSrc = mapping['Descrição do Produto'];
          const ci = headers.indexOf(descSrc);
          if (ci !== -1) {
            const raw = row[ci];
            const t = String(raw ?? '').trim();
            const alphanumCount = (t.match(/[a-zA-Z0-9]/g) ?? []).length;
            const letterCount = (t.match(/[a-zA-Z]/g) ?? []).length;
            const onlyNumbers = t.length > 0 && letterCount === 0 && alphanumCount > 0;
            // Só reporta se não for vazio (vazios já são cobertos por linhas em branco)
            if (t.length > 0 && (alphanumCount < 3 || onlyNumbers)) {
              const rk = String(sheetRow);
              const piped = pipelineProductDescription(String(raw ?? ''), options);
              const after =
                shortDescriptionEdits[rk] !== undefined ? shortDescriptionEdits[rk] : piped;
              const reason = onlyNumbers && alphanumCount >= 3
                ? `Descrição contém apenas números — sem letras`
                : onlyNumbers
                  ? `Descrição com ${alphanumCount} número(s) apenas — menos de 3 e sem letras`
                  : `Descrição com ${alphanumCount} letra(s)/número(s) — menos de 3`;
              items.push({
                row: sheetRow,
                action: 'short-desc',
                reason,
                field: 'Descrição do Produto',
                originalValue: String(raw ?? ''),
                cleanedValue: after,
                alterationKey: buildShortDescKey(sheetRow),
              });
            }
          }
        }

        // Verificar Código interno
        if (mapping['Código interno']) {
          const codeSrc = mapping['Código interno'];
          const ci = headers.indexOf(codeSrc);
          if (ci !== -1) {
            const raw = row[ci];
            const t = String(raw ?? '').trim();
            const alphanumCount = (t.match(/[a-zA-Z0-9]/g) ?? []).length;
            const hasLetters = /[a-zA-Z]/.test(t);
            const isTooLong = t.length > 15;

            if (t.length > 0 && alphanumCount < 3) {
              items.push({
                row: sheetRow,
                action: 'short-desc',
                reason: `Código interno com ${alphanumCount} caractere(s) — menos de 3`,
                field: 'Código interno',
                originalValue: String(raw ?? ''),
                cleanedValue: String(raw ?? ''),
                alterationKey: buildShortDescKey(sheetRow) + ':codigo',
              });
            } else if (t.length > 0 && hasLetters) {
              items.push({
                row: sheetRow,
                action: 'short-desc',
                reason: `Código interno contém letras — esperado somente números`,
                field: 'Código interno',
                originalValue: String(raw ?? ''),
                cleanedValue: String(raw ?? ''),
                alterationKey: buildShortDescKey(sheetRow) + ':codigo',
              });
            } else if (isTooLong) {
              items.push({
                row: sheetRow,
                action: 'short-desc',
                reason: `Código interno com ${t.length} caracteres — máximo permitido é 15`,
                field: 'Código interno',
                originalValue: String(raw ?? ''),
                cleanedValue: String(raw ?? ''),
                alterationKey: buildShortDescKey(sheetRow) + ':codigo',
              });
            }
          }
        }
      }

      if (sheetType === 'produto' && mapping['Código NCM']) {
        const ncmSrc = mapping['Código NCM'];
        const ci = headers.indexOf(ncmSrc);
        if (ci !== -1) {
          const ncmValue = String(row[ci] ?? '').trim();
          // Validar qualquer NCM (vazio ou não)
          const validation = validateNCM(ncmValue);
          console.log(`[NCM Debug] Linha ${sheetRow}: "${ncmValue}" → valid: ${validation.valid}, reason: ${validation.reason}`);
          if (!validation.valid) {
            const rk = String(sheetRow);
            items.push({
              row: sheetRow,
              action: 'ncm-invalid',
              reason: validation.reason || 'NCM inválido',
              field: 'Código NCM',
              originalValue: ncmValue,
              cleanedValue: ncmEdits[rk] ?? '',
              alterationKey: `ncm_${sheetRow}`,
              issueType: validation.issueType,
            });
          }
        } else {
          console.log(`[NCM Debug] Coluna NCM não encontrada e headers: ${headers.join(', ')}`);
        }
      } else {
        if (sheetType === 'produto') {
          console.log(`[NCM Debug] Mapping NCM não existe`);
        }
      }
    }
    return items;
  }, [sheetType, rows, headers, mapping, options, shortDescriptionEdits, ncmEdits]);

  // Gerar lista de campos válidos (indexados de TODAS as linhas)
  const allValidFields = useMemo<ValidField[]>(() => {
    if (sheetType !== 'produto') return [];

    const descSrc = mapping['Descrição do Produto'];
    const codeSrc = mapping['Código interno'];
    const ncmSrc = mapping['Código NCM'];
    const stockSrc = mapping['Quantidade em estoque'];

    const descIdx = descSrc ? headers.indexOf(descSrc) : -1;
    const codeIdx = codeSrc ? headers.indexOf(codeSrc) : -1;
    const ncmIdx = ncmSrc ? headers.indexOf(ncmSrc) : -1;
    const stockIdx = stockSrc ? headers.indexOf(stockSrc) : -1;

    const rowsWithErrors = new Set(
      errors.map(e => e.row),
    );
    const rowsForRemoval = new Set(
      preview.filter(p => p.action === 'remove').map(p => p.row),
    );

    const fields: ValidField[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const sheetRow = i + 2;

      if (rowsWithErrors.has(sheetRow) || rowsForRemoval.has(sheetRow)) continue;

      fields.push({
        row: sheetRow,
        description: descIdx !== -1 ? String(row[descIdx] ?? '').trim() : '',
        internalCode: codeIdx !== -1 ? String(row[codeIdx] ?? '').trim() : '',
        ncm: ncmIdx !== -1 ? String(row[ncmIdx] ?? '').trim() : '',
        stock: stockIdx !== -1 ? String(row[stockIdx] ?? '').trim() : '',
      });
    }

    return fields;
  }, [sheetType, rows, headers, mapping, errors, preview]);

  const filteredValidFields = useMemo(() => {
    let result = allValidFields;

    // Filtro por número de linha
    if (validFieldsLineSearch.trim()) {
      const lineNum = parseInt(validFieldsLineSearch.trim(), 10);
      if (!isNaN(lineNum)) {
        result = result.filter(f => f.row === lineNum);
      }
    }

    // Filtro por descrição/código (busca inteligente)
    if (validFieldsSearch.trim()) {
      const term = validFieldsSearch.toLowerCase();
      const isNumeric = /^\d+$/.test(term);

      result = result.filter(f => {
        if (isNumeric) {
          // Se é número, busca EXATA no código interno
          return f.internalCode === term;
        } else {
          // Se não é número, busca parcial em descrição ou código
          return (
            f.description.toLowerCase().includes(term) ||
            f.internalCode.toLowerCase().includes(term)
          );
        }
      });
    }

    // Retorna os 100 primeiros dos resultados filtrados
    return result.slice(0, 100);
  }, [allValidFields, validFieldsSearch, validFieldsLineSearch]);

  const validFields = useMemo(() => allValidFields.slice(0, 100), [allValidFields]);

  const removals = preview.filter(p => p.action === 'remove');
  const cleanings = preview.filter(p => p.action === 'clean');
  const shortDescItems = preview.filter(p => p.action === 'short-desc');
  const ncmInvalidItems = preview.filter(p => p.action === 'ncm-invalid');
  const totalCharsRemoved = cleanings.reduce((sum, c) => sum + (c.charsRemoved || 0), 0);

  const modalFilteredItems = useMemo(() => {
    switch (modalFilter) {
      case 'blank':
        return preview.filter(i => i.action === 'remove');
      case 'special':
        return preview.filter(i => i.action === 'clean' && Boolean(i.removedChars));
      case 'codes':
        return preview.filter(i => i.action !== 'short-desc' && ((i.field && isCodeRelatedField(i.field)) || i.action === 'ncm-invalid'));
      case 'short-desc':
        return preview.filter(i => {
          if (i.action !== 'short-desc') return false;
          if (shortDescFieldFilter === 'desc') return i.field === 'Descrição do Produto';
          if (shortDescFieldFilter === 'codigo') return i.field === 'Código interno';
          return true;
        });
      case 'valid-fields':
        return []; // Não usado neste filtro, usa filteredValidFields
      default:
        return preview;
    }
  }, [preview, modalFilter, shortDescFieldFilter]);

  const excludedSet = useMemo(() => new Set(excludedAlterationKeys), [excludedAlterationKeys]);

  const toggleExclusion = (key: string) => {
    if (excludedAlterationKeys.includes(key)) {
      onExcludedAlterationKeysChange(excludedAlterationKeys.filter(k => k !== key));
    } else {
      onExcludedAlterationKeysChange([...excludedAlterationKeys, key]);
    }
  };

  const clearAllExclusions = () => onExcludedAlterationKeysChange([]);

  const manuallyRemovedSet = useMemo(() => new Set(manuallyRemovedRows), [manuallyRemovedRows]);

  const toggleManualRemoval = (row: number) => {
    if (manuallyRemovedSet.has(row)) {
      onManuallyRemovedRowsChange(manuallyRemovedRows.filter(r => r !== row));
    } else {
      onManuallyRemovedRowsChange([...manuallyRemovedRows, row]);
    }
  };

  const toggleOption = (key: keyof CleaningOptions) => {
    onOptionsChange({ ...options, [key]: !options[key] });
  };

  const cleaningItems: { key: keyof CleaningOptions; label: string; description: string }[] = [
    { key: 'removeEmptyDescription', label: 'Remover linhas com descrição vazia', description: 'Linhas sem descrição serão excluídas do resultado' },
    { key: 'removeEmptyRequired', label: 'Remover linhas com campos obrigatórios vazios', description: 'Linhas com campos obrigatórios em branco serão excluídas' },
    { key: 'removeSpecialChars', label: 'Remover caracteres especiais dos campos', description: 'Remove apenas os caracteres especiais, mantendo a linha' },
    { key: 'normalizeText', label: 'Normalizar texto (remover acentos)', description: 'Remove acentos dos textos, mantendo a linha' },
    { key: 'ignoreUnmapped', label: 'Ignorar colunas não mapeadas', description: 'Colunas sem mapeamento não serão incluídas' },
  ];

  const filterCounts = useMemo(
    () => ({
      all: preview.length,
      blank: preview.filter(i => i.action === 'remove').length,
      special: preview.filter(i => i.action === 'clean' && i.removedChars).length,
      codes: preview.filter(i => i.action !== 'short-desc' && ((i.field && isCodeRelatedField(i.field)) || i.action === 'ncm-invalid')).length,
      shortDesc: preview.filter(i => i.action === 'short-desc').length,
      validFields: allValidFields.length,
    }),
    [preview, allValidFields],
  );

  type ColumnKey = 'linha' | 'acao' | 'campo' | 'tipos' | 'motivo' | 'recebido' | 'nova' | 'exportado' | 'processar' | 'excluir' | 'ncm' | 'descricao' | 'estoque' | 'codigo';

  const visibleColumns = useMemo(() => {
    const getVisibleColumns = (filter: ModalFilter): ColumnKey[] => {
      switch (filter) {
        case 'blank':
          return ['linha', 'acao', 'campo', 'processar'];
        case 'special':
          return ['linha', 'acao', 'campo', 'tipos', 'motivo', 'recebido', 'exportado', 'processar'];
        case 'codes':
          return ['linha', 'acao', 'campo', 'motivo', 'recebido', 'exportado', 'processar'];
        case 'short-desc':
          return ['linha', 'acao', 'campo', 'motivo', 'recebido', 'nova', 'exportado', 'processar', 'excluir'];
        case 'valid-fields':
          return ['linha', 'codigo', 'ncm', 'descricao', 'estoque', 'excluir'];
        case 'all':
        default:
          return ['linha', 'acao', 'campo', 'tipos', 'motivo', 'recebido', 'nova', 'exportado', 'processar'];
      }
    };
    return getVisibleColumns(modalFilter);
  }, [modalFilter]);

  const mappedColumnsSummary = useMemo(() => {
    const entries = Object.entries(mapping).filter(([, src]) => src);
    return entries.map(([erp, src]) => ({ erp, src }));
  }, [mapping]);

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      {/* Card de informação sobre linhas vazias */}
      <Card className="bg-blue-500/5 border-blue-500/20 p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-foreground">
            <span className="font-semibold">ℹ️ Linhas vazias preservadas:</span> Linhas em branco <span className="font-semibold">NÃO serão removidas automaticamente</span>.
            Se desejar remover linhas vazias, use o editor de dados (com a lixeira) ou processe sem essa opção ligada.
          </div>
        </div>
      </Card>

      {/* Card de status */}
      <Card className="bg-card p-8 text-center">
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300 }}>
          <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${preview.length === 0 ? 'bg-emerald-500/10' : 'bg-amber-500/10'
            }`}>
            {preview.length === 0
              ? <CheckCircle2 className="w-8 h-8 text-emerald-500" />
              : <AlertCircle className="w-8 h-8 text-amber-500" />}
          </div>
        </motion.div>
        <h2 className="font-heading text-xl font-bold text-foreground">
          {preview.length === 0
            ? 'Nenhuma alteração detectada'
            : `${preview.length.toLocaleString('pt-BR')} alteração(ões) detectada(s)`}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {preview.length === 0
            ? 'A planilha está pronta para exportação com as opções atuais.'
            : 'Revise os detalhes abaixo e abra o painel para configurar o processamento.'}
        </p>
      </Card>

      {/* Stats grid — 4 tipos de problema */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {([
          { label: 'Linhas a remover', value: removals.length, icon: <Trash2 className="w-5 h-5 text-destructive" />, color: 'text-destructive' },
          { label: 'Limpezas de texto', value: cleanings.length, icon: <Sparkles className="w-5 h-5 text-amber-500" />, color: 'text-amber-500' },
          { label: 'Valores inválidos', value: shortDescItems.length, icon: <TriangleAlert className="w-5 h-5 text-rose-500" />, color: 'text-rose-500' },
          { label: 'NCM inválidos', value: ncmInvalidItems.length, icon: <ScanLine className="w-5 h-5 text-orange-500" />, color: 'text-orange-500' },
        ] as const).map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.08 }}>
            <Card className="bg-card p-5 flex items-center gap-4">
              {s.icon}
              <div>
                <p className={`text-2xl font-heading font-bold ${s.color}`}>{s.value.toLocaleString('pt-BR')}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Linhas válidas + total */}
      <div className="grid grid-cols-2 gap-4">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.42 }}>
          <Card className="bg-card p-5 flex items-center gap-4">
            <ShieldCheck className="w-5 h-5 text-emerald-500" />
            <div>
              <p className="text-2xl font-heading font-bold text-emerald-500">
                {(sheetType === 'produto' ? allValidFields.length : rows.length - removals.length).toLocaleString('pt-BR')}
              </p>
              <p className="text-xs text-muted-foreground">Linhas válidas</p>
            </div>
          </Card>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
          <Card className="bg-card p-5 flex items-center gap-4">
            <List className="w-5 h-5 text-muted-foreground" />
            <div>
              <p className="text-2xl font-heading font-bold text-foreground">{rows.length.toLocaleString('pt-BR')}</p>
              <p className="text-xs text-muted-foreground">Total de linhas</p>
            </div>
          </Card>
        </motion.div>
      </div>

      {excludedAlterationKeys.length > 0 && (
        <p className="text-center text-sm text-primary flex items-center justify-center gap-1.5">
          <Ban className="w-4 h-4" />
          {excludedAlterationKeys.length} alteração(ões) marcadas para não processar
        </p>
      )}

      {sheetType === 'produto' && (
        <div className="flex flex-col items-center gap-1">
          <Button size="lg" type="button" onClick={() => setPreviewModalOpen(true)} className="gap-2">
            <LayoutGrid className="w-5 h-5" />
            Revisar e configurar processamento
          </Button>
          <p className="text-xs text-muted-foreground">* Prévia limitada às primeiras 500 linhas do arquivo</p>
        </div>
      )}

      <Dialog open={previewModalOpen} onOpenChange={setPreviewModalOpen}>
        <DialogContent className="max-w-[min(96rem,calc(100vw-1.5rem))] w-full h-[min(92vh,900px)] flex flex-col p-0 gap-0 overflow-hidden sm:rounded-lg">
          <DialogHeader className="px-6 pt-6 pb-3 border-b shrink-0 text-left space-y-1">
            <DialogTitle className="flex items-center gap-2 font-heading">
              <Filter className="w-5 h-5 text-primary" />
              Prévia detalhada das alterações
            </DialogTitle>
            <DialogDescription>
              Filtre por categoria. Descrições com menos de 3 caracteres aparecem com o valor como veio na planilha e um campo para editar cada linha; o texto exportado segue a coluna &quot;Nova descrição&quot; quando você alterar (senão usa a limpeza padrão).
            </DialogDescription>
          </DialogHeader>

          <div className="px-6 py-3 border-b bg-secondary/30 shrink-0 space-y-3">
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Filtrar visão</span>
              {(
                [
                  {
                    id: 'all' as const,
                    label: 'Todas',
                    count: filterCounts.all,
                    icon: List,
                    activeClass: 'bg-slate-700 text-white border-slate-700 shadow-md',
                    inactiveClass: 'bg-slate-100 border-slate-300 text-slate-800 hover:bg-slate-200',
                  },
                  {
                    id: 'blank' as const,
                    label: 'Em branco',
                    count: filterCounts.blank,
                    icon: FileX,
                    activeClass: 'bg-red-600 text-white border-red-600 shadow-md',
                    inactiveClass: 'bg-red-50 border-red-300 text-red-800 hover:bg-red-100',
                  },
                  {
                    id: 'special' as const,
                    label: 'Caracteres especiais',
                    count: filterCounts.special,
                    icon: Eraser,
                    activeClass: 'bg-yellow-400 text-black border-yellow-400 shadow-md',
                    inactiveClass: 'bg-yellow-50 border-yellow-300 text-yellow-800 hover:bg-yellow-100',
                  },
                  {
                    id: 'codes' as const,
                    label: 'NCM',
                    count: filterCounts.codes,
                    icon: ScanLine,
                    activeClass: 'bg-orange-500 text-white border-orange-500 shadow-md',
                    inactiveClass: 'bg-orange-50 border-orange-300 text-orange-800 hover:bg-orange-100',
                  },
                  {
                    id: 'short-desc' as const,
                    label: 'Valores inválidos',
                    count: filterCounts.shortDesc,
                    icon: TriangleAlert,
                    activeClass: 'bg-rose-600 text-white border-rose-600 shadow-md',
                    inactiveClass: 'bg-rose-50 border-rose-300 text-rose-800 hover:bg-rose-100',
                  },
                  {
                    id: 'valid-fields' as const,
                    label: 'Campos válidos',
                    count: filterCounts.validFields,
                    icon: ShieldCheck,
                    activeClass: 'bg-emerald-600 text-white border-emerald-600 shadow-md',
                    inactiveClass: 'bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100',
                  },
                ] as const
              ).map(({ id, label, count, icon: Icon, activeClass, inactiveClass }) => (
                <button
                  key={id}
                  type="button"
                  className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-md border text-[13px] font-semibold transition-colors ${modalFilter === id ? activeClass : inactiveClass
                    }`}
                  onClick={() => {
                    setModalFilter(id);
                    if (id !== 'valid-fields') setValidFieldsSearch('');
                    if (id !== 'short-desc') setShortDescFieldFilter('all');
                  }}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                  <span className="opacity-70">({count})</span>
                </button>
              ))}
              {excludedAlterationKeys.length > 0 && modalFilter !== 'valid-fields' && (
                <Button type="button" variant="ghost" size="sm" className="h-8 text-xs ml-auto gap-1" onClick={clearAllExclusions}>
                  <Undo2 className="w-3.5 h-3.5" />
                  Limpar exclusões ({excludedAlterationKeys.length})
                </Button>
              )}
            </div>

            {modalFilter === 'short-desc' && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Campo:</span>
                <Select value={shortDescFieldFilter} onValueChange={(v) => setShortDescFieldFilter(v as 'all' | 'desc' | 'codigo')}>
                  <SelectTrigger className="h-8 text-xs w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="desc">Descrição do Produto</SelectItem>
                    <SelectItem value="codigo">Código interno</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {modalFilter === 'valid-fields' && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Buscar por descrição ou código interno..."
                    value={validFieldsSearch}
                    onChange={(e) => setValidFieldsSearch(e.target.value)}
                    className="h-9 text-sm"
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">Procura todas as {allValidFields.length} linhas</span>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Linha..."
                    value={validFieldsLineSearch}
                    onChange={(e) => setValidFieldsLineSearch(e.target.value)}
                    type="number"
                    className="h-9 text-sm max-w-[150px]"
                  />
                  <span className="text-xs text-muted-foreground">Ex: 42</span>
                </div>
              </div>
            )}

            <details className="group rounded-md border bg-card/50 px-3 py-2 text-sm">
              <summary className="cursor-pointer font-medium text-foreground list-none flex items-center gap-2">
                <span className="text-muted-foreground group-open:rotate-90 transition-transform">▸</span>
                <SlidersHorizontal className="w-3.5 h-3.5" />
                Opções de limpeza
              </summary>
              <div className="mt-3 space-y-3 pb-1">
                {cleaningItems.map(({ key, label, description }) => (
                  <label key={key} className="flex items-start gap-3 cursor-pointer group/chk">
                    <Checkbox checked={options[key]} onCheckedChange={() => toggleOption(key)} className="mt-0.5" />
                    <div>
                      <span className="text-sm text-foreground group-hover/chk:text-primary transition-colors font-medium">{label}</span>
                      <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                    </div>
                  </label>
                ))}
              </div>
            </details>

            <details className="group rounded-md border bg-card/50 px-3 py-2 text-sm">
              <summary className="cursor-pointer font-medium text-foreground list-none flex items-center gap-2">
                <span className="text-muted-foreground group-open:rotate-90 transition-transform">▸</span>
                Colunas mapeadas ({mappedColumnsSummary.length})
              </summary>
              <ScrollArea className="mt-2 max-h-32">
                <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground pr-4">
                  {mappedColumnsSummary.map(({ erp, src }) => (
                    <li key={erp}>
                      <span className="text-foreground font-medium">{erp}</span>
                      <span className="mx-1.5 text-muted-foreground/60">→</span>
                      <span className="font-mono">{src}</span>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </details>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-2">
            <div className="px-4 pb-4">
              <table className="w-full text-sm caption-bottom">
                <thead className="sticky top-0 z-10 bg-secondary/90 backdrop-blur-sm border-b">
                  <tr>
                    {visibleColumns.includes('linha') && (
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Linha</th>
                    )}
                    {visibleColumns.includes('acao') && (
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Ação</th>
                    )}
                    {visibleColumns.includes('campo') && (
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Campo ERP</th>
                    )}
                    {visibleColumns.includes('tipos') && (
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground min-w-[140px]">Tipos de caractere</th>
                    )}
                    {visibleColumns.includes('motivo') && (
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Motivo</th>
                    )}
                    {visibleColumns.includes('recebido') && (
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground max-w-[180px]">Como veio na planilha</th>
                    )}
                    {visibleColumns.includes('nova') && (
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground min-w-[220px] max-w-[280px]">Nova descrição</th>
                    )}
                    {visibleColumns.includes('exportado') && (
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground max-w-[200px]">Depois (exportação)</th>
                    )}
                    {visibleColumns.includes('processar') && (
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Processar</th>
                    )}
                    {visibleColumns.includes('codigo') && (
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Código Interno</th>
                    )}
                    {visibleColumns.includes('ncm') && (
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">NCM</th>
                    )}
                    {visibleColumns.includes('descricao') && (
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Descrição do Produto</th>
                    )}
                    {visibleColumns.includes('estoque') && (
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Estoque</th>
                    )}
                    {visibleColumns.includes('excluir') && (
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Excluir</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {modalFilter === 'valid-fields' ? (
                    filteredValidFields.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                          Nenhum campo válido encontrado.
                        </td>
                      </tr>
                    ) : (
                      filteredValidFields.map((field, idx) => (
                        <tr key={`valid-${field.row}-${idx}`} className={`transition-colors ${manuallyRemovedSet.has(field.row)
                          ? 'bg-destructive/10 opacity-60 line-through'
                          : 'bg-emerald-500/5 hover:bg-emerald-500/10'
                          }`}>
                          {visibleColumns.includes('linha') && (
                            <td className="px-3 py-2 text-foreground font-mono text-xs align-top">{field.row}</td>
                          )}
                          {visibleColumns.includes('codigo') && (
                            <td className="px-3 py-2 text-xs font-mono text-foreground align-top">
                              {field.internalCode || '—'}
                            </td>
                          )}
                          {visibleColumns.includes('ncm') && (
                            <td className="px-3 py-2 text-xs font-mono text-foreground align-top">
                              {field.ncm || '—'}
                            </td>
                          )}
                          {visibleColumns.includes('descricao') && (
                            <td className="px-3 py-2 text-xs text-foreground align-top max-w-xs">
                              {field.description || '—'}
                            </td>
                          )}
                          {visibleColumns.includes('estoque') && (
                            <td className="px-3 py-2 text-xs font-mono text-foreground align-top">
                              {field.stock || '—'}
                            </td>
                          )}
                          {visibleColumns.includes('excluir') && (
                            <td className="px-3 py-2 text-right align-top">
                              <Button
                                type="button"
                                size="sm"
                                variant={manuallyRemovedSet.has(field.row) ? 'secondary' : 'destructive'}
                                className="h-7 text-xs gap-1"
                                onClick={() => toggleManualRemoval(field.row)}
                              >
                                {manuallyRemovedSet.has(field.row) ? (
                                  <><Undo2 className="w-3 h-3" /> Restaurar</>
                                ) : (
                                  <><Trash2 className="w-3 h-3" /> Excluir</>
                                )}
                              </Button>
                            </td>
                          )}
                        </tr>
                      ))
                    )
                  ) : modalFilteredItems.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
                        Nenhuma alteração neste filtro.
                      </td>
                    </tr>
                  ) : (
                    modalFilteredItems.map((item, idx) => {
                      const excluded = excludedSet.has(item.alterationKey);
                      const rowKey = String(item.row);
                      const defaultPipe =
                        item.action === 'short-desc'
                          ? pipelineProductDescription(item.originalValue ?? '', options)
                          : '';
                      return (
                        <tr
                          key={`${item.alterationKey}-${idx}`}
                          className={
                            excluded
                              ? 'bg-muted/40 opacity-70'
                              : item.action === 'remove'
                                ? 'bg-destructive/5 hover:bg-destructive/10'
                                : item.action === 'ncm-invalid'
                                  ? 'bg-orange-500/5 hover:bg-orange-500/10'
                                  : item.action === 'short-desc'
                                    ? 'bg-sky-500/5 hover:bg-sky-500/10'
                                    : 'bg-amber-500/5 hover:bg-amber-500/10'
                          }
                        >
                          {visibleColumns.includes('linha') && (
                            <td className="px-3 py-2 text-foreground font-mono text-xs align-top">{item.row}</td>
                          )}
                          {visibleColumns.includes('acao') && (
                            <td className="px-3 py-2 align-top">
                              {item.action === 'remove' ? (
                                <Badge variant="destructive" className="text-[10px] px-1.5 py-0.5 whitespace-nowrap">
                                  <Trash2 className="w-3 h-3 mr-1" /> Remover linha
                                </Badge>
                              ) : item.action === 'ncm-invalid' ? (
                                <Badge className="bg-orange-500/20 text-orange-600 dark:text-orange-300 border-orange-500/35 text-[10px] px-1.5 py-0.5 whitespace-nowrap">
                                  <AlertCircle className="w-3 h-3 mr-1" /> NCM Inválido
                                </Badge>
                              ) : item.action === 'short-desc' ? (
                                item.field === 'Código interno' ? (
                                  <Badge className="bg-sky-500/20 text-sky-600 dark:text-sky-300 border-sky-500/35 text-[10px] px-1.5 py-0.5 whitespace-nowrap">
                                    <Type className="w-3 h-3 mr-1" />
                                    Cód. curto
                                  </Badge>
                                ) : (
                                  <Badge className="bg-rose-500/20 text-rose-600 dark:text-rose-300 border-rose-500/35 text-[10px] px-1.5 py-0.5 whitespace-nowrap">
                                    <Type className="w-3 h-3 mr-1" />
                                    Desc. inválida
                                  </Badge>
                                )
                              ) : (
                                <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px] px-1.5 py-0.5 whitespace-nowrap">
                                  <Sparkles className="w-3 h-3 mr-1" /> Limpar
                                </Badge>
                              )}
                            </td>
                          )}
                          {visibleColumns.includes('campo') && (
                            <td className="px-3 py-2 text-xs text-foreground align-top">{item.field ?? '—'}</td>
                          )}
                          {visibleColumns.includes('tipos') && (
                            <td className="px-3 py-2 text-xs align-top">
                              {item.charCategories && item.charCategories.length > 0 ? (
                                <ul className="space-y-0.5 max-w-[220px]">
                                  {item.charCategories.map((cc, i) => (
                                    <li key={i} className="flex flex-wrap gap-x-1 gap-y-0.5 items-baseline">
                                      <code className="rounded bg-muted px-1 py-0 text-[10px] font-mono">{cc.char === ' ' ? '␠' : cc.char}</code>
                                      <span className="text-muted-foreground">{cc.label}</span>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                          )}
                          {visibleColumns.includes('motivo') && (
                            <td className="px-3 py-2 text-muted-foreground text-xs align-top max-w-xs">{item.reason}</td>
                          )}
                          {visibleColumns.includes('recebido') && (
                            <td className="px-3 py-2 align-top max-w-[180px]">
                              {item.action === 'ncm-invalid' ? (
                                <Input
                                  className="h-8 text-xs font-mono"
                                  value={ncmEdits[rowKey] ?? item.originalValue ?? ''}
                                  onChange={(e) =>
                                    setNcmEdits({
                                      ...ncmEdits,
                                      [rowKey]: e.target.value,
                                    })
                                  }
                                  placeholder="NCM"
                                  disabled={excluded}
                                  maxLength={8}
                                />
                              ) : (
                                <span className="text-xs font-mono break-all text-foreground">
                                  {item.originalValue ?? '—'}
                                </span>
                              )}
                            </td>
                          )}
                          {visibleColumns.includes('nova') && (
                            <td className="px-3 py-2 align-top min-w-[220px] max-w-[280px]">
                              {item.action === 'short-desc' ? (
                                <Input
                                  className="h-9 text-xs font-mono"
                                  value={
                                    shortDescriptionEdits[rowKey] !== undefined
                                      ? shortDescriptionEdits[rowKey]
                                      : defaultPipe
                                  }
                                  onChange={(e) =>
                                    onShortDescriptionEditsChange({
                                      ...shortDescriptionEdits,
                                      [rowKey]: e.target.value,
                                    })
                                  }
                                  placeholder="Texto na exportação"
                                  disabled={excluded}
                                />
                              ) : (
                                <span className="text-muted-foreground text-xs">—</span>
                              )}
                            </td>
                          )}
                          {visibleColumns.includes('exportado') && (
                            <td className="px-3 py-2 text-xs font-mono align-top break-all max-w-[200px]">
                              {item.action === 'remove' ? (
                                <span className="text-destructive">—</span>
                              ) : item.action === 'ncm-invalid' ? (
                                <span className="text-orange-600 dark:text-orange-400">
                                  {excluded ? (
                                    <span className="text-muted-foreground">(ignorado)</span>
                                  ) : ncmEdits[rowKey] ? (
                                    <span className={validateNCM(ncmEdits[rowKey]).valid ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                                      {ncmEdits[rowKey]}
                                    </span>
                                  ) : (
                                    <em className="text-muted-foreground">(aguardando NCM válido)</em>
                                  )}
                                </span>
                              ) : item.action === 'short-desc' ? (
                                <span className="text-sky-600 dark:text-sky-400">
                                  {excluded ? (
                                    <span className="text-muted-foreground">(ignorado)</span>
                                  ) : shortDescriptionEdits[rowKey] !== undefined ? (
                                    shortDescriptionEdits[rowKey] === '' ? (
                                      <em className="text-muted-foreground">(vazio)</em>
                                    ) : (
                                      shortDescriptionEdits[rowKey]
                                    )
                                  ) : item.cleanedValue === '' ? (
                                    <em className="text-muted-foreground">(vazio)</em>
                                  ) : (
                                    item.cleanedValue
                                  )}
                                </span>
                              ) : (
                                <span className="text-green-600 dark:text-green-400">{item.cleanedValue}</span>
                              )}
                            </td>
                          )}
                          {visibleColumns.includes('processar') && (
                            <td className="px-3 py-2 text-right align-top">
                              <Button
                                type="button"
                                size="sm"
                                variant={excluded ? 'secondary' : 'outline'}
                                className="h-8 text-xs gap-1 shrink-0"
                                onClick={() => toggleExclusion(item.alterationKey)}
                              >
                                {excluded ? (
                                  <>
                                    <Undo2 className="w-3.5 h-3.5" /> Restaurar
                                  </>
                                ) : (
                                  <>
                                    <Ban className="w-3.5 h-3.5" /> Não aplicar
                                  </>
                                )}
                              </Button>
                            </td>
                          )}
                          {visibleColumns.includes('excluir') && item.action === 'short-desc' && (
                            <td className="px-3 py-2 text-right align-top">
                              <Button
                                type="button"
                                size="sm"
                                variant={manuallyRemovedSet.has(item.row) ? 'secondary' : 'destructive'}
                                className="h-7 text-xs gap-1 shrink-0"
                                onClick={() => toggleManualRemoval(item.row)}
                              >
                                {manuallyRemovedSet.has(item.row) ? (
                                  <><Undo2 className="w-3 h-3" /> Restaurar</>
                                ) : (
                                  <><Trash2 className="w-3 h-3" /> Excluir</>
                                )}
                              </Button>
                            </td>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="px-6 py-3 border-t shrink-0 flex justify-between items-center gap-2 bg-card/80">
            <p className="text-xs text-muted-foreground">
              {modalFilter === 'valid-fields' ? (
                <>
                  {validFieldsSearch.trim() || validFieldsLineSearch.trim() ? (
                    <>
                      Mostrando até 100 de {(() => {
                        let count = allValidFields;
                        if (validFieldsLineSearch.trim()) {
                          const lineNum = parseInt(validFieldsLineSearch.trim(), 10);
                          if (!isNaN(lineNum)) {
                            count = count.filter(f => f.row === lineNum);
                          }
                        }
                        if (validFieldsSearch.trim()) {
                          const term = validFieldsSearch.toLowerCase();
                          const isNumeric = /^\d+$/.test(term);
                          count = count.filter(f => {
                            if (isNumeric) {
                              return f.internalCode === term;
                            } else {
                              return f.description.toLowerCase().includes(term) || f.internalCode.toLowerCase().includes(term);
                            }
                          });
                        }
                        return count.length;
                      })()} resultados
                    </>
                  ) : (
                    <>
                      Mostrando 100 primeiros de {allValidFields.length} campos válidos
                    </>
                  )}
                </>
              ) : (
                <>
                  {modalFilteredItems.length} visíveis · {excludedAlterationKeys.length} ignoradas no processamento
                </>
              )}
            </p>
            <Button type="button" variant="secondary" onClick={() => setPreviewModalOpen(false)}>
              Fechar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </motion.div>
  );
}
