/**
 * search-engine.js - Motor de busca baseado em FlexSearch
 * 
 * Implementa:
 * - Índices múltiplos por campo com pesos diferentes
 * - Full-text search com relevância
 * - Partial matching (prefix, substring)
 * - Fuzzy search opcional
 * - Persistência de índices em disco
 * - BM25 scoring
 * - Query parsing avançado
 * - Highlighting
 * - Spell correction
 */

const FlexSearch = require('flexsearch');
const fs = require('fs');
const path = require('path');
const { normalizeText, normalizeNumeroPatente, tokenize } = require('./normalizer');
const { FIELD_WEIGHTS } = require('./schema');
const { Scorer } = require('./scoring');
const { QueryParser } = require('./query-parser');
const { highlight, highlightFields } = require('./highlighter');
const { SpellChecker } = require('./spell-check');

const INDEX_DIR = path.join(__dirname, '..', 'data', 'indexes');

class SearchEngine {
  constructor(options = {}) {
    this.options = {
      useStemming: options.useStemming !== false,
      removeStopwords: options.removeStopwords !== false,
      useNgrams: options.useNgrams !== false,
      fuzzy: options.fuzzy || false,
      enableScoring: options.enableScoring !== false,
      enableSpellCheck: options.enableSpellCheck !== false,
      ...options,
    };
    
    this.indexes = {};
    this.documentCount = 0;
    this.documents = new Map();
    this.isBuilt = false;
    this.buildTime = null;
    this.buildDurationMs = 0;
    
    this.scorer = this.options.enableScoring ? new Scorer({
      fieldWeights: FIELD_WEIGHTS,
      recencyBoost: true,
      exactMatchBoost: true,
    }) : null;
    
    this.queryParser = new QueryParser();
    this.spellChecker = this.options.enableSpellCheck ? new SpellChecker() : null;
    
    this._createIndexes();
  }
  
  _createIndexes() {
    const fields = [
      { name: 'numero', weight: FIELD_WEIGHTS.numero, tokenize: 'strict' },
      { name: 'titulo', weight: FIELD_WEIGHTS.titulo, tokenize: 'forward' },
      { name: 'depositante', weight: FIELD_WEIGHTS.depositante, tokenize: 'forward' },
      { name: 'inventor', weight: FIELD_WEIGHTS.inventor, tokenize: 'forward' },
      { name: 'ipc', weight: FIELD_WEIGHTS.ipc, tokenize: 'strict' },
      { name: 'situacao', weight: FIELD_WEIGHTS.situacao, tokenize: 'forward' },
      { name: 'fulltext', weight: 1, tokenize: 'forward' },
    ];
    
    for (const field of fields) {
      this.indexes[field.name] = {
        index: new FlexSearch.Index({
          tokenize: field.tokenize,
          language: 'simple',
          charset: 'latin:advanced',
          resolution: 9,
        }),
        weight: field.weight,
        name: field.name,
      };
    }
  }
  
  addDocument(doc) {
    if (!doc || !doc.numero) return;
    
    const numero = normalizeNumeroPatente(doc.numero) || doc.numero;
    const normalizedDoc = this._normalizeDocument(doc);
    
    this.documents.set(numero, doc);
    
    for (const [fieldName, fieldData] of Object.entries(this.indexes)) {
      try {
        let value = null;
        
        if (fieldName === 'fulltext') {
          value = this._createFulltext(normalizedDoc);
        } else {
          value = normalizedDoc[fieldName];
        }
        
        if (value) {
          fieldData.index.add(numero, String(value));
        }
      } catch (error) {
        console.error(`[search-engine] Error adding doc to index ${fieldName}:`, error.message);
      }
    }
    
    this.documentCount++;
  }
  
  _normalizeDocument(doc) {
    return {
      numero: normalizeNumeroPatente(doc.numero) || doc.numero,
      titulo: normalizeText(doc.titulo),
      depositante: normalizeText(doc.depositante),
      inventor: normalizeText(doc.inventor),
      ipc: normalizeText(doc.ipc).replace(/\s+/g, ''),
      situacao: normalizeText(doc.situacao),
      ano_deposito: doc.ano_deposito,
      data_deposito: doc.data_deposito,
      url_detalhe: doc.url_detalhe,
    };
  }
  
