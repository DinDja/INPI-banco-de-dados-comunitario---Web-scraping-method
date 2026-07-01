/**
 * normalizer.js - Normalização de texto para busca e indexação
 * 
 * Funcionalidades:
 * - Remoção de acentos/diacríticos
 * - Case folding (lowercase)
 * - Normalização de números de patente
 * - Normalização de nomes empresariais
 * - Stemming básico em português
 * - Clean de strings (espaços extras, caracteres especiais)
 */

const ACCENT_MAP = {
  'á': 'a', 'à': 'a', 'ã': 'a', 'â': 'a', 'ä': 'a',
  'Á': 'A', 'À': 'A', 'Ã': 'A', 'Â': 'A', 'Ä': 'A',
  'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e',
  'É': 'E', 'È': 'E', 'Ê': 'E', 'Ë': 'E',
  'í': 'i', 'ì': 'i', 'î': 'i', 'ï': 'i',
  'Í': 'I', 'Ì': 'I', 'Î': 'I', 'Ï': 'I',
  'ó': 'o', 'ò': 'o', 'õ': 'o', 'ô': 'o', 'ö': 'o',
  'Ó': 'O', 'Ò': 'O', 'Õ': 'O', 'Ô': 'O', 'Ö': 'O',
  'ú': 'u', 'ù': 'u', 'û': 'u', 'ü': 'u',
  'Ú': 'U', 'Ù': 'U', 'Û': 'U', 'Ü': 'U',
  'ç': 'c', 'Ç': 'C',
  'ñ': 'n', 'Ñ': 'N'
};

const CORPORATE_SUFFIXES = {
  'ltda': 'ltda',
  'limitada': 'ltda',
  's.a.': 'sa',
  'sociedade anônima': 'sa',
  'sociedade anonima': 'sa',
  's/a': 'sa',
  's/a.': 'sa',
  'cia': 'cia',
  'companhia': 'cia',
  'eireli': 'eireli',
  'mei': 'mei',
  'me': 'me'
};

const STOPWORDS_PT = new Set([
  'a', 'o', 'as', 'os', 'um', 'uma', 'uns', 'umas',
  'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
  'por', 'pelo', 'pela', 'pelos', 'pelas', 'para', 'pra',
  'com', 'sem', 'sob', 'sobre', 'entre',
  'e', 'ou', 'mas', 'porém', 'contudo', 'entretanto', 'todavia',
  'que', 'quem', 'qual', 'quais', 'quanto', 'quantos',
  'se', 'si', 'consigo', 'lhe', 'lhes', 'o', 'a', 'os', 'as',
  'me', 'te', 'nos', 'vos',
  'este', 'esta', 'estes', 'estas', 'esse', 'essa', 'esses', 'essas',
  'aquele', 'aquela', 'aqueles', 'aquelas', 'isto', 'isso', 'aquilo',
  'eu', 'tu', 'ele', 'ela', 'nós', 'vós', 'eles', 'elas',
  'meu', 'minha', 'meus', 'minhas', 'teu', 'tua', 'teus', 'tuas',
  'seu', 'sua', 'seus', 'suas', 'nosso', 'nossa', 'nossos', 'nossas',
  'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez',
  'primeiro', 'segundo', 'terceiro', 'último', 'penúltimo',
  'mais', 'menos', 'muito', 'pouco', 'tanto', 'quantos',
  'não', 'sim', 'talvez', 'quase', 'só', 'somente', 'também',
  'já', 'ainda', 'sempre', 'nunca', 'jamais', 'logo', 'cedo', 'tarde',
  'como', 'quando', 'onde', 'porque', 'porquê', 'por que', 'porquê',
  'ao', 'aos', 'às', 'dum', 'duma', 'duns', 'dumas', 'num', 'numa', 'nums', 'numas',
  'aquela', 'aquelas', 'aquele', 'aqueles', 'aquilo', 'esta', 'estas', 'este', 'estes',
  'isto', 'essa', 'essas', 'esse', 'esses', 'isso',
  'daquela', 'daquelas', 'daquele', 'daqueles', 'daquilo',
  'nesta', 'nestas', 'neste', 'nestes', 'nisso',
  'naquela', 'naquelas', 'naquele', 'naqueles', 'naquilo',
  'qual', 'quais', 'quanto', 'quanta', 'quantos', 'quantas',
  'qualquer', 'quaisquer', 'quem', 'cujo', 'cuja', 'cujos', 'cujas',
  'tudo', 'todo', 'toda', 'todos', 'todas', 'nada', 'nenhum', 'nenhuma',
  'algo', 'alguém', 'alguem', 'ninguém', 'ninguem', 'outro', 'outra', 'outros', 'outras',
  'mesmo', 'mesma', 'mesmos', 'mesmas', 'próprio', 'própria', 'próprios', 'próprias',
  'tal', 'tais', 'tão', 'tanta', 'tantas', 'tantos',
  'certo', 'certa', 'certos', 'certas', 'vários', 'várias',
  'através', 'atravez', 'após', 'antes', 'durante', 'desde',
  'contra', 'segundo', 'conforme', 'segundo', 'mediante',
  'inclusive', 'exceto', 'salvo', 'menos', 'tirante',
  'visando', 'segundo', 'consoante', 'malgrado', 'não obstante'
]);

