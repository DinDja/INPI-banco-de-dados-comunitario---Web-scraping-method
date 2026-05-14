const fs = require('fs');
const path = require('path');
const { listJsonlFiles } = require('../utils');

const DEFAULT_PATENTS_FILE = path.join(__dirname, '..', 'data', 'patentes.jsonl');
const DEFAULT_PROGRAMS_FILE = path.join(__dirname, '..', 'data', 'programas.jsonl');
const DEFAULT_MARKS_FILE = path.join(__dirname, '..', 'data', 'marcas.jsonl');

const PATENTS_DATA_FILE = process.env.INPI_DATA_FILE || DEFAULT_PATENTS_FILE;
const PROGRAMS_DATA_FILE = process.env.INPI_PROGRAMAS_DATA_FILE || DEFAULT_PROGRAMS_FILE;
const MARKS_DATA_FILE = process.env.INPI_MARCAS_DATA_FILE || DEFAULT_MARKS_FILE;
const INCLUDE_PROGRAMS = String(process.env.INPI_INCLUDE_PROGRAMAS || 'true').toLowerCase() !== 'false';
const INCLUDE_MARKS = String(process.env.INPI_INCLUDE_MARCAS || 'true').toLowerCase() !== 'false';

function resolveBaseDatasets() {
  const datasets = [{ kind: 'patente', baseFile: PATENTS_DATA_FILE }];

  if (INCLUDE_PROGRAMS) {
    datasets.push({ kind: 'programa', baseFile: PROGRAMS_DATA_FILE });
  }

  if (INCLUDE_MARKS) {
    datasets.push({ kind: 'marca', baseFile: MARKS_DATA_FILE });
  }

  return datasets;
}

let cache = {
  loaded: false,
  signature: '',
  files: [],
  filesByType: {
    patente: [],
    programa: [],
    marca: [],
  },
  mtimeMs: 0,
  byNumero: new Map(),
  records: [],
  recordCount: 0,
  recordsByType: {
    patente: 0,
    programa: 0,
    marca: 0,
  },
};

function safeLower(value) {
  return String(value || '').toLowerCase();
}

function normalizeRecord(record, kind) {
  const normalized = {
    numero: record.numero || null,
    titulo: record.titulo || null,
    marca: record.marca || null,
    apresentacao: record.apresentacao || null,
    natureza: record.natureza || null,
    depositante: record.depositante || null,
    inventor: record.inventor || null,
    ipc: record.ipc || null,
    data_deposito: record.data_deposito || null,
    situacao: record.situacao || null,
    url_detalhe: record.url_detalhe || null,
    titular: record.titular || null,
    autor: record.autor || null,
    linguagem: record.linguagem || null,
    campo_aplicacao: record.campo_aplicacao || null,
    tipo_programa: record.tipo_programa || null,
    data_criacao: record.data_criacao || null,
    despacho_codigo: record.despacho_codigo || null,
    despacho_nome: record.despacho_nome || null,
    despacho_titulo: record.despacho_titulo || null,
    despacho_comentario: record.despacho_comentario || null,
    classe_nice: record.classe_nice || null,
    classe_nice_status: record.classe_nice_status || null,
    classe_nice_especificacao: record.classe_nice_especificacao || null,
    classe_vienna: record.classe_vienna || null,
    prioridade_unionista: record.prioridade_unionista || null,
    procurador: record.procurador || null,
    rpi_numero: record.rpi_numero || null,
    rpi_data_publicacao: record.rpi_data_publicacao || null,
    fonte_zip_url: record.fonte_zip_url || null,
    _scraped_at: record._scraped_at || null,
    ...record,
  };

  if (!normalized.depositante && normalized.titular) {
    normalized.depositante = normalized.titular;
  }

  if (!normalized.inventor && normalized.autor) {
    normalized.inventor = normalized.autor;
  }

  if (!normalized.tipo) {
    normalized.tipo = kind;
  }

  return normalized;
}

