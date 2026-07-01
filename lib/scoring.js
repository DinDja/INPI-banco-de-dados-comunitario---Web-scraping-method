/**
 * scoring.js - Algoritmos de scoring e ranking para busca
 * 
 * Implementa:
 * - BM25 (Okapi BM25) para relevância
 * - TF-IDF alternativo
 * - Boost por campo
 * - Boost por recenticidade
 * - Boost por exact match
 * - Proximity scoring
 */

const { normalizeText, tokenize } = require('./normalizer');

const BM25_PARAMS = {
  k1: 1.5,
  b: 0.75,
};

class Scorer {
  constructor(options = {}) {
    this.options = {
      useBM25: options.useBM25 !== false,
      useTFIDF: options.useTFIDF === true,
      fieldWeights: options.fieldWeights || {},
      recencyBoost: options.recencyBoost !== false,
      exactMatchBoost: options.exactMatchBoost !== false,
      proximityScoring: options.proximityScoring === true,
      ...options,
    };
    
    this.documents = new Map();
    this.fieldLengths = new Map();
    this.avgFieldLengths = new Map();
    this.termFrequency = new Map();
    this.documentFrequency = new Map();
    this.totalDocuments = 0;
  }
  
  addDocument(id, doc, fields = ['titulo', 'depositante', 'inventor', 'ipc']) {
    this.documents.set(id, doc);
    this.totalDocuments++;
    
    for (const field of fields) {
      const value = doc[field];
      if (!value) continue;
      
      const tokens = tokenize(String(value), { removeStopwords: true, stem: false });
      const fieldKey = `${id}:${field}`;
      this.fieldLengths.set(fieldKey, tokens.length);
      
      for (const token of tokens) {
        const tfKey = `${fieldKey}:${token}`;
        this.termFrequency.set(tfKey, (this.termFrequency.get(tfKey) || 0) + 1);
        
        const dfKey = `${field}:${token}`;
        if (!this.documentFrequency.has(dfKey)) {
          this.documentFrequency.set(dfKey, new Set());
        }
        this.documentFrequency.get(dfKey).add(id);
      }
    }
  }
  
