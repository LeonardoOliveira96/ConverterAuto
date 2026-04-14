import { useEffect, useRef, useState } from 'react';
import { SheetType, getFieldsForType, autoSuggestMapping } from '@/lib/erp-fields';
import {
  CleaningOptions,
  ProcessingResult,
  RemovedRowLog,
  CleanedFieldLog,
  ValidationError,
  SpreadsheetRow,
  ShortDescriptionEdits,
} from '@/lib/converter-types';
import { buildCleanKey, buildRemoveKey, buildShortDescKey, cleanSefazXmlChars, applySpecialCharsClean, removeDescriptionHashtags, categorizeSpecialCharsInString } from '@/lib/preview-alterations';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { motion } from 'framer-motion';
import { Loader2, X } from 'lucide-react';

interface StepProcessingProps {
  sheetType: SheetType;
  rows: SpreadsheetRow[];
  headers: string[];
  mapping: Record<string, string>;
  options: CleaningOptions;
  excludedAlterationKeys?: string[];
  shortDescriptionEdits?: ShortDescriptionEdits;
  manuallyRemovedRows?: number[];
  onComplete: (result: ProcessingResult, processedData: string[][]) => void;
  onCancel: () => void;
}

const STATUSES = ['Lendo planilha...', 'Processando...', 'Validando...', 'Gerando arquivo...'];

