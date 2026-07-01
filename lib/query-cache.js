/**
 * query-cache.js - Cache de queries frequentes
 * 
 * Implementa:
 * - LRU Cache (Least Recently Used)
 * - TTL (Time To Live) configurável
 * - Cache warming (pré-carregamento)
 * - Estatísticas de hit/miss
 */

const crypto = require('crypto');

class QueryCache {
  constructor(options = {}) {
    this.options = {
      maxSize: options.maxSize || 1000,
      ttlMs: options.ttlMs || 15 * 60 * 1000,
      enabled: options.enabled !== false,
      ...options,
    };
    
    this.cache = new Map();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }
  
  _generateKey(query) {
    return crypto.createHash('md5').update(query).digest('hex');
  }
  
  get(query) {
    if (!this.options.enabled) return null;
    
    const key = this._generateKey(query);
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.misses++;
      return null;
    }
    
    const now = Date.now();
    if (now - entry.timestamp > this.options.ttlMs) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }
    
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.hits++;
    
    return entry.data;
  }
  
  set(query, data, ttlMs = null) {
    if (!this.options.enabled) return;
    
    const key = this._generateKey(query);
    const now = Date.now();
    
    if (this.cache.size >= this.options.maxSize && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
      this.evictions++;
    }
    
    this.cache.set(key, {
      data,
      timestamp: now,
      ttl: ttlMs || this.options.ttlMs,
    });
  }
  
  has(query) {
    return this.get(query) !== null;
  }
  
  delete(query) {
    const key = this._generateKey(query);
    return this.cache.delete(key);
  }
  
  clear() {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }
  
  getStats() {
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? (this.hits / total) * 100 : 0;
    
    return {
      size: this.cache.size,
      maxSize: this.options.maxSize,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      hitRate: Math.round(hitRate * 100) / 100,
      avgTtlRemainingMs: this._calculateAvgTtlRemaining(),
    };
  }
  
  _calculateAvgTtlRemaining() {
    const now = Date.now();
    let totalRemaining = 0;
    let count = 0;
    
    for (const entry of this.cache.values()) {
      const remaining = Math.max(0, entry.ttl - (now - entry.timestamp));
      totalRemaining += remaining;
      count++;
    }
    
    return count > 0 ? Math.round(totalRemaining / count) : 0;
  }
  
  warmUp(queries, fetchFn) {
    const results = [];
    
    for (const query of queries) {
      if (!this.has(query)) {
        const data = fetchFn(query);
        if (data) {
          this.set(query, data);
          results.push({ query, cached: true });
        }
      } else {
        results.push({ query, cached: false });
      }
    }
    
    return results;
  }
  
  getPopularQueries(minHits = 5) {
    const queryCounts = new Map();
    
    for (const entry of this.cache.values()) {
      if (entry.data && entry.data.query) {
        const count = queryCounts.get(entry.data.query) || 0;
        queryCounts.set(entry.data.query, count + 1);
      }
    }
    
    return Array.from(queryCounts.entries())
      .filter(([_, count]) => count >= minHits)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([query, count]) => ({ query, count }));
  }
  
  export() {
    const entries = [];
    
    for (const [key, entry] of this.cache.entries()) {
      entries.push({
        key,
        data: entry.data,
        timestamp: entry.timestamp,
        ttl: entry.ttl,
      });
    }
    
    return entries;
  }
  
  import(entries) {
    this.clear();
    
    for (const entry of entries) {
      this.cache.set(entry.key, {
        data: entry.data,
        timestamp: entry.timestamp,
        ttl: entry.ttl,
      });
    }
  }
}

module.exports = {
  QueryCache,
};