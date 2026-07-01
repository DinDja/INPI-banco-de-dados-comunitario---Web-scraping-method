/**
 * enrich_patentes_nulls_rpi.js
 *
 * Preenche apenas campos nulos/vazios em patentes*.jsonl usando a RPI (Secao VI).
 * Nao recria a base inteira: aproveita os registros existentes e atualiza em-place.
 *
 * Uso:
 *   node enrich_patentes_nulls_rpi.js
 *
 * Variaveis uteis:
 *   INPI_PATENTES_OUTPUT_FILE=data/patentes.jsonl
 *   INPI_PATENTES_START_RPI=2404
 *   INPI_PATENTES_END_RPI=2888
 *   INPI_PATENTES_NULL_ENRICH_FIELDS=depositante,titular,inventor,ipc,titulo,data_deposito
 *   INPI_PATENTES_NULL_ENRICH_BACKUP=true
 *   INPI_PATENTES_NULL_ENRICH_RESET_PROGRESS=true
 */

const fs = require('fs');
const path = require('path');

const cfg = require('./config_patentes_rpi');
const {
  log,
  logError,
  sleep,
  loadProgress,
  saveProgress,
  listJsonlFiles,
  ensureDir,
} = require('./utils');
const {
  normalizeNumeroKey,
  detectLatestRpiNumber,
  buildZipUrl,
  downloadZipBuffer,
  parseZipRecords,
} = require('./scraper_patentes_rpi');

const DEFAULT_FIELDS = [
  'depositante',
  'titular',
  'inventor',
  'ipc',
  'titulo',
  'data_deposito',
];

function resolveDataPath(envValue, fallbackRelativePath) {
  const raw = String(envValue || fallbackRelativePath);
  return path.isAbsolute(raw) ? raw : path.join(__dirname, raw);
}

function parseFieldList(raw) {
  const value = String(raw || '').trim();
  if (!value) return [...DEFAULT_FIELDS];

  const fields = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return fields.length > 0 ? fields : [...DEFAULT_FIELDS];
}

function isMissing(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim().length === 0) return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

function applyLocalFallbacks(record) {
  let changed = 0;

  if (isMissing(record.depositante) && !isMissing(record.titular)) {
    record.depositante = record.titular;
    changed += 1;
  }

  if (isMissing(record.titular) && !isMissing(record.depositante)) {
    record.titular = record.depositante;
    changed += 1;
  }

  return changed;
}

function hasMissingFields(record, fieldsToFill) {
  for (const field of fieldsToFill) {
    if (isMissing(record[field])) {
      return true;
    }
  }
  return false;
}

function mergeMissingFields(target, source, fieldsToFill) {
  let writes = 0;

  for (const field of fieldsToFill) {
    if (!isMissing(target[field])) continue;

    let sourceValue = source[field];
    if (field === 'depositante' && isMissing(sourceValue)) {
      sourceValue = source.titular;
    }
    if (field === 'titular' && isMissing(sourceValue)) {
      sourceValue = source.depositante;
    }

    if (isMissing(sourceValue)) continue;

    target[field] = sourceValue;
    writes += 1;
  }

  writes += applyLocalFallbacks(target);

  if (writes > 0) {
    target._enriched_from_rpi_at = new Date().toISOString();

    if (isMissing(target.fonte_zip_url) && !isMissing(source.fonte_zip_url)) {
      target.fonte_zip_url = source.fonte_zip_url;
      writes += 1;
    }

    if (isMissing(target.rpi_numero) && !isMissing(source.rpi_numero)) {
      target.rpi_numero = source.rpi_numero;
      writes += 1;
    }

    if (isMissing(target.rpi_data_publicacao) && !isMissing(source.rpi_data_publicacao)) {
      target.rpi_data_publicacao = source.rpi_data_publicacao;
      writes += 1;
    }
  }

  return writes;
}

