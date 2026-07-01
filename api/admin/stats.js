const { getStats } = require('../lib/patent-store');
const { QueryLogger } = require('../lib/query-logger');
const { QueryCache } = require('../lib/query-cache');

const ADMIN_TOKEN = process.env.INPI_ADMIN_TOKEN || 'admin-secret-token';

function verifyAdmin(req) {
  const token = req.headers['x-admin-token'] || req.query.token;
  return token === ADMIN_TOKEN;
}

module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  if (!verifyAdmin(req)) {
    res.status(401).json({ error: 'unauthorized', message: 'Invalid or missing admin token' });
    return;
  }

  const queryLogger = new QueryLogger({ enabled: true });
  const queryCache = new QueryCache({ enabled: true });

  const stats = getStats();
  const queryStats = queryLogger.getStats({
    limit: Number(req.query.limit) || 50,
    timeRange: req.query.timeRange || 'all',
    zeroResultLimit: Number(req.query.zeroResultLimit) || 50,
  });
  const cacheStats = queryCache.getStats();

  const response = {
    ok: true,
    timestamp: new Date().toISOString(),
    
    database: {
      total_records: stats.total_records,
      total_files: stats.total_files,
      loaded: stats.loaded,
      search_engine: stats.search_engine,
      index_stats: stats.index_stats,
    },
    
    queries: queryStats,
    
    cache: cacheStats,
    
    performance: {
      load_duration_ms: stats.load_duration_ms,
      avg_query_response_ms: queryStats.overview.avgResponseTimeMs,
      cache_hit_rate: cacheStats.hitRate,
    },
    
    insights: {
      zero_result_rate: queryStats.overview.zeroResultRate,
      suggestions: generateInsights(queryStats, cacheStats),
    },
  };

  res.status(200).json(response);
};

function generateInsights(queryStats, cacheStats) {
  const insights = [];

  if (queryStats.overview.zeroResultRate > 10) {
    insights.push({
      type: 'warning',
      message: `Alta taxa de queries sem resultados (${queryStats.overview.zeroResultRate}%)`,
      suggestion: 'Revise os termos em "zeroResultQueries" para identificar gaps na base',
      priority: 'high',
    });
  }

  if (cacheStats.hitRate < 20 && queryStats.overview.totalQueries > 100) {
    insights.push({
      type: 'info',
      message: 'Cache hit rate baixo',
      suggestion: 'Considere aumentar cache size ou TTL para queries frequentes',
      priority: 'medium',
    });
  }

  if (queryStats.topQueries.length > 0) {
    const topQuery = queryStats.topQueries[0];
    if (topQuery.count > 100) {
      insights.push({
        type: 'info',
        message: `Query "${topQuery.query}" é muito frequente`,
        suggestion: 'Considere pré-indexar ou criar endpoint específico',
        priority: 'low',
      });
    }
  }

  return insights;
}