function removeAccents(text) {
  if (!text) return '';
  let result = String(text);
  for (const [accented, normalized] of Object.entries(ACCENT_MAP)) {
    result = result.split(accented).join(normalized);
  }
  return result;
}

function normalizeText(text, options = {}) {
  if (!text) return '';
  
  let result = String(text);
  
  if (options.removeAccents !== false) {
    result = removeAccents(result);
  }
  
  if (options.lowercase !== false) {
    result = result.toLowerCase();
  }
  
  if (options.cleanSpaces !== false) {
    result = result.replace(/\s+/g, ' ').trim();
  }
  
  if (options.removeSpecialChars) {
    result = result.replace(/[^\w\s]/g, '');
  }
  
  return result;
}

function normalizeNumeroPatente(numero) {
  if (!numero) return '';
  
  let normalized = normalizeText(numero, { lowercase: false });
  
  normalized = normalized.replace(/\s+/g, '');
  
  normalized = normalized.toUpperCase();
  
  normalized = normalized.replace(/^BR/, '');
  
  normalized = normalized.replace(/^[PI|MU|BR]+/i, '');
  
  const match = normalized.match(/^(\d{2})(\d{6,7})(-?(\d))?$/);
  if (match) {
    const [, prefix, number, , digit] = match;
    return `${prefix}${number}${digit || ''}`;
  }
  
  return normalized;
}

function normalizeNomeEmpresarial(nome) {
  if (!nome) return '';
  
  let normalized = normalizeText(nome);
  
  normalized = normalized.replace(/\b(limitada|ltda)\b/gi, 'ltda');
  normalized = normalized.replace(/\b(s\.?a\.?|sociedade anônima|sociedade anonima)\b/gi, 'sa');
  normalized = normalized.replace(/\b(cia|companhia)\b/gi, 'cia');
  normalized = normalized.replace(/\b(eireli)\b/gi, 'eireli');
  normalized = normalized.replace(/\b(me|mei)\b/gi, 'me');
  
  normalized = normalized.replace(/[.,]/g, '');
  
  normalized = normalized.replace(/\s+/g, ' ').trim();
  
  return normalized;
}

const STEM_RULES = [
  { pattern: /amento$/i, replacement: '' },
  { pattern: /imento$/i, replacement: '' },
  { pattern: /amento$/i, replacement: '' },
  { pattern: /ância$/i, replacement: '' },
  { pattern: /ência$/i, replacement: '' },
  { pattern: /idade$/i, replacement: '' },
  { pattern: /ador$/i, replacement: '' },
  { pattern: /dor$/i, replacement: '' },
  { pattern: /ista$/i, replacement: '' },
  { pattern: /mente$/i, replacement: '' },
  { pattern: /mente$/i, replacement: '' },
  { pattern: /ações$/i, replacement: 'a' },
  { pattern: /ões$/i, replacement: 'a' },
  { pattern: /ias$/i, replacement: 'ia' },
  { pattern: /as$/i, replacement: 'a' },
  { pattern: /es$/i, replacement: 'e' },
  { pattern: /is$/i, replacement: 'i' },
  { pattern: /os$/i, replacement: 'o' },
  { pattern: /s$/i, replacement: '' },
  { pattern: /ar$/i, replacement: 'a' },
  { pattern: /er$/i, replacement: 'e' },
  { pattern: /ir$/i, replacement: 'i' },
];

