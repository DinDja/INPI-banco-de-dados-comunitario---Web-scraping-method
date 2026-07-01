/**
 * scraper_patentes_rpi.js - Coleta de Patentes do INPI via RPI (Secao VI)
 *
 * Caracteristicas:
 * - Nao altera o fluxo antigo via buscaweb.
 * - Usa checkpoints dedicados (progress/seen) para este pipeline.
 * - Prioriza XML oficial da RPI e faz fallback para TXT se necessario.
 * - Pode exigir depositante preenchido para evitar registros nulos.
 *
 * Execucao:
 *   node scraper_patentes_rpi.js
 */

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const cfg = require('./config_patentes_rpi');
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
  listJsonlFiles,
} = require('./utils');

ensureDir(path.dirname(cfg.outputFile));
ensureDir(path.dirname(cfg.progressFile));
ensureDir(path.dirname(cfg.seenIdsFile));
ensureDir(path.dirname(cfg.errorLogFile));

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

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9.]/g, '');
}

function splitList(value) {
  return normalizeWhitespace(value)
    .split(/\s*;\s*/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
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

function decodeUtf16Be(buffer) {
  if (!buffer || buffer.length === 0) return '';
  const evenLength = buffer.length - (buffer.length % 2);
  const swapped = Buffer.alloc(evenLength);

  for (let i = 0; i < evenLength; i += 2) {
    swapped[i] = buffer[i + 1];
    swapped[i + 1] = buffer[i];
  }

  return swapped.toString('utf16le');
}

function detectLikelyUtf16(buffer) {
  const sample = Math.min(buffer.length, 4000);
  if (sample < 20) {
    return { isUtf16: false, littleEndian: true };
  }

  let zerosEven = 0;
  let zerosOdd = 0;

  for (let i = 0; i < sample; i++) {
    if (buffer[i] !== 0) continue;
    if (i % 2 === 0) zerosEven += 1;
    else zerosOdd += 1;
  }

  const half = Math.floor(sample / 2) || 1;
  const ratioEven = zerosEven / half;
  const ratioOdd = zerosOdd / half;
  const isUtf16 = ratioEven > 0.2 || ratioOdd > 0.2;
  const littleEndian = ratioOdd >= ratioEven;

  return { isUtf16, littleEndian };
}

function decodeZipEntry(buffer) {
  if (!buffer || buffer.length === 0) return '';

  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString('utf16le');
  }

  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return decodeUtf16Be(buffer.slice(2));
  }

  const utf16Guess = detectLikelyUtf16(buffer);
  if (utf16Guess.isUtf16) {
    return utf16Guess.littleEndian ? buffer.toString('utf16le') : decodeUtf16Be(buffer);
  }

  const utf8 = buffer.toString('utf8');
  const latin1 = buffer.toString('latin1');

  const utf8Noise = encodingNoiseScore(utf8);
  const latin1Noise = encodingNoiseScore(latin1);

  return utf8Noise <= latin1Noise ? utf8 : latin1;
}

function decodeXmlEntry(buffer) {
  if (!buffer || buffer.length === 0) return '';

  const utf8 = buffer.toString('utf8');
  const header = utf8.slice(0, 500).match(/encoding\s*=\s*["']([^"']+)["']/i);
  if (header) {
    const encoding = String(header[1] || '').toLowerCase();
    if (encoding.includes('8859-1') || encoding.includes('latin1') || encoding.includes('windows-1252')) {
      return buffer.toString('latin1');
    }
  }

  // XML da RPI costuma vir em UTF-8; aplicamos leve vies para evitar mojibake.
  const latin1 = buffer.toString('latin1');
  const utf8Noise = encodingNoiseScore(utf8);
  const latin1Noise = encodingNoiseScore(latin1) + 15;

  return utf8Noise <= latin1Noise ? utf8 : latin1;
}

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(x?[0-9A-Fa-f]+);/g, (_all, code) => {
      const parsed = code[0].toLowerCase() === 'x'
        ? parseInt(code.slice(1), 16)
        : parseInt(code, 10);

      if (!Number.isFinite(parsed)) return '';

      try {
        return String.fromCodePoint(parsed);
      } catch (_err) {
        return '';
      }
    });
}

