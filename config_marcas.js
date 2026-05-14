/**
 * config_marcas.js - Configuracoes do scraper de Marcas (INPI)
 */

const path = require('path');

module.exports = {
  // Arquivos de saida dedicados (nao mistura com patentes/programas)
  outputFile: path.join(__dirname, 'data', 'marcas.jsonl'),
  progressFile: path.join(__dirname, 'data', 'progress_marcas.json'),
  seenIdsFile: path.join(__dirname, 'data', 'seen_ids_marcas.json'),
  errorLogFile: path.join(__dirname, 'data', 'errors_marcas.log'),

  // Fonte oficial: RPI secao V (Marcas)
  rpiIndexUrl: 'https://revistas.inpi.gov.br/rpi/',
  rpiZipUrlTemplate: 'https://revistas.inpi.gov.br/txt/RM{RPI}.zip',

  // A publicacao por secoes comecou na RPI 2404
  startRpi: Number(process.env.INPI_MARCAS_START_RPI || 2404),
  // Se null, detecta automaticamente a RPI mais recente no indice
  endRpi: process.env.INPI_MARCAS_END_RPI ? Number(process.env.INPI_MARCAS_END_RPI) : null,

  // Opcional: filtrar por codigos de despacho (ex: IPAS029,IPAS009)
  allowedDispatchCodes: process.env.INPI_MARCAS_DISPATCH_CODES
    ? String(process.env.INPI_MARCAS_DISPATCH_CODES)
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
    : [],

  // Por padrao, mantem apenas registros com nome de marca preenchido.
  // Defina INPI_MARCAS_REQUIRE_NOME=false para manter todos os despachos.
  requireMarcaName: String(process.env.INPI_MARCAS_REQUIRE_NOME || 'true').toLowerCase() !== 'false',

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
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) INPI-Marcas-Scraper/1.0',
};