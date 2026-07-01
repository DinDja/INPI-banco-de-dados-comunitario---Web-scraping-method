/**
 * query-parser.js - Parser de queries avançadas
 * 
 * Implementa:
 * - Operadores booleanos: AND, OR, NOT
 * - Busca por frase exata: "energia solar"
 * - Wildcards: solar*, ?nergia
 * - Field-specific search: titulo:solar AND ipc:H02
 * - Range queries: ano_deposito:[2020 TO 2024]
 */

const { normalizeText, tokenize } = require('./normalizer');

const BOOLEAN_OPERATORS = ['AND', 'OR', 'NOT'];
const FIELD_PATTERN = /^(\w+):(.+)$/;
const PHRASE_PATTERN = /^"(.+)"$/;
const WILDCARD_PATTERN = /[*?]/;
const RANGE_PATTERN = /^\[(\d+)\s+TO\s+(\d+)\]$/i;

class QueryParser {
  constructor(options = {}) {
    this.options = {
      defaultOperator: options.defaultOperator || 'AND',
      defaultFields: options.defaultFields || ['titulo', 'depositante', 'inventor', 'ipc'],
      allowWildcards: options.allowWildcards !== false,
      allowFuzzy: options.allowFuzzy === true,
      ...options,
    };
  }
  
  parse(query) {
    if (!query || typeof query !== 'string') {
      return {
        type: 'empty',
        terms: [],
        operator: this.options.defaultOperator,
      };
    }
    
    const normalizedQuery = normalizeText(query);
    
    if (PHRASE_PATTERN.test(query.trim())) {
      return this._parsePhrase(query);
    }
    
    if (normalizedQuery.includes(' AND ') || normalizedQuery.includes(' OR ') || normalizedQuery.includes(' NOT ')) {
      return this._parseBoolean(normalizedQuery);
    }
    
    const fieldMatch = FIELD_PATTERN.exec(normalizedQuery);
    if (fieldMatch) {
      return this._parseFieldSpecific(fieldMatch[1], fieldMatch[2]);
    }
    
    if (WILDCARD_PATTERN.test(normalizedQuery) && this.options.allowWildcards) {
      return this._parseWildcard(normalizedQuery);
    }
    
    const rangeMatch = RANGE_PATTERN.exec(normalizedQuery);
    if (rangeMatch) {
      return this._parseRange(rangeMatch[1], rangeMatch[2]);
    }
    
    return this._parseSimple(normalizedQuery);
  }
  
  _parsePhrase(query) {
    const match = PHRASE_PATTERN.exec(query.trim());
    if (!match) return this._parseSimple(query);
    
    const phrase = match[1];
    
    return {
      type: 'phrase',
      phrase: phrase,
      terms: tokenize(phrase, { removeStopwords: false, stem: false }),
      operator: 'AND',
      proximity: 0,
    };
  }
  
  _parseBoolean(query) {
    const clauses = [];
    let currentOperator = 'AND';
    
    const tokens = query.split(/\s+(AND|OR|NOT)\s+/i);
    
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i].trim();
      
      if (BOOLEAN_OPERATORS.includes(token.toUpperCase())) {
        currentOperator = token.toUpperCase();
        continue;
      }
      
      if (!token) continue;
      
      const fieldMatch = FIELD_PATTERN.exec(token);
      if (fieldMatch) {
        clauses.push({
          field: fieldMatch[1],
          term: fieldMatch[2],
          operator: currentOperator,
          type: 'field',
        });
      } else if (PHRASE_PATTERN.test(token)) {
        const phraseMatch = PHRASE_PATTERN.exec(token);
        clauses.push({
          phrase: phraseMatch[1],
          operator: currentOperator,
          type: 'phrase',
        });
      } else {
        clauses.push({
          term: token,
          operator: currentOperator,
          type: 'term',
        });
      }
      
