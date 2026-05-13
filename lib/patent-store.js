const fs = require('fs');
const path = require('path');
const { listJsonlFiles } = require('../utils');

const DEFAULT_DATA_FILE = path.join(process.cwd(), 'data', 'patentes.jsonl');
const DATA_FILE = process.env.INPI_DATA_FILE || DEFAULT_DATA_FILE;

let cache = {
  loaded: false,
  signature: '',
  files: [],
  mtimeMs: 0,
  records: [],
  byNumero: new Map(),
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

function loadDataIfNeeded() {
  const dataFiles = listJsonlFiles(DATA_FILE);
  if (dataFiles.length === 0) {
    cache = {
      loaded: true,
      signature: '',
      files: [],
      mtimeMs: 0,
      records: [],
      byNumero: new Map(),
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

  const records = [];
  const byNumero = new Map();

  for (const file of dataFiles) {
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        const rec = normalizeRecord(parsed);
        records.push(rec);
        if (rec.numero) {
          byNumero.set(rec.numero.trim().toUpperCase(), rec);
        }
      } catch (_) {
        // Ignora linhas invalidas para nao derrubar a API
      }
    }
  }

  cache = {
    loaded: true,
    signature,
    files: dataFiles,
    mtimeMs: Math.max(...fileStats.map(({ stat }) => stat.mtimeMs)),
    records,
    byNumero,
  };

  return cache;
}

function searchPatents(params) {
  const state = loadDataIfNeeded();
  const q = safeLower(params.q).trim();
  const numero = safeLower(params.numero).trim();
  const titulo = safeLower(params.titulo).trim();
  const depositante = safeLower(params.depositante).trim();
  const ipc = safeLower(params.ipc).trim();

  const page = Math.max(parseInt(params.page || '1', 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(params.limit || '20', 10) || 20, 1), 100);

  let filtered = state.records;

  if (q) {
    filtered = filtered.filter((r) => {
      const blob = [r.numero, r.titulo, r.depositante, r.inventor, r.ipc, r.data_deposito, r.situacao]
        .map(safeLower)
        .join(' ');
      return blob.includes(q);
    });
  }

  if (numero) {
    filtered = filtered.filter((r) => safeLower(r.numero).includes(numero));
  }
  if (titulo) {
    filtered = filtered.filter((r) => safeLower(r.titulo).includes(titulo));
  }
  if (depositante) {
    filtered = filtered.filter((r) => safeLower(r.depositante).includes(depositante));
  }
  if (ipc) {
    filtered = filtered.filter((r) => safeLower(r.ipc).includes(ipc));
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
    indexed_records: state.records.length,
  };
}

function getByNumero(numero) {
  const state = loadDataIfNeeded();
  const key = String(numero || '').trim().toUpperCase();
  if (!key) return null;
  return state.byNumero.get(key) || null;
}

function getStats() {
  const state = loadDataIfNeeded();
  return {
    source_file: DATA_FILE,
    source_files: state.files,
    total_files: state.files.length,
    total_records: state.records.length,
    loaded: state.loaded,
    mtimeMs: state.mtimeMs,
  };
}

module.exports = {
  searchPatents,
  getByNumero,
  getStats,
};