  _createFulltext(doc) {
    const parts = [
      doc.numero,
      doc.titulo,
      doc.depositante,
      doc.inventor,
      doc.ipc,
      doc.situacao,
    ];
    
    return parts.filter(Boolean).join(' ');
  }
  
  addDocuments(documents) {
    for (const doc of documents) {
      this.addDocument(doc);
    }
    
    if (this.spellChecker) {
      this.spellChecker.buildFromDocuments(documents, ['titulo', 'depositante', 'inventor', 'ipc']);
    }
    
    this.isBuilt = true;
    this.buildTime = new Date().toISOString();
  }
  
  build(documents) {
    this._createIndexes();
    this.documentCount = 0;
    this.documents.clear();
    
    const startTime = Date.now();
    
    this.addDocuments(documents);
    
    this.buildDurationMs = Date.now() - startTime;
    
    return this;
  }
  
  search(query, options = {}) {
    if (!query || !this.isBuilt) return { results: [], total: 0 };
    
    const parsedQuery = this.queryParser.parse(query);
    const highlightTerms = this.queryParser.getHighlightTerms(parsedQuery);
    
    const normalizedQuery = normalizeText(query);
    const limit = options.limit || 100;
    
    const results = new Map();
    
    for (const [fieldName, fieldData] of Object.entries(this.indexes)) {
      try {
        const searchResults = fieldData.index.search(normalizedQuery, {
          limit: limit,
          suggest: false,
        });
        
        if (searchResults && searchResults.length > 0) {
          for (const docId of searchResults) {
            const existingScore = results.get(docId) || 0;
            const newScore = existingScore + fieldData.weight;
            
            results.set(docId, {
              numero: docId,
              score: newScore,
              matchedFields: [...(results.get(docId)?.matchedFields || []), fieldName],
            });
          }
        }
      } catch (error) {
        console.error(`[search-engine] Error searching index ${fieldName}:`, error.message);
      }
    }
    
    let sortedResults = Array.from(results.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    
    if (this.scorer && sortedResults.length > 0) {
      const docsWithData = sortedResults.map(r => ({
        ...r,
        ...this.documents.get(r.numero),
      }));
      
      const ranked = this.scorer.rankResults(docsWithData, query, {
        matchedFields: ['titulo', 'depositante', 'inventor', 'ipc'],
        fieldName: 'titulo',
      });
      
      sortedResults = ranked.map(r => ({
        numero: r.numero,
        score: r._score,
        matchedFields: r._matchedFields,
      }));
    }
    
    let spellSuggestion = null;
    if (this.spellChecker && sortedResults.length === 0) {
      spellSuggestion = this.spellChecker.getDidYouMean(query);
    }
    
    return {
      results: sortedResults,
      total: sortedResults.length,
      query: normalizedQuery,
      parsedQuery,
      highlightTerms,
      spellSuggestion,
    };
  }
  
  searchByField(fieldName, query, options = {}) {
    if (!query || !this.indexes[fieldName]) return [];
    
    const normalizedQuery = normalizeText(query);
    const limit = options.limit || 100;
    
    try {
      const searchResults = this.indexes[fieldName].index.search(normalizedQuery, {
        limit: limit,
      });
      
      return searchResults.map(id => ({
        numero: id,
        field: fieldName,
      }));
    } catch (error) {
      console.error(`[search-engine] Error searching ${fieldName}:`, error.message);
      return [];
    }
  }
  
  searchByNumero(numero) {
    const normalized = normalizeNumeroPatente(numero);
    if (!normalized) return null;
    
    try {
      const results = this.indexes.numero.index.search(normalized, {
        limit: 1,
      });
      
      if (results && results.length > 0) {
        return this.documents.get(results[0]) || null;
      }
    } catch (error) {
      console.error('[search-engine] Error searching by numero:', error.message);
    }
    
    return null;
  }
  
  getStats() {
    const stats = {
      documentCount: this.documentCount,
      documentsStored: this.documents.size,
      isBuilt: this.isBuilt,
      buildTime: this.buildTime,
      buildDurationMs: this.buildDurationMs,
      indexes: {},
      features: {
        scoring: !!this.scorer,
        spellCheck: !!this.spellChecker,
        queryParsing: !!this.queryParser,
      },
    };
    
    for (const [fieldName, fieldData] of Object.entries(this.indexes)) {
      try {
        stats.indexes[fieldName] = {
          size: fieldData.index.length || 0,
          weight: fieldData.weight,
        };
      } catch (_) {
        stats.indexes[fieldName] = { size: 0, weight: fieldData.weight };
      }
    }
    
    if (this.scorer) {
      stats.scorer = this.scorer.getStats();
    }
    
    if (this.spellChecker) {
      stats.spellChecker = this.spellChecker.getStats();
    }
    
    return stats;
  }
  
  async exportToFile(filePath) {
    const exportDir = path.dirname(filePath);
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
    }
    
    const exports = {};
    
    for (const [fieldName, fieldData] of Object.entries(this.indexes)) {
      try {
        const exported = await fieldData.index.export();
        if (exported) {
          exports[fieldName] = exported;
        }
      } catch (error) {
        console.error(`[search-engine] Error exporting index ${fieldName}:`, error.message);
      }
    }
    
    const documents = Array.from(this.documents.entries());
    
    fs.writeFileSync(filePath, JSON.stringify({
      indexes: exports,
      documents: documents,
    }), 'utf8');
    
    return filePath;
  }
  