      currentOperator = this.options.defaultOperator;
    }
    
    return {
      type: 'boolean',
      clauses,
      operator: this.options.defaultOperator,
    };
  }
  
  _parseFieldSpecific(field, value) {
    const isPhrase = PHRASE_PATTERN.test(value);
    const isWildcard = WILDCARD_PATTERN.test(value);
    
    let term = value;
    let type = 'field_term';
    
    if (isPhrase) {
      const phraseMatch = PHRASE_PATTERN.exec(value);
      term = phraseMatch[1];
      type = 'field_phrase';
    }
    
    if (isWildcard) {
      type = 'field_wildcard';
    }
    
    return {
      type: type,
      field: field,
      term: term,
      terms: tokenize(term, { removeStopwords: false, stem: false }),
      operator: 'AND',
    };
  }
  
  _parseWildcard(query) {
    const terms = [];
    
    if (query.includes('*')) {
      const parts = query.split('*');
      terms.push({
        prefix: parts[0],
        suffix: parts[1] || '',
        type: 'prefix',
      });
    } else if (query.includes('?')) {
      terms.push({
        pattern: query,
        type: 'fuzzy',
      });
    }
    
    return {
      type: 'wildcard',
      terms,
      operator: 'OR',
    };
  }
  
  _parseRange(start, end) {
    return {
      type: 'range',
      field: 'ano_deposito',
      start: parseInt(start, 10),
      end: parseInt(end, 10),
      operator: 'AND',
    };
  }
  
  _parseSimple(query) {
    const terms = tokenize(query, { removeStopwords: true, stem: false });
    
    return {
      type: 'simple',
      terms,
      originalQuery: query,
      operator: this.options.defaultOperator,
    };
  }
  
  compile(parsedQuery) {
    if (!parsedQuery || parsedQuery.type === 'empty') {
      return () => true;
    }
    
    switch (parsedQuery.type) {
      case 'phrase':
        return this._compilePhrase(parsedQuery);
      
      case 'boolean':
        return this._compileBoolean(parsedQuery);
      
      case 'field_term':
      case 'field_phrase':
      case 'field_wildcard':
        return this._compileFieldSpecific(parsedQuery);
      
      case 'wildcard':
        return this._compileWildcard(parsedQuery);
      
      case 'range':
        return this._compileRange(parsedQuery);
      
      case 'simple':
      default:
        return this._compileSimple(parsedQuery);
    }
  }
  
  _compileSimple(parsedQuery) {
    const terms = parsedQuery.terms;
    
    return (doc, matchedFields) => {
      let matchCount = 0;
      
      for (const term of terms) {
        const termLower = term.toLowerCase();
        let found = false;
        
        for (const field of matchedFields) {
          const value = String(doc[field] || '').toLowerCase();
          if (value && value.includes(termLower)) {
            found = true;
            break;
          }
        }
        
        if (found) {
          matchCount++;
        }
      }
      
      if (parsedQuery.operator === 'AND') {
        return matchCount === terms.length;
      } else {
        return matchCount > 0;
      }
    };
  }
  
  _compilePhrase(parsedQuery) {
    const phrase = parsedQuery.phrase.toLowerCase();
    
    return (doc, matchedFields) => {
      for (const field of matchedFields) {
        const value = String(doc[field] || '').toLowerCase();
        if (value && value.includes(phrase)) {
          return true;
        }
      }
      return false;
    };
  }
  
  _compileBoolean(parsedQuery) {
    const clauseFilters = parsedQuery.clauses.map(clause => {
      if (clause.type === 'phrase') {
        const phraseFilter = this._compilePhrase({ phrase: clause.phrase });
        return (doc, fields) => {
          const matches = phraseFilter(doc, fields);
          return clause.operator === 'NOT' ? !matches : matches;
        };
      }
      
      const termLower = clause.term.toLowerCase();
      return (doc, fields) => {
        let found = false;
        
        for (const field of fields) {
          const value = String(doc[field] || '').toLowerCase();
          if (value && value.includes(termLower)) {
            found = true;
            break;
          }
        }
        
        return clause.operator === 'NOT' ? !found : found;
      };
    });
    
    return (doc, fields) => {
      if (parsedQuery.operator === 'AND') {
        return clauseFilters.every(filter => filter(doc, fields));
      } else if (parsedQuery.operator === 'OR') {
        return clauseFilters.some(filter => filter(doc, fields));
      } else {
        let result = true;
        for (let i = 0; i < clauseFilters.length; i++) {
          const clause = parsedQuery.clauses[i];
          const matches = clauseFilters[i](doc, fields);
          
          if (clause.operator === 'NOT' && matches) {
            return false;
          } else if (clause.operator === 'OR' && matches) {
            result = true;
          } else if (clause.operator === 'AND' && !matches) {
            return false;
          }
        }
        return result;
      }
    };
  }
  
  _compileFieldSpecific(parsedQuery) {
    const field = parsedQuery.field;
    const term = parsedQuery.term.toLowerCase();
    
    return (doc) => {
      const value = String(doc[field] || '').toLowerCase();
      
      if (parsedQuery.type === 'field_phrase') {
        return value.includes(term);
      } else if (parsedQuery.type === 'field_wildcard') {
        const pattern = term.replace(/\*/g, '.*').replace(/\?/g, '.');
        const regex = new RegExp(`^${pattern}$`, 'i');
        return regex.test(value);
      } else {
        return value.includes(term);
      }
    };
  }
  
  _compileWildcard(parsedQuery) {
    const patterns = parsedQuery.terms.map(t => {
      if (t.type === 'prefix') {
        const pattern = `^${t.prefix}.*${t.suffix}$`;
        return new RegExp(pattern, 'i');
      } else if (t.type === 'fuzzy') {
        const pattern = t.pattern.replace(/\?/g, '.');
        return new RegExp(`^${pattern}$`, 'i');
      }
      return null;
    }).filter(Boolean);
    
    return (doc, matchedFields) => {
      for (const field of matchedFields) {
        const value = String(doc[field] || '');
        for (const pattern of patterns) {
          if (pattern.test(value)) {
            return true;
          }
        }
      }
      return false;
    };
  }
  
  _compileRange(parsedQuery) {
    const { start, end, field } = parsedQuery;
    
    return (doc) => {
      const value = doc[field];
      if (!value) return false;
      return value >= start && value <= end;
    };
  }
  
  getHighlightTerms(parsedQuery) {
    if (!parsedQuery) return [];
    
    const terms = [];
    
    if (parsedQuery.type === 'phrase') {
      terms.push(parsedQuery.phrase);
    } else if (parsedQuery.type === 'boolean') {
      for (const clause of parsedQuery.clauses) {
        if (clause.term) terms.push(clause.term);
        if (clause.phrase) terms.push(clause.phrase);
      }
    } else if (parsedQuery.terms) {
      terms.push(...parsedQuery.terms);
    }
    
    return terms.filter(Boolean).map(t => normalizeText(t));
  }
}

module.exports = {
  QueryParser,
  BOOLEAN_OPERATORS,
  FIELD_PATTERN,
  PHRASE_PATTERN,
  WILDCARD_PATTERN,
  RANGE_PATTERN,
};