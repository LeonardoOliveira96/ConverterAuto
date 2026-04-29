import { useEffect, useRef, useState } from 'react';
import { ProcessingResult } from '@/lib/converter-types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { motion } from 'framer-motion';
import { Download, CheckCircle2, AlertCircle, Trash2, RotateCcw, Sparkles, ClipboardList, Search } from 'lucide-react';
import * as XLSX from 'xlsx';

interface StepResultProps {
  result: ProcessingResult;
  processedData: string[][];
  fileName: string;
  onReset: () => void;
  onEditAgain: () => void;
}

function useCountUp(target: number, duration = 1200) {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (target === 0) { setValue(0); return; }
    startRef.current = null;
    const step = (timestamp: number) => {
      if (startRef.current === null) startRef.current = timestamp;
      const progress = Math.min((timestamp - startRef.current) / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * target));
      if (progress < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, duration]);

  return value;
}

function AnimatedNumber({ value, suffix = '' }: { value: number; suffix?: string }) {
  const animated = useCountUp(value);
  return <>{animated.toLocaleString('pt-BR')}{suffix}</>;
}

export function StepResult({ result, processedData, fileName, onReset, onEditAgain }: StepResultProps) {
  const [logOpen, setLogOpen] = useState(false);
  const [lineFilter, setLineFilter] = useState('');

  const handleDownload = () => {
    const ws = XLSX.utils.aoa_to_sheet(processedData);

    // Forçar colunas de código/barras como texto para evitar notação científica no Excel
    if (processedData.length > 0) {
      const hdrs = processedData[0];
      for (let c = 0; c < hdrs.length; c++) {
        const h = String(hdrs[c] ?? '').toLowerCase();
        if (h.includes('barras') || h.includes('barcode') || h.includes('ean') || h.includes('gtin')) {
          const colRef = XLSX.utils.encode_col(c);
          for (let r = 1; r < processedData.length; r++) {
            const addr = `${colRef}${r + 1}`;
            const cell = ws[addr];
            if (cell && cell.v !== '' && cell.v !== null && cell.v !== undefined) {
              cell.t = 's';
              cell.z = '@';
              cell.v = String(cell.v);
              delete cell.w; // força SheetJS a recalcular o texto formatado
            }
          }
        }
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Dados');
    const outName = fileName.replace(/\.[^.]+$/, '') + '_convertido.xlsx';
    XLSX.writeFile(wb, outName);
  };

  const removedCount = result.removedRows;

  const stats: { label: string; value: number; icon: React.ReactNode; color: string; bg: string }[] = [
    {
      label: 'Total de linhas',
      value: result.totalRows,
      icon: <ClipboardList className="w-6 h-6 text-blue-500" />,
      color: 'text-blue-500',
      bg: 'bg-blue-500/10',
    },
    {
      label: 'Linhas convertidas',
      value: result.processedRows,
      icon: <CheckCircle2 className="w-6 h-6 text-emerald-500" />,
      color: 'text-emerald-500',
      bg: 'bg-emerald-500/10',
    },
    {
      label: 'Linhas removidas',
      value: removedCount,
      icon: <Trash2 className="w-6 h-6 text-amber-500" />,
      color: 'text-amber-500',
      bg: 'bg-amber-500/10',
    },
    {
      label: 'Caracteres removidos',
      value: result.charsRemoved ?? 0,
      icon: <Sparkles className="w-6 h-6 text-violet-500" />,
      color: 'text-violet-500',
      bg: 'bg-violet-500/10',
    },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <Card className="bg-card p-8 text-center">
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300 }}>
          <div className="w-20 h-20 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-10 h-10 text-emerald-500" />
          </div>
        </motion.div>
        <h2 className="font-heading text-2xl font-bold text-foreground">Conversão Concluída!</h2>
        <p className="text-muted-foreground mt-2">Sua planilha foi convertida com sucesso para o padrão do ERP.</p>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 + i * 0.08 }}
          >
            <Card className="bg-card p-5 flex flex-col items-center text-center gap-3">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center ${s.bg}`}>
                {s.icon}
              </div>
              <div>
                <p className={`text-3xl font-heading font-bold ${s.color}`}>
                  <AnimatedNumber value={s.value} />
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="flex flex-wrap justify-center gap-4">
        <Button size="lg" onClick={handleDownload} className="gap-2">
          <Download className="w-5 h-5" /> Baixar Planilha Convertida
        </Button>
        {((result.removedRowsLog?.length ?? 0) > 0 || (result.cleanedFieldsLog?.length ?? 0) > 0) && (
          <Button size="lg" variant="outline" onClick={() => setLogOpen(true)} className="gap-2">
            <ClipboardList className="w-5 h-5" /> Veja o que foi alterado
          </Button>
        )}
        <Button size="lg" variant="outline" onClick={onEditAgain} className="gap-2">
          <Sparkles className="w-5 h-5" /> Editar novamente
        </Button>
        <Button size="lg" variant="outline" onClick={onReset} className="gap-2">
          <RotateCcw className="w-5 h-5" /> Nova Conversão
        </Button>
      </div>

      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent className="max-w-4xl w-full p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-3">
            <DialogTitle className="text-lg font-heading font-semibold flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-muted-foreground" />
              O que foi alterado
            </DialogTitle>
            <div className="relative mt-3">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="number"
                min={1}
                placeholder="Filtrar por número de linha..."
                value={lineFilter}
                onChange={e => setLineFilter(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </DialogHeader>
          <Tabs defaultValue={result.removedRowsLog?.length ? 'removed' : 'cleaned'} className="flex flex-col h-[65vh]"
            onValueChange={() => setLineFilter('')}
          >
            <TabsList className="mx-6 mb-0 w-fit">
              <TabsTrigger value="removed">
                Linhas removidas ({result.removedRowsLog?.length ?? 0})
              </TabsTrigger>
              <TabsTrigger value="cleaned">
                Campos alterados ({result.cleanedFieldsLog?.length ?? 0})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="removed" className="flex-1 overflow-hidden m-0 mt-0">
              <ScrollArea className="h-full px-6 pb-6 pt-3">
                {(result.removedRowsLog?.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-10">Nenhuma linha foi removida.</p>
                ) : (() => {
                  const filtered = lineFilter
                    ? result.removedRowsLog.filter(e => String(e.sheetRow).startsWith(lineFilter))
                    : result.removedRowsLog;
                  return filtered.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-10">Nenhuma linha encontrada.</p>
                  ) : (
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 pr-4 font-semibold text-muted-foreground whitespace-nowrap">Linha</th>
                          <th className="text-left py-2 pr-4 font-semibold text-muted-foreground whitespace-nowrap">Motivo</th>
                          <th className="text-left py-2 font-semibold text-muted-foreground">Dados</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((entry, idx) => (
                          <tr key={idx} className="border-b last:border-0 align-top">
                            <td className="py-2 pr-4 font-mono text-xs font-bold text-foreground whitespace-nowrap">{entry.sheetRow}</td>
                            <td className="py-2 pr-4 whitespace-nowrap">
                              <span className="inline-flex items-center rounded-full bg-destructive/10 text-destructive px-2.5 py-0.5 text-xs font-medium">
                                {entry.reason}
                              </span>
                            </td>
                            <td className="py-2">
                              <div className="flex flex-wrap gap-1">
                                {entry.fieldNames.map((name, fi) =>
                                  entry.originalData[fi] ? (
                                    <span key={fi} className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs">
                                      <span className="text-muted-foreground">{name}:</span>
                                      <span className="font-medium text-foreground">{entry.originalData[fi]}</span>
                                    </span>
                                  ) : null
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  );
                })()}
              </ScrollArea>
            </TabsContent>

            <TabsContent value="cleaned" className="flex-1 overflow-hidden m-0 mt-0">
              <ScrollArea className="h-full px-6 pb-6 pt-3">
                {(result.cleanedFieldsLog?.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-10">Nenhum campo foi alterado.</p>
                ) : (() => {
                  const filtered = lineFilter
                    ? result.cleanedFieldsLog.filter(e => String(e.sheetRow).startsWith(lineFilter))
                    : result.cleanedFieldsLog;
                  return filtered.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-10">Nenhuma linha encontrada.</p>
                  ) : (
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 pr-4 font-semibold text-muted-foreground whitespace-nowrap">Linha</th>
                          <th className="text-left py-2 pr-4 font-semibold text-muted-foreground whitespace-nowrap">Campo</th>
                          <th className="text-left py-2 pr-4 font-semibold text-muted-foreground">Como estava</th>
                          <th className="text-left py-2 font-semibold text-muted-foreground">Como ficou</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((entry, idx) => (
                          <tr key={idx} className="border-b last:border-0 align-top">
                            <td className="py-2 pr-4 font-mono text-xs font-bold text-foreground whitespace-nowrap">{entry.sheetRow}</td>
                            <td className="py-2 pr-4 text-xs text-muted-foreground whitespace-nowrap">{entry.field}</td>
                            <td className="py-2 pr-4 max-w-[240px]">
                              <span className="inline-block rounded bg-red-500/10 text-red-600 dark:text-red-400 px-2 py-0.5 text-xs font-mono break-all">{entry.before}</span>
                            </td>
                            <td className="py-2 max-w-[240px]">
                              <span className="inline-block rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 text-xs font-mono break-all">{entry.after}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  );
                })()}
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
