/**
 * config_patentes_rpi.js - Configuracoes do scraper de Patentes via RPI (Secao VI)
 */

const path = require('path');

function resolveDataPath(envValue, fallbackRelativePath) {
  const raw = String(envValue || fallbackRelativePath);
  return path.isAbsolute(raw) ? raw : path.join(__dirname, raw);
}

module.exports = {
  // Usa o mesmo arquivo final de patentes para manter compatibilidade com a API
  outputFile: resolveDataPath(process.env.INPI_PATENTES_OUTPUT_FILE, 'data/patentes.jsonl'),

  // Checkpoints dedicados para nao conflitar com o fluxo antigo via buscaweb
  progressFile: resolveDataPath(process.env.INPI_PATENTES_PROGRESS_FILE, 'data/progress_patentes_rpi.json'),
  seenIdsFile: resolveDataPath(process.env.INPI_PATENTES_SEENIDS_FILE, 'data/seen_ids_patentes_rpi.json'),
  errorLogFile: resolveDataPath(process.env.INPI_PATENTES_ERRORLOG_FILE, 'data/errors_patentes_rpi.log'),

  // Fonte oficial: RPI secao VI (Patentes)
  rpiIndexUrl: 'https://revistas.inpi.gov.br/rpi/',
  rpiZipUrlTemplate: 'https://revistas.inpi.gov.br/txt/P{RPI}.zip',

  // Publicacao por secoes comecou na RPI 2404
  startRpi: Number(process.env.INPI_PATENTES_START_RPI || 2404),
  endRpi: process.env.INPI_PATENTES_END_RPI ? Number(process.env.INPI_PATENTES_END_RPI) : null,

  // Regras de qualidade
  // true = ignora registros sem titular/depositante
  requireDepositante: String(process.env.INPI_PATENTES_REQUIRE_DEPOSITANTE || 'true').toLowerCase() !== 'false',

  // true = mantem somente 1 registro por numero de processo
  dedupeByNumeroOnly: String(process.env.INPI_PATENTES_DEDUPE_BY_NUMERO || 'true').toLowerCase() !== 'false',

  // Se true, remove patentes*.jsonl + checkpoints deste scraper antes de iniciar.
  freshStart: String(process.env.INPI_PATENTES_RPI_FRESH_START || 'false').toLowerCase() === 'true',

  // Armazenamento (mesma logica de rotacao por tamanho)
  maxJsonlPartSizeMB: Number(process.env.INPI_MAX_JSONL_PART_MB || 25),

  // Retomada
  resumeFromNextRpi: true,

  // Resiliencia e desempenho
  saveEveryNRecords: 500,
  pauseBetweenRpis: 300,
  maxRetries: 3,
  pauseOnError: 4000,
  requestTimeout: 45000,

  // HTTP
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) INPI-Patentes-RPI-Scraper/1.0',
};