/**
 * scraper.js — Robô principal de scraping do portal pePI / INPI
 *
 * Modos de execução:
 *   node scraper.js           → usa modo definido em config.js (padrão: 'list')
 *   node scraper.js list      → só lista básica (rápido)
 *   node scraper.js detail    → lista + detalhes completos (lento)
 *   node scraper.js enrich    → enriquece patentes já salvas sem detalhe
 *
 * Retoma automaticamente de onde parou (via progress.json e seen_ids.json).
 */

const path = require('path');
const dayjs = require('dayjs');

const cfg = require('./config');
const {
  log, logError, sleep,
  loadProgress, saveProgress,
  loadSeenIds, saveSeenIds,
  appendRecord, readJsonl,
  ensureDir, generateMonths,
} = require('./utils');
const {
  createSession, loginAnonymous,
  detectFormFields, submitSearch,
  extractListPage, fetchPatentDetail,
  goToNextPage,
} = require('./browser');

// Modo via argumento CLI
const modeArg = process.argv[2];
if (modeArg) cfg.mode = modeArg;

// Garante que o diretório de dados existe
ensureDir(path.dirname(cfg.outputFile));

// ─────────────────────────────────────────────────────────────────────────────
// MODO: list / detail
// ─────────────────────────────────────────────────────────────────────────────

