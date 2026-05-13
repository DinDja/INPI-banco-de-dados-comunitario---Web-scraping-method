/**
 * browser.js — Gerenciamento de sessao Playwright e interacao com o site INPI
 */

const { chromium } = require('playwright');
const { log, sleep } = require('./utils');

/**
 * Inicia o browser e cria uma pagina com sessao anonima no pePI.
 */
async function createSession(cfg) {
  const browser = await chromium.launch({ headless: cfg.headless });
  const context = await browser.newContext({ userAgent: cfg.userAgent });
  const page    = await context.newPage();
  page.setDefaultTimeout(cfg.navigationTimeout);
  await loginAnonymous(page, cfg);
  return { browser, context, page };
}

/**
 * Faz login anonimo no portal pePI navegando diretamente para loginUrl.
 * A sessao anonima e suficiente para buscar patentes.
 */
async function loginAnonymous(page, cfg) {
  log('Iniciando sessao anonima no pePI...');

  await page.goto(cfg.loginUrl, { waitUntil: 'domcontentloaded', timeout: cfg.navigationTimeout });
  await sleep(800);

  const url = page.url();

  // Se ja caiu em pagina de busca ou menu principal, sessao ativa
  if (url.includes('Base_pesquisa') || url.includes('PatenteSearch') || url.includes('jsp/patentes')) {
    log('  Sessao ja ativa. URL: ' + url);
    return;
  }

  // Aguarda qualquer forma de botao/link "Continuar"
  try {
    await page.waitForSelector(
      'input[value*="Continuar"], input[value*="continuar"], a:has-text("Continuar"), a[href*="action=login"]',
      { timeout: 12000 }
    );
  } catch (_) {
    // Pagina pode nao ter botao — tenta navegar diretamente para a busca
    log('  Botao Continuar nao encontrado — navegando direto para busca avancada...');
    await page.goto(cfg.searchUrl, { waitUntil: 'domcontentloaded', timeout: cfg.navigationTimeout });
    await sleep(500);
    return;
  }

  // Tenta input primeiro, depois <a>
  let btn = page.locator('input[value*="Continuar"], input[value*="continuar"]').first();
  if (await btn.count() === 0) {
    // O INPI usa um <a href="...LoginController?action=login"> com texto "Continuar...."
    btn = page.locator('a[href*="LoginController"], a:has-text("Continuar")').first();
  }

  if (await btn.count() > 0) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: cfg.navigationTimeout }).catch(() => {}),
      btn.click(),
    ]);
  } else {
    // Ultimo recurso: submete o formulario vazio
    await page.locator('form').first().evaluate(f => f.submit()).catch(() => {});
    await page.waitForLoadState('domcontentloaded', { timeout: cfg.navigationTimeout }).catch(() => {});
  }

  await sleep(500);
  log('  Sessao iniciada. URL: ' + page.url());
}

/**
 * Retorna os campos do formulario (seletores CSS prontos para uso).
 * Config manual tem prioridade; auto-deteccao e fallback.
 */
async function detectFormFields(page, cfg) {
  if (cfg.formFields.dateFrom && cfg.formFields.dateTo) {
    return {
      dateFrom: cfg.formFields.dateFrom.startsWith('[') ? cfg.formFields.dateFrom : `[name="${cfg.formFields.dateFrom}"]`,
      dateTo:   cfg.formFields.dateTo.startsWith('[')   ? cfg.formFields.dateTo   : `[name="${cfg.formFields.dateTo}"]`,
    };
  }

  log('  Detectando campos de data...');
  await page.goto(cfg.searchUrl, { waitUntil: 'domcontentloaded', timeout: cfg.navigationTimeout });

  const inputs = await page.locator('input[type=text], input:not([type])').all();
  for (const inp of inputs) {
    const name = (await inp.getAttribute('name') || '').toLowerCase();
    log('    input name="' + name + '"');
  }

  log('  ATENCAO: configure formFields em config.js com os nomes acima.');
  return { dateFrom: null, dateTo: null };
}

/**
 * Navega ate a busca avancada, preenche o intervalo de datas e submete.
 * Retorna o numero total de resultados (ou null se nao encontrado na pagina).
 */
