/**
 * scraper_marcas.js - Coleta de Marcas do INPI via RPI (Secao V)
 *
 * Caracteristicas:
 * - Nao altera codigo/arquivos dos scrapers de patentes/programas.
 * - Usa arquivos dedicados: marcas.jsonl, progress_marcas.json, seen_ids_marcas.json.
 * - Mantem a mesma logica de rotacao JSONL por tamanho.
 * - Le XML dentro do ZIP de Marcas (RM{RPI}.zip).
 *
 * Execucao:
 *   node scraper_marcas.js
 */

const path = require('path');
const AdmZip = require('adm-zip');

const cfg = require('./config_marcas');
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

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9|]/g, '');
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

      if (!Number.isFinite(parsed)) {
        return '';
      }

      try {
        return String.fromCodePoint(parsed);
      } catch (_err) {
        return '';
      }
    });
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
  return normalizeWhitespace(decodeXmlEntities(match[1]));
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

function parseHeaderMetaFromXml(xmlContent, fallbackRpi) {
  const chunk = String(xmlContent || '').slice(0, 8000);
  const rootMatch = chunk.match(/<revista\b([^>]*)>/i);

  if (!rootMatch) {
    return {
      rpiNumero: fallbackRpi,
      rpiDataPublicacao: null,
    };
  }

  const attrs = rootMatch[1] || '';
  const numero = Number(parseAttribute(attrs, 'numero') || fallbackRpi);
  const data = parseAttribute(attrs, 'data');

  return {
    rpiNumero: Number.isFinite(numero) ? numero : fallbackRpi,
    rpiDataPublicacao: normalizeWhitespace(data) || null,
  };
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function shouldKeepByDispatch(despachos) {
  if (!Array.isArray(cfg.allowedDispatchCodes) || cfg.allowedDispatchCodes.length === 0) {
    return true;
  }

  const allowed = new Set(
    cfg.allowedDispatchCodes
      .map((value) => normalizeWhitespace(value).toUpperCase())
      .filter(Boolean),
  );

  return despachos.some((item) => allowed.has(normalizeWhitespace(item.codigo).toUpperCase()));
}

function parseDespachos(processBlock) {
  const despachos = [];

  const selfClosingRegex = /<despacho\b([^>]*?)\/>/gi;
  let match = selfClosingRegex.exec(processBlock);
  while (match) {
    despachos.push({
      codigo: normalizeWhitespace(parseAttribute(match[1], 'codigo')) || null,
      nome: normalizeWhitespace(parseAttribute(match[1], 'nome')) || null,
    });
    match = selfClosingRegex.exec(processBlock);
  }

  const pairedRegex = /<despacho\b([^>]*)>([\s\S]*?)<\/despacho>/gi;
  match = pairedRegex.exec(processBlock);
  while (match) {
    const attrs = match[1] || '';
    const inner = match[2] || '';
    despachos.push({
      codigo: normalizeWhitespace(parseAttribute(attrs, 'codigo')) || extractTagText(inner, 'codigo') || null,
      nome: normalizeWhitespace(parseAttribute(attrs, 'nome')) || extractTagText(inner, 'nome') || null,
    });
    match = pairedRegex.exec(processBlock);
  }

  return despachos;
}

function parseTitulares(processBlock) {
  const titulares = [];
  const regex = /<titular\b([^>]*?)\/>/gi;

  let match = regex.exec(processBlock);
  while (match) {
    const attrs = match[1] || '';
    titulares.push({
      nome: normalizeWhitespace(parseAttribute(attrs, 'nome-razao-social')) || null,
      pais: normalizeWhitespace(parseAttribute(attrs, 'pais')) || null,
      uf: normalizeWhitespace(parseAttribute(attrs, 'uf')) || null,
    });
    match = regex.exec(processBlock);
  }

  return titulares;
}

function parseMarca(processBlock) {
  const marcaMatch = processBlock.match(/<marca\b([^>]*)>([\s\S]*?)<\/marca>/i);

  if (marcaMatch) {
    const attrs = marcaMatch[1] || '';
    const inner = marcaMatch[2] || '';

    return {
      nome:
        extractTagText(inner, 'nome') ||
        normalizeWhitespace(parseAttribute(attrs, 'nome')) ||
        null,
      apresentacao: normalizeWhitespace(parseAttribute(attrs, 'apresentacao')) || null,
      natureza: normalizeWhitespace(parseAttribute(attrs, 'natureza')) || null,
    };
  }

  const selfClosingMatch = processBlock.match(/<marca\b([^>]*?)\/>/i);
  if (selfClosingMatch) {
    const attrs = selfClosingMatch[1] || '';
    return {
      nome: normalizeWhitespace(parseAttribute(attrs, 'nome')) || null,
      apresentacao: normalizeWhitespace(parseAttribute(attrs, 'apresentacao')) || null,
      natureza: normalizeWhitespace(parseAttribute(attrs, 'natureza')) || null,
    };
  }

  return {
    nome:
      extractTagText(processBlock, 'nome-marca') ||
      extractTagText(processBlock, 'nome_marca') ||
      null,
    apresentacao: null,
    natureza: null,
  };
}

function parseClassesNice(processBlock) {
  const classes = [];
  const regex = /<classe-nice\b([^>]*)>([\s\S]*?)<\/classe-nice>/gi;

  let match = regex.exec(processBlock);
  while (match) {
    const attrs = match[1] || '';
    const inner = match[2] || '';

    classes.push({
      codigo: normalizeWhitespace(parseAttribute(attrs, 'codigo')) || null,
      especificacao: extractTagText(inner, 'especificacao') || null,
      status: extractTagText(inner, 'status') || null,
    });

    match = regex.exec(processBlock);
  }

  return classes;
}

function parseClassesVienna(processBlock) {
  const classes = [];
  const regex = /<classe-vienna\b([^>]*?)\/>/gi;

  let match = regex.exec(processBlock);
  while (match) {
    const attrs = match[1] || '';
    const codigo = normalizeWhitespace(parseAttribute(attrs, 'codigo'));
    if (codigo) {
      classes.push(codigo);
    }
    match = regex.exec(processBlock);
  }

  return classes;
}

function parsePrioridades(processBlock) {
  const prioridades = [];
  const regex = /<prioridade\b([^>]*?)\/>/gi;

  let match = regex.exec(processBlock);
  while (match) {
    const attrs = match[1] || '';
    const numero = normalizeWhitespace(parseAttribute(attrs, 'numero'));
    const pais = normalizeWhitespace(parseAttribute(attrs, 'pais'));
    const data = normalizeWhitespace(parseAttribute(attrs, 'data'));

    const item = [pais, numero, data].filter(Boolean).join(':');
    if (item) {
      prioridades.push(item);
    }

    match = regex.exec(processBlock);
  }

  return prioridades;
}

function buildRecordFromProcess(processAttrs, processBlock, meta, sourceZipUrl) {
  const numero = normalizeWhitespace(parseAttribute(processAttrs, 'numero'));
  if (!numero) {
    return null;
  }

  const dataDeposito = normalizeWhitespace(parseAttribute(processAttrs, 'data-deposito')) || null;
  const despachos = parseDespachos(processBlock);

  if (!shouldKeepByDispatch(despachos)) {
    return null;
  }

  const titulares = parseTitulares(processBlock);
  const marca = parseMarca(processBlock);
  if (cfg.requireMarcaName && !normalizeWhitespace(marca.nome)) {
    return null;
  }

  const classesNice = parseClassesNice(processBlock);
  const classesVienna = parseClassesVienna(processBlock);
  const prioridades = parsePrioridades(processBlock);
  const procurador = extractTagText(processBlock, 'procurador');

  const despachoCodigos = uniqueValues(despachos.map((item) => item.codigo));
  const despachoNomes = uniqueValues(despachos.map((item) => item.nome));

  const titularesNomes = uniqueValues(titulares.map((item) => item.nome));
  const titularesPaises = uniqueValues(titulares.map((item) => item.pais));
  const titularesUfs = uniqueValues(titulares.map((item) => item.uf));

  const classesNiceCodigos = uniqueValues(classesNice.map((item) => item.codigo));
  const classesNiceStatus = uniqueValues(classesNice.map((item) => item.status));
  const classesNiceSpecs = uniqueValues(classesNice.map((item) => item.especificacao));

  return {
    numero,
    data_deposito: dataDeposito,
    marca: marca.nome,
    apresentacao: marca.apresentacao,
    natureza: marca.natureza,
    titular: titularesNomes.join('; ') || null,
    titular_pais: titularesPaises.join('; ') || null,
    titular_uf: titularesUfs.join('; ') || null,
    despacho_codigo: despachoCodigos.join('; ') || null,
    despacho_nome: despachoNomes.join('; ') || null,
    classe_nice: classesNiceCodigos.join('; ') || null,
    classe_nice_status: classesNiceStatus.join('; ') || null,
    classe_nice_especificacao: classesNiceSpecs.join(' || ') || null,
    classe_vienna: classesVienna.join('; ') || null,
    prioridade_unionista: prioridades.join('; ') || null,
    procurador: procurador || null,
    rpi_numero: meta.rpiNumero,
    rpi_data_publicacao: meta.rpiDataPublicacao,
    fonte_zip_url: sourceZipUrl,
    _scraped_at: new Date().toISOString(),
  };
}

function parseRecordsFromXml(xmlContent, fallbackRpi, sourceZipUrl) {
  const meta = parseHeaderMetaFromXml(xmlContent, fallbackRpi);
  const records = [];

  const processRegex = /<processo\b([^>]*)>([\s\S]*?)<\/processo>/gi;
  let match = processRegex.exec(xmlContent);

  while (match) {
    const processAttrs = match[1] || '';
    const processBlock = match[2] || '';
    const record = buildRecordFromProcess(processAttrs, processBlock, meta, sourceZipUrl);

    if (record) {
      records.push(record);
    }

    match = processRegex.exec(xmlContent);
  }

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

  const xmlEntry = entries.find((entry) => /\.xml$/i.test(entry.entryName));
  const txtEntry = entries.find((entry) => /\.txt$/i.test(entry.entryName));
  const contentEntry = xmlEntry || txtEntry || entries[0];

  if (!contentEntry) {
    throw new Error('Nao foi encontrado conteudo valido no ZIP da RPI ' + rpiNumber);
  }

  const xmlContent = decodeZipEntry(contentEntry.getData());
  return parseRecordsFromXml(xmlContent, rpiNumber, sourceZipUrl);
}

function buildSeenKey(record) {
  const numero = normalizeKey(record.numero);
  const rpi = normalizeKey(String(record.rpi_numero || ''));
  const despacho = normalizeKey(record.despacho_codigo || '');

  if (!numero) return null;
  return [numero, rpi, despacho].filter(Boolean).join('|');
}

async function runScraperMarcas() {
  const progress = loadProgress(cfg.progressFile);
  const seenIds = loadSeenIds(cfg.seenIdsFile);

  log('===================================================');
  log('  INPI Marcas Scraper - via RPI (Secao V)');
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

  if (cfg.allowedDispatchCodes.length > 0) {
    log('Filtro de despacho ativo: ' + cfg.allowedDispatchCodes.join(', '));
  }

  let currentOutputFile = null;

  for (let rpi = startRpi; rpi <= latestRpi; rpi++) {
    const zipUrl = buildZipUrl(rpi);
    log('\nRPI ' + rpi + ' -> ' + zipUrl);

    let success = false;

    for (let attempt = 1; attempt <= cfg.maxRetries; attempt++) {
      try {
        const zipBuffer = await downloadZipBuffer(zipUrl);

        if (!zipBuffer) {
          log('  Sem arquivo RM para esta RPI (404). Pulando.');
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

        log('  OK RPI ' + rpi + ' - novas marcas: ' + savedThisRpi);
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

  log('\nConcluido. Total de marcas salvas: ' + progress.totalSaved);
}

runScraperMarcas().catch((err) => {
  log('Erro fatal: ' + err.message);
  console.error(err.stack);
  process.exit(1);
});