export function StepProcessing({
  sheetType,
  rows,
  headers,
  mapping,
  options,
  excludedAlterationKeys = [],
  shortDescriptionEdits = {},
  manuallyRemovedRows = [],
  onComplete,
  onCancel,
}: StepProcessingProps) {
  const [progress, setProgress] = useState(0);
  const [processed, setProcessed] = useState(0);
  const [statusIdx, setStatusIdx] = useState(0);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    processData();
    return () => { cancelledRef.current = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function processData() {
    const excluded = new Set(excludedAlterationKeys);
    const fields = getFieldsForType(sheetType);
    const requiredFields = fields.filter(f => f.required);

    // SEMPRE regenerar o mapping com base nos headers ATUAIS
    // Isso garante que funcione mesmo se colunas forem deletadas em Step 2
    const currentMapping = autoSuggestMapping(headers, fields);

    // Filtrar para apenas campos que têm mapeamento explícito
    const mappedFields = fields.filter(f => currentMapping[f.name]);
    const mappedRequiredFields = mappedFields.filter(f => f.required);

    const total = rows.length;
    const BATCH = 500;
    const result: string[][] = [];
    const errors: ValidationError[] = [];
    let removed = 0;
    let charsRemoved = 0;
    const charTypes: Record<string, number> = {};
    const removedRowsLog: RemovedRowLog[] = [];
    const cleanedFieldsLog: CleanedFieldLog[] = [];

    const fieldNames = fields.map(f => f.name);

    function captureRowData(row: SpreadsheetRow): string[] {
      return fields.map(f => {
        const src = currentMapping[f.name];
        if (!src) return '';
        const ci = headers.indexOf(src);
        if (ci === -1) return '';
        return String(row[ci] ?? '');
      });
    }

    // Header row - apenas campos mapeados
    const outputHeaders = mappedFields.map(f => f.name);
    result.push(outputHeaders);

    setStatusIdx(0);
    await delay(300);
    setStatusIdx(1);

    for (let i = 0; i < total; i += BATCH) {
      if (cancelledRef.current) return;
      const end = Math.min(i + BATCH, total);

      for (let j = i; j < end; j++) {
        const row = rows[j];
        let skip = false;
        const sheetRow = j + 2;

        // Linhas excluídas manualmente pelo usuário
        if (manuallyRemovedRows.includes(sheetRow)) {
          removed++;
          removedRowsLog.push({ sheetRow, reason: 'Removido manualmente', originalData: captureRowData(row), fieldNames });
          continue;
        }

        let skipReason = '';
        if (options.removeEmptyRequired) {
          // Validar apenas campos obrigatórios que foram mapeados
          for (const rf of mappedRequiredFields) {
            const src = currentMapping[rf.name];
            if (!src) continue;
            const ci = headers.indexOf(src);
            if (ci === -1) continue;
            const val = row[ci];
            if (val === undefined || val === null || String(val).trim() === '') {
              if (!excluded.has(buildRemoveKey(sheetRow, rf.name))) {
                skip = true;
                skipReason = `Campo obrigatório vazio: ${rf.name}`;
                break;
              }
            }
          }
        }

        if (!skip && options.removeEmptyDescription && sheetType === 'produto') {
          const descSrc = currentMapping['Descrição do Produto'];
          if (descSrc) {
            const ci = headers.indexOf(descSrc);
            if (ci !== -1) {
              const val = row[ci];
              if (!val || String(val).trim() === '') {
                if (!excluded.has(buildRemoveKey(sheetRow, 'Descrição do Produto'))) {
                  skip = true;
                  skipReason = 'Descrição do Produto vazia';
                }
              }
            }
          }
        }

        if (skip) {
          removed++;
          removedRowsLog.push({ sheetRow, reason: skipReason, originalData: captureRowData(row), fieldNames });
          continue;
        }

        const outputRow: string[] = mappedFields.map(field => {
          const src = currentMapping[field.name];
          if (!src) return '';
          const ci = headers.indexOf(src);
          if (ci === -1) return '';
          let val = row[ci] ?? '';
          val = String(val);
          const originalVal = val;

          const cleanKey = buildCleanKey(sheetRow, field.name);
          const skipClean = excluded.has(cleanKey);

          if (options.removeSpecialChars && !skipClean) {
            // Normalizar primeiro para preservar letra sem acento (ã → a, é → e, etc)
            val = val.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

            if (sheetType === 'produto' && field.name === 'Descrição do Produto') {
              val = removeDescriptionHashtags(val).result;
            }
            // Track removed chars before cleaning
            const strVal: string = val as string;
            const cats = categorizeSpecialCharsInString(strVal);
            const allowed = /[\w\s.,;:\-()@]/;
            for (const c of strVal) {
              if (!allowed.test(c)) {
                const cat = cats.find(x => x.char === c);
                const label = cat?.label ?? 'símbolo';
                charTypes[label] = (charTypes[label] ?? 0) + 1;
                charsRemoved++;
              }
            }
            val = applySpecialCharsClean(val, sheetType === 'produto');
          }
          if (options.removeSefazXmlChars && !skipClean) {
            val = cleanSefazXmlChars(val, sheetType === 'produto');
          }
          if (options.normalizeText && !skipClean) {
            val = val.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          }

          if (
            sheetType === 'produto' &&
            field.name === 'Descrição do Produto' &&
            !excluded.has(buildShortDescKey(sheetRow)) &&
            Object.prototype.hasOwnProperty.call(shortDescriptionEdits, String(sheetRow))
          ) {
            val = shortDescriptionEdits[String(sheetRow)];
          }

          if (val !== originalVal) {
            cleanedFieldsLog.push({ sheetRow, field: field.name, before: originalVal, after: val });
          }

          return val;
        });
        result.push(outputRow);
      }

      setProcessed(end);
      setProgress(Math.round((end / total) * 100));
      await delay(10);
    }

    if (cancelledRef.current) return;
    setStatusIdx(2);
    await delay(400);
    setStatusIdx(3);
    await delay(400);

    onComplete(
      { totalRows: total, processedRows: result.length - 1, removedRows: removed, errors, charsRemoved, charTypes, removedRowsLog, cleanedFieldsLog },
      result
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="bg-card p-8 text-center space-y-6">
        <Loader2 className="w-12 h-12 text-primary mx-auto animate-spin" />
        <div>
          <p className="font-heading font-semibold text-lg text-foreground">{STATUSES[statusIdx]}</p>
          <p className="text-sm text-muted-foreground mt-1">
            {processed.toLocaleString('pt-BR')} / {rows.length.toLocaleString('pt-BR')} linhas
          </p>
        </div>
        <Progress value={progress} className="h-3" />
        <Button variant="outline" onClick={() => { cancelledRef.current = true; onCancel(); }} className="gap-2">
          <X className="w-4 h-4" /> Cancelar
        </Button>
      </Card>
    </motion.div>
  );
}

function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}