function stripXmlTags(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseAttribute(attrsText, attrName) {
  const regex = new RegExp(attrName + '="([^"]*)"', 'i');
  const match = String(attrsText || '').match(regex);
  return match ? decodeXmlEntities(match[1]) : null;
}

function extractTagText(xmlChunk, tagName) {
  const safeTag = escapeRegExp(tagName);
  const regex = new RegExp('<' + safeTag + '(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/' + safeTag + '>', 'i');
  const match = String(xmlChunk || '').match(regex);
  if (!match) return null;
  return normalizeWhitespace(decodeXmlEntities(stripXmlTags(match[1])));
}

function extractAllTagTexts(xmlChunk, tagName) {
  const safeTag = escapeRegExp(tagName);
  const regex = new RegExp('<' + safeTag + '(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/' + safeTag + '>', 'gi');
  const values = [];

  let match = regex.exec(String(xmlChunk || ''));
  while (match) {
    const value = normalizeWhitespace(decodeXmlEntities(stripXmlTags(match[1])));
    if (value) values.push(value);
    match = regex.exec(String(xmlChunk || ''));
  }

  return values;
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

function parseHeaderMetaFromXml(xmlContent, fallbackRpi) {
  const chunk = String(xmlContent || '').slice(0, 10000);
  const rootMatch = chunk.match(/<revista\b([^>]*)>/i);

  if (!rootMatch) {
    return {
      rpiNumero: fallbackRpi,
      rpiDataPublicacao: null,
    };
  }

  const attrs = rootMatch[1] || '';
  const numero = Number(parseAttribute(attrs, 'numero') || fallbackRpi);
  const data = parseAttribute(attrs, 'dataPublicacao') || parseAttribute(attrs, 'data');

  return {
    rpiNumero: Number.isFinite(numero) ? numero : fallbackRpi,
    rpiDataPublicacao: normalizeWhitespace(data) || null,
  };
}

function parseNumeroFromProcess(processBlock) {
  const numeroMatch = String(processBlock || '').match(/<numero\b([^>]*)>([\s\S]*?)<\/numero>/i);
  if (!numeroMatch) {
    return {
      numero: null,
      kindcode: null,
    };
  }

  const attrs = numeroMatch[1] || '';
  const numero = normalizeWhitespace(decodeXmlEntities(stripXmlTags(numeroMatch[2] || '')));
  const kindcode = normalizeWhitespace(parseAttribute(attrs, 'kindcode') || '') || null;

  return {
    numero: numero || null,
    kindcode,
  };
}

function parseTituloPatente(processBlock) {
  const explicit54 = String(processBlock || '').match(/<titulo\b[^>]*\binid="54"[^>]*>([\s\S]*?)<\/titulo>/i);
  if (explicit54) {
    return normalizeWhitespace(decodeXmlEntities(stripXmlTags(explicit54[1] || ''))) || null;
  }

  return extractTagText(processBlock, 'titulo');
}

function parseTitularesFromProcess(processBlock) {
  const titulares = [];
  const regex = /<titular\b[^>]*>([\s\S]*?)<\/titular>/gi;

  let match = regex.exec(String(processBlock || ''));
  while (match) {
    const nome = extractTagText(match[1] || '', 'nome-completo');
    if (nome) titulares.push(nome);
    match = regex.exec(String(processBlock || ''));
  }

  return uniqueValues(titulares);
}

function parseInventoresFromProcess(processBlock) {
  const inventores = [];
  const regex = /<inventor\b[^>]*>([\s\S]*?)<\/inventor>/gi;

  let match = regex.exec(String(processBlock || ''));
  while (match) {
    const nome = extractTagText(match[1] || '', 'nome-completo');
    if (nome) inventores.push(nome);
    match = regex.exec(String(processBlock || ''));
  }

  return uniqueValues(inventores);
}

function parseIpcFromProcess(processBlock) {
  const values = extractAllTagTexts(processBlock, 'classificacao-internacional');
  return uniqueValues(values);
}

function buildRecordFromXmlBlocks(despachoBlock, processBlock, meta, sourceZipUrl) {
  const numeroInfo = parseNumeroFromProcess(processBlock);
  if (!numeroInfo.numero) {
    return null;
  }

  const tituloPatente = parseTituloPatente(processBlock);
  const titulares = parseTitularesFromProcess(processBlock);
  const inventores = parseInventoresFromProcess(processBlock);
  const ipcs = parseIpcFromProcess(processBlock);

  const depositante = titulares.join('; ') || null;
  if (cfg.requireDepositante && !depositante) {
    return null;
  }

  const despachoCodigo = extractTagText(despachoBlock, 'codigo');
  const despachoTitulo = extractTagText(despachoBlock, 'titulo');
  const despachoComentario = extractTagText(despachoBlock, 'comentario');

  return {
    numero: numeroInfo.numero,
    kindcode: numeroInfo.kindcode,
    titulo: tituloPatente || null,
    depositante,
    titular: depositante,
    inventor: inventores.join('; ') || null,
    ipc: ipcs.join('; ') || null,
    data_deposito: extractTagText(processBlock, 'data-deposito') || null,
    situacao: despachoTitulo || null,
    despacho_codigo: despachoCodigo || null,
    despacho_nome: despachoTitulo || null,
    despacho_titulo: despachoTitulo || null,
    despacho_comentario: despachoComentario || null,
    rpi_numero: meta.rpiNumero,
    rpi_data_publicacao: meta.rpiDataPublicacao,
    fonte_zip_url: sourceZipUrl,
    _scraped_at: new Date().toISOString(),
  };
}

function parseRecordsFromXml(xmlContent, fallbackRpi, sourceZipUrl) {
  const meta = parseHeaderMetaFromXml(xmlContent, fallbackRpi);
  const records = [];

  const despachoRegex = /<despacho\b[^>]*>([\s\S]*?)<\/despacho>/gi;
  let match = despachoRegex.exec(String(xmlContent || ''));

  while (match) {
    const despachoBlock = match[1] || '';
    const processMatch = despachoBlock.match(/<processo-patente\b[^>]*>([\s\S]*?)<\/processo-patente>/i);

    if (processMatch) {
      const processBlock = processMatch[1] || '';
      const record = buildRecordFromXmlBlocks(despachoBlock, processBlock, meta, sourceZipUrl);
      if (record) {
        records.push(record);
      }
    }

    match = despachoRegex.exec(String(xmlContent || ''));
  }

  return {
    meta,
    records,
  };
}

function parseHeaderMetaFromTxt(txtContent, fallbackRpi) {
  const firstLine = normalizeWhitespace((String(txtContent || '').split(/\r?\n/)[0] || ''));
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

function parseDispatchInfoFromCd(rawCd) {
  const text = normalizeWhitespace(rawCd);
  if (!text) {
    return { codigo: null, titulo: null };
  }

  const separator = text.indexOf(' - ');
  if (separator < 0) {
    return {
      codigo: text,
      titulo: text,
    };
  }

  return {
    codigo: normalizeWhitespace(text.slice(0, separator)) || null,
    titulo: normalizeWhitespace(text.slice(separator + 3)) || null,
  };
}

function buildRecordFromTxtFields(fields, dispatchInfo, meta, sourceZipUrl) {
  const numero = normalizeWhitespace(fields['21'] || fields['11'] || '');
  if (!numero) return null;

  const titulares = splitList(fields['71'] || fields['73'] || '');
  const depositante = titulares.join('; ') || null;
  if (cfg.requireDepositante && !depositante) {
    return null;
  }

  const inventores = splitList(fields['72'] || '');
  const ipcs = splitList(fields['51'] || '');

  return {
    numero,
    titulo: normalizeWhitespace(fields['54'] || '') || null,
    depositante,
    titular: depositante,
    inventor: inventores.join('; ') || null,
    ipc: ipcs.join('; ') || null,
    data_deposito: normalizeWhitespace(fields['22'] || '') || null,
    situacao: dispatchInfo.titulo || null,
    despacho_codigo: dispatchInfo.codigo || null,
    despacho_nome: dispatchInfo.titulo || null,
    despacho_titulo: dispatchInfo.titulo || null,
    despacho_comentario: normalizeWhitespace(fields.co || fields.CO || '') || null,
    rpi_numero: meta.rpiNumero,
    rpi_data_publicacao: meta.rpiDataPublicacao,
    fonte_zip_url: sourceZipUrl,
    _scraped_at: new Date().toISOString(),
  };
}

function parseRecordsFromTxt(txtContent, fallbackRpi, sourceZipUrl) {
  const meta = parseHeaderMetaFromTxt(txtContent, fallbackRpi);
  const lines = String(txtContent || '').split(/\r?\n/);

  const records = [];
  let currentDispatch = { codigo: null, titulo: null };
  let current = null;

  const flushCurrent = () => {
    if (!current) return;
    const rec = buildRecordFromTxtFields(current, currentDispatch, meta, sourceZipUrl);
    if (rec) records.push(rec);
    current = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = line.match(/^\(([A-Za-z0-9_]{1,10})\)\s*(.*)$/);
    if (!match) continue;

    const tag = match[1];
    const value = normalizeWhitespace(match[2]);

    if (tag === 'Cd') {
      flushCurrent();
      currentDispatch = parseDispatchInfoFromCd(value);
      continue;
    }

    if (tag === '11' || tag === '21') {
      if (current && (current['11'] || current['21'])) {
        flushCurrent();
      }

      if (!current) current = {};
      current[tag] = value;
      continue;
    }

    if (!current) continue;

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

  const xmlEntry = entries.find((entry) => /patente_.*\.xml$/i.test(entry.entryName))
    || entries.find((entry) => /\.xml$/i.test(entry.entryName));
  const txtEntry = entries.find((entry) => /\.txt$/i.test(entry.entryName));

  let parsedXml = null;

  if (xmlEntry) {
    const xmlContent = decodeXmlEntry(xmlEntry.getData());
    parsedXml = parseRecordsFromXml(xmlContent, rpiNumber, sourceZipUrl);

    if (parsedXml.records.length > 0 || !txtEntry) {
      return parsedXml;
    }
  }

  if (txtEntry) {
    const txtContent = decodeZipEntry(txtEntry.getData());
    const parsedTxt = parseRecordsFromTxt(txtContent, rpiNumber, sourceZipUrl);

    if (parsedTxt.records.length > 0) {
      return parsedTxt;
    }
  }

  if (parsedXml) {
    return parsedXml;
  }

  throw new Error('Nao foi encontrado conteudo XML/TXT legivel no ZIP da RPI ' + rpiNumber);
}

function buildSeenKey(record) {
  const numero = normalizeNumeroKey(record.numero);
  if (!numero) return null;

  if (cfg.dedupeByNumeroOnly) {
    return numero;
  }

  const rpi = normalizeKey(String(record.rpi_numero || ''));
  const despacho = normalizeKey(record.despacho_codigo || '');
  return [numero, rpi, despacho].filter(Boolean).join('|');
}

function bootstrapSeenIdsFromOutput(seenIds, outputBaseFile) {
  const files = listJsonlFiles(outputBaseFile).filter((filePath) => fs.existsSync(filePath));
  let added = 0;
  let invalidLines = 0;

  for (const filePath of files) {
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);

    for (const line of lines) {
      if (!line) continue;

      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (_err) {
        invalidLines += 1;
        continue;
      }

      const key = buildSeenKey(parsed);
      if (!key || seenIds.has(key)) continue;

      seenIds.add(key);
      added += 1;
    }
  }

  return {
    files: files.length,
    added,
    invalidLines,
  };
}

function deleteFileIfExists(filePath) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function resetOutputAndCheckpoints() {
  const outputFiles = listJsonlFiles(cfg.outputFile);
  outputFiles.forEach(deleteFileIfExists);
  deleteFileIfExists(cfg.progressFile);
  deleteFileIfExists(cfg.seenIdsFile);
}

async function runScraperPatentesRpi() {
  if (cfg.freshStart) {
    log('Fresh start ativo: removendo patentes*.jsonl e checkpoints do scraper RPI...');
    resetOutputAndCheckpoints();
  }

  const progress = loadProgress(cfg.progressFile);
  const seenIds = loadSeenIds(cfg.seenIdsFile);
  progress.totalSaved = Number(progress.totalSaved || 0);

  const existingOutputFiles = listJsonlFiles(cfg.outputFile).filter((filePath) => fs.existsSync(filePath));
  const bootstrapSeen = String(process.env.INPI_PATENTES_BOOTSTRAP_SEEN_FROM_OUTPUT || 'true').toLowerCase() !== 'false';

  if (!cfg.freshStart && seenIds.size === 0 && existingOutputFiles.length > 0) {
    if (bootstrapSeen) {
      const bootstrapStats = bootstrapSeenIdsFromOutput(seenIds, cfg.outputFile);
      saveSeenIds(cfg.seenIdsFile, seenIds);

      log('Bootstrap de seen_ids a partir da base existente: ' + bootstrapStats.added + ' IDs carregados.');
      if (bootstrapStats.invalidLines > 0) {
        log('  Linhas JSON invalidas ignoradas durante bootstrap: ' + bootstrapStats.invalidLines);
      }
    } else {
      log('Aviso: ja existem patentes*.jsonl e o seen_ids do scraper RPI esta vazio.');
      log('Para evitar duplicatas ao refazer a base, use INPI_PATENTES_RPI_FRESH_START=true.');
      log('Ou habilite bootstrap com INPI_PATENTES_BOOTSTRAP_SEEN_FROM_OUTPUT=true.');
    }
  }

  log('===================================================');
  log('  INPI Patentes Scraper - via RPI (Secao VI)');
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
  log('Regra requireDepositante: ' + (cfg.requireDepositante ? 'ativa' : 'desativada'));
  log('Dedupe por numero: ' + (cfg.dedupeByNumeroOnly ? 'ativo' : 'desativado'));

  let currentOutputFile = null;

  for (let rpi = startRpi; rpi <= latestRpi; rpi++) {
    const zipUrl = buildZipUrl(rpi);
    log('\nRPI ' + rpi + ' -> ' + zipUrl);

    let success = false;

    for (let attempt = 1; attempt <= cfg.maxRetries; attempt++) {
      try {
        const zipBuffer = await downloadZipBuffer(zipUrl);

        if (!zipBuffer) {
          log('  Sem arquivo P para esta RPI (404). Pulando.');
          success = true;
          break;
        }

        const parsed = parseZipRecords(zipBuffer, rpi, zipUrl);
        log('  Registros validos no arquivo: ' + parsed.records.length);

        let savedThisRpi = 0;

        for (const record of parsed.records) {
          const key = buildSeenKey(record);
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

        log('  OK RPI ' + rpi + ' - novas patentes: ' + savedThisRpi);
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

  log('\nConcluido. Total de patentes salvas: ' + progress.totalSaved);
}

module.exports = {
  normalizeNumeroKey,
  detectLatestRpiNumber,
  buildZipUrl,
  downloadZipBuffer,
  parseZipRecords,
  runScraperPatentesRpi,
};

if (require.main === module) {
  runScraperPatentesRpi().catch((err) => {
    log('Erro fatal: ' + err.message);
    console.error(err.stack);
    process.exit(1);
  });
}