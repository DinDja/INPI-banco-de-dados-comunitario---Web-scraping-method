/**
 * spell-check.js - Correção ortográfica e sugestões
 * 
 * Implementa:
 * - Distância de Levenshtein para similaridade
 * - Sugestões baseadas em termos indexados
 * - "Você quis dizer...?"
 */

const { normalizeText, tokenize } = require('./normalizer');

function levenshteinDistance(s1, s2) {
  const m = s1.length;
  const n = s2.length;
  
  if (Math.abs(m - n) > 2) return Math.max(m, n);
  
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
      
      if (i > 1 && j > 1 && s1[i - 1] === s2[j - 2] && s1[i - 2] === s2[j - 1]) {
        curr[j] = Math.min(curr[j], prev[j - 2] + cost);
      }
    }
    [prev, curr] = [curr, prev];
  }
  
  return prev[n];
}

function similarity(s1, s2) {
  const distance = levenshteinDistance(s1, s2);
  const maxLength = Math.max(s1.length, s2.length);
  return maxLength > 0 ? 1 - distance / maxLength : 1;
}

class SpellChecker {
  constructor(options = {}) {
    this.options = {
      maxDistance: options.maxDistance || 2,
      minSimilarity: options.minSimilarity || 0.7,
      maxSuggestions: options.maxSuggestions || 5,
      minLength: options.minLength || 3,
      ...options,
    };
    
    this.dictionary = new Set();
    this.termFrequency = new Map();
  }
  
  addTerm(term, frequency = 1) {
    const normalized = normalizeText(term);
    if (normalized.length >= this.options.minLength) {
      this.dictionary.add(normalized);
      this.termFrequency.set(normalized, (this.termFrequency.get(normalized) || 0) + frequency);
    }
  }
  
  addTerms(terms) {
    for (const term of terms) {
      this.addTerm(term);
    }
  }
  
  buildFromDocuments(documents, fields = ['titulo', 'depositante', 'inventor', 'ipc']) {
    for (const doc of documents) {
      for (const field of fields) {
        const value = doc[field];
        if (!value) continue;
        
        const tokens = tokenize(String(value), { removeStopwords: true, stem: false });
        for (const token of tokens) {
          this.addTerm(token);
        }
      }
    }
  }
  
  suggest(query) {
    if (!query || query.length < this.options.minLength) {
      return [];
    }
    
    const normalizedQuery = normalizeText(query);
    const suggestions = [];
    
    for (const term of this.dictionary) {
      const distance = levenshteinDistance(normalizedQuery, term);
      
      if (distance <= this.options.maxDistance) {
        const similarity = 1 - distance / Math.max(normalizedQuery.length, term.length);
        
        if (similarity >= this.options.minSimilarity) {
          suggestions.push({
            term: term,
            distance: distance,
            similarity: similarity,
            frequency: this.termFrequency.get(term) || 0,
          });
        }
      }
    }
    
    suggestions.sort((a, b) => {
      if (b.similarity !== a.similarity) {
        return b.similarity - a.similarity;
      }
      return b.frequency - a.frequency;
    });
    
    return suggestions.slice(0, this.options.maxSuggestions);
  }
  
  getCorrection(query) {
    const suggestions = this.suggest(query);
    return suggestions.length > 0 ? suggestions[0] : null;
  }
  
  shouldSuggest(query) {
    if (!query || query.length < this.options.minLength) {
      return false;
    }
    
    const normalizedQuery = normalizeText(query);
    return !this.dictionary.has(normalizedQuery);
  }
  
  getDidYouMean(query) {
    if (!this.shouldSuggest(query)) {
      return null;
    }
    
    const correction = this.getCorrection(query);
    
    if (correction && correction.similarity >= 0.8) {
      return {
        original: query,
        suggestion: correction.term,
        similarity: correction.similarity,
        message: `Você quis dizer "${correction.term}"?`,
      };
    }
    
    return null;
  }
  
  getStats() {
    return {
      dictionarySize: this.dictionary.size,
      uniqueTerms: this.termFrequency.size,
    };
  }
  
  clear() {
    this.dictionary.clear();
    this.termFrequency.clear();
  }
}

function findBestMatch(query, candidates, options = {}) {
  const maxDistance = options.maxDistance || 2;
  const normalizedQuery = normalizeText(query);
  
  let bestMatch = null;
  let bestScore = -1;
  
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeText(candidate);
    const distance = levenshteinDistance(normalizedQuery, normalizedCandidate);
    
    if (distance <= maxDistance) {
      const score = 1 - distance / Math.max(normalizedQuery.length, normalizedCandidate.length);
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = {
          term: candidate,
          distance: distance,
          similarity: score,
        };
      }
    }
  }
  
  return bestMatch;
}

module.exports = {
  SpellChecker,
  levenshteinDistance,
  similarity,
  findBestMatch,
};