/**
 * test_quick.js — Teste rápido de 3 meses (2024-01 até 2024-03)
 * Para validar antes de rodar o scraper completo de 2000-2026.
 *
 * Executa: node test_quick.js
 * Gera: data/patentes.jsonl (mesmo arquivo do scraper)
 */

const cfg = require('./config');
const { log } = require('./utils');

// Override para teste rapido (apenas 3 meses)
cfg.startDate = '01/01/2024';
cfg.endDate   = '31/03/2024';
cfg.mode      = 'list';

// Importa e roda o scraper
const path = require('path');
delete require.cache[require.resolve('./scraper')];

log('🚀 Teste rápido: ' + cfg.startDate + ' até ' + cfg.endDate);
log('Modo: ' + cfg.mode);
log('Saída: ' + cfg.outputFile);

require('./scraper');
