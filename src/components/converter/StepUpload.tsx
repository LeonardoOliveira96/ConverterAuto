import { useCallback, useRef, useState } from 'react';
import { Upload, FileSpreadsheet, Scissors, Download, CheckCircle2, Barcode, ScanLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { motion } from 'framer-motion';
import * as XLSX from 'xlsx';
import { LoadedSpreadsheetData, SpreadsheetRow } from '@/lib/converter-types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

// ─── Extração de unidade (apenas no final da string) ─────────────────────────
// Unidades válidas em ordem do mais específico para o menos específico
const VALID_UNITS = ['UN', 'KG', 'LT', 'ML', 'CX', 'PC', 'FD', 'SC', 'CA', 'CJ', 'JG', 'LA', 'BJ', 'M2', 'MT', 'CT', 'BI', 'FA', 'VL', 'KT', 'JO', 'PR', 'DP', 'RO', 'M'] as const;
type ValidUnit = typeof VALID_UNITS[number];

// Conjunto amplo para o fallback — captura unidades grudadas em letras
// Ex: "SUAUN" → "UN", "SEPA" → "PA", "ACAI FR" → "FR", "MEGATRONM2" → "M2"
const FALLBACK_UNITS = new Set([
  'UN', 'KG', 'LT', 'ML', 'CX', 'PC', 'FD', 'SC',
  'PA', 'FR', 'PT', 'VD', 'DZ', 'BD', 'RL', 'MT',
  'CA', 'CJ', 'JG', 'LA', 'BJ', 'M2',
  'CT', 'BI', 'FA', 'VL', 'KT', 'JO', 'PR', 'DP', 'RO',
]);

// Números soltos no final — ex: "UN    4    0" → remove "    4    0"
// Também cobre negativos: "UN    -7" → remove "    -7"
const _RX_TRAIL_NUMS = /(\s+-?\d+)+\s*$/

// Detecta EAN (8–14 dígitos) no início da célula seguido de texto — usado pelo Limpador EAN+Descrição
const _RX_BARCODE_SPLIT = /^(\d{8,14})\s+([\s\S]+)/

// Regex: captura unidade no final do texto
// Padrão 1: espaço + unidade no final → "PRODUTO 4X200 UN"
// Padrão 2: dígito colado na unidade no final → "KISS 48UN"
// Usa \b para garantir que não seja parte de uma palavra maior
const _RX_UNIT_END = new RegExp(
  `(?:(?<=\\s)|(?<=\\d))(${VALID_UNITS.join('|')})\\s*$`,
  'i'
);

/**
 * Extrai a unidade do FINAL da string e retorna { unit, cleaned }.
 * Retorna null se não encontrar unidade válida no final.
 *
 * Exemplos:
 *   "ABRACADEIRA NYLON 4X200 UN"  → { unit: "UN", cleaned: "ABRACADEIRA NYLON 4X200" }
 *   "ABA ADESIVA KISS 48UN"       → { unit: "UN", cleaned: "ABA ADESIVA KISS 48" }
 *   "ALGUM PRODUTO FUN"           → null  (FUN não é unidade)
 */
function extractUnit(raw: string): { unit: ValidUnit; cleaned: string } | null {
  const match = _RX_UNIT_END.exec(raw);
  if (!match) return null;

  const unit = match[1].toUpperCase() as ValidUnit;
  // Remove a unidade encontrada + espaços ao redor no final
  const cleaned = raw.slice(0, match.index).trimEnd();
  return { unit, cleaned };
}

/**
 * Fallback: pega os 2 últimos caracteres (após trimEnd) e verifica se formam
 * uma unidade conhecida do conjunto ampliado.
 *
 * Captura casos onde a unidade está grudada em letras:
 *   "SUAUN"    → "UN"
 *   "SEPA"     → "PA"
 *   "15G   PA" → "PA"  (trimEnd remove os espaços internos não, mas last2 = "PA")
 *
 * SÓ é chamado quando a extração normal falhou E a coluna de destino está vazia.
 */
function extractUnitFallback(raw: string): { unit: string; cleaned: string } | null {
  const trimmed = raw.trimEnd(); // remove espaços/padding no final
  if (trimmed.length < 3) return null;

  const last2 = trimmed.slice(-2).toUpperCase();
  if (!FALLBACK_UNITS.has(last2)) return null;

  const cleaned = trimmed.slice(0, -2).trimEnd();
  return { unit: last2, cleaned };
}

interface StepUploadProps {
  onFileLoaded: (data: LoadedSpreadsheetData) => void;
  fileInfo: { fileName: string; headers: string[]; rowCount: number } | null;
}

export function StepUpload({ onFileLoaded, fileInfo }: StepUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Estado do extrator de unidades
  const [unitRows, setUnitRows] = useState<SpreadsheetRow[] | null>(null);
  const [unitHeaders, setUnitHeaders] = useState<string[]>([]);
  const [unitFileName, setUnitFileName] = useState('');
  const [unitSourceCol, setUnitSourceCol] = useState('');
  const [unitDestCol, setUnitDestCol] = useState('');
  const [unitResult, setUnitResult] = useState<{
    extracted: number;
    skipped: number;
    unchanged: number;
  } | null>(null);
  const [unitProcessedRows, setUnitProcessedRows] = useState<SpreadsheetRow[] | null>(null);
  const unitInputRef = useRef<HTMLInputElement>(null);

  // Estado do separador de código de barras
  const [sepRows, setSepRows] = useState<SpreadsheetRow[] | null>(null);
  const [sepHeaders, setSepHeaders] = useState<string[]>([]);
  const [sepFileName, setSepFileName] = useState('');
  const [sepInputCol, setSepInputCol] = useState('');    // col que tem "EAN Produto" ou só "Produto"
  const [sepEanCol, setSepEanCol] = useState('');        // col destino do EAN
  const [sepProductCol, setSepProductCol] = useState(''); // col destino do produto
  const [sepResult, setSepResult] = useState<{ withEan: number; noEan: number } | null>(null);
  const [sepProcessedRows, setSepProcessedRows] = useState<SpreadsheetRow[] | null>(null);
  const sepInputRef = useRef<HTMLInputElement>(null);

  // Estado do limpador EAN+Descrição (2 colunas)
  const [cleanRows, setCleanRows] = useState<SpreadsheetRow[] | null>(null);
  const [cleanHeaders, setCleanHeaders] = useState<string[]>([]);
  const [cleanFileName, setCleanFileName] = useState('');
  const [cleanSourceCol, setCleanSourceCol] = useState(''); // col que tem "EAN Descrição" misturado
  const [cleanDestCol, setCleanDestCol] = useState('');     // col destino da descrição limpa
  const [cleanResult, setCleanResult] = useState<{ separated: number; plain: number; skipped: number } | null>(null);
  const [cleanProcessedRows, setCleanProcessedRows] = useState<SpreadsheetRow[] | null>(null);
  const cleanInputRef = useRef<HTMLInputElement>(null);

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

  // ─── Extrator de unidades ───────────────────────────────────────────────────

  const handleUnitFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target?.result as ArrayBuffer);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<SpreadsheetRow>(sheet, { header: 1 });

      const maxCols = Math.max(...json.map((r) => (Array.isArray(r) ? r.length : 0)), 0);
      const normalized = json.map((row) => {
        if (!Array.isArray(row)) return row as SpreadsheetRow;
        const r: SpreadsheetRow = new Array(maxCols);
        for (let i = 0; i < maxCols; i++) {
          r[i] = (i < row.length && row[i] !== undefined && row[i] !== null) ? row[i] : '';
        }
        return r;
      });

      setUnitFileName(file.name);
      setUnitHeaders((normalized[0] || []).map(String));
      setUnitRows(normalized.slice(1) as SpreadsheetRow[]);
      setUnitSourceCol('');
      setUnitDestCol('');
      setUnitResult(null);
      setUnitProcessedRows(null);
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const handleExtractUnits = useCallback(() => {
    if (!unitRows || unitSourceCol === '' || unitDestCol === '') return;

    const srcIdx = parseInt(unitSourceCol);
    const dstIdx = parseInt(unitDestCol);
    let extracted = 0, skipped = 0, unchanged = 0;

    const processed = unitRows.map((row) => {
      const newRow = [...row] as SpreadsheetRow;
      // Garantir que a coluna de destino existe
      while (newRow.length <= Math.max(srcIdx, dstIdx)) newRow.push('');

      const srcVal = String(newRow[srcIdx] ?? '').trim();
      if (!srcVal) { unchanged++; return newRow; }

      // Remove números soltos no final (ex: "UN    4    0" → "UN")
      const stripped = srcVal.replace(_RX_TRAIL_NUMS, '').trimEnd();

      // Se destino já tem valor, não sobrescrever (mas apaga números soltos)
      const dstVal = String(newRow[dstIdx] ?? '').trim();
      if (dstVal !== '') {
        if (stripped !== srcVal) newRow[srcIdx] = stripped;
        skipped++;
        return newRow;
      }

      const result = extractUnit(stripped) ?? extractUnitFallback(stripped);
      if (!result) {
        // Sem unidade encontrada, mas apaga números soltos se houver
        if (stripped !== srcVal) newRow[srcIdx] = stripped;
        unchanged++;
        return newRow;
      }

      // Atualiza descrição (sem a unidade no final) e preenche destino
      newRow[srcIdx] = result.cleaned;
      newRow[dstIdx] = result.unit;
      extracted++;
      return newRow;
    });

    setUnitProcessedRows(processed);
    setUnitResult({ extracted, skipped, unchanged });
  }, [unitRows, unitSourceCol, unitDestCol]);

  const handleDownloadUnit = useCallback(() => {
    if (!unitProcessedRows || !unitHeaders) return;

    // Converter todos os valores para string antes de gravar no Excel.
    // Sem isso, células numéricas (ex: códigos de barras) ficam como número
    // e o Excel exibe em notação científica (ex: 7,90865E+12).
    const wsData: string[][] = [
      unitHeaders,
      ...unitProcessedRows.map(row =>
        Array.from({ length: Math.max(row.length, unitHeaders.length) }, (_, i) => {
          const v = row[i];
          return v === null || v === undefined ? '' : String(v);
        })
      ),
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Planilha');
    const baseName = unitFileName.replace(/\.[^.]+$/, '');
    XLSX.writeFile(wb, `${baseName}_unidades.xlsx`);
  }, [unitProcessedRows, unitHeaders, unitFileName]);

  // ─── Separador de código de barras ─────────────────────────────────────────
  // O usuário escolhe:
  //   - Coluna de entrada: tem "17896071030042  BISC MABEL..." ou só "BISC MABEL..."
  //   - Coluna EAN destino: onde gravar o EAN extraído
  //   - Coluna Produto destino: onde gravar só o nome do produto
  const handleSepFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target?.result as ArrayBuffer);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<SpreadsheetRow>(sheet, { header: 1 });

      const maxCols = Math.max(...(json as SpreadsheetRow[]).map((r) => (Array.isArray(r) ? r.length : 0)), 0);
      const normalized = (json as SpreadsheetRow[]).map((row) => {
        if (!Array.isArray(row)) return row as SpreadsheetRow;
        const r: SpreadsheetRow = new Array(maxCols);
        for (let i = 0; i < maxCols; i++) {
          r[i] = (i < row.length && row[i] !== undefined && row[i] !== null) ? row[i] : '';
        }
        return r;
      });

      setSepFileName(file.name);
      setSepHeaders((normalized[0] || []).map(String));
      setSepRows(normalized.slice(1) as SpreadsheetRow[]);
      setSepInputCol('');
      setSepEanCol('');
      setSepProductCol('');
      setSepResult(null);
      setSepProcessedRows(null);
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const handleSeparate = useCallback(() => {
    if (!sepRows || sepInputCol === '' || sepProductCol === '') return;

    const inputIdx = parseInt(sepInputCol);
    const prodIdx = parseInt(sepProductCol);
    const eanIdx = sepEanCol !== '' ? parseInt(sepEanCol) : -1;
    let withEan = 0, noEan = 0;

    const processed = sepRows.map((row): SpreadsheetRow => {
      const newRow = [...row] as SpreadsheetRow;
      while (newRow.length <= Math.max(inputIdx, prodIdx, eanIdx)) newRow.push('');

      const val = String(newRow[inputIdx] ?? '').trim();
      if (!val) return newRow;

      // Detecta EAN (7+ dígitos) no início, seguido de espaço e nome do produto
      const eanMatch = val.match(/^(\d{7,})\s+([\s\S]+)/);
      if (eanMatch) {
        if (eanIdx >= 0) newRow[eanIdx] = eanMatch[1];          // EAN → col EAN
        newRow[prodIdx] = eanMatch[2].trim();                   // Produto → col produto
        if (inputIdx !== prodIdx && inputIdx !== eanIdx) newRow[inputIdx] = ''; // limpa entrada
        withEan++;
      } else {
        // Sem EAN: ignora número PLU curto (<7 dígitos) se houver no início
        const pluMatch = val.match(/^\d{1,6}\s+([\s\S]+)/);
        newRow[prodIdx] = pluMatch ? pluMatch[1].trim() : val;  // Produto → col produto
        if (inputIdx !== prodIdx) newRow[inputIdx] = '';         // limpa entrada
        noEan++;
      }
      return newRow;
    });

    setSepProcessedRows(processed);
    setSepResult({ withEan, noEan });
  }, [sepRows, sepInputCol, sepEanCol, sepProductCol]);

  const handleDownloadSep = useCallback(() => {
    if (!sepProcessedRows || !sepHeaders) return;
    const eanIdx = sepEanCol !== '' ? parseInt(sepEanCol) : -1;

    const wsData: string[][] = [
      sepHeaders,
      ...sepProcessedRows.map(row =>
        Array.from({ length: Math.max(row.length, sepHeaders.length) }, (_, i) => {
          const v = row[i];
          return v === null || v === undefined ? '' : String(v);
        })
      ),
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    // Forçar coluna EAN como texto para evitar notação científica
    if (eanIdx >= 0) {
      const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
      for (let r = range.s.r + 1; r <= range.e.r; r++) {
        const cellAddr = XLSX.utils.encode_cell({ r, c: eanIdx });
        const cell = ws[cellAddr];
        if (cell && cell.v !== '') {
          cell.t = 's';
          cell.z = '@';
          delete cell.w;
        }
      }
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Planilha');
    const baseName = sepFileName.replace(/\.[^.]+$/, '');
    XLSX.writeFile(wb, `${baseName}_separado.xlsx`);
  }, [sepProcessedRows, sepHeaders, sepFileName, sepEanCol]);

  // ─── Limpador EAN + Descrição (2 colunas) ──────────────────────────────────
  // Regras determinísticas:
  //   - Início numérico (8–14 dígitos) → manter EAN na coluna original, gravar descrição na destino (se vazia)
  //   - Sem EAN → manter original inalterado, gravar texto completo na destino (se vazia)
  //   - Nunca sobrescrever coluna destino que já tem valor

  const handleCleanFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target?.result as ArrayBuffer);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<SpreadsheetRow>(sheet, { header: 1 });

      const maxCols = Math.max(...(json as SpreadsheetRow[]).map((r) => (Array.isArray(r) ? r.length : 0)), 0);
      const normalized = (json as SpreadsheetRow[]).map((row) => {
        if (!Array.isArray(row)) return row as SpreadsheetRow;
        const r: SpreadsheetRow = new Array(maxCols);
        for (let i = 0; i < maxCols; i++) {
          r[i] = (i < row.length && row[i] !== undefined && row[i] !== null) ? row[i] : '';
        }
        return r;
      });

      setCleanFileName(file.name);
      setCleanHeaders((normalized[0] || []).map(String));
      setCleanRows(normalized.slice(1) as SpreadsheetRow[]);
      setCleanSourceCol('');
      setCleanDestCol('');
      setCleanResult(null);
      setCleanProcessedRows(null);
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const handleCleanProcess = useCallback(() => {
    if (!cleanRows || cleanSourceCol === '' || cleanDestCol === '') return;

    const srcIdx = parseInt(cleanSourceCol);
    const dstIdx = parseInt(cleanDestCol);
    let separated = 0, plain = 0, skipped = 0;

    const processed = cleanRows.map((row): SpreadsheetRow => {
      const newRow = [...row] as SpreadsheetRow;
      while (newRow.length <= Math.max(srcIdx, dstIdx)) newRow.push('');

      const srcVal = String(newRow[srcIdx] ?? '').trim();
      if (!srcVal) return newRow;

      const dstVal = String(newRow[dstIdx] ?? '').trim();

      const match = _RX_BARCODE_SPLIT.exec(srcVal);
      if (match) {
        // Começa com 8–14 dígitos seguido de texto
        const barcode = match[1];
        const description = match[2].replace(/\s+/g, ' ').trim();
        // Coluna original → só o código de barras
        newRow[srcIdx] = barcode;
        // Coluna destino → descrição limpa (somente se vazia)
        if (dstVal === '') {
          newRow[dstIdx] = description;
          separated++;
        } else {
          skipped++;
        }
      } else {
        // Não começa com barcode → original inalterado
        // Coluna destino → texto completo (somente se vazia)
        if (dstVal === '') {
          newRow[dstIdx] = srcVal.replace(/\s+/g, ' ').trim();
          plain++;
        } else {
          skipped++;
        }
      }
      return newRow;
    });

    setCleanProcessedRows(processed);
    setCleanResult({ separated, plain, skipped });
  }, [cleanRows, cleanSourceCol, cleanDestCol]);

  const handleDownloadClean = useCallback(() => {
    if (!cleanProcessedRows || !cleanHeaders) return;

    const srcIdx = parseInt(cleanSourceCol);
    const wsData: string[][] = [
      cleanHeaders,
      ...cleanProcessedRows.map(row =>
        Array.from({ length: Math.max(row.length, cleanHeaders.length) }, (_, i) => {
          const v = row[i];
          return v === null || v === undefined ? '' : String(v);
        })
      ),
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    // Forçar coluna do EAN (fonte) como texto para evitar notação científica
    if (srcIdx >= 0) {
      const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
      for (let r = range.s.r + 1; r <= range.e.r; r++) {
        const cellAddr = XLSX.utils.encode_cell({ r, c: srcIdx });
        const cell = ws[cellAddr];
        if (cell && cell.v !== '') {
          cell.t = 's';
          cell.z = '@';
          delete cell.w;
        }
      }
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Planilha');
    const baseName = cleanFileName.replace(/\.[^.]+$/, '');
    XLSX.writeFile(wb, `${baseName}_limpo.xlsx`);
  }, [cleanProcessedRows, cleanHeaders, cleanFileName, cleanSourceCol]);

  return (
    <div className="space-y-6">
      {/* ─── Upload principal ──────────────────────────────────────────────── */}
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

      {/* ─── Extrator de Unidades ──────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <Card className="p-6 border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/30">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-lg bg-violet-100 dark:bg-violet-900/50 flex items-center justify-center shrink-0">
              <Scissors className="w-5 h-5 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <p className="font-semibold text-sm text-foreground">Extrator de Unidades</p>
              <p className="text-xs text-muted-foreground">
                Extrai unidades do final da descrição (UN, KG, LT, ML, CX, PC, FD, SC)
              </p>
            </div>
          </div>

          {/* Área de upload do extrator */}
          {!unitRows ? (
            <div
              className="border-2 border-dashed border-violet-300 dark:border-violet-700 rounded-lg p-6 flex flex-col items-center gap-3 cursor-pointer hover:border-violet-500 dark:hover:border-violet-500 transition-colors"
              onClick={() => unitInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file) handleUnitFile(file);
              }}
            >
              <input
                ref={unitInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUnitFile(file);
                  e.target.value = '';
                }}
              />
              <Upload className="w-7 h-7 text-violet-400" />
              <p className="text-sm text-violet-700 dark:text-violet-300 font-medium">
                Arraste ou clique para carregar a planilha
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Info do arquivo */}
              <div className="flex items-center gap-3 p-3 rounded-lg bg-violet-100/60 dark:bg-violet-900/30">
                <FileSpreadsheet className="w-5 h-5 text-violet-600 dark:text-violet-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{unitFileName}</p>
                  <p className="text-xs text-muted-foreground">{unitRows.length.toLocaleString('pt-BR')} linhas • {unitHeaders.length} colunas</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-violet-600 hover:text-violet-800 dark:text-violet-400 shrink-0"
                  onClick={() => {
                    setUnitRows(null);
                    setUnitHeaders([]);
                    setUnitFileName('');
                    setUnitSourceCol('');
                    setUnitDestCol('');
                    setUnitResult(null);
                    setUnitProcessedRows(null);
                  }}
                >
                  Trocar arquivo
                </Button>
              </div>

              {/* Seleção de colunas */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    Coluna de origem <span className="text-muted-foreground">(descrição)</span>
                  </label>
                  <Select value={unitSourceCol} onValueChange={setUnitSourceCol}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Selecionar..." />
                    </SelectTrigger>
                    <SelectContent>
                      {unitHeaders.map((h, i) => (
                        <SelectItem key={i} value={String(i)}>
                          {h || `Coluna ${String.fromCharCode(65 + i)}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    Coluna de destino <span className="text-muted-foreground">(unidade)</span>
                  </label>
                  <Select value={unitDestCol} onValueChange={setUnitDestCol}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Selecionar..." />
                    </SelectTrigger>
                    <SelectContent>
                      {unitHeaders.map((h, i) => (
                        <SelectItem key={i} value={String(i)}>
                          {h || `Coluna ${String.fromCharCode(65 + i)}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Exemplos de como funciona */}
              <div className="p-3 rounded-lg bg-white/60 dark:bg-white/5 border border-violet-200 dark:border-violet-800 text-xs space-y-1">
                <p className="font-semibold text-violet-800 dark:text-violet-200 mb-1.5">Exemplos:</p>
                <div className="grid grid-cols-1 gap-1 font-mono text-[11px]">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">"ABRACADEIRA NYLON 4X200 UN"</span>
                    <span className="text-violet-500">→</span>
                    <span className="text-foreground">"ABRACADEIRA NYLON 4X200"</span>
                    <Badge variant="outline" className="text-[10px] py-0 border-violet-400 text-violet-700 dark:text-violet-300">UN</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">"ABA ADESIVA KISS 48UN"</span>
                    <span className="text-violet-500">→</span>
                    <span className="text-foreground">"ABA ADESIVA KISS 48"</span>
                    <Badge variant="outline" className="text-[10px] py-0 border-violet-400 text-violet-700 dark:text-violet-300">UN</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">"ALGUM PRODUTO FUN"</span>
                    <span className="text-red-400">→</span>
                    <span className="text-muted-foreground">sem alteração (FUN ≠ unidade)</span>
                  </div>
                </div>
              </div>

              {/* Resultado */}
              {unitResult && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="grid grid-cols-3 gap-2"
                >
                  <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-center">
                    <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">{unitResult.extracted}</p>
                    <p className="text-[10px] text-emerald-600 dark:text-emerald-500">Extraídas</p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-center">
                    <p className="text-lg font-bold text-amber-700 dark:text-amber-400">{unitResult.skipped}</p>
                    <p className="text-[10px] text-amber-600 dark:text-amber-500">Já tinham unidade</p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-muted/40 border text-center">
                    <p className="text-lg font-bold text-foreground">{unitResult.unchanged}</p>
                    <p className="text-[10px] text-muted-foreground">Sem unidade</p>
                  </div>
                </motion.div>
              )}

              {/* Ações */}
              <div className="flex gap-2">
                <Button
                  className="flex-1 gap-2 bg-violet-600 hover:bg-violet-700 text-white"
                  disabled={unitSourceCol === '' || unitDestCol === '' || unitSourceCol === unitDestCol}
                  onClick={handleExtractUnits}
                >
                  <Scissors className="w-4 h-4" />
                  Extrair Unidades
                </Button>
                {unitProcessedRows && (
                  <Button
                    variant="outline"
                    className="gap-2 border-violet-400 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/30"
                    onClick={handleDownloadUnit}
                  >
                    <Download className="w-4 h-4" />
                    Baixar planilha
                  </Button>
                )}
              </div>

              {unitResult && unitResult.extracted > 0 && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Processado! Clique em "Baixar planilha" para salvar o resultado.
                </p>
              )}
            </div>
          )}
        </Card>
      </motion.div>

      {/* ─── Separador de Código de Barras ──────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <Card className="p-6 border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-lg bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center shrink-0">
              <Barcode className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <p className="font-semibold text-sm text-foreground">Separador de Código de Barras</p>
              <p className="text-xs text-muted-foreground">
                Lê coluna com "EAN Produto" e separa: EAN → coluna EAN, Produto → coluna Produto
              </p>
            </div>
          </div>

          {!sepRows ? (
            <div
              className="border-2 border-dashed border-indigo-300 dark:border-indigo-700 rounded-lg p-6 flex flex-col items-center gap-3 cursor-pointer hover:border-indigo-500 dark:hover:border-indigo-500 transition-colors"
              onClick={() => sepInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file) handleSepFile(file);
              }}
            >
              <input
                ref={sepInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleSepFile(file);
                  e.target.value = '';
                }}
              />
              <Upload className="w-7 h-7 text-indigo-400" />
              <p className="text-sm text-indigo-700 dark:text-indigo-300 font-medium">
                Arraste ou clique para carregar a planilha
              </p>
              <p className="text-xs text-muted-foreground text-center">
                Você escolherá qual coluna tem os dados e onde gravar cada saída
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Info do arquivo */}
              <div className="flex items-center gap-3 p-3 rounded-lg bg-indigo-100/60 dark:bg-indigo-900/30">
                <FileSpreadsheet className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{sepFileName}</p>
                  <p className="text-xs text-muted-foreground">{sepRows.length.toLocaleString('pt-BR')} linhas • {sepHeaders.length} colunas</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 shrink-0"
                  onClick={() => {
                    setSepRows(null);
                    setSepHeaders([]);
                    setSepFileName('');
                    setSepInputCol('');
                    setSepEanCol('');
                    setSepProductCol('');
                    setSepResult(null);
                    setSepProcessedRows(null);
                  }}
                >
                  Trocar arquivo
                </Button>
              </div>

              {/* Seleção de colunas */}
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    Coluna de entrada
                    <span className="block text-muted-foreground font-normal">(tem EAN + produto ou só produto)</span>
                  </label>
                  <Select value={sepInputCol} onValueChange={setSepInputCol}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Selecionar..." />
                    </SelectTrigger>
                    <SelectContent>
                      {sepHeaders.map((h, i) => (
                        <SelectItem key={i} value={String(i)}>
                          {h || `Coluna ${String.fromCharCode(65 + i)}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    Coluna EAN (saída)
                    <span className="block text-muted-foreground font-normal">(onde gravar o código de barras)</span>
                  </label>
                  <Select value={sepEanCol} onValueChange={setSepEanCol}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Selecionar..." />
                    </SelectTrigger>
                    <SelectContent>
                      {sepHeaders.map((h, i) => (
                        <SelectItem key={i} value={String(i)}>
                          {h || `Coluna ${String.fromCharCode(65 + i)}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    Coluna Produto (saída)
                    <span className="block text-muted-foreground font-normal">(onde gravar só o nome)</span>
                  </label>
                  <Select value={sepProductCol} onValueChange={setSepProductCol}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Selecionar..." />
                    </SelectTrigger>
                    <SelectContent>
                      {sepHeaders.map((h, i) => (
                        <SelectItem key={i} value={String(i)}>
                          {h || `Coluna ${String.fromCharCode(65 + i)}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Exemplo visual */}
              <div className="p-3 rounded-lg bg-white/60 dark:bg-white/5 border border-indigo-200 dark:border-indigo-800 text-xs space-y-1.5">
                <p className="font-semibold text-indigo-800 dark:text-indigo-200 mb-1.5">Como funciona:</p>
                <div className="font-mono text-[11px] space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">"17896071030042  BISC MABEL CREAM..."</span>
                    <span className="text-indigo-400">→</span>
                    <span className="text-emerald-700 dark:text-emerald-400">EAN: 17896071030042 | Produto: BISC MABEL CREAM...</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">"CONECTOR P HASTE ATERRAMENTO..."</span>
                    <span className="text-indigo-400">→</span>
                    <span className="text-emerald-700 dark:text-emerald-400">EAN: (vazio) | Produto: CONECTOR P HASTE...</span>
                  </div>
                </div>
              </div>

              {/* Resultado */}
              {sepResult && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="grid grid-cols-2 gap-2"
                >
                  <div className="p-2.5 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 border border-indigo-200 dark:border-indigo-800 text-center">
                    <p className="text-lg font-bold text-indigo-700 dark:text-indigo-300">{sepResult.withEan}</p>
                    <p className="text-[10px] text-indigo-600 dark:text-indigo-500">Com EAN extraído</p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-center">
                    <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">{sepResult.noEan}</p>
                    <p className="text-[10px] text-emerald-600 dark:text-emerald-500">Só produto (sem EAN)</p>
                  </div>
                </motion.div>
              )}

              {/* Ações */}
              <div className="flex gap-2">
                <Button
                  className="flex-1 gap-2 bg-indigo-600 hover:bg-indigo-700 text-white"
                  disabled={sepInputCol === '' || sepProductCol === ''}
                  onClick={handleSeparate}
                >
                  <Barcode className="w-4 h-4" />
                  Separar / Normalizar
                </Button>
                {sepProcessedRows && (
                  <Button
                    variant="outline"
                    className="gap-2 border-indigo-400 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/30"
                    onClick={handleDownloadSep}
                  >
                    <Download className="w-4 h-4" />
                    Baixar planilha
                  </Button>
                )}
              </div>

              {sepResult && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Processado! Clique em "Baixar planilha" para salvar.
                </p>
              )}
            </div>
          )}
        </Card>
      </motion.div>

      {/* ─── Limpador EAN + Descrição ────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
        <Card className="p-6 border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/30">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-lg bg-teal-100 dark:bg-teal-900/50 flex items-center justify-center shrink-0">
              <ScanLine className="w-5 h-5 text-teal-600 dark:text-teal-400" />
            </div>
            <div>
              <p className="font-semibold text-sm text-foreground">Limpador EAN + Descrição</p>
              <p className="text-xs text-muted-foreground">
                Separa código de barras (8–14 dígitos) da descrição em uma única coluna
              </p>
            </div>
          </div>

          {!cleanRows ? (
            <div
              className="border-2 border-dashed border-teal-300 dark:border-teal-700 rounded-lg p-6 flex flex-col items-center gap-3 cursor-pointer hover:border-teal-500 dark:hover:border-teal-500 transition-colors"
              onClick={() => cleanInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file) handleCleanFile(file);
              }}
            >
              <input
                ref={cleanInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleCleanFile(file);
                  e.target.value = '';
                }}
              />
              <Upload className="w-7 h-7 text-teal-400" />
              <p className="text-sm text-teal-700 dark:text-teal-300 font-medium">
                Arraste ou clique para carregar a planilha
              </p>
              <p className="text-xs text-muted-foreground text-center">
                Escolha a coluna de entrada e a coluna onde gravar a descrição limpa
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Info do arquivo */}
              <div className="flex items-center gap-3 p-3 rounded-lg bg-teal-100/60 dark:bg-teal-900/30">
                <FileSpreadsheet className="w-5 h-5 text-teal-600 dark:text-teal-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{cleanFileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {cleanRows.length.toLocaleString('pt-BR')} linhas • {cleanHeaders.length} colunas
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-teal-600 hover:text-teal-800 dark:text-teal-400 shrink-0"
                  onClick={() => {
                    setCleanRows(null);
                    setCleanHeaders([]);
                    setCleanFileName('');
                    setCleanSourceCol('');
                    setCleanDestCol('');
                    setCleanResult(null);
                    setCleanProcessedRows(null);
                  }}
                >
                  Trocar arquivo
                </Button>
              </div>

              {/* Seleção de colunas */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    Coluna de entrada
                    <span className="block text-muted-foreground font-normal">(ex: "Cód.Bar." — tem EAN + descrição misturado)</span>
                  </label>
                  <Select value={cleanSourceCol} onValueChange={setCleanSourceCol}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Selecionar..." />
                    </SelectTrigger>
                    <SelectContent>
                      {cleanHeaders.map((h, i) => (
                        <SelectItem key={i} value={String(i)}>
                          {h || `Coluna ${String.fromCharCode(65 + i)}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    Coluna de destino
                    <span className="block text-muted-foreground font-normal">(onde gravar a descrição — não sobrescreve se já preenchida)</span>
                  </label>
                  <Select value={cleanDestCol} onValueChange={setCleanDestCol}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Selecionar..." />
                    </SelectTrigger>
                    <SelectContent>
                      {cleanHeaders.map((h, i) => (
                        <SelectItem key={i} value={String(i)}>
                          {h || `Coluna ${String.fromCharCode(65 + i)}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Exemplo visual */}
              <div className="p-3 rounded-lg bg-white/60 dark:bg-white/5 border border-teal-200 dark:border-teal-800 text-xs space-y-1.5">
                <p className="font-semibold text-teal-800 dark:text-teal-200 mb-1.5">Como funciona:</p>
                <div className="font-mono text-[11px] space-y-1.5">
                  <div className="space-y-0.5">
                    <p className="text-muted-foreground">"17896071030042  BISC MABEL CREAM CRACKER 600G UN"</p>
                    <div className="flex gap-3 pl-2">
                      <span className="text-teal-500">→</span>
                      <span>
                        <span className="text-foreground">Col. original: </span>
                        <span className="text-emerald-700 dark:text-emerald-400">"17896071030042"</span>
                      </span>
                      <span>
                        <span className="text-foreground">Col. destino: </span>
                        <span className="text-emerald-700 dark:text-emerald-400">"BISC MABEL CREAM CRACKER 600G UN"</span>
                      </span>
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-muted-foreground">"CONECTOR P HASTE ATERRAMENTO GRA UN"</p>
                    <div className="flex gap-3 pl-2">
                      <span className="text-teal-500">→</span>
                      <span>
                        <span className="text-foreground">Col. original: </span>
                        <span className="text-muted-foreground">permanece igual</span>
                      </span>
                      <span>
                        <span className="text-foreground">Col. destino: </span>
                        <span className="text-emerald-700 dark:text-emerald-400">"CONECTOR P HASTE ATERRAMENTO GRA UN"</span>
                      </span>
                    </div>
                  </div>
                  <p className="text-amber-600 dark:text-amber-400 mt-1">
                    ⚠ Coluna destino só é preenchida se estiver <strong>vazia</strong>
                  </p>
                </div>
              </div>

              {/* Resultado */}
              {cleanResult && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="grid grid-cols-3 gap-2"
                >
                  <div className="p-2.5 rounded-lg bg-teal-100 dark:bg-teal-900/40 border border-teal-200 dark:border-teal-800 text-center">
                    <p className="text-lg font-bold text-teal-700 dark:text-teal-300">{cleanResult.separated}</p>
                    <p className="text-[10px] text-teal-600 dark:text-teal-500">EAN separado</p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-center">
                    <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">{cleanResult.plain}</p>
                    <p className="text-[10px] text-emerald-600 dark:text-emerald-500">Só descrição</p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-center">
                    <p className="text-lg font-bold text-amber-700 dark:text-amber-400">{cleanResult.skipped}</p>
                    <p className="text-[10px] text-amber-600 dark:text-amber-500">Destino já preenchido</p>
                  </div>
                </motion.div>
              )}

              {/* Ações */}
              <div className="flex gap-2">
                <Button
                  className="flex-1 gap-2 bg-teal-600 hover:bg-teal-700 text-white"
                  disabled={cleanSourceCol === '' || cleanDestCol === '' || cleanSourceCol === cleanDestCol}
                  onClick={handleCleanProcess}
                >
                  <ScanLine className="w-4 h-4" />
                  Separar EAN e Descrição
                </Button>
                {cleanProcessedRows && (
                  <Button
                    variant="outline"
                    className="gap-2 border-teal-400 text-teal-700 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-900/30"
                    onClick={handleDownloadClean}
                  >
                    <Download className="w-4 h-4" />
                    Baixar planilha
                  </Button>
                )}
              </div>

              {cleanResult && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Processado! Clique em "Baixar planilha" para salvar.
                </p>
              )}
            </div>
          )}
        </Card>
      </motion.div>
    </div>
  );
}
