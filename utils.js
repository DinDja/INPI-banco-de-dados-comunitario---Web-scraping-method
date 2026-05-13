/**
 * utils.js — Utilitários compartilhados
 */

const fs   = require('fs');
const path = require('path');
const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');

dayjs.extend(customParseFormat);

// ── Log com timestamp ──────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const line = `[${ts}] ${msg}`;
  console.log(line);
  return line;
}

function logError(msg, errorLogFile) {
  const line = log(`❌ ${msg}`);
  if (errorLogFile) {
    fs.appendFileSync(errorLogFile, line + '\n', 'utf8');
  }
}

// ── Sleep ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Progresso ─────────────────────────────────────────────────────────────

function loadProgress(file) {
  if (fs.existsSync(file)) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
  }
  return { lastMonth: null, totalSaved: 0, startedAt: new Date().toISOString() };
}

function saveProgress(file, data) {
  fs.writeFileSync(file, JSON.stringify({ ...data, updatedAt: new Date().toISOString() }, null, 2));
}

// ── IDs já visitados ──────────────────────────────────────────────────────

function loadSeenIds(file) {
  if (fs.existsSync(file)) {
    try { return new Set(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (_) {}
  }
  return new Set();
}

function saveSeenIds(file, set) {
  fs.writeFileSync(file, JSON.stringify([...set]));
}

// ── JSONL helpers ─────────────────────────────────────────────────────────

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function listJsonlFiles(file) {
  const dir = path.dirname(file);
  const ext = path.extname(file) || '.jsonl';
  const stem = path.basename(file, ext);
  const files = [];

  if (fs.existsSync(file)) {
    files.push(file);
  }

  if (!fs.existsSync(dir)) return files;

  const partRegex = new RegExp('^' + escapeRegExp(stem) + '\\.part(\\d+)' + escapeRegExp(ext) + '$');
  const parts = fs.readdirSync(dir)
    .map((name) => {
      const match = name.match(partRegex);
      if (!match) return null;
      return { name, index: Number(match[1]) };
    })
    .filter(Boolean)
    .sort((a, b) => a.index - b.index)
    .map(({ name }) => path.join(dir, name));

  return [...files, ...parts];
}

function resolveWritableJsonlFile(file, maxPartSizeMB) {
  const maxSizeMB = Number(maxPartSizeMB);
  const maxBytes = Number.isFinite(maxSizeMB) && maxSizeMB > 0
    ? Math.floor(maxSizeMB * 1024 * 1024)
    : 0;

  if (!maxBytes) return file;

  const ext = path.extname(file) || '.jsonl';
  const stem = path.basename(file, ext);
  const dir = path.dirname(file);
  const files = listJsonlFiles(file);

  if (files.length === 0) {
    return file;
  }

  const lastFile = files[files.length - 1];
  const lastSize = fs.existsSync(lastFile) ? fs.statSync(lastFile).size : 0;
  if (lastSize < maxBytes) {
    return lastFile;
  }

  const partRegex = new RegExp('^' + escapeRegExp(stem) + '\\.part(\\d+)' + escapeRegExp(ext) + '$');
  const lastName = path.basename(lastFile);
  const match = lastName.match(partRegex);
  const nextIndex = match ? Number(match[1]) + 1 : 1;

  return path.join(dir, `${stem}.part${String(nextIndex).padStart(3, '0')}${ext}`);
}

function appendRecord(file, record, options = {}) {
  const targetFile = resolveWritableJsonlFile(file, options.maxPartSizeMB);
  fs.appendFileSync(targetFile, JSON.stringify(record) + '\n', 'utf8');
  return targetFile;
}

/** Lê todos os registros de um JSONL e retorna array */
function readJsonl(file, options = {}) {
  const includeParts = options.includeParts !== false;
  const files = includeParts ? listJsonlFiles(file) : [file];
  const records = [];

  for (const jsonlFile of files) {
    if (!fs.existsSync(jsonlFile)) continue;

    const parsed = fs.readFileSync(jsonlFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch (_) { return null; } })
      .filter(Boolean);

    records.push(...parsed);
  }

  return records;
}

// ── Garante que o diretório existe ────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── Gera lista de meses YYYY-MM entre duas datas DD/MM/YYYY ──────────────

function generateMonths(startDDMMYYYY, endDDMMYYYY) {
  const months = [];
  let cur = dayjs(startDDMMYYYY, 'DD/MM/YYYY', true);
  const end = dayjs(endDDMMYYYY, 'DD/MM/YYYY', true);

  if (!cur.isValid() || !end.isValid()) {
    throw new Error('Datas inválidas para gerar meses: start="' + startDDMMYYYY + '", end="' + endDDMMYYYY + '" (esperado DD/MM/YYYY)');
  }

  if (cur.isAfter(end, 'day')) return months;

  while (cur.isBefore(end) || cur.isSame(end, 'month')) {
    months.push(cur.format('YYYY-MM'));
    cur = cur.add(1, 'month');
  }
  return months;
}

module.exports = {
  log,
  logError,
  sleep,
  loadProgress,
  saveProgress,
  loadSeenIds,
  saveSeenIds,
  appendRecord,
  readJsonl,
  listJsonlFiles,
  ensureDir,
  generateMonths,
};
