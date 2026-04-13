import { useCallback, useRef } from 'react';
import { Upload, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { motion } from 'framer-motion';
import * as XLSX from 'xlsx';
import { LoadedSpreadsheetData, SpreadsheetRow } from '@/lib/converter-types';

interface StepUploadProps {
  onFileLoaded: (data: LoadedSpreadsheetData) => void;
  fileInfo: { fileName: string; headers: string[]; rowCount: number } | null;
}

export function StepUpload({ onFileLoaded, fileInfo }: StepUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target?.result as ArrayBuffer);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<SpreadsheetRow>(sheet, { header: 1 });

      // Remover apenas trailing empty cells (sem modificar colunas)
      let cleanedJson = json.map((row) => {
        if (!Array.isArray(row)) return row;
        while (row.length > 0 && (row[row.length - 1] === undefined || row[row.length - 1] === null || row[row.length - 1] === '')) {
          row.pop();
        }
        return row;
      });

      // IMPORTANTE: Normalizar arrays para preencher "holes" (colunas vazias no meio)
      // O SheetJS deixa holes em vez de strings vazias quando há colunas vazias no meio
      const maxCols = Math.max(...cleanedJson.map((r) => (Array.isArray(r) ? r.length : 0)), 0);
      cleanedJson = cleanedJson.map((row) => {
        if (!Array.isArray(row)) return row;
        const normalized: SpreadsheetRow = new Array(maxCols);
        for (let i = 0; i < maxCols; i++) {
          normalized[i] = (i < row.length && row[i] !== undefined && row[i] !== null) ? row[i] : '';
        }
        return normalized;
      });

      const headers = (cleanedJson[0] || []).map(String);
      const rows = cleanedJson.slice(1);

      onFileLoaded({ fileName: file.name, headers, rows, rawData: cleanedJson });
    };
    reader.readAsArrayBuffer(file);
  }, [onFileLoaded]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
      <Card
        className="border-2 border-dashed border-primary/30 bg-card p-12 flex flex-col items-center gap-6 cursor-pointer hover:border-primary/60 transition-colors"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center">
          <Upload className="w-10 h-10 text-primary" />
        </div>
        <div className="text-center">
          <p className="text-lg font-heading font-semibold text-foreground">
            Arraste sua planilha aqui
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            ou clique para selecionar (.xlsx, .csv)
          </p>
        </div>
      </Card>

      {fileInfo && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-6">
          <Card className="bg-card p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-success/10 flex items-center justify-center">
                <FileSpreadsheet className="w-6 h-6 text-success" />
              </div>
              <div className="flex-1">
                <p className="font-heading font-semibold text-foreground">{fileInfo.fileName}</p>
                <p className="text-sm text-muted-foreground">
                  {fileInfo.rowCount.toLocaleString('pt-BR')} linhas • {fileInfo.headers.length} colunas
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {fileInfo.headers.map((h, i) => (
                <span key={i} className="px-2.5 py-1 text-xs font-medium rounded-md bg-secondary text-secondary-foreground">
                  {h}
                </span>
              ))}
            </div>
          </Card>
        </motion.div>
      )}
    </motion.div>
  );
}
