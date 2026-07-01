/**
 * sync_patentes_rpi.js
 *
 * Sincroniza a base de patentes com a RPI:
 * 1) adiciona novos registros (sem duplicar os existentes);
 * 2) preenche campos nulos/vazios dos registros ja salvos.
 *
 * Uso:
 *   node sync_patentes_rpi.js
 */

const { log } = require('./utils');
const { runScraperPatentesRpi } = require('./scraper_patentes_rpi');
const { runEnrichPatentesNulls } = require('./enrich_patentes_nulls_rpi');

async function runSyncPatentesRpi() {
  log('===================================================');
  log('  INPI Patentes Sync - novos + preenchimento nulos');
  log('===================================================');

  log('Etapa 1/2: coletando novos registros da RPI...');
  await runScraperPatentesRpi();

  log('Etapa 2/2: preenchendo campos nulos nos registros existentes...');
  await runEnrichPatentesNulls();

  log('Sincronizacao concluida.');
}

runSyncPatentesRpi().catch((err) => {
  console.error('Erro fatal na sincronizacao de patentes:', err.message);
  console.error(err.stack);
  process.exit(1);
});
