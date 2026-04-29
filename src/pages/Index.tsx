import { useState, useCallback, lazy, Suspense } from 'react';
import { SheetType } from '@/lib/erp-fields';
import {
  CleaningOptions,
  ProcessingResult,
  BackupEntry,
  LoadedSpreadsheetData,
  SpreadsheetRow,
  ShortDescriptionEdits,
} from '@/lib/converter-types';
import { StepperHeader } from '@/components/converter/StepperHeader';
import { StepUpload } from '@/components/converter/StepUpload';
import { StepTypeSelection } from '@/components/converter/StepTypeSelection';
import { StepDataEditor } from '@/components/converter/StepDataEditor';
import { StepValidation } from '@/components/converter/StepValidation';
import { StepProcessing } from '@/components/converter/StepProcessing';
import { StepResult } from '@/components/converter/StepResult';

const BackupHistory = lazy(() => import('@/components/converter/BackupHistory').then(m => ({ default: m.BackupHistory })));
const MatchPlanilhas = lazy(() => import('@/components/converter/MatchPlanilhas').then(m => ({ default: m.MatchPlanilhas })));
const AuditValidation = lazy(() => import('@/components/converter/AuditValidation').then(m => ({ default: m.AuditValidation })));
const ExtractorUnidades = lazy(() => import('@/components/converter/ExtractorUnidades').then(m => ({ default: m.ExtractorUnidades })));
const SeparadorCodigoBarras = lazy(() => import('@/components/converter/SeparadorCodigoBarras').then(m => ({ default: m.SeparadorCodigoBarras })));
const LimpadorEAN = lazy(() => import('@/components/converter/LimpadorEAN').then(m => ({ default: m.LimpadorEAN })));
const FiltradorTamanhoEAN = lazy(() => import('@/components/converter/FiltradorTamanhoEAN').then(m => ({ default: m.FiltradorTamanhoEAN })));
const ValidadorNCM = lazy(() => import('@/components/converter/ValidadorNCM').then(m => ({ default: m.ValidadorNCM })));
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { toast } from '@/components/ui/sonner';
import { ArrowLeft, ArrowRight, History, FileSpreadsheet, Barcode, ShieldCheck, Scissors, ScanLine, Filter, ClipboardCheck } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

type ToolMode = null | 'converter' | 'match' | 'audit' | 'units' | 'barsep' | 'cleaner' | 'barfilter' | 'ncmvalidator';