function loadOutputStates(outputBaseFile) {
  const files = listJsonlFiles(outputBaseFile).filter((filePath) => fs.existsSync(filePath));
  if (files.length === 0) {
    throw new Error('Nenhum arquivo de patentes encontrado a partir de: ' + outputBaseFile);
  }

  return files.map((filePath) => {
    const raw = fs.readFileSync(filePath, 'utf8');
    const hasTrailingNewline = raw.endsWith('\n');
    const lines = raw.split(/\r?\n/);
    if (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }

    const entries = lines.map((line) => {
      if (!line) {
        return {
          raw: line,
          record: null,
          parseError: false,
          dirty: false,
        };
      }

      try {
        return {
          raw: line,
          record: JSON.parse(line),
          parseError: false,
          dirty: false,
          countedDirty: false,
        };
      } catch (_err) {
        return {
          raw: line,
          record: null,
          parseError: true,
          dirty: false,
        };
      }
    });

    return {
      filePath,
      hasTrailingNewline,
      entries,
    };
  });
}

function buildPendingMap(states, fieldsToFill) {
  const pending = new Map();

  let totalJson = 0;
  let totalParseErrors = 0;
  let totalMissing = 0;
  let totalLocalFallbackWrites = 0;

  for (const state of states) {
    for (const entry of state.entries) {
      if (entry.parseError) {
        totalParseErrors += 1;
        continue;
      }

      if (!entry.record) continue;

      totalJson += 1;

      const fallbackWrites = applyLocalFallbacks(entry.record);
      if (fallbackWrites > 0) {
        totalLocalFallbackWrites += fallbackWrites;
        entry.dirty = true;
      }

      if (!hasMissingFields(entry.record, fieldsToFill)) {
        continue;
      }

      const numeroKey = normalizeNumeroKey(entry.record.numero);
      if (!numeroKey) {
        continue;
      }

      if (!pending.has(numeroKey)) {
        pending.set(numeroKey, []);
      }

      pending.get(numeroKey).push(entry);
      totalMissing += 1;
    }
  }

  return {
    pending,
    stats: {
      totalJson,
      totalParseErrors,
      totalMissing,
      totalLocalFallbackWrites,
    },
  };
}

function buildBackupPath(filePath) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return filePath + '.bak-null-enrich-' + stamp;
}

function writeUpdatedFiles(states, backupEnabled) {
  let filesWritten = 0;
  const backups = [];

  for (const state of states) {
    const hasDirtyEntries = state.entries.some((entry) => entry.dirty && entry.record);
    if (!hasDirtyEntries) continue;

    if (backupEnabled) {
      const backupPath = buildBackupPath(state.filePath);
      fs.copyFileSync(state.filePath, backupPath);
      backups.push(backupPath);
    }

    const outputLines = state.entries.map((entry) => {
      if (!entry.record) {
        return entry.raw;
      }

      if (entry.dirty) {
        return JSON.stringify(entry.record);
      }

      return entry.raw;
    });

    const nextContent = outputLines.join('\n') + (state.hasTrailingNewline ? '\n' : '');
    fs.writeFileSync(state.filePath, nextContent, 'utf8');
    filesWritten += 1;
  }

  return {
    filesWritten,
    backups,
  };
}

function deleteFileIfExists(filePath) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

