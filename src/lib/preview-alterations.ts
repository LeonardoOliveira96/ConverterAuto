/** Chave estável para identificar uma alteração na prévia (remove/limpeza por linha+campo). */
export type AlterationKey = string;

export function buildRemoveKey(sheetRow: number, field: string): AlterationKey {
  return `remove:${sheetRow}:${field}`;
}

export function buildCleanKey(sheetRow: number, field: string): AlterationKey {
  return `clean:${sheetRow}:${field}`;
}

export function buildShortDescKey(sheetRow: number): AlterationKey {
  return `shortdesc:${sheetRow}`;
}

const CODE_RELATED_FIELDS = new Set([
  'Código interno',
  'Código pai da grade',
  'Código de Barras',
  'Código NCM',
  'CST A',
  'CEST',
  'CFOP',
  'Código Cliente',
]);

export function isCodeRelatedField(fieldName: string): boolean {
  if (CODE_RELATED_FIELDS.has(fieldName)) return true;
  const lower = fieldName.toLowerCase();
  return (
    lower.includes('código') ||
    lower.includes('codigo') ||
    lower.includes('cest') ||
    lower.includes('ncm')
  );
}

export interface CharCategory {
  char: string;
  label: string;
}

/** Classifica caracteres que o conversor trata como “especiais” (mesma regra de remoção). */
export function categorizeSpecialCharsInString(value: string): CharCategory[] {
  const allowed = /[\w\s.,;:\-()@]/; // / \ | são agora considerados especiais
  const seen = new Map<string, CharCategory>();

  for (const c of value) {
    if (allowed.test(c)) continue;
    if (seen.has(c)) continue;

    let label = 'símbolo';
    const cp = c.codePointAt(0) ?? 0;
    if (cp >= 0x1f300 && cp <= 0x1faf0) label = 'emoji';
    else if (/[\u2000-\u206f\u2e00-\u2e7f]/.test(c)) label = 'espaço/tipografia';
    else if (/\p{Currency_Symbol}/u.test(c)) label = 'moeda';
    else if (/\p{P}/u.test(c)) label = 'pontuação';
    else if (/\p{S}/u.test(c)) label = 'símbolo';
    else if (cp > 0x7f) label = 'caractere não ASCII';

    seen.set(c, { char: c, label });
  }

  return [...seen.values()];
}

/** Limpa caracteres não permitidos em XML/SEFAZ:
 * - Remove caracteres de controle (0x00-0x1F exceto tab, newline, CR)
 * - Substitui C/ → COM e S/ → SEM (antes de remover /)
 * - Remove: & < > " ' \ / |
 */
export function cleanSefazXmlChars(value: string): string {
  let cleaned = String(value ?? '');

  // Remove caracteres de controle (exceto tab, newline, carriage return)
  cleaned = cleaned.split('').filter(c => {
    const code = c.charCodeAt(0);
    if (code < 0x09 || (code > 0x09 && code < 0x0A) || (code > 0x0A && code < 0x0D) || (code > 0x0D && code < 0x20) || code === 0x7F) {
      return false;
    }
    return true;
  }).join('');

  // Substituições ANTES de remover /: C/ → COM, S/ → SEM
  cleaned = cleaned.replace(/C\//gi, 'COM ');
  cleaned = cleaned.replace(/S\//gi, 'SEM ');

  // Substituir / \ | por espaço (evita colar palavras: 12UN/269ML → 12UN 269ML)
  cleaned = cleaned.replace(/[/\\|]/g, ' ');

  // Remove demais caracteres não permitidos em XML: & < > " '
  cleaned = cleaned.replace(/[&<>"']/g, '');

  // Colapsar múltiplos espaços gerados pelas substituições
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();

  return cleaned;
}

/** Substitui C/ → COM e S/ → SEM, depois remove todos os caracteres
 * especiais/inválidos para SEFAZ/XML (incluindo \ / | # etc.).
 */
export function applySpecialCharsClean(value: string): string {
  let v = String(value ?? '');
  // 1. Substituições antes de remover /
  v = v.replace(/C\//gi, 'COM ');
  v = v.replace(/S\//gi, 'SEM ');
  // 2. Remove caracteres de controle
  v = v.split('').filter(c => {
    const code = c.charCodeAt(0);
    return !(code < 0x09 || (code > 0x09 && code < 0x0A) || (code > 0x0A && code < 0x0D) || (code > 0x0D && code < 0x20) || code === 0x7F);
  }).join('');
  // 3. Substituir / \ | por espaço (evita colar palavras: 12UN/269ML → 12UN 269ML)
  v = v.replace(/[/\\|]/g, ' ');
  // 4. Remove demais caracteres não permitidos
  v = v.replace(/[^\w\s.,;:\-()@]/g, '');
  // 5. Colapsar múltiplos espaços
  v = v.replace(/\s{2,}/g, ' ').trim();
  return v;
}

/** Remove padrões de hashtag (#palavra com ≥1 char após #) especificamente
 * de campos de descrição. Retorna o texto limpo e a quantidade removida.
 */
export function removeDescriptionHashtags(value: string): { result: string; count: number } {
  let count = 0;
  const result = value.replace(/#\S+/g, () => { count++; return ' '; });
  return { result: result.replace(/\s{2,}/g, ' ').trim(), count };
}
