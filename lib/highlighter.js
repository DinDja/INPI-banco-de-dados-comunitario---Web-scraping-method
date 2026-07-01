/**
 * highlighter.js - Highlighting de termos nos resultados
 * 
 * Implementa:
 * - Marcação de termos buscados
 * - Geração de snippets com contexto
 * - Highlight múltiplo por campo
 */

const { normalizeText } = require('./normalizer');

function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/[&<>"']/g, function(m) {
    return {
      '&': '&',
      '<': '<',
      '>': '>',
      '"': '"',
      "'": '\x27'
    }[m];
  });
}

function highlight(text, terms, options = {}) {
  if (!text || !terms || terms.length === 0) {
    return escapeHtml(text);
  }
  
  const tag = options.tag || 'mark';
  const className = options.className ? ` class="${options.className}"` : '';
  const caseSensitive = options.caseSensitive !== false;
  
  let highlighted = escapeHtml(text);
  
  const sortedTerms = terms
    .filter(Boolean)
    .map(t => normalizeText(t))
    .sort((a, b) => b.length - a.length);
  
  for (const term of sortedTerms) {
    if (!term || term.length < 2) continue;
    
    const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    const regex = new RegExp(
      `(${escapedTerm})`,
      caseSensitive ? 'g' : 'gi'
    );
    
    highlighted = highlighted.replace(regex, `<${tag}${className}>$1</${tag}>`);
  }
  
  return highlighted;
}

function createSnippet(text, terms, options = {}) {
  if (!text) return '';
  
  const maxLength = options.maxLength || 150;
  const radius = options.radius || 50;
  const ellipsis = options.ellipsis !== false ? '...' : '';
  
  const normalizedText = String(text);
  const lowerText = normalizedText.toLowerCase();
  
  let bestStart = -1;
  let bestScore = 0;
  
  for (const term of terms) {
    if (!term) continue;
    
    const termLower = normalizeText(term).toLowerCase();
    let pos = 0;
    
    while ((pos = lowerText.indexOf(termLower, pos)) !== -1) {
      let score = term.length;
      
      const wordStart = pos > 0 && /\w/.test(normalizedText[pos - 1]);
      const wordEnd = pos + term.length < normalizedText.length && /\w/.test(normalizedText[pos + term.length]);
      
      if (!wordStart && !wordEnd) {
        score *= 2;
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestStart = pos;
      }
      
      pos++;
    }
  }
  
  if (bestStart === -1) {
    if (normalizedText.length <= maxLength) {
      return highlight(normalizedText, terms, options);
    }
    
    return highlight(normalizedText.substring(0, maxLength), terms, options) + ellipsis;
  }
  
  let start = Math.max(0, bestStart - radius);
  let end = Math.min(normalizedText.length, bestStart + 10 + radius);
  
  while (start > 0 && /\w/.test(normalizedText[start])) {
    start--;
  }
  
  while (end < normalizedText.length && /\w/.test(normalizedText[end])) {
    end++;
  }
  
  if (end - start > maxLength) {
    end = start + maxLength;
  }
  
  const snippet = normalizedText.substring(start, end);
  
  return (start > 0 ? ellipsis : '') +
    highlight(snippet.trim(), terms, options) +
    (end < normalizedText.length ? ellipsis : '');
}

function highlightFields(doc, terms, fields, options = {}) {
  const highlighted = {};
  
  for (const field of fields) {
    const value = doc[field];
    if (!value) continue;
    
    if (options.snippet) {
      highlighted[`${field}_snippet`] = createSnippet(value, terms, options);
    } else {
      highlighted[field] = highlight(value, terms, options);
    }
  }
  
  return highlighted;
}

function extractHighlights(html) {
  const highlights = [];
  const regex = /<mark[^>]*>(.*?)<\/mark>/gi;
  let match;
  
  while ((match = regex.exec(html)) !== null) {
    highlights.push(match[1]);
  }
  
  return [...new Set(highlights)];
}

module.exports = {
  highlight,
  createSnippet,
  highlightFields,
  extractHighlights,
  escapeHtml,
};