function stem(word) {
  if (!word || word.length < 4) return word;
  
  for (const { pattern, replacement } of STEM_RULES) {
    if (pattern.test(word)) {
      return word.replace(pattern, replacement);
    }
  }
  
  return word;
}

function tokenize(text, options = {}) {
  if (!text) return [];
  
  const normalized = normalizeText(text, {
    removeAccents: true,
    lowercase: true,
    cleanSpaces: true,
    removeSpecialChars: options.removeSpecialChars !== false
  });
  
  let tokens = normalized.split(/[\s,;.!?()"\[\]{}:]+/).filter(Boolean);
  
  if (options.removeStopwords) {
    tokens = tokens.filter(token => !STOPWORDS_PT.has(token));
  }
  
  if (options.stem) {
    tokens = tokens.map(stem);
  }
  
  return tokens;
}

function generateNgrams(tokens, n = 2) {
  if (!tokens || tokens.length < n) return [];
  
  const ngrams = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    ngrams.push(tokens.slice(i, i + n).join(' '));
  }
  return ngrams;
}

function normalizeIPC(ipc) {
  if (!ipc) return '';
  
  let normalized = normalizeText(ipc, { lowercase: false });
  
  normalized = normalized.toUpperCase();
  
  const match = normalized.match(/^([A-H])(\d{2})\s*(\d{2})\s*[\/-]?\s*(\d{2})$/);
  if (match) {
    const [, section, class_, subclass, group] = match;
    return `${section}${class_}${subclass}/${group}`;
  }
  
  return normalized.replace(/\s+/g, '');
}

function normalizeDataDeposito(data) {
  if (!data) return null;
  
  const str = String(data).trim();
  
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) {
    const [dia, mes, ano] = str.split('/');
    return `${ano}-${mes}-${dia}`;
  }
  
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }
  
  return str;
}

function extractAnoDeposito(dataDeposito) {
  if (!dataDeposito) return null;
  
  const normalized = normalizeDataDeposito(dataDeposito);
  if (!normalized) return null;
  
  const match = normalized.match(/^(\d{4})/);
  return match ? parseInt(match[1], 10) : null;
}

function extractClasseIPCPrincipal(ipc) {
  if (!ipc) return null;
  
  const normalized = normalizeIPC(ipc);
  const match = normalized.match(/^([A-H]\d{2})/);
  return match ? match[1] : null;
}

function normalizeRecord(record) {
  if (!record) return null;
  
  const normalized = {
    numero: normalizeNumeroPatente(record.numero),
    numero_original: record.numero || null,
    titulo: normalizeText(record.titulo),
    titulo_original: record.titulo || null,
    depositante: normalizeNomeEmpresarial(record.depositante),
    depositante_original: record.depositante || null,
    inventor: normalizeText(record.inventor),
    inventor_original: record.inventor || null,
    ipc: normalizeIPC(record.ipc),
    ipc_original: record.ipc || null,
    ipc_classe_principal: extractClasseIPCPrincipal(record.ipc),
    data_deposito: normalizeDataDeposito(record.data_deposito),
    data_deposito_original: record.data_deposito || null,
    ano_deposito: extractAnoDeposito(record.data_deposito),
    situacao: normalizeText(record.situacao),
    situacao_original: record.situacao || null,
    url_detalhe: record.url_detalhe || null,
    _scraped_at: record._scraped_at || null,
  };
  
  Object.keys(record).forEach(key => {
    if (!(key in normalized)) {
      normalized[key] = record[key];
    }
  });
  
  return normalized;
}

function createSearchBlob(record) {
  if (!record) return '';
  
  const fields = [
    record.numero,
    record.titulo,
    record.depositante,
    record.inventor,
    record.ipc,
    record.situacao
  ];
  
  return fields.filter(Boolean).join(' ').toLowerCase();
}

module.exports = {
  normalizeText,
  normalizeNumeroPatente,
  normalizeNomeEmpresarial,
  normalizeIPC,
  normalizeDataDeposito,
  extractAnoDeposito,
  extractClasseIPCPrincipal,
  normalizeRecord,
  createSearchBlob,
  tokenize,
  stem,
  generateNgrams,
  removeAccents,
  STOPWORDS_PT,
  ACCENT_MAP,
};