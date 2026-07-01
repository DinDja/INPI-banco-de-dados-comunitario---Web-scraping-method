/**
 * indexes.js - Índices básicos em memória para busca rápida
 * 
 * Implementa:
 * - Hash map para busca exata por número (O(1))
 * - Inverted index para full-text search
 * - Índice de datas para range queries
 * - Índice de facets para agregações
 */

const {
  normalizeText,
  normalizeNumeroPatente,
  normalizeNomeEmpresarial,
  normalizeIPC,
  extractAnoDeposito,
  extractClasseIPCPrincipal,
  tokenize,
} = require('./normalizer');

const {
  getSearchableFields,
  getFacetFields,
  getFieldWeight,
} = require('./schema');

class PatentIndexes {
  constructor(options = {}) {
    this.options = {
      useStemming: options.useStemming !== false,
      removeStopwords: options.removeStopwords !== false,
      useNgrams: options.useNgrams !== false,
      ...options,
    };
    
    this.reset();
  }
  
  reset() {
    this.byNumero = new Map();
    this.invertedIndex = new Map();
    this.byAnoDeposito = new Map();
    this.byIpcClasse = new Map();
    this.bySituacao = new Map();
    this.byDepositante = new Map();
    
    this.documentCount = 0;
    this.fieldLengths = new Map();
    this.avgFieldLengths = new Map();
    
    this.isBuilt = false;
    this.buildTime = null;
  }
  
  build(records) {
    this.reset();
    
    if (!records || records.length === 0) {
      this.isBuilt = true;
      this.buildTime = new Date().toISOString();
      return this;
    }
    
    const startTime = Date.now();
    
    for (const record of records) {
      this.addRecord(record);
    }
    
    this._calculateAvgFieldLengths();
    
    this.isBuilt = true;
    this.buildTime = new Date().toISOString();
    this.buildDurationMs = Date.now() - startTime;
    
    return this;
  }
  
  addRecord(record) {
    if (!record) return;
    
    this.documentCount++;
    
    this._indexByNumero(record);
    this._indexByAnoDeposito(record);
    this._indexByIpcClasse(record);
    this._indexBySituacao(record);
    this._indexByDepositante(record);
    this._indexFullText(record);
  }
  
  removeRecord(record) {
    if (!record) return;
    
    const numero = normalizeNumeroPatente(record.numero);
    if (numero && this.byNumero.has(numero)) {
      this.byNumero.delete(numero);
      this.documentCount = Math.max(0, this.documentCount - 1);
    }
  }
  
  _indexByNumero(record) {
    const numero = normalizeNumeroPatente(record.numero);
    if (numero) {
      this.byNumero.set(numero, record);
    }
  }
  
  _indexByAnoDeposito(record) {
    const ano = extractAnoDeposito(record.data_deposito);
    if (ano) {
      if (!this.byAnoDeposito.has(ano)) {
        this.byAnoDeposito.set(ano, []);
      }
      this.byAnoDeposito.get(ano).push(record);
    }
  }
  
  _indexByIpcClasse(record) {
    const classe = extractClasseIPCPrincipal(record.ipc);
    if (classe) {
      if (!this.byIpcClasse.has(classe)) {
        this.byIpcClasse.set(classe, []);
      }
      this.byIpcClasse.get(classe).push(record);
    }
  }
  
  _indexBySituacao(record) {
    const situacao = normalizeText(record.situacao);
    if (situacao) {
      if (!this.bySituacao.has(situacao)) {
        this.bySituacao.set(situacao, []);
      }
      this.bySituacao.get(situacao).push(record);
    }
  }
  
  _indexByDepositante(record) {
    const depositante = normalizeNomeEmpresarial(record.depositante);
    if (depositante) {
      if (!this.byDepositante.has(depositante)) {
        this.byDepositante.set(depositante, []);
      }
      this.byDepositante.get(depositante).push(record);
    }
  }
  
  _indexFullText(record) {
    const searchableFields = getSearchableFields();
    
    for (const fieldName of searchableFields) {
      const value = record[fieldName];
      if (!value) continue;
      
      const weight = getFieldWeight(fieldName);
      const tokens = this._tokenizeField(value, fieldName);
      
      this.fieldLengths.set(`${record.numero || ''}:${fieldName}`, tokens.length);
      
      for (const token of tokens) {
        if (!this.invertedIndex.has(token)) {
          this.invertedIndex.set(token, {
            postings: new Map(),
            df: 0,
          });
        }
        
        const posting = this.invertedIndex.get(token);
        const docId = record.numero || '';
        
        if (!posting.postings.has(docId)) {
          posting.postings.set(docId, {
            tf: 0,
            positions: [],
            fields: new Set(),
          });
          posting.df++;
        }
        
        const docPosting = posting.postings.get(docId);
        docPosting.tf += 1;
        docPosting.fields.add(fieldName);
        
        if (weight > 1) {
          docPosting.tf += (weight - 1);
        }
      }
    }
  }
  
  _tokenizeField(value, fieldName) {
    const fieldConfig = {
      removeStopwords: this.options.removeStopwords,
      stem: this.options.useStemming,
    };
    
    if (fieldName === 'numero' || fieldName === 'ipc') {
      const normalized = normalizeText(value, { lowercase: true, cleanSpaces: true });
      const tokens = normalized.split(/[\s/-]+/).filter(Boolean);
      
      if (this.options.useNgrams && tokens.length > 1) {
        for (let i = 1; i <= Math.min(3, tokens.length); i++) {
          tokens.push(tokens.slice(0, i).join(''));
        }
      }
      
      return tokens;
    }
    
    return tokenize(String(value), fieldConfig);
  }
  
