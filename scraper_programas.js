/**
 * scraper_programas.js - Coleta de Programas de Computador do INPI via RPI (Secao VII)
 *
 * Caracteristicas:
 * - Nao altera codigo/arquivos do scraper de patentes.
 * - Usa arquivos dedicados: programas.jsonl, progress_programas.json, seen_ids_programas.json.
 * - Mantem a mesma logica de rotacao JSONL por tamanho (25MB por padrao).
 * - Exclui indeferidos de forma conservadora:
 *   1) Mantem somente despacho 730 (Expedicao do Certificado de Registro).
 *   2) Rejeita texto de despacho contendo "indefer".
 *
 * Execucao:
 *   node scraper_programas.js
 */

const path = require('path');
const AdmZip = require('adm-zip');

const cfg = require('./config_programas');
const {
  log,
  logError,
  sleep,
  loadProgress,
  saveProgress,
  loadSeenIds,
  saveSeenIds,
  appendRecord,
  ensureDir,
} = require('./utils');

ensureDir(path.dirname(cfg.outputFile));

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeNumeroKey(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

function splitList(value) {
  return normalizeWhitespace(value)
    .split(/\s*;\s*/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function countMatches(text, regex) {
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

function encodingNoiseScore(text) {
  if (!text) return Number.MAX_SAFE_INTEGER;

  let score = 0;
  score += countMatches(text, /\uFFFD/g) * 100;
  score += countMatches(text, /Ã[\u0080-\u00BFA-Za-z]/g) * 12;
  score += countMatches(text, /Â[\u0080-\u00BFA-Za-z]/g) * 10;
  score += countMatches(text, /â[\u0080-\u00BF]/g) * 10;
  score += countMatches(text, /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) * 50;

  return score;
}

function decodeZipEntry(buffer) {
  const utf8 = buffer.toString('utf8');
  const latin1 = buffer.toString('latin1');

  const utf8Noise = encodingNoiseScore(utf8);
  const latin1Noise = encodingNoiseScore(latin1);

  return utf8Noise <= latin1Noise ? utf8 : latin1;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || cfg.requestTimeout);

  try {
    return await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': cfg.userAgent,
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function detectLatestRpiNumber() {
  const response = await fetchWithTimeout(cfg.rpiIndexUrl);
  if (!response.ok) {
    throw new Error('Falha ao ler indice RPI: HTTP ' + response.status);
  }

  const html = await response.text();

  // Primeira ocorrencia da tabela (mais recente)
  const match = html.match(/<td[^>]*>\s*(\d{4})\s*<\/td>\s*<td[^>]*>\s*\d{2}\/\d{2}\/\d{4}\s*<\/td>/i);
  if (!match) {
    throw new Error('Nao foi possivel detectar o numero da RPI mais recente no indice.');
  }

  return Number(match[1]);
}

function buildZipUrl(rpiNumber) {
  return cfg.rpiZipUrlTemplate.replace('{RPI}', String(rpiNumber));
}

async function downloadZipBuffer(zipUrl) {
  const response = await fetchWithTimeout(zipUrl);

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error('Falha ao baixar ZIP: HTTP ' + response.status + ' (' + zipUrl + ')');
  }

  const arr = await response.arrayBuffer();
  return Buffer.from(arr);
}

function parseHeaderMetaFromTxt(txtContent, fallbackRpi) {
  const firstLine = normalizeWhitespace((txtContent.split(/\r?\n/)[0] || ''));
  const match = firstLine.match(/No\s+(\d+)\s+de\s+(\d{2}\/\d{2}\/\d{4})/i);

  if (!match) {
    return {
      rpiNumero: fallbackRpi,
      rpiDataPublicacao: null,
    };
  }

  return {
    rpiNumero: Number(match[1]),
    rpiDataPublicacao: match[2],
  };
}

function shouldRejectByText(value) {
  const text = normalizeWhitespace(value).toLowerCase();
  if (!text) return false;

  return cfg.rejectIfTextMatches.some((needle) => text.includes(String(needle || '').toLowerCase()));
}

function buildRecordFromFields(fields, meta, sourceZipUrl) {
  const despachoCodigo = normalizeWhitespace(fields.Cd || '');
  const despachoTitulo = normalizeWhitespace(fields._dispatchTitle || '');
  const despachoComentario = normalizeWhitespace(fields.co || '');

  if (cfg.allowedDispatchCodes.length > 0 && !cfg.allowedDispatchCodes.includes(despachoCodigo)) {
    return null;
  }

  if (shouldRejectByText(despachoTitulo) || shouldRejectByText(despachoComentario)) {
    return null;
  }

  const numero = normalizeWhitespace(fields.Np || '');
  if (!numero) return null;

  const titulares = splitList(fields['73'] || '');
  const autores = splitList(fields.Cr || '');
  const linguagens = splitList(fields.Lg || '');
  const camposAplicacao = splitList(fields.Cp || '');
  const tiposPrograma = splitList(fields.Tp || '');

  return {
    numero,
    titulo: normalizeWhitespace(fields['54'] || '') || null,
    titular: titulares.join('; ') || null,
    autor: autores.join('; ') || null,
    linguagem: linguagens.join('; ') || null,
    campo_aplicacao: camposAplicacao.join('; ') || null,
    tipo_programa: tiposPrograma.join('; ') || null,
    data_criacao: normalizeWhitespace(fields.Dl || '') || null,
    despacho_codigo: despachoCodigo || null,
    despacho_titulo: despachoTitulo || null,
    despacho_comentario: despachoComentario || null,
    rpi_numero: meta.rpiNumero,
    rpi_data_publicacao: meta.rpiDataPublicacao,
    fonte_zip_url: sourceZipUrl,
    _scraped_at: new Date().toISOString(),
  };
}

function parseRecordsFromTxt(txtContent, fallbackRpi, sourceZipUrl) {
  const meta = parseHeaderMetaFromTxt(txtContent, fallbackRpi);
  const lines = txtContent.split(/\r?\n/);

  const records = [];
  let current = null;

  const flushCurrent = () => {
    if (!current) return;
    const rec = buildRecordFromFields(current, meta, sourceZipUrl);
    if (rec) records.push(rec);
    current = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = line.match(/^\(([A-Za-z0-9_]{1,8})\)\s*(.*)$/);
    if (!match) continue;

    const tag = match[1];
    const value = normalizeWhitespace(match[2]);

    if (tag === 'Cd') {
      flushCurrent();
      current = { Cd: value };
      continue;
    }

    if (!current) {
      continue;
    }

    if (!current[tag]) {
      current[tag] = value;
    } else {
      current[tag] = normalizeWhitespace(current[tag] + '; ' + value);
    }
  }

  flushCurrent();

  return {
    meta,
    records,
  };
}

function parseZipRecords(zipBuffer, rpiNumber, sourceZipUrl) {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries().filter((entry) => !entry.isDirectory);

  if (entries.length === 0) {
    throw new Error('ZIP vazio para RPI ' + rpiNumber);
  }

  const txtEntry = entries.find((entry) => /\.txt$/i.test(entry.entryName));
  if (!txtEntry) {
    throw new Error('Nao foi encontrado TXT dentro do ZIP da RPI ' + rpiNumber);
  }

  const txtContent = decodeZipEntry(txtEntry.getData());
  return parseRecordsFromTxt(txtContent, rpiNumber, sourceZipUrl);
}

async function runScraperProgramas() {
  const progress = loadProgress(cfg.progressFile);
  const seenIds = loadSeenIds(cfg.seenIdsFile);

  log('===================================================');
  log('  INPI Programas Scraper - via RPI (Secao VII)');
  log('===================================================');
  log('Saida: ' + cfg.outputFile);
  log('Registros ja salvos: ' + progress.totalSaved + ' | IDs unicos: ' + seenIds.size);

  const latestRpi = cfg.endRpi || await detectLatestRpiNumber();
  let startRpi = cfg.startRpi;

  if (progress.lastRpi) {
    const base = Number(progress.lastRpi);
    if (Number.isFinite(base)) {
      startRpi = cfg.resumeFromNextRpi ? base + 1 : base;
    }
  }

  if (startRpi > latestRpi) {
    log('Checkpoint ja esta na ultima RPI (' + latestRpi + '). Nada pendente.');
    return;
  }

  log('Intervalo de RPI: ' + startRpi + ' ate ' + latestRpi);
  log('Rotacao JSONL: ' + cfg.maxJsonlPartSizeMB + 'MB por arquivo');

  let currentOutputFile = null;

  for (let rpi = startRpi; rpi <= latestRpi; rpi++) {
    const zipUrl = buildZipUrl(rpi);
    log('\nRPI ' + rpi + ' -> ' + zipUrl);

    let success = false;

    for (let attempt = 1; attempt <= cfg.maxRetries; attempt++) {
      try {
        const zipBuffer = await downloadZipBuffer(zipUrl);

        if (!zipBuffer) {
          log('  Sem arquivo PC para esta RPI (404). Pulando.');
          success = true;
          break;
        }

        const parsed = parseZipRecords(zipBuffer, rpi, zipUrl);
        log('  Registros validos no arquivo: ' + parsed.records.length);

        let savedThisRpi = 0;

        for (const record of parsed.records) {
          const key = normalizeNumeroKey(record.numero);
          if (!key || seenIds.has(key)) continue;

          seenIds.add(key);

          const writtenFile = appendRecord(cfg.outputFile, record, {
            maxPartSizeMB: cfg.maxJsonlPartSizeMB,
          });

          if (writtenFile !== currentOutputFile) {
            currentOutputFile = writtenFile;
            log('  Gravando em: ' + writtenFile);
          }

          savedThisRpi += 1;
          progress.totalSaved += 1;

          if (progress.totalSaved % cfg.saveEveryNRecords === 0) {
            saveProgress(cfg.progressFile, { ...progress, lastRpi: rpi });
            saveSeenIds(cfg.seenIdsFile, seenIds);
            log('  Checkpoint parcial salvo em total=' + progress.totalSaved);
          }
        }

        log('  OK RPI ' + rpi + ' - novos programas: ' + savedThisRpi);
        success = true;
        break;
      } catch (err) {
        logError(
          'RPI ' + rpi + ' tentativa ' + attempt + '/' + cfg.maxRetries + ' falhou: ' + err.message,
          cfg.errorLogFile,
        );

        if (attempt < cfg.maxRetries) {
          log('  Aguardando ' + Math.round(cfg.pauseOnError / 1000) + 's para nova tentativa...');
          await sleep(cfg.pauseOnError);
        }
      }
    }

    if (!success) {
      logError('RPI ' + rpi + ' falhou apos ' + cfg.maxRetries + ' tentativas. Pulando.', cfg.errorLogFile);
    }

    saveProgress(cfg.progressFile, { ...progress, lastRpi: rpi });
    saveSeenIds(cfg.seenIdsFile, seenIds);
    await sleep(cfg.pauseBetweenRpis);
  }

  log('\nConcluido. Total de programas salvos: ' + progress.totalSaved);
}

runScraperProgramas().catch((err) => {
  log('Erro fatal: ' + err.message);
  console.error(err.stack);
  process.exit(1);
});