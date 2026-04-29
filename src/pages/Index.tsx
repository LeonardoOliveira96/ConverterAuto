import { useState, useCallback } from 'react';
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
import { BackupHistory } from '@/components/converter/BackupHistory';
import { MatchPlanilhas } from '@/components/converter/MatchPlanilhas';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowLeft, ArrowRight, History, FileSpreadsheet, Barcode } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

type ToolMode = null | 'converter' | 'match';

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
                  {toolMode === 'converter' ? 'Conversor ERP' : 'Match Inteligente'}
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Card: Conversor ERP */}
                <Card
                  onClick={() => setToolMode('converter')}
                  className="p-8 cursor-pointer transition-all duration-200 hover:shadow-lg hover:bg-secondary/50 group"
                >
                  <div className="w-16 h-16 rounded-2xl bg-secondary text-secondary-foreground flex items-center justify-center mb-4 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                    <FileSpreadsheet className="w-8 h-8" />
                  </div>
                  <h3 className="font-heading font-semibold text-lg text-foreground">
                    Conversor de Planilhas ERP
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Converta e normalize planilhas de produtos, clientes e fornecedores para o formato ERP
                  </p>
                </Card>

                {/* Card: Match Inteligente */}
                <Card
                  onClick={() => setToolMode('match')}
                  className="p-8 cursor-pointer transition-all duration-200 hover:shadow-lg hover:bg-secondary/50 group"
                >
                  <div className="w-16 h-16 rounded-2xl bg-secondary text-secondary-foreground flex items-center justify-center mb-4 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                    <Barcode className="w-8 h-8" />
                  </div>
                  <h3 className="font-heading font-semibold text-lg text-foreground">
                    Match Inteligente de Planilhas
                    <span className="block text-xs font-normal text-muted-foreground mt-0.5">
                      Código de Barras
                    </span>
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Associe automaticamente códigos de barras (EAN) de uma planilha base para outra usando correspondência inteligente por descrição
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

        </AnimatePresence>
      </main>
    </div>
  );
}