async function submitSearch(page, cfg, fields, dateFrom, dateTo) {
  if (!fields.dateFrom || !fields.dateTo) {
    throw new Error('Campos de data nao configurados. Veja detectFormFields/config.js.');
  }

  // Navega para a pagina de busca avancada (sessao ja estabelecida)
  await page.goto(cfg.searchUrl, { waitUntil: 'domcontentloaded', timeout: cfg.navigationTimeout });
  await sleep(600);

  // Se redirecionou para login, refaz o login e tenta de novo...
  if (page.url().includes('LoginController') || page.url().includes('login')) {
    log('  Sessao expirada, re-login...');
    await loginAnonymous(page, cfg);
    await page.goto(cfg.searchUrl, { waitUntil: 'domcontentloaded', timeout: cfg.navigationTimeout });
    await sleep(600);
  }

  // FIX: Clica no botao accordion "Datas" para expandir a secao de data
  // O INPI usa <button class="accordion">Datas</button> para ocultar/mostrar os campos
  try {
    const datesButton = page.locator('button.accordion:has-text("Datas"), button:has-text("Datas")').first();
    if (await datesButton.count() > 0) {
      log('  Expandindo secao de datas...');
      await datesButton.click();
      await sleep(400);
    }
  } catch (_) {
    log('  Aviso: botao Datas nao encontrado — tentando preencher campos diretamente');
  }

  // Verifica se o campo existe na pagina
  const elFrom = page.locator(fields.dateFrom).first();
  if (await elFrom.count() === 0) {
    // Dump dos inputs para diagnostico
    const allInputs = await page.locator('input').all();
    const names = [];
    for (const i of allInputs) names.push(await i.getAttribute('name'));
    throw new Error('Campo "' + fields.dateFrom + '" nao encontrado. Inputs na pagina: ' + names.join(', '));
  }

  // Preenche data inicio
  await elFrom.click({ clickCount: 3 });
  await elFrom.fill(dateFrom);

  // Preenche data fim
  const elTo = page.locator(fields.dateTo).first();
  if (await elTo.count() > 0) {
    await elTo.click({ clickCount: 3 });
    await elTo.fill(dateTo);
  }

  // FIX: Configura 100 resultados por página (em vez de 20)
  // O INPI tem um campo select para "Resultados por página" ou similar
  try {
    const resultsPerPageOptions = [
      'select[name*="resultado"], select[name*="page"], select[name*="Resultado"]',
      'select:has-text("100"), select:has-text("Resultados")',
    ];
    
    for (const sel of resultsPerPageOptions) {
      const dropdown = page.locator(sel).first();
      if (await dropdown.count() > 0) {
        log('  Configurando 100 resultados por página...');
        await dropdown.selectOption('100').catch(() => {
          // Se falhar com '100', tenta com o valor da option
          return dropdown.selectOption(dropdown.locator('option:has-text("100")').first().getAttribute('value').catch(() => null));
        });
        await sleep(300);
        break;
      }
    }
  } catch (_) {
    log('  Aviso: não foi possível configurar 100 resultados por página');
  }

  // Submete o formulario
  const [response] = await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: cfg.navigationTimeout }).catch(() => null),
    page.locator('input[type=submit], button[type=submit]').first().click(),
  ]);

  await sleep(700);

  const bodyText = await page.content();

  // Detecta pagina de erro do servidor (404/500/sessao expirada)
  if (bodyText.includes('HTTP Status') || bodyText.includes('Error report')) {
    throw new Error('Servidor retornou pagina de erro apos submit. URL: ' + page.url());
  }

  // Extrai total de resultados
  const match = bodyText.match(/(\d[\d\.,]*)\s*(resultado|registro|patente|document)/i);
  const total = match ? parseInt(match[1].replace(/[.,]/g, ''), 10) : null;

  // Detecta "nenhum resultado"
  if (/nenhum|nao foram|no result/i.test(bodyText) && !match) return 0;

  return total;
}

/**
 * Extrai as patentes da pagina de listagem atual.
 * Retorna array de objetos com os campos da tabela de resultados.
 */
