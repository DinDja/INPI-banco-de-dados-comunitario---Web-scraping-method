/**
 * schema.js - Schema normalizado para registros de patentes
 * 
 * Define:
 * - Campos indexáveis (usados para busca)
 * - Campos armazenados (apenas para exibição)
 * - Tipos de dados (string, date, keyword, number)
 * - Campos computed (derivados de outros campos)
 * - Pesos de relevância por campo
 */

const FIELD_TYPES = {
  STRING: 'string',
  TEXT: 'text',
  KEYWORD: 'keyword',
  NUMBER: 'number',
  DATE: 'date',
  BOOLEAN: 'boolean',
  ARRAY: 'array',
};

const FIELD_WEIGHTS = {
  numero: 10,
  titulo: 5,
  depositante: 3,
  ipc: 4,
  inventor: 2,
  situacao: 1,
  data_deposito: 1,
};

const SCHEMA = {
  fields: {
    numero: {
      type: FIELD_TYPES.KEYWORD,
      indexed: true,
      stored: true,
      searchable: true,
      weight: FIELD_WEIGHTS.numero,
      normalizer: 'normalizeNumeroPatente',
      description: 'Número da patente (formato normalizado)',
    },
    
    numero_original: {
      type: FIELD_TYPES.STRING,
      indexed: false,
      stored: true,
      searchable: false,
      weight: 0,
      description: 'Número da patente (formato original)',
    },
    
    titulo: {
      type: FIELD_TYPES.TEXT,
      indexed: true,
      stored: true,
      searchable: true,
      weight: FIELD_WEIGHTS.titulo,
      normalizer: 'normalizeText',
      tokenizer: {
        removeStopwords: true,
        stem: true,
        ngrams: [1, 2],
      },
      description: 'Título da patente',
    },
    
    titulo_original: {
      type: FIELD_TYPES.STRING,
      indexed: false,
      stored: true,
      searchable: false,
      weight: 0,
      description: 'Título da patente (original)',
    },
    
    depositante: {
      type: FIELD_TYPES.TEXT,
      indexed: true,
      stored: true,
      searchable: true,
      weight: FIELD_WEIGHTS.depositante,
      normalizer: 'normalizeNomeEmpresarial',
      tokenizer: {
        removeStopwords: false,
        stem: false,
        ngrams: [1, 2, 3],
      },
      description: 'Nome do depositante/empresa',
    },
    
    depositante_original: {
      type: FIELD_TYPES.STRING,
      indexed: false,
      stored: true,
      searchable: false,
      weight: 0,
      description: 'Nome do depositante (original)',
    },
    
    inventor: {
      type: FIELD_TYPES.TEXT,
      indexed: true,
      stored: true,
      searchable: true,
      weight: FIELD_WEIGHTS.inventor,
      normalizer: 'normalizeText',
      tokenizer: {
        removeStopwords: false,
        stem: false,
        ngrams: [1, 2],
      },
      description: 'Nome do(s) inventor(es)',
    },
    
    inventor_original: {
      type: FIELD_TYPES.STRING,
      indexed: false,
      stored: true,
      searchable: false,
      weight: 0,
      description: 'Nome do(s) inventor(es) (original)',
    },
    
    ipc: {
      type: FIELD_TYPES.KEYWORD,
      indexed: true,
      stored: true,
      searchable: true,
      weight: FIELD_WEIGHTS.ipc,
      normalizer: 'normalizeIPC',
      description: 'Classificação Internacional de Patentes (IPC)',
    },
    
    ipc_original: {
      type: FIELD_TYPES.STRING,
      indexed: false,
      stored: true,
      searchable: false,
      weight: 0,
      description: 'IPC (formato original)',
    },
    
    ipc_classe_principal: {
      type: FIELD_TYPES.KEYWORD,
      indexed: true,
      stored: true,
      searchable: true,
      weight: FIELD_WEIGHTS.ipc * 0.8,
      description: 'Classe principal do IPC (ex: G06, H02)',
      computed: true,
    },
    
    data_deposito: {
      type: FIELD_TYPES.DATE,
      indexed: true,
      stored: true,
      searchable: true,
      weight: FIELD_WEIGHTS.data_deposito,
      normalizer: 'normalizeDataDeposito',
      description: 'Data de depósito da patente (YYYY-MM-DD)',
    },
    
    data_deposito_original: {
      type: FIELD_TYPES.STRING,
      indexed: false,
      stored: true,
      searchable: false,
      weight: 0,
      description: 'Data de depósito (formato original)',
    },
    
    ano_deposito: {
      type: FIELD_TYPES.NUMBER,
      indexed: true,
      stored: true,
      searchable: true,
      weight: FIELD_WEIGHTS.data_deposito * 0.5,
      description: 'Ano de depósito (extraído de data_deposito)',
      computed: true,
    },
    
    situacao: {
      type: FIELD_TYPES.KEYWORD,
      indexed: true,
      stored: true,
      searchable: true,
      weight: FIELD_WEIGHTS.situacao,
      normalizer: 'normalizeText',
      description: 'Situação atual da patente',
    },
    
    situacao_original: {
      type: FIELD_TYPES.STRING,
      indexed: false,
      stored: true,
      searchable: false,
      weight: 0,
      description: 'Situação (formato original)',
    },
    
    url_detalhe: {
      type: FIELD_TYPES.STRING,
      indexed: false,
      stored: true,
      searchable: false,
      weight: 0,
      description: 'URL para página de detalhes no INPI',
    },
    
    _scraped_at: {
      type: FIELD_TYPES.DATE,
      indexed: false,
      stored: true,
      searchable: false,
      weight: 0,
      description: 'Timestamp quando o registro foi coletado',
    },
  },
  
  searchableFields: [
    'numero',
    'titulo',
    'depositante',
    'inventor',
    'ipc',
    'ipc_classe_principal',
    'situacao',
    'data_deposito',
    'ano_deposito',
  ],
  
  storedFields: [
    'numero',
    'numero_original',
    'titulo',
    'titulo_original',
    'depositante',
    'depositante_original',
    'inventor',
    'inventor_original',
    'ipc',
    'ipc_original',
    'ipc_classe_principal',
    'data_deposito',
    'data_deposito_original',
    'ano_deposito',
    'situacao',
    'situacao_original',
    'url_detalhe',
    '_scraped_at',
  ],
  
  computedFields: [
    'ipc_classe_principal',
    'ano_deposito',
  ],
  
  facetFields: [
    'ipc_classe_principal',
    'ano_deposito',
    'situacao',
    'depositante',
  ],
  
  sortByFields: [
    { field: 'ano_deposito', type: 'number', direction: ['asc', 'desc'] },
    { field: 'data_deposito', type: 'date', direction: ['asc', 'desc'] },
    { field: 'numero', type: 'keyword', direction: ['asc', 'desc'] },
    { field: 'relevancia', type: 'score', direction: ['asc', 'desc'] },
  ],
};

