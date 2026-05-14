const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { listJsonlFiles } = require('../utils');

const DEFAULT_DATA_FILE = path.join(__dirname, '..', 'data', 'patentes.jsonl');
const DATA_FILE = process.env.INPI_DATA_FILE || DEFAULT_DATA_FILE;

let cache = {
  loaded: false,
  signature: '',
  files: [],
  mtimeMs: 0,
  byNumero: new Map(),
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

/** Índice rápido: mapeia número de patente → arquivo e localização */
function buildIndex() {
  const dataFiles = listJsonlFiles(DATA_FILE);
  if (dataFiles.length === 0) return { byNumero: new Map(), recordCount: 0 };

  const fileStats = dataFiles.map((file) => ({ file, stat: fs.statSync(file) }));
  const signature = fileStats
    .map(({ file, stat }) => `${file}:${stat.mtimeMs}:${stat.size}`)
    .join('|');

  if (cache.loaded && cache.signature === signature) {
    return cache;
  }

  const byNumero = new Map();
  let recordCount = 0;

  // Build index: cada entrada mapeia número → arquivo
  for (const file of dataFiles) {
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        const numero = parsed.numero;
        if (numero) {
          const key = String(numero || '').trim().toUpperCase();
          byNumero.set(key, { file, data: parsed });
          recordCount++;
        }
      } catch (_) {
        // Ignora linhas inválidas
      }
    }
  }

  cache = {
    loaded: true,
    signature,
    files: dataFiles,
    mtimeMs: Math.max(...fileStats.map(({ stat }) => stat.mtimeMs)),
    byNumero,
    recordCount,
  };

  return cache;
}

/** Busca em todos os arquivos usando stream/lazy loading */
function searchPatents(params) {
  const state = buildIndex();
  const q = safeLower(params.q).trim();
  const numero = safeLower(params.numero).trim();
  const titulo = safeLower(params.titulo).trim();
  const depositante = safeLower(params.depositante).trim();
  const ipc = safeLower(params.ipc).trim();

  const page = Math.max(parseInt(params.page || '1', 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(params.limit || '20', 10) || 20, 1), 100);

  // Se há query, faz busca full-text em todos os arquivos
  const filtered = [];
  const dataFiles = state.files;

  for (const file of dataFiles) {
    try {
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          const rec = normalizeRecord(parsed);

          // Aplica filtros
          if (q) {
            const blob = [rec.numero, rec.titulo, rec.depositante, rec.inventor, rec.ipc, rec.data_deposito, rec.situacao]
              .map(safeLower)
              .join(' ');
            if (!blob.includes(q)) continue;
          }

          if (numero && !safeLower(rec.numero).includes(numero)) continue;
          if (titulo && !safeLower(rec.titulo).includes(titulo)) continue;
          if (depositante && !safeLower(rec.depositante).includes(depositante)) continue;
          if (ipc && !safeLower(rec.ipc).includes(ipc)) continue;

          filtered.push(rec);
        } catch (_) {
          // Ignora linhas inválidas
        }
      }
    } catch (_) {
      // Ignora erros ao ler arquivo
    }
  }

  const total = filtered.length;
  const start = (page - 1) * limit;
  const end = start + limit;
  const items = filtered.slice(start, end);

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
  const key = String(numero || '').trim().toUpperCase();
  if (!key) return null;
  const entry = state.byNumero.get(key);
  return entry ? normalizeRecord(entry.data) : null;
}

function clearCache() {
  cache = {
    loaded: false,
    signature: '',
    files: [],
    mtimeMs: 0,
    byNumero: new Map(),
    recordCount: 0,
  };
}

module.exports.clearCache = clearCache;

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
