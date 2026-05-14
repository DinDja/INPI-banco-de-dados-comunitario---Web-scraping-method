/**
 * config_programas.js - Configuracoes do scraper de Programas de Computador (INPI)
 */

const path = require('path');

module.exports = {
  // Arquivos de saida dedicados (nao mistura com patentes)
  outputFile: path.join(__dirname, 'data', 'programas.jsonl'),
  progressFile: path.join(__dirname, 'data', 'progress_programas.json'),
  seenIdsFile: path.join(__dirname, 'data', 'seen_ids_programas.json'),
  errorLogFile: path.join(__dirname, 'data', 'errors_programas.log'),

  // Fonte oficial: RPI secao VII (Programa de Computador)
  rpiIndexUrl: 'https://revistas.inpi.gov.br/rpi/',
  rpiZipUrlTemplate: 'https://revistas.inpi.gov.br/txt/PC{RPI}.zip',

  // A secao separada de Programa comecou na RPI 2404
  startRpi: Number(process.env.INPI_PROGRAMAS_START_RPI || 2404),
  // Se null, detecta automaticamente a RPI mais recente no indice
  endRpi: process.env.INPI_PROGRAMAS_END_RPI ? Number(process.env.INPI_PROGRAMAS_END_RPI) : null,

  // Garantia contra indeferidos:
  // - Mantem somente despachos 730 (Expedicao do Certificado de Registro)
  // - Tambem descarta qualquer registro cujo texto do despacho mencione indeferimento
  allowedDispatchCodes: ['730'],
  rejectIfTextMatches: ['indefer'],

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
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) INPI-Programas-Scraper/1.0',
};