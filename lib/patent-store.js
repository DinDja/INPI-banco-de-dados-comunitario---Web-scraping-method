const fs = require('fs');
const path = require('path');
const { listJsonlFiles } = require('../utils');

const DEFAULT_DATA_FILE = path.join(__dirname, '..', 'data', 'patentes.jsonl');
const DATA_FILE = process.env.INPI_DATA_FILE || DEFAULT_DATA_FILE;

let cache = {
  loaded: false,
  signature: '',
  files: [],
  mtimeMs: 0,
  byNumero: new Map(),
  records: [],
  recordCount: 0,
};

function safeLower(value) {
  return String(value || '').toLowerCase();
}

function normalizeRecord(record) {
  return {
    numero: record.numero || null,
    titulo: record.titulo || null,
    depositante: record.depositante || null,
    inventor: record.inventor || null,
    ipc: record.ipc || null,
    data_deposito: record.data_deposito || null,
    situacao: record.situacao || null,
    url_detalhe: record.url_detalhe || null,
    _scraped_at: record._scraped_at || null,
    ...record,
  };
}

function normalizeNumeroKey(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

function buildSearchEntry(record) {
  return {
    record,
    numeroLc: safeLower(record.numero),
    tituloLc: safeLower(record.titulo),
    depositanteLc: safeLower(record.depositante),
    inventorLc: safeLower(record.inventor),
    ipcLc: safeLower(record.ipc),
    dataDepositoLc: safeLower(record.data_deposito),
    situacaoLc: safeLower(record.situacao),
  };
}

/** Índice rápido: mapeia número de patente → arquivo e localização */
function buildIndex() {
  const dataFiles = listJsonlFiles(DATA_FILE);

  if (dataFiles.length === 0) {
    cache = {
      loaded: true,
      signature: '',
      files: [],
      mtimeMs: 0,
      byNumero: new Map(),
      records: [],
      recordCount: 0,
    };

    return cache;
  }

  const fileStats = dataFiles.map((file) => ({ file, stat: fs.statSync(file) }));
  const signature = fileStats
    .map(({ file, stat }) => `${file}:${stat.mtimeMs}:${stat.size}`)
    .join('|');

  if (cache.loaded && cache.signature === signature) {
    return cache;
  }

  const byNumero = new Map();
  const records = [];

  // Lê e indexa todos os JSONL uma única vez por assinatura de arquivos.
  for (const file of dataFiles) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);

    for (const line of lines) {
      if (!line) continue;

      try {
        const parsed = JSON.parse(line);
        const normalized = normalizeRecord(parsed);
        const key = normalizeNumeroKey(normalized.numero);

        if (key) byNumero.set(key, normalized);

        records.push(buildSearchEntry(normalized));
      } catch (_) {
        // Ignora linhas inválidas
      }
    }
  }

  const recordCount = records.length;

  cache = {
    loaded: true,
    signature,
    files: dataFiles,
    mtimeMs: Math.max(...fileStats.map(({ stat }) => stat.mtimeMs)),
    byNumero,
    records,
    recordCount,
  };

  return cache;
}

function matchesFilters(entry, filters) {
  if (filters.q) {
    const hasQuery =
      entry.numeroLc.includes(filters.q) ||
      entry.tituloLc.includes(filters.q) ||
      entry.depositanteLc.includes(filters.q) ||
      entry.inventorLc.includes(filters.q) ||
      entry.ipcLc.includes(filters.q) ||
      entry.dataDepositoLc.includes(filters.q) ||
      entry.situacaoLc.includes(filters.q);

    if (!hasQuery) return false;
  }

  if (filters.numero && !entry.numeroLc.includes(filters.numero)) return false;
  if (filters.titulo && !entry.tituloLc.includes(filters.titulo)) return false;
  if (filters.depositante && !entry.depositanteLc.includes(filters.depositante)) return false;
  if (filters.ipc && !entry.ipcLc.includes(filters.ipc)) return false;

  return true;
}

/** Busca em todos os arquivos usando stream/lazy loading */
function searchPatents(params) {
  const state = buildIndex();
  const filters = {
    q: safeLower(params.q).trim(),
    numero: safeLower(params.numero).trim(),
    titulo: safeLower(params.titulo).trim(),
    depositante: safeLower(params.depositante).trim(),
    ipc: safeLower(params.ipc).trim(),
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
    source_file: DATA_FILE,
    source_files: state.files,
    indexed_files: state.files.length,
    indexed_records: state.recordCount,
  };
}

function getByNumero(numero) {
  const state = buildIndex();
  const key = normalizeNumeroKey(numero);
  if (!key) return null;
  return state.byNumero.get(key) || null;
}

function clearCache() {
  cache = {
    loaded: false,
    signature: '',
    files: [],
    mtimeMs: 0,
    byNumero: new Map(),
    records: [],
    recordCount: 0,
  };
}

function getStats() {
  const state = buildIndex();
  return {
    source_file: DATA_FILE,
    source_files: state.files,
    total_files: state.files.length,
    total_records: state.recordCount,
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