  calculateAvgFieldLengths() {
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
  
  bm25(term, field, docId) {
    const tfKey = `${docId}:${field}:${term}`;
    const dfKey = `${field}:${term}`;
    const lengthKey = `${docId}:${field}`;
    
    const tf = this.termFrequency.get(tfKey) || 0;
    const df = this.documentFrequency.get(dfKey)?.size || 0;
    const docLength = this.fieldLengths.get(lengthKey) || 0;
    const avgLength = this.avgFieldLengths.get(field) || 0;
    
    if (tf === 0 || df === 0) return 0;
    
    const N = this.totalDocuments;
    const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
    
    const k1 = BM25_PARAMS.k1;
    const b = BM25_PARAMS.b;
    
    const tfNorm = tf * (k1 + 1) / (tf + k1 * (1 - b + b * (docLength / avgLength)));
    
    return tfNorm * idf;
  }
  
  tfidf(term, field, docId) {
    const tfKey = `${docId}:${field}:${term}`;
    const dfKey = `${field}:${term}`;
    
    const tf = this.termFrequency.get(tfKey) || 0;
    const df = this.documentFrequency.get(dfKey)?.size || 0;
    
    if (tf === 0 || df === 0) return 0;
    
    const N = this.totalDocuments;
    const idf = Math.log(N / df) + 1;
    
    return tf * idf;
  }
  
  calculateScore(doc, query, matchedFields = []) {
    if (!doc || !query) return 0;
    
    const queryTokens = tokenize(query, { removeStopwords: true, stem: false });
    if (queryTokens.length === 0) return 0;
    
    let totalScore = 0;
    
    for (const token of queryTokens) {
      for (const field of matchedFields) {
        const fieldWeight = this.options.fieldWeights[field] || 1;
        
        let score = 0;
        if (this.options.useBM25) {
          score = this.bm25(token, field, doc.numero || doc.id);
        } else {
          score = this.tfidf(token, field, doc.numero || doc.id);
        }
        
        totalScore += score * fieldWeight;
      }
    }
    
    totalScore *= this._calculateFieldBoost(doc, query, matchedFields);
    totalScore *= this._calculateRecencyBoost(doc);
    totalScore *= this._calculateExactMatchBoost(doc, query);
    
    return totalScore;
  }
  
  _calculateFieldBoost(doc, query, matchedFields) {
    let boost = 1;
    
    const queryLower = normalizeText(query);
    
    if (matchedFields.includes('titulo')) {
      const titulo = normalizeText(doc.titulo);
      if (titulo && titulo.includes(queryLower)) {
        boost *= 2;
      }
    }
    
    if (matchedFields.includes('numero')) {
      const numero = normalizeText(doc.numero);
      if (numero && numero.includes(queryLower)) {
        boost *= 5;
      }
    }
    
    if (matchedFields.includes('ipc')) {
      const ipc = normalizeText(doc.ipc).replace(/\s+/g, '');
      if (ipc && ipc.includes(queryLower.replace(/\s+/g, ''))) {
        boost *= 3;
      }
    }
    
    return boost;
  }
  
  _calculateRecencyBoost(doc) {
    if (!this.options.recencyBoost) return 1;
    
    const anoDeposito = doc.ano_deposito;
    if (!anoDeposito) return 1;
    
    const currentYear = new Date().getFullYear();
    const yearsDiff = currentYear - anoDeposito;
    
    if (yearsDiff <= 2) {
      return 1.5;
    } else if (yearsDiff <= 5) {
      return 1.2;
    } else if (yearsDiff <= 10) {
      return 1;
    } else {
      return 0.8;
    }
  }
  
  _calculateExactMatchBoost(doc, query) {
    if (!this.options.exactMatchBoost) return 1;
    
    const queryLower = normalizeText(query);
    let boost = 1;
    
    const fields = ['numero', 'titulo', 'depositante', 'ipc'];
    for (const field of fields) {
      const value = normalizeText(doc[field]);
      if (value && value === queryLower) {
        boost *= 3;
        break;
      }
    }
    
    return boost;
  }
  
  calculateProximityScore(doc, query, fieldName = 'titulo') {
    if (!this.options.proximityScoring) return 1;
    
    const queryTokens = tokenize(query, { removeStopwords: true, stem: false });
    if (queryTokens.length < 2) return 1;
    
    const fieldValue = normalizeText(doc[fieldName]);
    if (!fieldValue) return 1;
    
    const fieldTokens = tokenize(fieldValue, { removeStopwords: true, stem: false });
    
    let minDistance = Infinity;
    
    for (let i = 0; i <= fieldTokens.length - queryTokens.length; i++) {
      let matchCount = 0;
      for (let j = 0; j < queryTokens.length; j++) {
        if (fieldTokens[i + j] === queryTokens[j]) {
          matchCount++;
        }
      }
      
      if (matchCount === queryTokens.length) {
        minDistance = 0;
        break;
      }
    }
    
    if (minDistance === 0) {
      return 2;
    } else if (minDistance < 5) {
      return 1.5;
    }
    
    return 1;
  }
  
  rankResults(results, query, options = {}) {
    const scored = results.map(doc => {
      const matchedFields = options.matchedFields || ['titulo', 'depositante', 'inventor', 'ipc'];
      const baseScore = this.calculateScore(doc, query, matchedFields);
      const proximityBoost = this.calculateProximityScore(doc, query, options.fieldName || 'titulo');
      
      return {
        ...doc,
        _score: baseScore * proximityBoost,
        _matchedFields: matchedFields,
      };
    });
    
    scored.sort((a, b) => b._score - a._score);
    
    return scored;
  }
  
  getStats() {
    return {
      totalDocuments: this.totalDocuments,
      uniqueTerms: this.documentFrequency.size,
      avgFieldLengths: Object.fromEntries(this.avgFieldLengths),
    };
  }
  
  clear() {
    this.documents.clear();
    this.fieldLengths.clear();
    this.avgFieldLengths.clear();
    this.termFrequency.clear();
    this.documentFrequency.clear();
    this.totalDocuments = 0;
  }
}

function calculateBM25(params) {
  const { termFrequency, documentFrequency, fieldLength, avgFieldLength, totalDocuments } = params;
  
  const k1 = BM25_PARAMS.k1;
  const b = BM25_PARAMS.b;
  
  const idf = Math.log((totalDocuments - documentFrequency + 0.5) / (documentFrequency + 0.5) + 1);
  const tfNorm = termFrequency * (k1 + 1) / (termFrequency + k1 * (1 - b + b * (fieldLength / avgFieldLength)));
  
  return tfNorm * idf;
}

function calculateTFIDF(params) {
  const { termFrequency, documentFrequency, totalDocuments } = params;
  
  const idf = Math.log(totalDocuments / documentFrequency) + 1;
  return termFrequency * idf;
}

module.exports = {
  Scorer,
  BM25_PARAMS,
  calculateBM25,
  calculateTFIDF,
};