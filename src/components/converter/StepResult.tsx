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

export function StepResult({ result, processedData, fileName, onReset }: StepResultProps) {
  const [logOpen, setLogOpen] = useState(false);
  const [lineFilter, setLineFilter] = useState('');

  const handleDownload = () => {
    const ws = XLSX.utils.aoa_to_sheet(processedData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Dados');
    const outName = fileName.replace(/\.[^.]+$/, '') + '_convertido.xlsx';
    XLSX.writeFile(wb, outName);
  };

  const stats: { label: string; value: number; icon: React.ReactNode; color: string }[] = [
    {
      label: 'Linhas processadas',
      value: result.processedRows,
      icon: <CheckCircle2 className="w-5 h-5 text-emerald-500" />,
      color: 'text-emerald-500',
    },
    {
      label: 'Linhas removidas',
      value: result.removedRows,
      icon: <Trash2 className="w-5 h-5 text-amber-500" />,
      color: 'text-amber-500',
    },
    {
      label: 'Erros encontrados',
      value: result.errors.length,
      icon: <AlertCircle className="w-5 h-5 text-destructive" />,
      color: 'text-destructive',
    },
    {
      label: 'Caracteres removidos',
      value: result.charsRemoved ?? 0,
      icon: <Sparkles className="w-5 h-5 text-violet-500" />,
      color: 'text-violet-500',
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

      {/* Resumo de processamento */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <Card className="bg-card p-6 border-l-4 border-l-emerald-500">
          <div className="space-y-2 text-sm md:text-base">
            <p className="text-foreground">
              <span className="font-semibold">Total de linhas:</span> {result.totalRows.toLocaleString('pt-BR')}
            </p>
            <p className="text-emerald-600 dark:text-emerald-400">
              <span className="font-semibold">✓ Processadas:</span> {result.processedRows.toLocaleString('pt-BR')}
            </p>
            {result.removedRows > 0 && (
              <p className="text-amber-600 dark:text-amber-400">
                <span className="font-semibold">⊗ Removidas:</span> {result.removedRows.toLocaleString('pt-BR')}
              </p>
            )}
            {(result.charsRemoved ?? 0) > 0 && (
              <p className="text-violet-600 dark:text-violet-400">
                <span className="font-semibold">✨ Caracteres removidos:</span> {(result.charsRemoved ?? 0).toLocaleString('pt-BR')}
              </p>
            )}
            {result.errors.length > 0 && (
              <p className="text-destructive">
                <span className="font-semibold">⚠ Erros encontrados:</span> {result.errors.length.toLocaleString('pt-BR')}
              </p>
            )}
          </div>
        </Card>
      </motion.div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.08 }}
          >
            <Card className="bg-card p-5 flex items-center gap-4">
              {s.icon}
              <div>
                <p className={`text-2xl font-heading font-bold ${s.color}`}>
                  <AnimatedNumber value={s.value} />
                </p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Detalhes de caracteres removidos */}
      {result.charTypes && Object.keys(result.charTypes).length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <Card className="bg-card p-6">
            <h3 className="font-heading font-semibold text-lg text-foreground mb-4">Tipos de caracteres removidos</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Object.entries(result.charTypes).map(([type, count]) => (
                <div key={type} className="bg-muted/50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-foreground">
                    <AnimatedNumber value={count} />
                  </p>
                  <p className="text-xs text-muted-foreground capitalize mt-1">{type}</p>
                </div>
              ))}
            </div>
          </Card>
        </motion.div>
      )}

      <div className="flex flex-wrap justify-center gap-4">
        <Button size="lg" onClick={handleDownload} className="gap-2">
          <Download className="w-5 h-5" /> Baixar Planilha Convertida
        </Button>
        {((result.removedRowsLog?.length ?? 0) > 0 || (result.cleanedFieldsLog?.length ?? 0) > 0) && (
          <Button size="lg" variant="outline" onClick={() => setLogOpen(true)} className="gap-2">
            <ClipboardList className="w-5 h-5" /> Veja o que foi alterado
          </Button>
        )}
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