function getSearchableFields() {
  return SCHEMA.searchableFields;
}

function getStoredFields() {
  return SCHEMA.storedFields;
}

function getFacetFields() {
  return SCHEMA.facetFields;
}

function getFieldWeight(fieldName) {
  const field = SCHEMA.fields[fieldName];
  return field ? field.weight : 1;
}

function getFieldConfig(fieldName) {
  return SCHEMA.fields[fieldName] || null;
}

function isFieldIndexed(fieldName) {
  const field = SCHEMA.fields[fieldName];
  return field ? field.indexed : false;
}

function isFieldStored(fieldName) {
  const field = SCHEMA.fields[fieldName];
  return field ? field.stored : false;
}

function isFieldSearchable(fieldName) {
  const field = SCHEMA.fields[fieldName];
  return field ? field.searchable : false;
}

function getFieldType(fieldName) {
  const field = SCHEMA.fields[fieldName];
  return field ? field.type : null;
}

function getNormalizerForField(fieldName) {
  const field = SCHEMA.fields[fieldName];
  return field ? field.normalizer : null;
}

function getTokenizerConfigForField(fieldName) {
  const field = SCHEMA.fields[fieldName];
  return field ? field.tokenizer : null;
}

function validateRecord(record) {
  if (!record) return { valid: false, errors: ['Record is null or undefined'] };
  
  const errors = [];
  const warnings = [];
  
  if (record.data_deposito) {
    const datePattern = /^\d{2}\/\d{2}\/\d{4}$/;
    if (!datePattern.test(record.data_deposito)) {
      warnings.push(`data_deposito fora do formato esperado: ${record.data_deposito}`);
    }
  }
  
  if (record.ipc) {
    const ipcPattern = /^[A-H]\d{2}\s*\d{2}\s*[\/-]?\s*\d{2}$/i;
    if (!ipcPattern.test(record.ipc)) {
      warnings.push(`IPC fora do formato esperado: ${record.ipc}`);
    }
  }
  
  if (!record.numero) {
    errors.push('Campo "numero" é obrigatório');
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function extractFieldValues(record, fieldName) {
  const field = SCHEMA.fields[fieldName];
  if (!field || !record) return [];
  
  const value = record[fieldName];
  if (!value) return [];
  
  if (Array.isArray(value)) {
    return value;
  }
  
  return [value];
}

module.exports = {
  SCHEMA,
  FIELD_TYPES,
  FIELD_WEIGHTS,
  getSearchableFields,
  getStoredFields,
  getFacetFields,
  getFieldWeight,
  getFieldConfig,
  isFieldIndexed,
  isFieldStored,
  isFieldSearchable,
  getFieldType,
  getNormalizerForField,
  getTokenizerConfigForField,
  validateRecord,
  extractFieldValues,
};