async function runEnrichPatentesNulls() {
  const outputBaseFile = cfg.outputFile;
  const progressFile = resolveDataPath(
    process.env.INPI_PATENTES_NULL_ENRICH_PROGRESS_FILE,
    'data/progress_patentes_rpi_null_enrich.json',
  );
  const errorLogFile = resolveDataPath(
    process.env.INPI_PATENTES_NULL_ENRICH_ERRORLOG_FILE,
    'data/errors_patentes_rpi_null_enrich.log',
  );

  const fieldsToFill = parseFieldList(process.env.INPI_PATENTES_NULL_ENRICH_FIELDS);
  const backupEnabled = String(process.env.INPI_PATENTES_NULL_ENRICH_BACKUP || 'true').toLowerCase() !== 'false';
  const resetProgress = String(process.env.INPI_PATENTES_NULL_ENRICH_RESET_PROGRESS || 'false').toLowerCase() === 'true';

  ensureDir(path.dirname(progressFile));
  ensureDir(path.dirname(errorLogFile));

  if (resetProgress) {
    deleteFileIfExists(progressFile);
  }

  const progress = loadProgress(progressFile);

  log('===================================================');
  log('  INPI Patentes - Enriquecimento de campos nulos');
  log('===================================================');
  log('Base alvo: ' + outputBaseFile);
  log('Campos para preencher: ' + fieldsToFill.join(', '));

  const states = loadOutputStates(outputBaseFile);
  const { pending, stats } = buildPendingMap(states, fieldsToFill);

  log('Registros JSON validos: ' + stats.totalJson + ' | linhas com JSON invalido: ' + stats.totalParseErrors);
  log('Registros com campos faltantes: ' + stats.totalMissing + ' | numeros pendentes: ' + pending.size);

  let totalRecordUpdates = 0;
  let totalFieldWrites = stats.totalLocalFallbackWrites;

  if (stats.totalLocalFallbackWrites > 0) {
    for (const state of states) {
      for (const entry of state.entries) {
        if (entry.dirty && !entry.countedDirty && entry.record) {
          entry.countedDirty = true;
          totalRecordUpdates += 1;
        }
      }
    }
  }

  if (pending.size > 0) {
    const latestRpi = cfg.endRpi || await detectLatestRpiNumber();

    const hasExplicitStart = Object.prototype.hasOwnProperty.call(process.env, 'INPI_PATENTES_START_RPI');
    let startRpi = cfg.startRpi;

    if (!hasExplicitStart && progress.lastRpi) {
      const checkpoint = Number(progress.lastRpi);
      if (Number.isFinite(checkpoint)) {
        startRpi = checkpoint + 1;
      }
    }

    if (startRpi > latestRpi) {
      log('Checkpoint de enriquecimento ja passou da ultima RPI disponivel (' + latestRpi + ').');
    } else {
      log('Varredura RPI para enriquecer: ' + startRpi + ' ate ' + latestRpi);

      for (let rpi = startRpi; rpi <= latestRpi; rpi++) {
        const zipUrl = buildZipUrl(rpi);
        log('\nRPI ' + rpi + ' -> ' + zipUrl + ' | pendentes: ' + pending.size);

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
            let updatesThisRpi = 0;

            for (const sourceRecord of parsed.records) {
              const numeroKey = normalizeNumeroKey(sourceRecord.numero);
              if (!numeroKey) continue;

              const refs = pending.get(numeroKey);
              if (!refs) continue;

              for (const entry of refs) {
                const writes = mergeMissingFields(entry.record, sourceRecord, fieldsToFill);
                if (writes > 0) {
                  entry.dirty = true;
                  updatesThisRpi += 1;
                  totalFieldWrites += writes;

                  if (!entry.countedDirty) {
                    entry.countedDirty = true;
                    totalRecordUpdates += 1;
                  }
                }
              }

              if (refs.every((entry) => !hasMissingFields(entry.record, fieldsToFill))) {
                pending.delete(numeroKey);
              }
            }

            log('  Atualizacoes aplicadas nesta RPI: ' + updatesThisRpi);
            success = true;
            break;
          } catch (err) {
            logError(
              'RPI ' + rpi + ' tentativa ' + attempt + '/' + cfg.maxRetries + ' falhou: ' + err.message,
              errorLogFile,
            );

            if (attempt < cfg.maxRetries) {
              log('  Aguardando ' + Math.round(cfg.pauseOnError / 1000) + 's para nova tentativa...');
              await sleep(cfg.pauseOnError);
            }
          }
        }

        if (!success) {
          logError('RPI ' + rpi + ' falhou apos ' + cfg.maxRetries + ' tentativas. Pulando.', errorLogFile);
        }

        saveProgress(progressFile, {
          ...progress,
          lastRpi: rpi,
          totalRecordUpdates,
          totalFieldWrites,
          pendingNumeros: pending.size,
        });

        if (pending.size === 0) {
          log('Todos os numeros pendentes foram preenchidos antes do fim da faixa de RPI.');
          break;
        }

        await sleep(cfg.pauseBetweenRpis);
      }
    }
  }

  const { filesWritten, backups } = writeUpdatedFiles(states, backupEnabled);

  log('\nResumo final:');
  log('  Registros atualizados: ' + totalRecordUpdates);
  log('  Escritas de campos: ' + totalFieldWrites);
  log('  Numeros ainda pendentes: ' + pending.size);
  log('  Arquivos regravados: ' + filesWritten);

  if (backupEnabled && backups.length > 0) {
    log('  Backups criados: ' + backups.length);
  }
}

module.exports = {
  runEnrichPatentesNulls,
};

if (require.main === module) {
  runEnrichPatentesNulls().catch((err) => {
    console.error('Erro fatal no enriquecimento de nulos:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
}