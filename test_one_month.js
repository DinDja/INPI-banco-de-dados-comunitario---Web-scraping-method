/**
 * test_one_month.js — Testa a busca de um unico mes para validar o scraper.
 * Executa: node test_one_month.js
 */

const cfg = require('./config');
const { createSession, detectFormFields, submitSearch, extractListPage } = require('./browser');
const { log } = require('./utils');

// Testa Janeiro/2024 (deve ter resultados)
const TEST_FROM = '01/01/2024';
const TEST_TO   = '31/01/2024';

cfg.headless = false; // visivel para inspecao

async function test() {
  log('=== TESTE: ' + TEST_FROM + ' ate ' + TEST_TO + ' ===');

  const { browser, context, page } = await createSession(cfg);

  try {
    const fields = await detectFormFields(page, cfg);
    log('Campos: dateFrom="' + fields.dateFrom + '" dateTo="' + fields.dateTo + '"');

    const total = await submitSearch(page, cfg, fields, TEST_FROM, TEST_TO);
    log('Total de resultados reportado: ' + total);
    log('URL apos busca: ' + page.url());

    const patents = await extractListPage(page, cfg);
    log('Patentes extraidas da pagina 1: ' + patents.length);

    if (patents.length > 0) {
      log('\nPrimeiros 3 registros:');
      patents.slice(0, 3).forEach((p, i) => {
        log('  [' + i + '] numero="' + p.numero + '" titulo="' + (p.titulo || '').substring(0, 50) + '" data="' + p.data_deposito + '"');
        log('       url="' + p.url_detalhe + '"');
      });
    } else {
      log('\nNenhuma patente extraida!');
    }

    // Inspeciona elementos de paginacao
    log('\n=== ELEMENTOS DE NAVEGACAO ===');
    const allLinks = await page.locator('a').all();
    log('Links na pagina: ' + allLinks.length);
    for (let i = 0; i < Math.min(allLinks.length, 15); i++) {
      const text = await allLinks[i].innerText().catch(() => '');
      const href = await allLinks[i].getAttribute('href');
      log('  a[' + i + '] text="' + text.trim().substring(0, 30) + '" href="' + (href || '').substring(0, 40) + '"');
    }

    // Inspeciona inputs/buttons
    log('\n=== BUTTONS/INPUTS ===');
    const allButtons = await page.locator('button, input[type=button], input[type=submit]').all();
    for (let i = 0; i < Math.min(allButtons.length, 10); i++) {
      const value = await allButtons[i].getAttribute('value');
      const text = await allButtons[i].innerText().catch(() => '');
      const type = await allButtons[i].evaluate(el => el.tagName);
      log('  [' + i + '] ' + type + ' value="' + value + '" text="' + text.trim().substring(0, 20) + '"');
    }

    log('\nAguardando 15s para inspecao visual...');
    await new Promise(r => setTimeout(r, 15000));

  } finally {
    await browser.close();
  }
}

test().catch(err => {
  log('ERRO: ' + err.message);
  console.error(err.stack);
  process.exit(1);
});
