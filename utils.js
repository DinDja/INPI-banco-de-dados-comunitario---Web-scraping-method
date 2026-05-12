/**
 * utils.js — Utilitários compartilhados
 */

const fs   = require('fs');
const path = require('path');

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

function appendRecord(file, record) {
  fs.appendFileSync(file, JSON.stringify(record) + '\n', 'utf8');
}

/** Lê todos os registros de um JSONL e retorna array */
function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch (_) { return null; } })
    .filter(Boolean);
}

// ── Garante que o diretório existe ────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── Gera lista de meses YYYY-MM entre duas datas DD/MM/YYYY ──────────────

function generateMonths(startDDMMYYYY, endDDMMYYYY) {
  const dayjs = require('dayjs');
  const months = [];
  let cur = dayjs(startDDMMYYYY, 'DD/MM/YYYY');
  const end = dayjs(endDDMMYYYY, 'DD/MM/YYYY');
  while (cur.isBefore(end) || cur.isSame(end, 'month')) {
    months.push(cur.format('YYYY-MM'));
    cur = cur.add(1, 'month');
  }
  return months;
}

module.exports = { log, logError, sleep, loadProgress, saveProgress, loadSeenIds, saveSeenIds, appendRecord, readJsonl, ensureDir, generateMonths };
