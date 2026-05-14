/**
 * repair_mojibake_jsonl.js
 *
 * Repara strings com mojibake em arquivos JSONL do projeto.
 *
 * Uso:
 *   node repair_mojibake_jsonl.js
 *   node repair_mojibake_jsonl.js data/programas.jsonl data/patentes.jsonl
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { listJsonlFiles } = require('./utils');

function resolveBaseFiles(argv) {
  if (argv.length > 0) {
    return argv.map((p) => (path.isAbsolute(p) ? p : path.join(__dirname, p)));
  }

  return [
    path.join(__dirname, 'data', 'programas.jsonl'),
    path.join(__dirname, 'data', 'patentes.jsonl'),
    path.join(__dirname, 'data', 'patentes_enriched.jsonl'),
  ];
}

function unique(values) {
  return [...new Set(values)];
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

function shouldTryRepair(text) {
  return /Ã[\u0080-\u00BFA-Za-z]|Â[\u0080-\u00BFA-Za-z]|â[\u0080-\u00BF]|\uFFFD/.test(text);
}

function repairMojibakeString(text) {
  if (!shouldTryRepair(text)) return text;

  let current = text;

  for (let i = 0; i < 3; i++) {
    const before = encodingNoiseScore(current);
    const candidate = Buffer.from(current, 'latin1').toString('utf8');
    const after = encodingNoiseScore(candidate);

    if (!candidate || candidate === current || after >= before) {
      break;
    }

    current = candidate;
  }

  return current;
}

function repairValue(value, stats) {
  if (typeof value === 'string') {
    const repaired = repairMojibakeString(value);
    if (repaired !== value) stats.changedStrings += 1;
    return repaired;
  }

  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const repaired = repairValue(item, stats);
      if (repaired !== item) changed = true;
      return repaired;
    });
    return changed ? next : value;
  }

  if (value && typeof value === 'object') {
    let changed = false;
    const next = {};

    for (const [k, v] of Object.entries(value)) {
      const repaired = repairValue(v, stats);
      next[k] = repaired;
      if (repaired !== v) changed = true;
    }

    return changed ? next : value;
  }

  return value;
}

async function repairJsonlFile(filePath) {
  const tmpFile = filePath + '.tmp-repair';

  const input = fs.createReadStream(filePath, { encoding: 'utf8' });
  const output = fs.createWriteStream(tmpFile, { encoding: 'utf8' });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  let totalLines = 0;
  let invalidJsonLines = 0;
  let changedLines = 0;
  let changedStrings = 0;

  for await (const line of rl) {
    totalLines += 1;

    if (!line) {
      output.write('\n');
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (_) {
      invalidJsonLines += 1;
      output.write(line + '\n');
      continue;
    }

    const localStats = { changedStrings: 0 };
    const repaired = repairValue(parsed, localStats);

    if (localStats.changedStrings > 0) {
      changedLines += 1;
      changedStrings += localStats.changedStrings;
      output.write(JSON.stringify(repaired) + '\n');
    } else {
      output.write(line + '\n');
    }
  }

  await new Promise((resolve, reject) => {
    output.end(() => resolve());
    output.on('error', reject);
  });

  if (changedLines > 0) {
    fs.renameSync(tmpFile, filePath);
  } else {
    fs.unlinkSync(tmpFile);
  }

  return {
    filePath,
    totalLines,
    invalidJsonLines,
    changedLines,
    changedStrings,
  };
}

async function main() {
  const baseFiles = resolveBaseFiles(process.argv.slice(2));

  const jsonlFiles = unique(
    baseFiles
      .flatMap((baseFile) => listJsonlFiles(baseFile))
      .filter((file) => fs.existsSync(file)),
  );

  if (jsonlFiles.length === 0) {
    console.log('Nenhum JSONL encontrado para reparo.');
    return;
  }

  console.log('Arquivos para reparo: ' + jsonlFiles.length);

  let grandChangedLines = 0;
  let grandChangedStrings = 0;

  for (const filePath of jsonlFiles) {
    console.log('Reparando: ' + filePath);
    const stats = await repairJsonlFile(filePath);

    grandChangedLines += stats.changedLines;
    grandChangedStrings += stats.changedStrings;

    console.log(
      '  linhas=' + stats.totalLines +
      ' | linhas alteradas=' + stats.changedLines +
      ' | strings alteradas=' + stats.changedStrings +
      ' | json invalido=' + stats.invalidJsonLines,
    );
  }

  console.log('Concluido. Linhas alteradas: ' + grandChangedLines + ' | strings alteradas: ' + grandChangedStrings);
}

main().catch((err) => {
  console.error('Erro no reparo de mojibake:', err.message);
  console.error(err.stack);
  process.exit(1);
});