async function extractListPage(page, cfg) {
  const patents = [];
  const currentUrl = page.url();

  // Guarda de seguranca: se ainda estamos na pagina de busca, nao e resultados
  if (currentUrl.includes('PatenteSearch') && !(await page.content()).includes('Resultados')) {
    log('  Pagina de busca sem resultados visivel.');
    return patents;
  }

  // --- Estrategia: encontrar a tabela de resultados ---
  // O INPI retorna uma tabela com cabecalho contendo "Numero"/"Titulo"/"Depositante"
  const tables = await page.locator('table').all();
  let resultTable = null;

  for (const table of tables) {
    const headerText = (await table.locator('tr').first().innerText().catch(() => '')).toLowerCase();
    const hasPatentHeaders =
      (headerText.includes('n') && (headerText.includes('t') || headerText.includes('d'))) ||
      headerText.includes('pedido') ||
      headerText.includes('patente') ||
      headerText.includes('depositante');

    // Conta linhas de dados (pelo menos 2 para ser uma tabela de resultados)
    const rowCount = await table.locator('tr').count();
    if (rowCount >= 2 && hasPatentHeaders) {
      resultTable = table;
      break;
    }
  }

  // Fallback: tabela com mais linhas de dados
  if (!resultTable) {
    let maxRows = 0;
    for (const table of tables) {
      const count = await table.locator('tr').count();
      if (count > maxRows) { maxRows = count; resultTable = table; }
    }
  }

  if (!resultTable) {
    log('  Nenhuma tabela encontrada na pagina.');
    return patents;
  }

  const rows = await resultTable.locator('tr').all();

  // Mapeia cabecalhos para indices de coluna
  let headers = [];
  let dataStart = 1;
  for (let i = 0; i < Math.min(rows.length, 3); i++) {
    const cells = await rows[i].locator('th, td').all();
    if (cells.length >= 3) {
      for (const cell of cells) {
        headers.push((await cell.innerText()).trim().toLowerCase());
      }
      dataStart = i + 1;
      break;
    }
  }

  log('  Cabecalhos detectados: ' + headers.join(' | '));

  const idx = {
    numero:       findCol(headers, ['n°', 'numero', 'número', 'pedido', 'processo']),
    titulo:       findCol(headers, ['titulo', 'título', 'title']),
    depositante:  findCol(headers, ['depositante', 'titular', 'requerente']),
    inventor:     findCol(headers, ['inventor']),
    ipc:          findCol(headers, ['ipc', 'cip', 'classe', 'classificac']),
    data_deposito:findCol(headers, ['data', 'deposit', 'depósito']),
    situacao:     findCol(headers, ['situac', 'situaç', 'status', 'despacho']),
  };

  log('  Mapeamento de colunas: ' + JSON.stringify(idx));

  for (let i = dataStart; i < rows.length; i++) {
    const cells = await rows[i].locator('td').all();
    if (cells.length < 2) continue;

    const texts = [];
    for (const cell of cells) {
      texts.push((await cell.innerText()).trim());
    }
    if (texts.every(t => !t)) continue;

    const numero = texts[idx.numero ?? 0] ?? '';

    // Filtros anti-lixo:
    // 1. Numero muito curto ou parece texto de navegacao
    if (numero.length < 5) continue;
    // 2. Contem quebras de linha = provavelmente e a celula do formulario de busca
    if (numero.includes('\n') && numero.length > 80) continue;
    // 3. Parece ser linha de cabecalho repetida
    if (/n[uú]mero|pedido|processo/i.test(numero) && numero.length < 30) continue;

    const entry = {
      // Ordem real das colunas do pePI (quando headers nao sao detectados):
      // 0=numero | 1=data_deposito | 2=titulo | 3=depositante | 4=ipc | 5=situacao
      numero:        numero || null,
      titulo:        texts[idx.titulo        ?? 2] ?? null,
      depositante:   texts[idx.depositante   ?? 3] ?? null,
      inventor:      idx.inventor  != null ? (texts[idx.inventor]  ?? null) : null,
      ipc:           texts[idx.ipc           ?? 4] ?? null,
      data_deposito: texts[idx.data_deposito ?? 1] ?? null,
      situacao:      texts[idx.situacao      ?? 5] ?? null,
      _scraped_at:   new Date().toISOString(),
    };

    // FIX: URL de detalhe — resolve relativa corretamente usando URL base da pagina
    const link = rows[i].locator('a').first();
    if (await link.count() > 0) {
      const href = await link.getAttribute('href');
      if (href) {
        try {
          // Usa o URL da pagina atual como base para resolver URLs relativas
          const base = page.url();
          entry.url_detalhe = new URL(href, base).href;
        } catch (_) {
          entry.url_detalhe = cfg.baseUrl + '/' + href.replace(/^\/+/, '');
        }
      }
    }

    patents.push(entry);
  }

  return patents;
}