function normalizeNumeroKey(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

function buildSearchEntry(record, kind) {
  return {
    kind,
    record,
    numeroLc: safeLower(record.numero),
    tituloLc: safeLower(record.titulo),
    marcaLc: safeLower(record.marca),
    apresentacaoLc: safeLower(record.apresentacao),
    naturezaLc: safeLower(record.natureza),
    depositanteLc: safeLower(record.depositante),
    titularLc: safeLower(record.titular),
    inventorLc: safeLower(record.inventor),
    autorLc: safeLower(record.autor),
    ipcLc: safeLower(record.ipc),
    dataDepositoLc: safeLower(record.data_deposito),
    linguagemLc: safeLower(record.linguagem),
    campoAplicacaoLc: safeLower(record.campo_aplicacao),
    tipoProgramaLc: safeLower(record.tipo_programa),
    dataCriacaoLc: safeLower(record.data_criacao),
    despachoCodigoLc: safeLower(record.despacho_codigo),
    despachoNomeLc: safeLower(record.despacho_nome),
    classeNiceLc: safeLower(record.classe_nice),
    classeNiceStatusLc: safeLower(record.classe_nice_status),
    classeNiceEspecificacaoLc: safeLower(record.classe_nice_especificacao),
    classeViennaLc: safeLower(record.classe_vienna),
    prioridadeUnionistaLc: safeLower(record.prioridade_unionista),
    procuradorLc: safeLower(record.procurador),
    rpiNumeroLc: safeLower(record.rpi_numero),
    rpiDataPublicacaoLc: safeLower(record.rpi_data_publicacao),
    tipoLc: safeLower(record.tipo || kind),
    situacaoLc: safeLower(record.situacao),
  };
}

/** Indice rapido: mapeia numero de processo -> registro */
function buildIndex() {
  const datasets = resolveBaseDatasets();
  const dataSources = [];

  for (const dataset of datasets) {
    const files = listJsonlFiles(dataset.baseFile);
    for (const file of files) {
      dataSources.push({ kind: dataset.kind, baseFile: dataset.baseFile, file });
    }
  }

  if (dataSources.length === 0) {
    cache = {
      loaded: true,
      signature: '',
      files: [],
      filesByType: {
        patente: [],
        programa: [],
        marca: [],
      },
      mtimeMs: 0,
      byNumero: new Map(),
      records: [],
      recordCount: 0,
      recordsByType: {
        patente: 0,
        programa: 0,
        marca: 0,
      },
    };

    return cache;
  }

  const fileStats = dataSources.map((source) => ({ ...source, stat: fs.statSync(source.file) }));
  const signature = fileStats
    .map(({ kind, file, stat }) => `${kind}:${file}:${stat.mtimeMs}:${stat.size}`)
    .join('|');

  if (cache.loaded && cache.signature === signature) {
    return cache;
  }

  const byNumero = new Map();
  const records = [];
  const filesByType = {
    patente: [],
    programa: [],
    marca: [],
  };
  const recordsByType = {
    patente: 0,
    programa: 0,
    marca: 0,
  };

  // Le e indexa todos os JSONL uma unica vez por assinatura de arquivos.
  for (const source of dataSources) {
    const lines = fs.readFileSync(source.file, 'utf8').split(/\r?\n/);

    filesByType[source.kind].push(source.file);

    for (const line of lines) {
      if (!line) continue;

      try {
        const parsed = JSON.parse(line);
        const normalized = normalizeRecord(parsed, source.kind);
        const key = normalizeNumeroKey(normalized.numero);

        if (key && !byNumero.has(key)) {
          byNumero.set(key, normalized);
        }

        records.push(buildSearchEntry(normalized, source.kind));
        recordsByType[source.kind] += 1;
      } catch (_) {
        // Ignora linhas invalidas
      }
    }
  }

  const recordCount = records.length;

  cache = {
    loaded: true,
    signature,
    files: dataSources.map((source) => source.file),
    filesByType,
    mtimeMs: Math.max(...fileStats.map(({ stat }) => stat.mtimeMs)),
    byNumero,
    records,
    recordCount,
    recordsByType,
  };

  return cache;
}

function matchesFilters(entry, filters) {
  if (filters.q) {
    const hasQuery =
      entry.numeroLc.includes(filters.q) ||
      entry.tituloLc.includes(filters.q) ||
      entry.marcaLc.includes(filters.q) ||
      entry.apresentacaoLc.includes(filters.q) ||
      entry.naturezaLc.includes(filters.q) ||
      entry.depositanteLc.includes(filters.q) ||
      entry.titularLc.includes(filters.q) ||
      entry.inventorLc.includes(filters.q) ||
      entry.autorLc.includes(filters.q) ||
      entry.ipcLc.includes(filters.q) ||
      entry.dataDepositoLc.includes(filters.q) ||
      entry.linguagemLc.includes(filters.q) ||
      entry.campoAplicacaoLc.includes(filters.q) ||
      entry.tipoProgramaLc.includes(filters.q) ||
      entry.dataCriacaoLc.includes(filters.q) ||
      entry.despachoCodigoLc.includes(filters.q) ||
      entry.despachoNomeLc.includes(filters.q) ||
      entry.classeNiceLc.includes(filters.q) ||
      entry.classeNiceStatusLc.includes(filters.q) ||
      entry.classeNiceEspecificacaoLc.includes(filters.q) ||
      entry.classeViennaLc.includes(filters.q) ||
      entry.prioridadeUnionistaLc.includes(filters.q) ||
      entry.procuradorLc.includes(filters.q) ||
      entry.rpiNumeroLc.includes(filters.q) ||
      entry.rpiDataPublicacaoLc.includes(filters.q) ||
      entry.tipoLc.includes(filters.q) ||
      entry.situacaoLc.includes(filters.q);

    if (!hasQuery) return false;
  }

  if (filters.numero && !entry.numeroLc.includes(filters.numero)) return false;
  if (filters.titulo && !entry.tituloLc.includes(filters.titulo)) return false;
  if (filters.marca && !entry.marcaLc.includes(filters.marca) && !entry.tituloLc.includes(filters.marca)) return false;
  if (filters.apresentacao && !entry.apresentacaoLc.includes(filters.apresentacao)) return false;
  if (filters.natureza && !entry.naturezaLc.includes(filters.natureza)) return false;
  if (
    filters.depositante &&
    !entry.depositanteLc.includes(filters.depositante) &&
    !entry.titularLc.includes(filters.depositante)
  ) {
    return false;
  }
  if (filters.ipc && !entry.ipcLc.includes(filters.ipc)) return false;
  if (filters.titular && !entry.titularLc.includes(filters.titular)) return false;
  if (filters.autor && !entry.autorLc.includes(filters.autor)) return false;
  if (filters.linguagem && !entry.linguagemLc.includes(filters.linguagem)) return false;
  if (filters.campo_aplicacao && !entry.campoAplicacaoLc.includes(filters.campo_aplicacao)) return false;
  if (filters.tipo_programa && !entry.tipoProgramaLc.includes(filters.tipo_programa)) return false;
  if (filters.classe_nice && !entry.classeNiceLc.includes(filters.classe_nice)) return false;
  if (filters.classe_nice_status && !entry.classeNiceStatusLc.includes(filters.classe_nice_status)) return false;
  if (filters.classe_vienna && !entry.classeViennaLc.includes(filters.classe_vienna)) return false;
  if (filters.prioridade_unionista && !entry.prioridadeUnionistaLc.includes(filters.prioridade_unionista)) return false;
  if (filters.procurador && !entry.procuradorLc.includes(filters.procurador)) return false;
  if (filters.data_criacao && !entry.dataCriacaoLc.includes(filters.data_criacao)) return false;
  if (filters.despacho_codigo && !entry.despachoCodigoLc.includes(filters.despacho_codigo)) return false;
  if (filters.despacho_nome && !entry.despachoNomeLc.includes(filters.despacho_nome)) return false;
  if (filters.rpi_numero && !entry.rpiNumeroLc.includes(filters.rpi_numero)) return false;
  if (filters.rpi_data_publicacao && !entry.rpiDataPublicacaoLc.includes(filters.rpi_data_publicacao)) return false;
  if (filters.tipo && entry.kind !== filters.tipo && !entry.tipoLc.includes(filters.tipo)) return false;

  return true;
}

/** Busca em todos os arquivos indexados em memoria */
function searchPatents(params) {
  const state = buildIndex();
  const filters = {
    q: safeLower(params.q).trim(),
    numero: safeLower(params.numero).trim(),
    titulo: safeLower(params.titulo).trim(),
    marca: safeLower(params.marca).trim(),
    apresentacao: safeLower(params.apresentacao).trim(),
    natureza: safeLower(params.natureza).trim(),
    depositante: safeLower(params.depositante).trim(),
    ipc: safeLower(params.ipc).trim(),
    titular: safeLower(params.titular).trim(),
    autor: safeLower(params.autor).trim(),
    linguagem: safeLower(params.linguagem).trim(),
    campo_aplicacao: safeLower(params.campo_aplicacao).trim(),
    tipo_programa: safeLower(params.tipo_programa).trim(),
    classe_nice: safeLower(params.classe_nice).trim(),
    classe_nice_status: safeLower(params.classe_nice_status).trim(),
    classe_vienna: safeLower(params.classe_vienna).trim(),
    prioridade_unionista: safeLower(params.prioridade_unionista).trim(),
    procurador: safeLower(params.procurador).trim(),
    data_criacao: safeLower(params.data_criacao).trim(),
    despacho_codigo: safeLower(params.despacho_codigo).trim(),
    despacho_nome: safeLower(params.despacho_nome).trim(),
    rpi_numero: safeLower(params.rpi_numero).trim(),
    rpi_data_publicacao: safeLower(params.rpi_data_publicacao).trim(),
    tipo: safeLower(params.tipo).trim(),
  };

  const page = Math.max(parseInt(params.page || '1', 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(params.limit || '20', 10) || 20, 1), 100);
  const start = (page - 1) * limit;
  const end = start + limit;

  let total = 0;
  const items = [];

  for (const entry of state.records) {
    if (!matchesFilters(entry, filters)) {
      continue;
    }

    if (total >= start && total < end) {
      items.push(entry.record);
    }

    total += 1;
  }

  return {
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
    items,
    source_file: PATENTS_DATA_FILE,
    source_programas_file: PROGRAMS_DATA_FILE,
    source_marcas_file: MARKS_DATA_FILE,
    source_files: state.files,
    source_files_by_type: state.filesByType,
    indexed_files: state.files.length,
    indexed_records: state.recordCount,
    indexed_records_by_type: state.recordsByType,
  };
}

function getByNumero(numero, kind) {
  const state = buildIndex();
  const key = normalizeNumeroKey(numero);
  if (!key) return null;

  if (!kind) {
    return state.byNumero.get(key) || null;
  }

  const wantedKind = safeLower(kind).trim();
  if (!wantedKind) {
    return state.byNumero.get(key) || null;
  }

  for (const entry of state.records) {
    if (entry.kind !== wantedKind) continue;
    if (normalizeNumeroKey(entry.record.numero) === key) {
      return entry.record;
    }
  }

  return null;
}

function clearCache() {
  cache = {
    loaded: false,
    signature: '',
    files: [],
    filesByType: {
      patente: [],
      programa: [],
      marca: [],
    },
    mtimeMs: 0,
    byNumero: new Map(),
    records: [],
    recordCount: 0,
    recordsByType: {
      patente: 0,
      programa: 0,
      marca: 0,
    },
  };
}

function getStats() {
  const state = buildIndex();
  return {
    source_file: PATENTS_DATA_FILE,
    source_programas_file: PROGRAMS_DATA_FILE,
    source_marcas_file: MARKS_DATA_FILE,
    source_files: state.files,
    source_files_by_type: state.filesByType,
    total_files: state.files.length,
    total_records: state.recordCount,
    total_records_by_type: state.recordsByType,
    loaded: state.loaded,
    mtimeMs: state.mtimeMs,
  };
}

module.exports = {
  searchPatents,
  getByNumero,
  getStats,
  clearCache,
};