export default function Index() {
  const [toolMode, setToolMode] = useState<ToolMode>(null);
  const [step, setStep] = useState(0);
  const [showBackups, setShowBackups] = useState(false);

  // Data state
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<SpreadsheetRow[]>([]);
  const [rawData, setRawData] = useState<SpreadsheetRow[]>([]);
  const [sheetType, setSheetType] = useState<SheetType | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [cleaningOptions, setCleaningOptions] = useState<CleaningOptions>({
    removeEmptyDescription: false,
    removeEmptyRequired: false,
    removeSpecialChars: true,
    normalizeText: false,
    ignoreUnmapped: true,
    removeSefazXmlChars: true,
  });
  const [shortDescriptionEdits, setShortDescriptionEdits] = useState<ShortDescriptionEdits>({});
  const [result, setResult] = useState<ProcessingResult | null>(null);
  const [processedData, setProcessedData] = useState<string[][]>([]);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [excludedAlterationKeys, setExcludedAlterationKeys] = useState<string[]>([]);
  const [manuallyRemovedRows, setManuallyRemovedRows] = useState<number[]>([]);

  const handleFileLoaded = useCallback((data: LoadedSpreadsheetData) => {
    setFileName(data.fileName);
    setHeaders(data.headers);
    setRows(data.rows);
    setRawData(data.rawData);
    setExcludedAlterationKeys([]);
    setShortDescriptionEdits({});
    setManuallyRemovedRows([]);
  }, []);

  const handleProcessComplete = (res: ProcessingResult, data: string[][]) => {
    // rawData inclui a linha de cabeçalho, por isso -1
    const deletedInEditor = (rawData.length - 1) - rows.length;
    const adjustedResult: ProcessingResult = deletedInEditor > 0
      ? { ...res, removedRows: res.removedRows + deletedInEditor }
      : res;
    setResult(adjustedResult);
    setProcessedData(data);

    toast.dismiss('processing');
    if (adjustedResult.errors.length > 0) {
      toast.warning('Validação inconclusiva em alguns itens', {
        description: `${adjustedResult.errors.length} problema(s) encontrado(s) durante o processamento`,
      });
    } else {
      toast.success('Processo concluído com sucesso', {
        description: `${adjustedResult.processedRows} linha(s) processada(s) com êxito`,
      });
    }

    setStep(5);
  };

  const startProcessing = () => {
    // Save backup
    const backup: BackupEntry = {
      id: Date.now().toString(),
      fileName,
      date: new Date().toISOString(),
      type: sheetType!,
      rowCount: rows.length,
      data: rawData,
    };
    setBackups(prev => [backup, ...prev]);

    toast.loading('Processando dados, aguarde...', { id: 'processing' });
    setStep(4);
  };

  const reset = () => {
    setStep(0);
    setFileName('');
    setHeaders([]);
    setRows([]);
    setRawData([]);
    setSheetType(null);
    setMapping({});
    setResult(null);
    setProcessedData([]);
    setExcludedAlterationKeys([]);
    setShortDescriptionEdits({});
    setManuallyRemovedRows([]);
  };

  const handleEditAgain = () => {
    setStep(2);
    setResult(null);
    setProcessedData([]);
  };

  const handleRestore = (backup: BackupEntry) => {
    setFileName(backup.fileName);
    setRawData(backup.data);
    setHeaders((backup.data[0] || []).map(String));
    setRows(backup.data.slice(1));
    setSheetType(backup.type);
    setMapping({});
    setShortDescriptionEdits({});
    setStep(2);
    setShowBackups(false);
  };

  const canNext = () => {
    if (step === 0) return fileName !== '';
    if (step === 1) return sheetType !== null;
    if (step === 2) return true; // Sempre pode avançar após editar dados
    if (step === 3) return true;
    return false;
  };

  const fileInfo = fileName ? { fileName, headers, rowCount: rows.length } : null;

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="container max-w-5xl flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setToolMode(null);
                setShowBackups(false);
              }}
              className="flex items-center gap-3 hover:opacity-80 transition-opacity"
            >
              <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-heading font-bold text-sm">ERP</span>
              </div>
              <h1 className="font-heading font-bold text-lg text-foreground">
                Conversor Inteligente de Planilhas
              </h1>
            </button>
            {toolMode !== null && (
              <span className="text-muted-foreground text-sm">
                /
                <span className="ml-2 text-foreground font-medium">
                  {toolMode === 'converter' ? 'Conversor ERP' : toolMode === 'match' ? 'Match Inteligente' : toolMode === 'audit' ? 'Auditoria de Exportação' : toolMode === 'units' ? 'Extrator de Unidades' : toolMode === 'barsep' ? 'Separador de Código de Barras' : toolMode === 'cleaner' ? 'Limpador EAN + Descrição' : toolMode === 'barfilter' ? 'Filtrar por Tamanho do Código de Barras' : 'Validador de NCM'}
                </span>
              </span>
            )}
          </div>
          {toolMode === 'converter' && (
            <Button variant="outline" size="sm" onClick={() => setShowBackups(!showBackups)} className="gap-2">
              <History className="w-4 h-4" />
              Backups
              {backups.length > 0 && (
                <span className="ml-1 w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center font-bold">
                  {backups.length}
                </span>
              )}
            </Button>
          )}
        </div>
      </header>

      <main className="container max-w-5xl py-8">
        <Suspense fallback={
          <div className="flex items-center justify-center py-24">
            <span className="text-muted-foreground text-sm">Carregando...</span>
          </div>
        }>
          <AnimatePresence mode="wait">

            {/* ── Home: seleção de ferramenta ── */}
            {toolMode === null && (
              <motion.div
                key="home"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <div className="mb-8">
                  <h2 className="font-heading text-2xl font-bold text-foreground mb-1">
                    Ferramentas disponíveis
                  </h2>
                  <p className="text-muted-foreground text-sm">
                    Selecione a ferramenta que deseja utilizar
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

                  {/* Card: Conversor ERP */}
                  <Card
                    onClick={() => setToolMode('converter')}
                    className="p-6 cursor-pointer transition-all duration-200 hover:shadow-lg hover:bg-secondary/50 group flex flex-col"
                  >
                    <div className="flex items-center gap-1.5 mb-4">
                      <span className="text-xs">🔄</span>
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        Conversão
                      </span>
                    </div>
                    <div className="w-12 h-12 rounded-xl bg-secondary text-secondary-foreground flex items-center justify-center mb-3 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                      <FileSpreadsheet className="w-6 h-6" />
                    </div>
                    <h3 className="font-heading font-semibold text-base text-foreground leading-snug">
                      Conversor de Planilhas ERP
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1.5 flex-1">
                      Converta e normalize planilhas de produtos, clientes e fornecedores para o formato ERP
                    </p>
                  </Card>

                  {/* Card: Match Inteligente */}
                  <Card
                    onClick={() => setToolMode('match')}
                    className="p-6 cursor-pointer transition-all duration-200 hover:shadow-lg hover:bg-secondary/50 group flex flex-col"
                  >
                    <div className="flex items-center gap-1.5 mb-4">
                      <span className="text-xs">🧠</span>
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        Inteligência
                      </span>
                    </div>
                    <div className="w-12 h-12 rounded-xl bg-secondary text-secondary-foreground flex items-center justify-center mb-3 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                      <Barcode className="w-6 h-6" />
                    </div>
                    <h3 className="font-heading font-semibold text-base text-foreground leading-snug">
                      Match Inteligente de Planilhas
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1.5 flex-1">
                      Associe códigos de barras (EAN) entre planilhas usando correspondência inteligente por descrição
                    </p>
                  </Card>

                  {/* Card: Auditoria */}
                  <Card
                    onClick={() => setToolMode('audit')}
                    className="p-6 cursor-pointer transition-all duration-200 hover:shadow-lg hover:bg-secondary/50 group flex flex-col"
                  >
                    <div className="flex items-center gap-1.5 mb-4">
                      <span className="text-xs">🔍</span>
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        Auditoria
                      </span>
                    </div>
                    <div className="w-12 h-12 rounded-xl bg-secondary text-secondary-foreground flex items-center justify-center mb-3 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                      <ShieldCheck className="w-6 h-6" />
                    </div>
                    <h3 className="font-heading font-semibold text-base text-foreground leading-snug">
                      Validação de Consistência
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1.5 flex-1">
                      Compare planilha original com a gerada e identifique divergências de valores e inconsistências
                    </p>
                  </Card>

                  {/* Card: Extrator de Unidades */}
                  <Card
                    onClick={() => setToolMode('units')}
                    className="p-6 cursor-pointer transition-all duration-200 hover:shadow-lg hover:bg-secondary/50 group flex flex-col border-violet-200 dark:border-violet-800"
                  >
                    <div className="flex items-center gap-1.5 mb-4">
                      <span className="text-xs">⚙️</span>
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        Ferramentas
                      </span>
                    </div>
                    <div className="w-12 h-12 rounded-xl bg-violet-100 dark:bg-violet-900/50 text-violet-600 dark:text-violet-400 flex items-center justify-center mb-3 group-hover:bg-violet-600 group-hover:text-white transition-colors">
                      <Scissors className="w-6 h-6" />
                    </div>
                    <h3 className="font-heading font-semibold text-base text-foreground leading-snug">
                      Extrator de Unidades
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1.5 flex-1">
                      Extrai unidades do final da descrição (UN, KG, LT, ML, CX, PC, FD, SC)
                    </p>
                  </Card>

                  {/* Card: Separador de Código de Barras */}
                  <Card
                    onClick={() => setToolMode('barsep')}
                    className="p-6 cursor-pointer transition-all duration-200 hover:shadow-lg hover:bg-secondary/50 group flex flex-col border-indigo-200 dark:border-indigo-800"
                  >
                    <div className="flex items-center gap-1.5 mb-4">
                      <span className="text-xs">⚙️</span>
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        Ferramentas
                      </span>
                    </div>
                    <div className="w-12 h-12 rounded-xl bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mb-3 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                      <Barcode className="w-6 h-6" />
                    </div>
                    <h3 className="font-heading font-semibold text-base text-foreground leading-snug">
                      Separador de Código de Barras
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1.5 flex-1">
                      Separa EAN e Produto de uma coluna combinada em colunas distintas
                    </p>
                  </Card>

                  {/* Card: Limpador EAN + Descrição */}
                  <Card
                    onClick={() => setToolMode('cleaner')}
                    className="p-6 cursor-pointer transition-all duration-200 hover:shadow-lg hover:bg-secondary/50 group flex flex-col border-teal-200 dark:border-teal-800"
                  >
                    <div className="flex items-center gap-1.5 mb-4">
                      <span className="text-xs">⚙️</span>
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        Ferramentas
                      </span>
                    </div>
                    <div className="w-12 h-12 rounded-xl bg-teal-100 dark:bg-teal-900/50 text-teal-600 dark:text-teal-400 flex items-center justify-center mb-3 group-hover:bg-teal-600 group-hover:text-white transition-colors">
                      <ScanLine className="w-6 h-6" />
                    </div>
                    <h3 className="font-heading font-semibold text-base text-foreground leading-snug">
                      Limpador EAN + Descrição
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1.5 flex-1">
                      Separa código de barras (8–14 dígitos) da descrição em uma única coluna
                    </p>
                  </Card>

                  {/* Card: Filtrar por Tamanho do Código de Barras */}
                  <Card
                    onClick={() => setToolMode('barfilter')}
                    className="p-6 cursor-pointer transition-all duration-200 hover:shadow-lg hover:bg-secondary/50 group flex flex-col border-amber-200 dark:border-amber-800"
                  >
                    <div className="flex items-center gap-1.5 mb-4">
                      <span className="text-xs">⚙️</span>
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        Ferramentas
                      </span>
                    </div>
                    <div className="w-12 h-12 rounded-xl bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400 flex items-center justify-center mb-3 group-hover:bg-amber-600 group-hover:text-white transition-colors">
                      <Filter className="w-6 h-6" />
                    </div>
                    <h3 className="font-heading font-semibold text-base text-foreground leading-snug">
                      Filtrar por Tamanho do Código de Barras
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1.5 flex-1">
                      Remove registros cujo código de barras tenha menos dígitos que o código de referência informado
                    </p>
                  </Card>

                  {/* Card: Validador de NCM */}
                  <Card
                    onClick={() => setToolMode('ncmvalidator')}
                    className="p-6 cursor-pointer transition-all duration-200 hover:shadow-lg hover:bg-secondary/50 group flex flex-col border-sky-200 dark:border-sky-800"
                  >
                    <div className="flex items-center gap-1.5 mb-4">
                      <span className="text-xs">⚙️</span>
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        Ferramentas
                      </span>
                    </div>
                    <div className="w-12 h-12 rounded-xl bg-sky-100 dark:bg-sky-900/50 text-sky-600 dark:text-sky-400 flex items-center justify-center mb-3 group-hover:bg-sky-600 group-hover:text-white transition-colors">
                      <ClipboardCheck className="w-6 h-6" />
                    </div>
                    <h3 className="font-heading font-semibold text-base text-foreground leading-snug">
                      Validador de NCM
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1.5 flex-1">
                      Limpa NCMs inválidos (diferente de 8 dígitos numéricos) sem remover linhas da planilha
                    </p>
                  </Card>

                </div>
              </motion.div>
            )}

            {/* ── Conversor ERP (stepper existente) ── */}
            {toolMode === 'converter' && (
              <motion.div key="converter" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                {showBackups ? (
                  <div>
                    <div className="flex items-center justify-between mb-6">
                      <h2 className="font-heading text-xl font-bold text-foreground">Histórico de Backups</h2>
                      <Button variant="ghost" size="sm" onClick={() => setShowBackups(false)}>Voltar</Button>
                    </div>
                    <BackupHistory backups={backups} onRestore={handleRestore} />
                  </div>
                ) : (
                  <div>
                    {step < 5 && <StepperHeader currentStep={step} />}

                    {step === 0 && <StepUpload onFileLoaded={handleFileLoaded} fileInfo={fileInfo} />}
                    {step === 1 && <StepTypeSelection selected={sheetType} onSelect={setSheetType} />}
                    {step === 2 && sheetType && (
                      <StepDataEditor
                        headers={headers}
                        rows={rows}
                        onRowsChange={setRows}
                        onHeadersChange={setHeaders}
                        sheetType={sheetType}
                      />
                    )}
                    {step === 3 && sheetType && (
                      <StepValidation
                        sheetType={sheetType}
                        rows={rows}
                        headers={headers}
                        mapping={mapping}
                        options={cleaningOptions}
                        onOptionsChange={setCleaningOptions}
                        excludedAlterationKeys={excludedAlterationKeys}
                        onExcludedAlterationKeysChange={setExcludedAlterationKeys}
                        shortDescriptionEdits={shortDescriptionEdits}
                        onShortDescriptionEditsChange={setShortDescriptionEdits}
                        manuallyRemovedRows={manuallyRemovedRows}
                        onManuallyRemovedRowsChange={setManuallyRemovedRows}
                      />
                    )}
                    {step === 4 && sheetType && (
                      <StepProcessing
                        sheetType={sheetType}
                        rows={rows}
                        headers={headers}
                        mapping={mapping}
                        options={cleaningOptions}
                        excludedAlterationKeys={excludedAlterationKeys}
                        shortDescriptionEdits={shortDescriptionEdits}
                        manuallyRemovedRows={manuallyRemovedRows}
                        onComplete={handleProcessComplete}
                        onCancel={() => setStep(2)}
                      />
                    )}
                    {step === 5 && result && (
                      <StepResult
                        result={result}
                        processedData={processedData}
                        fileName={fileName}
                        onReset={reset}
                        onEditAgain={handleEditAgain}
                      />
                    )}

                    {/* Navigation */}
                    {step < 4 && (
                      <div className="flex justify-between mt-8">
                        <Button
                          variant="outline"
                          onClick={step === 0 ? () => setToolMode(null) : () => setStep(s => s - 1)}
                          disabled={false}
                          className="gap-2"
                        >
                          <ArrowLeft className="w-4 h-4" />
                          {step === 0 ? 'Início' : 'Voltar'}
                        </Button>
                        {step === 2 || step === 3 ? (
                          <Button onClick={startProcessing} className="gap-2">
                            Processar <ArrowRight className="w-4 h-4" />
                          </Button>
                        ) : (
                          <Button onClick={() => setStep(s => s + 1)} disabled={!canNext()} className="gap-2">
                            Próximo <ArrowRight className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            )}

            {/* ── Match Inteligente ── */}
            {toolMode === 'match' && (
              <motion.div key="match" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <MatchPlanilhas onBack={() => setToolMode(null)} />
              </motion.div>
            )}

            {/* ── Auditoria de Exportação ── */}
            {toolMode === 'audit' && (
              <motion.div key="audit" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <AuditValidation onBack={() => setToolMode(null)} />
              </motion.div>
            )}

            {/* ── Extrator de Unidades ── */}
            {toolMode === 'units' && (
              <motion.div key="units" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <ExtractorUnidades onBack={() => setToolMode(null)} />
              </motion.div>
            )}

            {/* ── Separador de Código de Barras ── */}
            {toolMode === 'barsep' && (
              <motion.div key="barsep" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <SeparadorCodigoBarras onBack={() => setToolMode(null)} />
              </motion.div>
            )}

            {/* ── Limpador EAN + Descrição ── */}
            {toolMode === 'cleaner' && (
              <motion.div key="cleaner" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <LimpadorEAN onBack={() => setToolMode(null)} />
              </motion.div>
            )}

            {/* ── Filtrar por Tamanho do Código de Barras ── */}
            {toolMode === 'barfilter' && (
              <motion.div key="barfilter" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <FiltradorTamanhoEAN onBack={() => setToolMode(null)} />
              </motion.div>
            )}

            {/* ── Validador de NCM ── */}
            {toolMode === 'ncmvalidator' && (
              <motion.div key="ncmvalidator" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <ValidadorNCM onBack={() => setToolMode(null)} />
              </motion.div>
            )}

          </AnimatePresence>
        </Suspense>
      </main>
    </div>
  );
}
