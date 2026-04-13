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
import { StepColumnMapping } from '@/components/converter/StepColumnMapping';
import { StepDataEditor } from '@/components/converter/StepDataEditor';
import { StepValidation } from '@/components/converter/StepValidation';
import { StepProcessing } from '@/components/converter/StepProcessing';
import { StepResult } from '@/components/converter/StepResult';
import { BackupHistory } from '@/components/converter/BackupHistory';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight, History } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

export default function Index() {
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
    removeEmptyDescription: true,
    removeEmptyRequired: true,
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
    setResult(res);
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
    if (step === 2) return Object.keys(mapping).length > 0;
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
            <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-heading font-bold text-sm">ERP</span>
            </div>
            <h1 className="font-heading font-bold text-lg text-foreground">
              Conversor Inteligente de Planilhas
            </h1>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowBackups(!showBackups)} className="gap-2">
            <History className="w-4 h-4" />
            Backups
            {backups.length > 0 && (
              <span className="ml-1 w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center font-bold">
                {backups.length}
              </span>
            )}
          </Button>
        </div>
      </header>

      <main className="container max-w-5xl py-8">
        <AnimatePresence mode="wait">
          {showBackups ? (
            <motion.div key="backups" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="flex items-center justify-between mb-6">
                <h2 className="font-heading text-xl font-bold text-foreground">Histórico de Backups</h2>
                <Button variant="ghost" size="sm" onClick={() => setShowBackups(false)}>Voltar</Button>
              </div>
              <BackupHistory backups={backups} onRestore={handleRestore} />
            </motion.div>
          ) : (
            <motion.div key="main" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {step < 5 && <StepperHeader currentStep={step} />}

              {step === 0 && <StepUpload onFileLoaded={handleFileLoaded} fileInfo={fileInfo} />}
              {step === 1 && <StepTypeSelection selected={sheetType} onSelect={setSheetType} />}
              {step === 2 && sheetType && (
                <div className="space-y-6">
                  <StepDataEditor
                    headers={headers}
                    rows={rows}
                    onRowsChange={setRows}
                    onHeadersChange={setHeaders}
                  />
                  <StepColumnMapping
                    sheetType={sheetType}
                    sourceColumns={headers}
                    mapping={mapping}
                    onMappingChange={setMapping}
                  />
                </div>
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
                  onCancel={() => setStep(3)}
                />
              )}
              {step === 5 && result && (
                <StepResult
                  result={result}
                  processedData={processedData}
                  fileName={fileName}
                  onReset={reset}
                />
              )}

              {/* Navigation */}
              {step < 4 && (
                <div className="flex justify-between mt-8">
                  <Button
                    variant="outline"
                    onClick={() => setStep(s => s - 1)}
                    disabled={step === 0}
                    className="gap-2"
                  >
                    <ArrowLeft className="w-4 h-4" /> Voltar
                  </Button>
                  {step === 3 ? (
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
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
