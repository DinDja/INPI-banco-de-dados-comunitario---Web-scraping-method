/**
 * query-logger.js - Log e analytics de queries
 * 
 * Implementa:
 * - Log de todas as queries em JSONL
 * - Estatísticas de uso (top queries, zero results, tempo médio)
 * - Detecção de queries sem resultados
 * - Click tracking (opcional)
 */

const fs = require('fs');
const path = require('path');
const { normalizeText } = require('./normalizer');

const LOG_FILE = path.join(__dirname, '..', 'data', 'query-log.jsonl');
const STATS_FILE = path.join(__dirname, '..', 'data', 'query-stats.json');

class QueryLogger {
  constructor(options = {}) {
    this.options = {
      enabled: options.enabled !== false,
      logFile: options.logFile || LOG_FILE,
      statsFile: options.statsFile || STATS_FILE,
      minQueryLength: options.minQueryLength || 2,
      trackClicks: options.trackClicks === true,
      ...options,
    };
    
    this.stats = this._loadStats();
    this._ensureLogFile();
  }
  
  _ensureLogFile() {
    const dir = path.dirname(this.options.logFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  
  _loadStats() {
    if (fs.existsSync(this.options.statsFile)) {
      try {
        return JSON.parse(fs.readFileSync(this.options.statsFile, 'utf8'));
      } catch (_) {}
    }
    
    return {
      totalQueries: 0,
      uniqueQueries: 0,
      queriesWithResults: 0,
      zeroResultQueries: 0,
      avgResponseTimeMs: 0,
      totalResponseTimeMs: 0,
      topQueries: {},
      zeroResultQueriesList: [],
      hourlyStats: {},
      dailyStats: {},
      lastUpdated: new Date().toISOString(),
    };
  }
  
  _saveStats() {
    this.stats.lastUpdated = new Date().toISOString();
    const dir = path.dirname(this.options.statsFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.options.statsFile, JSON.stringify(this.stats, null, 2), 'utf8');
  }
  
  log(queryData) {
    if (!this.options.enabled) return;
    
    const {
      query,
      results,
      responseTimeMs,
      userId,
      sessionId,
      timestamp = new Date().toISOString(),
      filters = {},
      pagination = {},
    } = queryData;
    
    if (!query || query.length < this.options.minQueryLength) {
      return;
    }
    
    const normalizedQuery = normalizeText(query);
    const hasResults = results && results.length > 0;
    
    const logEntry = {
      timestamp,
      query: normalizedQuery,
      originalQuery: query,
      resultsCount: results ? results.length : 0,
      hasResults,
      responseTimeMs,
      userId: userId || null,
      sessionId: sessionId || null,
      filters,
      pagination,
    };
    
    try {
      fs.appendFileSync(this.options.logFile, JSON.stringify(logEntry) + '\n', 'utf8');
    } catch (error) {
      console.error('[query-logger] Error writing to log file:', error.message);
    }
    
    this._updateStats(logEntry);
  }
  
  _updateStats(entry) {
    this.stats.totalQueries++;
    this.stats.totalResponseTimeMs += entry.responseTimeMs || 0;
    this.stats.avgResponseTimeMs = Math.round(
      this.stats.totalResponseTimeMs / this.stats.totalQueries
    );
    
    if (entry.hasResults) {
      this.stats.queriesWithResults++;
    } else {
      this.stats.zeroResultQueries++;
      
      if (!this.stats.zeroResultQueriesList.includes(entry.query)) {
        this.stats.zeroResultQueriesList.push(entry.query);
        if (this.stats.zeroResultQueriesList.length > 1000) {
          this.stats.zeroResultQueriesList.shift();
        }
      }
    }
    
    this.stats.uniqueQueries = Object.keys(this.stats.topQueries).length;
    
    if (!this.stats.topQueries[entry.query]) {
      this.stats.topQueries[entry.query] = {
        count: 0,
        resultsCount: 0,
        avgResponseTimeMs: 0,
        totalResponseTimeMs: 0,
      };
    }
    
    const queryStats = this.stats.topQueries[entry.query];
    queryStats.count++;
    queryStats.resultsCount = entry.resultsCount;
    queryStats.totalResponseTimeMs += entry.responseTimeMs || 0;
    queryStats.avgResponseTimeMs = Math.round(
      queryStats.totalResponseTimeMs / queryStats.count
    );
    
    const now = new Date(entry.timestamp);
    const hourKey = now.toISOString().slice(0, 13);
    const dayKey = now.toISOString().slice(0, 10);
    
    if (!this.stats.hourlyStats[hourKey]) {
      this.stats.hourlyStats[hourKey] = {
        totalQueries: 0,
        uniqueQueries: [],
        zeroResults: 0,
      };
    }
    
    this.stats.hourlyStats[hourKey].totalQueries++;
    if (!this.stats.hourlyStats[hourKey].uniqueQueries.includes(entry.query)) {
      this.stats.hourlyStats[hourKey].uniqueQueries.push(entry.query);
    }
    if (!entry.hasResults) {
      this.stats.hourlyStats[hourKey].zeroResults++;
    }
    
    if (!this.stats.dailyStats[dayKey]) {
      this.stats.dailyStats[dayKey] = {
        totalQueries: 0,
        uniqueQueries: [],
        zeroResults: 0,
      };
    }
    
    this.stats.dailyStats[dayKey].totalQueries++;
    if (!this.stats.dailyStats[dayKey].uniqueQueries.includes(entry.query)) {
      this.stats.dailyStats[dayKey].uniqueQueries.push(entry.query);
    }
    if (!entry.hasResults) {
      this.stats.dailyStats[dayKey].zeroResults++;
    }
    
    this._saveStats();
  }
  
  getStats(options = {}) {
    const limit = options.limit || 50;
    const timeRange = options.timeRange || 'all';
    
    const now = new Date();
    let filteredTopQueries = { ...this.stats.topQueries };
    
    if (timeRange === '24h') {
      const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      filteredTopQueries = this._filterQueriesByTime(twentyFourHoursAgo);
    } else if (timeRange === '7d') {
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      filteredTopQueries = this._filterQueriesByTime(sevenDaysAgo);
    }
    
    const sortedQueries = Object.entries(filteredTopQueries)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, limit)
      .map(([query, stats]) => ({
        query,
        ...stats,
      }));
    
    const zeroResultQueries = this.stats.zeroResultQueriesList
      .slice(0, options.zeroResultLimit || 50);
    
    return {
      overview: {
        totalQueries: this.stats.totalQueries,
        uniqueQueries: this.stats.uniqueQueries,
        queriesWithResults: this.stats.queriesWithResults,
        zeroResultQueries: this.stats.zeroResultQueries,
        zeroResultRate: this.stats.totalQueries > 0
          ? Math.round((this.stats.zeroResultQueries / this.stats.totalQueries) * 100)
          : 0,
        avgResponseTimeMs: this.stats.avgResponseTimeMs,
      },
      topQueries: sortedQueries,
      zeroResultQueries,
      lastUpdated: this.stats.lastUpdated,
    };
  }
  
  _filterQueriesByTime(since) {
    const filtered = {};
    
    if (!fs.existsSync(this.options.logFile)) {
      return filtered;
    }
    
    const lines = fs.readFileSync(this.options.logFile, 'utf8').split('\n').filter(Boolean);
    
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const entryTime = new Date(entry.timestamp);
        
        if (entryTime >= since) {
          if (!filtered[entry.query]) {
            filtered[entry.query] = {
              count: 0,
              resultsCount: 0,
              avgResponseTimeMs: 0,
              totalResponseTimeMs: 0,
            };
          }
          
          filtered[entry.query].count++;
          filtered[entry.query].resultsCount = entry.resultsCount;
          filtered[entry.query].totalResponseTimeMs += entry.responseTimeMs || 0;
          filtered[entry.query].avgResponseTimeMs = Math.round(
            filtered[entry.query].totalResponseTimeMs / filtered[entry.query].count
          );
        }
      } catch (_) {}
    }
    
    return filtered;
  }
  
  trackClick(query, clickedItem, position) {
    if (!this.options.trackClicks) return;
    
    const clickEntry = {
      timestamp: new Date().toISOString(),
      type: 'click',
      query: normalizeText(query),
      clickedItem,
      position,
    };
    
    try {
      fs.appendFileSync(this.options.logFile, JSON.stringify(clickEntry) + '\n', 'utf8');
    } catch (error) {
      console.error('[query-logger] Error writing click entry:', error.message);
    }
  }
  
  getRecentQueries(limit = 100) {
    if (!fs.existsSync(this.options.logFile)) {
      return [];
    }
    
    const lines = fs.readFileSync(this.options.logFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .slice(-limit);
    
    return lines.map(line => {
      try {
        return JSON.parse(line);
      } catch (_) {
        return null;
      }
    }).filter(Boolean);
  }
  
  clear() {
    this.stats = this._loadStats();
    
    if (fs.existsSync(this.options.logFile)) {
      fs.unlinkSync(this.options.logFile);
    }
    
    this._saveStats();
  }
}

module.exports = {
  QueryLogger,
};