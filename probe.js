/**
 * probe.js — Inspeciona o formulário de busca do INPI e mostra os campos reais.
 * Execute ANTES do scraper para confirmar os seletores corretos.
 *
 * node probe.js
 */

const { chromium } = require('playwright');

const BASE_URL  = 'https://busca.inpi.gov.br/pePI';
const LOGIN_URL  = `${BASE_URL}/servlet/LoginController?action=login`;
const BASIC_URL  = `${BASE_URL}/jsp/patentes/PatenteSearchBasico.jsp`;
const ADV_URL    = `${BASE_URL}/jsp/patentes/PatenteSearchAvancado.jsp`;

async function probe() {
  console.log('Abrindo navegador...');
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  console.log('Acessando pagina de login...');
  // FIX: vai para loginUrl para garantir que o botao Continuar aparece
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Clica em Continuar (login anônimo)
  const btns = await page.locator('input[type=submit], input[type=button], a').all();
  for (const btn of btns) {
    const text = await btn.innerText().catch(() => '') || await btn.getAttribute('value') || '';
    if (text.toLowerCase().includes('continuar')) {
      console.log(`Clicando em: "${text}"`);
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {}),
        btn.click(),
      ]);
      break;
    }
  }

  await page.waitForTimeout(2000);
  console.log('\nURL atual:', page.url());

  // Navega para a busca AVANCADA (tem campos de data)
  console.log('\nNavegando para busca avancada...');
  await page.goto(ADV_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1500);
  console.log('URL avancado:', page.url());

  // Dump de todos os inputs/selects/textareas do formulário
  console.log('\n=== CAMPOS DO FORMULÁRIO ===');
  const inputs = await page.locator('input, select, textarea').all();
  for (const inp of inputs) {
    const tag = await inp.evaluate(el => el.tagName);
    const name = await inp.getAttribute('name') || '(sem name)';
    const type = await inp.getAttribute('type') || tag.toLowerCase();
    const value = await inp.getAttribute('value') || '';
    const placeholder = await inp.getAttribute('placeholder') || '';
    console.log(`  [${type}] name="${name}" value="${value}" placeholder="${placeholder}"`);
  }

  // Dump de todos os forms
  console.log('\n=== FORMULÁRIOS ===');
  const forms = await page.locator('form').all();
  for (const form of forms) {
    const action = await form.getAttribute('action') || '(sem action)';
    const method = await form.getAttribute('method') || 'GET';
    console.log(`  <form action="${action}" method="${method}">`);
  }

  // Testa uma busca com datas
  console.log('\n=== TESTANDO BUSCA AVANCADA POR DATA ===');
  // Procura especificamente por campos com "data" no nome
  const dateInputs = await page.locator('input[name*="ata"], input[name*="ATA"]').all();
  console.log(`  Inputs com "data" no nome: ${dateInputs.length}`);
  for (const inp of dateInputs) {
    const name = await inp.getAttribute('name');
    const id   = await inp.getAttribute('id');
    console.log(`    name="${name}" id="${id}"`);
  }

  console.log('\nAguarde 30s para inspecionar manualmente no browser aberto...');
  await page.waitForTimeout(30000);

  await browser.close();
}

probe().catch(console.error);