  async importFromFile(filePath) {
    if (!fs.existsSync(filePath)) {
      return false;
    }
    
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(content);
      
      this._createIndexes();
      
      for (const [fieldName, exportData] of Object.entries(data.indexes || {})) {
        if (this.indexes[fieldName] && exportData) {
          await this.indexes[fieldName].index.import(exportData);
        }
      }
      
      if (data.documents) {
        this.documents = new Map(data.documents);
        this.documentCount = this.documents.size;
      }
      
      this.isBuilt = true;
      this.buildTime = new Date().toISOString();
      
      return true;
    } catch (error) {
      console.error('[search-engine] Error importing indexes:', error.message);
      return false;
    }
  }
  
  async saveToDisk(baseName = 'patentes') {
    if (!fs.existsSync(INDEX_DIR)) {
      fs.mkdirSync(INDEX_DIR, { recursive: true });
    }
    
    const filePath = path.join(INDEX_DIR, `${baseName}.flexsearch.json`);
    await this.exportToFile(filePath);
    
    const metaPath = path.join(INDEX_DIR, `${baseName}.flexsearch.meta.json`);
    const meta = {
      savedAt: new Date().toISOString(),
      documentCount: this.documentCount,
      stats: this.getStats(),
    };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
    
    return { indexPath: filePath, metaPath };
  }
  
  async loadFromDisk(baseName = 'patentes') {
    const filePath = path.join(INDEX_DIR, `${baseName}.flexsearch.json`);
    const metaPath = path.join(INDEX_DIR, `${baseName}.flexsearch.meta.json`);
    
    const loaded = await this.importFromFile(filePath);
    
    if (loaded && fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        this.documentCount = meta.documentCount || 0;
        this.buildTime = meta.savedAt;
      } catch (_) {}
    }
    
    return loaded;
  }
  
  clear() {
    this._createIndexes();
    this.documentCount = 0;
    this.documents.clear();
    this.isBuilt = false;
    this.buildTime = null;
    this.buildDurationMs = 0;
  }
  
  getMemoryUsage() {
    const mem = process.memoryUsage();
    return {
      heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
      heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
      rss_mb: Math.round(mem.rss / 1024 / 1024),
    };
  }
}

module.exports = {
  SearchEngine,
  INDEX_DIR,
};