/** Encontra o indice da primeira coluna cujo texto contem algum dos keywords */
function findCol(headers, keywords) {
  const idx = headers.findIndex(h => keywords.some(k => h.includes(k)));
  return idx >= 0 ? idx : null;
}

/**
 * Extrai dados detalhados de uma patente em nova aba (nao perde a pagina de lista).
 */
async function fetchPatentDetail(context, patent, cfg) {
  if (!patent.url_detalhe) return patent;

  const detailPage = await context.newPage();
  detailPage.setDefaultTimeout(cfg.navigationTimeout);

  try {
    await detailPage.goto(patent.url_detalhe, { waitUntil: 'domcontentloaded', timeout: cfg.navigationTimeout });
    await sleep(300);

    const detail = { ...patent };

    // Extrai pares label:valor de todas as tabelas
    const tables = await detailPage.locator('table').all();
    for (const table of tables) {
      const rows = await table.locator('tr').all();
      for (const row of rows) {
        const cells = await row.locator('td').all();
        if (cells.length === 2) {
          const rawLabel = (await cells[0].innerText()).trim().replace(/:$/, '');
          const value    = (await cells[1].innerText()).trim();
          if (rawLabel && value && rawLabel.length < 60) {
            const label = rawLabel.toLowerCase()
              .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
              .replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
            if (label) detail['det_' + label] = value;
          }
        }
      }
    }

    // Titulo completo
    const heading = detailPage.locator('h1, h2, .titulo, td.titulo').first();
    if (await heading.count() > 0) {
      detail.titulo_completo = (await heading.innerText()).trim();
    }

    return detail;
  } catch (err) {
    log('  Detalhe falhou para ' + patent.numero + ': ' + err.message);
    return { ...patent, _detail_error: err.message };
  } finally {
    await detailPage.close();
  }
}

/**
 * Clica em "proxima pagina" se existir. Retorna true se navegou.
 * Tenta multiplos seletores para encontrar o botao de paginacao.
 */
async function goToNextPage(page, cfg) {
  // Estrategia 1: procura por links com "Proxima" ou ">>" ou ">"
  const selectors = [
    'a:has-text("Próxima")', 'a:has-text("Proxima")',
    'a:has-text("Próximo")', 'a:has-text("Proximo")',
    'a:has-text(">>")',
    'a:has-text(">")',
    'input[value=">>"]', 'input[value*="xima"]',
    'a[title*="xima" i]', 'a[title*="next" i]',
    'button:has-text("Proxima")',
  ];

  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.count() === 0) continue;

      const disabled = await el.getAttribute('disabled');
      const cls = (await el.getAttribute('class') || '').toLowerCase();
      const ariaDisabled = await el.getAttribute('aria-disabled');

      // Verifica se esta desabilitado
      if (disabled === '' || disabled === 'true' || ariaDisabled === 'true') continue;
      if (cls && (cls.includes('disabled') || cls.includes('inativo'))) continue;

      log('  ▶ Proxima pagina encontrada, clicando...');
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: cfg.navigationTimeout }).catch(() => {}),
        el.click(),
      ]);
      await sleep(cfg.pauseBetweenPages);
      return true;
    } catch (_) {}
  }

  return false;
}

module.exports = { createSession, loginAnonymous, detectFormFields, submitSearch, extractListPage, fetchPatentDetail, goToNextPage };