  _calculateAvgFieldLengths() {
    const fieldTotals = new Map();
    const fieldCounts = new Map();
    
    for (const [key, length] of this.fieldLengths) {
      const [, fieldName] = key.split(':');
      fieldTotals.set(fieldName, (fieldTotals.get(fieldName) || 0) + length);
      fieldCounts.set(fieldName, (fieldCounts.get(fieldName) || 0) + 1);
    }
    
    for (const [fieldName, total] of fieldTotals) {
      const count = fieldCounts.get(fieldName) || 1;
      this.avgFieldLengths.set(fieldName, total / count);
    }
  }
  
  getByNumero(numero) {
    const normalized = normalizeNumeroPatente(numero);
    return this.byNumero.get(normalized) || null;
  }
  
  searchByAnoDeposito(anoStart, anoEnd) {
    const results = [];
    
    for (const [ano, records] of this.byAnoDeposito) {
      if (ano >= anoStart && ano <= anoEnd) {
        results.push(...records);
      }
    }
    
    return results;
  }
  
  searchByIpcClasse(classe) {
    if (!classe) return [];
    
    const normalized = normalizeIPC(classe).substring(0, 3);
    return this.byIpcClasse.get(normalized) || [];
  }
  
  searchBySituacao(situacao) {
    if (!situacao) return [];
    
    const normalized = normalizeText(situacao);
    return this.bySituacao.get(normalized) || [];
  }
  
  searchByDepositante(depositante) {
    if (!depositante) return [];
    
    const normalized = normalizeNomeEmpresarial(depositante);
    const results = [];
    
    for (const [key, records] of this.byDepositante) {
      if (key.includes(normalized)) {
        results.push(...records);
      }
    }
    
    return results;
  }
  
  searchFullText(query) {
    if (!query || !this.isBuilt) return [];
    
    const tokens = tokenize(query, {
      removeStopwords: this.options.removeStopwords,
      stem: this.options.useStemming,
    });
    
    if (tokens.length === 0) return [];
    
    const scoredDocs = new Map();
    
    for (const token of tokens) {
      const normalizedToken = token.toLowerCase();
      
      let posting = this.invertedIndex.get(normalizedToken);
      
      if (!posting) {
        const fuzzyMatch = this._findFuzzyMatch(normalizedToken);
        if (fuzzyMatch) {
          posting = this.invertedIndex.get(fuzzyMatch);
        }
      }
      
      if (!posting) continue;
      
      for (const [docId, docPosting] of posting.postings) {
        if (!scoredDocs.has(docId)) {
          scoredDocs.set(docId, {
            docId,
            score: 0,
            matchedTokens: [],
            matchedFields: Array.from(docPosting.fields),
          });
        }
        
        const docScore = scoredDocs.get(docId);
        const tf = docPosting.tf;
        const df = posting.df;
        const N = this.documentCount;
        
        const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
        const tfNorm = tf / (tf + 1.5);
        
        docScore.score += tfNorm * idf;
        docScore.matchedTokens.push(token);
      }
    }
    
    return Array.from(scoredDocs.values())
      .sort((a, b) => b.score - a.score)
      .map(x => x.docId);
  }
  
  _findFuzzyMatch(token, maxDistance = 1) {
    if (token.length <= 2) return null;
    
    for (const indexedToken of this.invertedIndex.keys()) {
      if (Math.abs(indexedToken.length - token.length) > maxDistance) continue;
      
      const distance = this._levenshteinDistance(token, indexedToken);
      if (distance <= maxDistance) {
        return indexedToken;
      }
    }
    
    return null;
  }
  
  _levenshteinDistance(s1, s2) {
    const m = s1.length;
    const n = s2.length;
    
    let prev = new Array(n + 1).fill(0).map((_, j) => j);
    let curr = new Array(n + 1).fill(0);
    
    for (let i = 1; i <= m; i++) {
      curr[0] = i;
      for (let j = 1; j <= n; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        curr[j] = Math.min(
          prev[j] + 1,
          curr[j - 1] + 1,
          prev[j - 1] + cost
        );
      }
      [prev, curr] = [curr, prev];
    }
    
    return prev[n];
  }
  
  getFacets(fieldName, limit = 20) {
    let dataMap;
    
    switch (fieldName) {
      case 'ano_deposito':
        dataMap = this.byAnoDeposito;
        break;
      case 'ipc_classe_principal':
      case 'ipc_classe':
        dataMap = this.byIpcClasse;
        break;
      case 'situacao':
        dataMap = this.bySituacao;
        break;
      case 'depositante':
        dataMap = this.byDepositante;
        break;
      default:
        return [];
    }
    
    const facets = [];
    for (const [key, records] of dataMap) {
      facets.push({
        value: key,
        count: records.length,
      });
    }
    
    return facets
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }
  
  getStats() {
    return {
      documentCount: this.documentCount,
      invertedIndexSize: this.invertedIndex.size,
      byNumeroSize: this.byNumero.size,
      byAnoDepositoSize: this.byAnoDeposito.size,
      byIpcClasseSize: this.byIpcClasse.size,
      bySituacaoSize: this.bySituacao.size,
      byDepositanteSize: this.byDepositante.size,
      isBuilt: this.isBuilt,
      buildTime: this.buildTime,
      buildDurationMs: this.buildDurationMs || 0,
    };
  }
  
  getMemoryUsage() {
    const used = process.memoryUsage();
    return {
      heapUsed: Math.round(used.heapUsed / 1024 / 1024),
      heapTotal: Math.round(used.heapTotal / 1024 / 1024),
      external: Math.round(used.external / 1024 / 1024),
    };
  }
}

module.exports = {
  PatentIndexes,
};