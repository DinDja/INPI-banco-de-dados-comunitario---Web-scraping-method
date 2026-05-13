/**
 * config.js — Configurações centrais do scraper INPI
 * Edite aqui os campos do formulário se a auto-detecção falhar (rode probe.js para descobri-los).
 */

const dayjs = require('dayjs');
const path  = require('path');

module.exports = {
  // ── Arquivos de saída ───────────────────────────────────────────────────
  outputFile:     path.join(__dirname, 'data', 'patentes.jsonl'),
  progressFile:   path.join(__dirname, 'data', 'progress.json'),
  seenIdsFile:    path.join(__dirname, 'data', 'seen_ids.json'),
  errorLogFile:   path.join(__dirname, 'data', 'errors.log'),

  // ── Período a varrer ────────────────────────────────────────────────────
  startDate: '01/01/2000',
  endDate:   dayjs().format('DD/MM/YYYY'),

  // ── Comportamento ───────────────────────────────────────────────────────
  // 'list'    → salva só os dados da lista (rápido, ~1-2 h para tudo)
  // 'detail'  → busca página de detalhe de cada patente (lento, dias)
  // 'enrich'  → apenas enriquece patentes já salvas que ainda não têm detalhe
  mode: 'list',

  // ── Armazenamento ───────────────────────────────────────────────────────
  // Divide automaticamente a base em arquivos menores: patentes.part001.jsonl, ...
  // Use 0 para desativar a rotação e gravar tudo em um único arquivo.
  maxJsonlPartSizeMB: Number(process.env.INPI_MAX_JSONL_PART_MB || 25),

  // Ao retomar, iniciar no mes seguinte ao checkpoint (evita revarrer mes ja finalizado).
  // Defina false se quiser reprocessar o mesmo mes em caso de interrupcao no meio.
  resumeFromNextMonth: true,

  // ── Pausas (ms) ─────────────────────────────────────────────────────────
  pauseBetweenPages:   5000,   // entre paginas de resultados (aumentado para evitar timeout de sessao)
  pauseBetweenMonths:  2000,   // entre meses
  pauseBetweenDetails: 800,    // entre paginas de detalhe (reduzido)
  pauseOnError:       15000,   // espera apos erro antes de tentar de novo

  // ── Resiliência ─────────────────────────────────────────────────────────
  maxRetries:          4,
  reloginEveryNMonths: 15,     // força novo login a cada N meses (sessão expira)

  // ── Playwright ──────────────────────────────────────────────────────────
  headless:           true,  // mude para false para depuracao visual
  navigationTimeout:  30000,  // reduzido: timeout para ir a pagina de detalhe (era 60s, causava demora)
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',

  // ── Campos do formulário ───────────────────────────────────────────────
  // Campos da busca AVANÇADA do pePI (PatenteSearchAvancado.jsp).
  // Se mudarem, rode `node probe.js` para redescobrir.
  formFields: {
    dateFrom: 'DataDeposito1',  // data de depósito início (nome real do campo)
    dateTo:   'DataDeposito2',  // data de depósito fim   (nome real do campo)
  },

  // ── URLs ─────────────────────────────────────────────────────────────────
  baseUrl:     'https://busca.inpi.gov.br/pePI',
  loginUrl:    'https://busca.inpi.gov.br/pePI/servlet/LoginController?action=login',
  // Busca AVANÇADA tem campos de data; a básica só tem campo de palavra-chave
  searchUrl:   'https://busca.inpi.gov.br/pePI/jsp/patentes/PatenteSearchAvancado.jsp',
};
