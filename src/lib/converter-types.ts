import { SheetType } from './erp-fields';

/** Valor de célula bruto retornado pelo SheetJS (`sheet_to_json` com `header: 1`). */
export type SpreadsheetCell = string | number | boolean | Date | null | undefined;
export type SpreadsheetRow = SpreadsheetCell[];

export interface LoadedSpreadsheetData {
  fileName: string;
  headers: string[];
  rows: SpreadsheetRow[];
  rawData: SpreadsheetRow[];
}

export interface BackupEntry {
  id: string;
  fileName: string;
  date: string;
  type: SheetType;
  rowCount: number;
  data: SpreadsheetRow[];
}

export interface ValidationError {
  row: number;
  field: string;
  message: string;
}

export interface RemovedRowLog {
  sheetRow: number;         // número da linha na planilha original (2-based)
  reason: string;           // motivo da remoção
  originalData: string[];   // valores da linha na ordem dos campos ERP mapeados
  fieldNames: string[];     // nomes dos campos correspondentes
}

export interface CleanedFieldLog {
  sheetRow: number;
  field: string;
  before: string;
  after: string;
}

export interface ProcessingResult {
  totalRows: number;
  processedRows: number;
  removedRows: number;
  errors: ValidationError[];
  charsRemoved: number;
  charTypes: Record<string, number>;
  removedRowsLog: RemovedRowLog[];
  cleanedFieldsLog: CleanedFieldLog[];
}

export interface CleaningOptions {
  removeEmptyDescription: boolean;
  removeEmptyRequired: boolean;
  removeSpecialChars: boolean;
  normalizeText: boolean;
  ignoreUnmapped: boolean;
  removeSefazXmlChars?: boolean;
}

/** Por linha da planilha (nº da linha no Excel), texto final da descrição quando editado no modal. */
export type ShortDescriptionEdits = Record<string, string>;