async function runScrape() {
  const progress = loadProgress(cfg.progressFile);
  const seenIds  = loadSeenIds(cfg.seenIdsFile);

  log('═══════════════════════════════════════════════════');
  log('  INPI Patent Scraper — modo: ' + cfg.mode.toUpperCase());
  log('═══════════════════════════════════════════════════');
  log('Saída: ' + cfg.outputFile);
  log('Patentes já salvas: ' + progress.totalSaved + ' | IDs únicos: ' + seenIds.size);

  const { browser, context, page } = await createSession(cfg);

  try {
    let fields = await detectFormFields(page, cfg);
    log('Campos detectados → dateFrom: "' + fields.dateFrom + '" | dateTo: "' + fields.dateTo + '"');

    const months = generateMonths(cfg.startDate, cfg.endDate);
    log('Meses a varrer: ' + months.length + ' (' + cfg.startDate + ' → ' + cfg.endDate + ')\n');
    log('Rotacao JSONL: ' + cfg.maxJsonlPartSizeMB + 'MB por arquivo (base: ' + cfg.outputFile + ')\n');

    if (months.length === 0) {
      throw new Error('Nenhum mês gerado para varredura. Verifique startDate/endDate em config.js (DD/MM/YYYY).');
    }

    let startIdx = 0;
    if (progress.lastMonth) {
      const idx = months.indexOf(progress.lastMonth);
      if (idx >= 0) {
        if (cfg.resumeFromNextMonth) {
          startIdx = idx + 1;
          if (startIdx >= months.length) {
            log('✅ Checkpoint já está no último mês (' + progress.lastMonth + '). Nada pendente para varrer.\n');
            return;
          }
          log('⏩ Retomando no mês seguinte ao checkpoint: ' + progress.lastMonth + ' → ' + months[startIdx] + '\n');
        } else {
          startIdx = idx;
          log('⏩ Retomando a partir de ' + progress.lastMonth + '\n');
        }
      } else {
        log('⚠️ Último mês salvo (' + progress.lastMonth + ') não encontrado no intervalo atual; iniciando do começo.\n');
      }
    }

    let currentOutputFile = null;

    for (let mi = startIdx; mi < months.length; mi++) {
      const month = months[mi];
      const [year, mon] = month.split('-');
      const lastDay = dayjs(year + '-' + mon + '-01').endOf('month').date();
      const dateFrom = '01/' + mon + '/' + year;
      const dateTo   = String(lastDay).padStart(2,'0') + '/' + mon + '/' + year;

      log('📅 ' + month + ' (' + dateFrom + ' → ' + dateTo + ')');

      if (mi > 0 && mi % cfg.reloginEveryNMonths === 0) {
        log('  🔄 Re-login periódico...');
        await loginAnonymous(page, cfg);
        fields = await detectFormFields(page, cfg);
      }

      let success = false;
      for (let attempt = 1; attempt <= cfg.maxRetries; attempt++) {
        try {
          const total = await submitSearch(page, cfg, fields, dateFrom, dateTo);
          log('  Resultados: ' + (total ?? '?'));

          if (total === 0) { success = true; break; }

          const url = page.url();
          if (url.includes('Error') || url.includes('error')) {
            throw new Error('Página de erro: ' + url);
          }

          let pageNum      = 1;
          let newThisMonth = 0;

          do {
            log('  Página ' + pageNum + '...');
            const patents = await extractListPage(page, cfg);
            log('    ' + patents.length + ' patentes extraídas');

            for (const patent of patents) {
              const id = patent.numero?.trim();
              if (!id || seenIds.has(id)) continue;

              let record = patent;

              if (cfg.mode === 'detail' && patent.url_detalhe) {
                record = await fetchPatentDetail(context, patent, cfg);
                await sleep(cfg.pauseBetweenDetails);
              }

              seenIds.add(id);
              const writtenFile = appendRecord(cfg.outputFile, record, { maxPartSizeMB: cfg.maxJsonlPartSizeMB });
              if (writtenFile !== currentOutputFile) {
                currentOutputFile = writtenFile;
                log('  🗂 Gravando em: ' + writtenFile);
              }
              newThisMonth++;
              progress.totalSaved++;

              if (progress.totalSaved % 500 === 0) {
                log('  💾 Total salvo: ' + progress.totalSaved);
                saveSeenIds(cfg.seenIdsFile, seenIds);
                saveProgress(cfg.progressFile, { ...progress, lastMonth: month });
              }
            }

            await sleep(cfg.pauseBetweenPages);
            pageNum++;
          } while (await goToNextPage(page, cfg));

          log('  ✅ ' + month + ' — novas patentes: ' + newThisMonth);
          success = true;
          break;

        } catch (err) {
          logError('Tentativa ' + attempt + '/' + cfg.maxRetries + ' falhou para ' + month + ': ' + err.message, cfg.errorLogFile);
          if (attempt < cfg.maxRetries) {
            log('  ⏳ Aguardando ' + (cfg.pauseOnError / 1000) + 's...');
            await sleep(cfg.pauseOnError);
            try { await loginAnonymous(page, cfg); fields = await detectFormFields(page, cfg); } catch (_) {}
          }
        }
      }

      if (!success) {
        logError('Mês ' + month + ' falhou após ' + cfg.maxRetries + ' tentativas — pulando.', cfg.errorLogFile);
      }

      saveProgress(cfg.progressFile, { ...progress, lastMonth: month });
      saveSeenIds(cfg.seenIdsFile, seenIds);

      await sleep(cfg.pauseBetweenMonths);
    }

    log('\n🎉 Scraping concluído! Total: ' + progress.totalSaved + ' patentes');

  } finally {
    saveProgress(cfg.progressFile, progress);
    saveSeenIds(cfg.seenIdsFile, seenIds);
    await browser.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MODO: enrich
// ─────────────────────────────────────────────────────────────────────────────

async function runEnrich() {
  log('═══════════════════════════════════════════════════');
  log('  INPI Patent Scraper — ENRICH (enriquecimento)');
  log('═══════════════════════════════════════════════════');

  const records  = readJsonl(cfg.outputFile);
  const toEnrich = records.filter(r => r.url_detalhe && !r.det_titulo && !r._detail_error);

  log('Registros a enriquecer: ' + toEnrich.length + ' de ' + records.length + ' total');

  if (toEnrich.length === 0) {
    log('Nada a enriquecer. Saindo.');
    return;
  }

  const { browser, context } = await createSession(cfg);

  const enrichedFile = cfg.outputFile.replace('.jsonl', '_enriched.jsonl');
  const enrichedIds  = new Set();
  const fs = require('fs');

  if (fs.existsSync(enrichedFile)) {
    readJsonl(enrichedFile).forEach(r => enrichedIds.add(r.numero?.trim()));
  }

  try {
    let done = 0;
    let currentEnrichedOutputFile = null;
    for (const record of toEnrich) {
      const id = record.numero?.trim();
      if (enrichedIds.has(id)) { done++; continue; }

      const enriched = await fetchPatentDetail(context, record, cfg);
      const writtenFile = appendRecord(enrichedFile, enriched, { maxPartSizeMB: cfg.maxJsonlPartSizeMB });
      if (writtenFile !== currentEnrichedOutputFile) {
        currentEnrichedOutputFile = writtenFile;
        log('  🗂 Gravando enriquecimento em: ' + writtenFile);
      }
      enrichedIds.add(id);
      done++;

      if (done % 100 === 0) {
        log('  💾 ' + done + '/' + toEnrich.length + ' enriquecidos');
      }

      await sleep(cfg.pauseBetweenDetails);
    }

    log('\n🎉 Enriquecimento concluído! ' + done + ' registros processados.');
    log('Saída: ' + enrichedFile);

  } finally {
    await browser.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  if (cfg.mode === 'enrich') {
    await runEnrich();
  } else {
    await runScrape();
  }
}

main().catch(err => {
  log('💥 Erro fatal: ' + err.message);
  console.error(err.stack);
  process.exit(1);
});
