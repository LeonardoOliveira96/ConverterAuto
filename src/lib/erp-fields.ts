export type SheetType = 'produto' | 'cliente' | 'fornecedor';

export interface FieldDef {
  name: string;
  required: boolean;
}

export const PRODUCT_FIELDS: FieldDef[] = [
  { name: 'Descrição do Produto', required: true },
  { name: 'Código interno', required: true },
  { name: 'Código pai da grade', required: false },
  { name: 'Modalidades', required: false },
  { name: 'Código de Barras', required: false },
  { name: 'Código NCM', required: false },
  { name: 'CST A', required: false },
  { name: 'Altura', required: false },
  { name: 'Largura', required: false },
  { name: 'Comprimento', required: false },
  { name: 'Peso', required: false },
  { name: 'Valor Venda', required: false },
  { name: 'Custo', required: false },
  { name: 'Quantidade em estoque', required: false },
  { name: 'Unidade Entrada', required: false },
  { name: 'Unidade Saída', required: false },
  { name: 'Informação Adicional', required: false },
  { name: 'Categoria', required: false },
  { name: 'Comissão', required: false },
  { name: 'CFOP', required: false },
  { name: 'Departamento', required: false },
  { name: 'Estoque MIN', required: false },
  { name: 'Estoque MAX', required: false },
  { name: 'CEST', required: false },
  { name: 'Desativar', required: false },
  { name: 'Reativar', required: false },
  { name: 'Sincronizar c/ loja virtual', required: false },
  { name: 'Atributos', required: false },
  { name: 'Data Validade', required: false },
];

export const CLIENT_FIELDS: FieldDef[] = [
  { name: 'Nome/Razão Social', required: true },
  { name: 'CEP', required: true },
  { name: 'Estado (Sigla)', required: true },
  { name: 'Cidade', required: true },
  { name: 'Rua', required: true },
  { name: 'Bairro', required: true },
  { name: 'Número', required: true },
  { name: 'Nome Fantasia', required: false },
  { name: 'Código Cliente', required: false },
  { name: 'CPF/CNPJ', required: false },
  { name: 'RG', required: false },
  { name: 'Inscrição Estadual', required: false },
  { name: 'Inscrição Municipal', required: false },
  { name: 'Complemento', required: false },
  { name: 'Telefone', required: false },
  { name: 'Data de Nascimento', required: false },
  { name: 'E-mail', required: false },
  { name: 'Sexo', required: false },
  { name: 'Informação Adicional', required: false },
];

export const SUPPLIER_FIELDS: FieldDef[] = [
  { name: 'Nome/Razão Social', required: true },
  { name: 'CEP', required: true },
  { name: 'Estado (Sigla)', required: true },
  { name: 'Cidade', required: true },
  { name: 'Rua', required: true },
  { name: 'Bairro', required: true },
  { name: 'Número', required: true },
  { name: 'Nome Fantasia', required: false },
  { name: 'CPF/CNPJ', required: false },
  { name: 'RG', required: false },
  { name: 'Inscrição Estadual', required: false },
  { name: 'Inscrição Municipal', required: false },
  { name: 'Complemento', required: false },
  { name: 'Telefone', required: false },
  { name: 'E-mail', required: false },
  { name: 'Informação Adicional', required: false },
];

export function getFieldsForType(type: SheetType): FieldDef[] {
  switch (type) {
    case 'produto': return PRODUCT_FIELDS;
    case 'cliente': return CLIENT_FIELDS;
    case 'fornecedor': return SUPPLIER_FIELDS;
  }
}

export function autoSuggestMapping(sourceColumns: string[], targetFields: FieldDef[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const usedColumns = new Set<string>();
  const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

  for (const field of targetFields) {
    const normalizedField = normalize(field.name);
    let bestCol: string | null = null;
    let bestScore = -1;

    for (const col of sourceColumns) {
      if (usedColumns.has(col)) continue;
      const normalizedCol = normalize(col);
      if (normalizedCol.length <= 2) continue;

      let score = -1;
      if (normalizedCol === normalizedField) {
        score = 1;
      } else if (normalizedCol.includes(normalizedField)) {
        score = normalizedField.length / normalizedCol.length;
      } else if (normalizedField.includes(normalizedCol)) {
        score = normalizedCol.length / normalizedField.length;
      }

      if (score > bestScore) {
        bestScore = score;
        bestCol = col;
      }
    }

    if (bestCol !== null) {
      mapping[field.name] = bestCol;
      usedColumns.add(bestCol);
    }
  }
  return mapping;
}

export function suggestHeaderName(sourceColumnName: string, sheetType: SheetType): string | null {
  const fields = getFieldsForType(sheetType);
  const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  const normalizedCol = normalize(sourceColumnName);

  if (normalizedCol.length <= 2) return null;

  let bestField: FieldDef | null = null;
  let bestScore = -1;

  for (const field of fields) {
    const normalizedField = normalize(field.name);
    let score = -1;

    if (normalizedCol === normalizedField) {
      score = 1;
    } else if (normalizedCol.includes(normalizedField)) {
      score = normalizedField.length / normalizedCol.length;
    } else if (normalizedField.includes(normalizedCol)) {
      score = normalizedCol.length / normalizedField.length;
    }

    if (score > bestScore) {
      bestScore = score;
      bestField = field;
    }
  }

  return bestField ? bestField.name : null;
}
