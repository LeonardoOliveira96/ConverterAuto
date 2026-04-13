import { useEffect, useMemo, useState } from 'react';
import { SheetType, getFieldsForType, autoSuggestMapping } from '@/lib/erp-fields';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { motion } from 'framer-motion';
import { AlertTriangle, Sparkles, Info } from 'lucide-react';
import type { SpreadsheetRow } from '@/lib/converter-types';

interface StepColumnMappingProps {
  sheetType: SheetType;
  sourceColumns: string[];
  mapping: Record<string, string>;
  onMappingChange: (mapping: Record<string, string>) => void;
  sourceData?: SpreadsheetRow[];
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

export function StepColumnMapping({ sheetType, sourceColumns, mapping, onMappingChange, sourceData }: StepColumnMappingProps) {
  const fields = useMemo(() => getFieldsForType(sheetType), [sheetType]);

  // Tracks which fields were filled by auto-suggest vs manually by the user
  const [autoMapped, setAutoMapped] = useState<Set<string>>(new Set());
  const [manualMapped, setManualMapped] = useState<Set<string>>(new Set());

  const usedColumns = useMemo(() => new Set(Object.values(mapping)), [mapping]);

  // Map each source column name → its Excel letter (A, B, C...)
  const sourceColLetter = useMemo(() => {
    const map: Record<string, string> = {};
    sourceColumns.forEach((col, i) => { map[col] = toExcelCol(i); });
    return map;
  }, [sourceColumns]);

  useEffect(() => {
    if (Object.keys(mapping).length === 0) {
      const suggested = autoSuggestMapping(sourceColumns, fields);
      if (Object.keys(suggested).length > 0) {
        onMappingChange(suggested);
        setAutoMapped(new Set(Object.keys(suggested)));
        setManualMapped(new Set());
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceColumns, fields]);

  const unmappedRequired = fields.filter(f => f.required && !mapping[f.name]);
  const mappedCount = Object.keys(mapping).length;

  function getRowStyle(fieldName: string): string {
    if (manualMapped.has(fieldName)) return 'bg-green-500/10';
    if (autoMapped.has(fieldName) && mapping[fieldName]) return 'bg-yellow-400/10';
    if (fields.find(f => f.name === fieldName)?.required && !mapping[fieldName]) return 'bg-destructive/5';
    return '';
  }

  return (
    <TooltipProvider>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <Sparkles className="w-5 h-5 text-primary" />
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{mappedCount}</span> de {fields.length} campos mapeados automaticamente
            </p>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm bg-yellow-400/60 border border-yellow-400" />
              <span className="text-xs text-muted-foreground">Automático</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm bg-green-500/60 border border-green-500" />
              <span className="text-xs text-muted-foreground">Manual</span>
            </div>
            {unmappedRequired.length > 0 && (
              <div className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="w-4 h-4" />
                <span className="text-sm font-medium">{unmappedRequired.length} campo(s) obrigatório(s) não mapeado(s)</span>
              </div>
            )}
          </div>
        </div>

        <Card className="bg-card overflow-hidden">
          {/* Header row — Excel-style: gray corner + column headers */}
          <div className="grid grid-cols-[2.5rem_1fr_auto_1fr_2.5rem] bg-secondary/50 border-b text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {/* Corner cell — mimics Excel top-left */}
            <div className="flex items-center justify-center border-r border-border bg-secondary/80 py-3 select-none">#</div>
            <div className="flex items-center px-4 py-3">Campo do Sistema</div>
            <div className="flex items-center px-2 py-3" />
            <div className="flex items-center px-4 py-3">Coluna do Arquivo</div>
            {/* Right corner — mimics Excel column header */}
            <div className="flex items-center justify-center border-l border-border bg-secondary/80 py-3 select-none">#</div>
          </div>
          <div className="divide-y max-h-[500px] overflow-y-auto">
            {fields.map((field, index) => (
              <div
                key={field.name}
                className={`grid grid-cols-[2.5rem_1fr_auto_1fr_2.5rem] items-center transition-colors ${getRowStyle(field.name)}`}
              >
                {/* Left: Excel-style row letter */}
                <div className="self-stretch flex items-center justify-center border-r border-border bg-secondary/60 select-none">
                  <span className="text-[11px] font-mono font-bold text-muted-foreground">
                    {toExcelCol(index)}
                  </span>
                </div>

                {/* Inner grid for the row content */}
                <div className="col-span-3 grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{field.name}</span>
                    {field.required && (
                      <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                        Obrigatório
                      </Badge>
                    )}
                  </div>

                  <span className="text-muted-foreground">→</span>

                  <Select
                    value={mapping[field.name] || ''}
                    onValueChange={(value) => {
                      const newMapping = { ...mapping };
                      if (value === '__none__') {
                        delete newMapping[field.name];
                        setAutoMapped(prev => { const s = new Set(prev); s.delete(field.name); return s; });
                        setManualMapped(prev => { const s = new Set(prev); s.delete(field.name); return s; });
                      } else {
                        newMapping[field.name] = value;
                        setManualMapped(prev => new Set(prev).add(field.name));
                        setAutoMapped(prev => { const s = new Set(prev); s.delete(field.name); return s; });
                      }
                      onMappingChange(newMapping);
                    }}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Selecione uma coluna..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Nenhuma —</SelectItem>
                      {sourceColumns.map((col) => {
                        const isUsedByOther = usedColumns.has(col) && mapping[field.name] !== col;
                        const usedByField = isUsedByOther
                          ? fields.find(f => f.name !== field.name && mapping[f.name] === col)?.name
                          : null;
                        return isUsedByOther ? (
                          <Tooltip key={col}>
                            <TooltipTrigger asChild>
                              <span>
                                <SelectItem value={col} disabled className="opacity-40 cursor-not-allowed">
                                  {col}
                                </SelectItem>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="left">
                              <p className="text-xs">Já usada em: <strong>{usedByField}</strong></p>
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <SelectItem key={col} value={col}>{col}</SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>

                {/* Right: Excel column letter of the selected source column */}
                <div className="self-stretch flex items-center justify-center border-l border-border bg-secondary/60 select-none">
                  {mapping[field.name] ? (
                    <span className="text-[11px] font-mono font-bold text-muted-foreground">
                      {sourceColLetter[mapping[field.name]]}
                    </span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground/40">—</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </motion.div>
    </TooltipProvider>
  );
}
