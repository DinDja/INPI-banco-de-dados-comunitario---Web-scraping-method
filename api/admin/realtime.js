const { getStats } = require('../lib/patent-store');
const { QueryLogger } = require('../lib/query-logger');
const { QueryCache } = require('../lib/query-cache');
const { IndexManager } = require('../lib/index-manager');

const ADMIN_TOKEN = process.env.INPI_ADMIN_TOKEN || 'admin-secret-token';

function verifyAdmin(req) {
  const token = req.headers['x-admin-token'] || req.query.token;
  return token === ADMIN_TOKEN;
}

module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

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
  const indexManager = new IndexManager({ lazyLoad: true });

  const dbStats = getStats();
  const queryStats = queryLogger.getStats({
    limit: Number(req.query.limit) || 50,
    timeRange: req.query.timeRange || 'all',
    zeroResultLimit: Number(req.query.zeroResultLimit) || 50,
  });
  const cacheStats = queryCache.getStats();
  const indexStats = indexManager.getStats();

  const recentQueries = queryLogger.getRecentQueries(100);
  const popularQueries = queryStats.topQueries.slice(0, 20);

  const hourlyTrend = calculateHourlyTrend(queryStats.hourlyStats);
  const dailyTrend = calculateDailyTrend(queryStats.dailyStats);

  const response = {
    ok: true,
    timestamp: new Date().toISOString(),
    
    overview: {
      total_queries: queryStats.overview.totalQueries,
      unique_queries: queryStats.overview.uniqueQueries,
      zero_result_rate: queryStats.overview.zeroResultRate,
      avg_response_time_ms: queryStats.overview.avgResponseTimeMs,
      cache_hit_rate: cacheStats.hitRate,
    },
    
    database: {
      total_records: dbStats.total_records,
      total_files: dbStats.total_files,
      loaded: dbStats.loaded,
      search_engine: dbStats.search_engine,
      index_stats: dbStats.index_stats,
      load_duration_ms: dbStats.load_duration_ms,
    },
    
    cache: {
      size: cacheStats.size,
      maxSize: cacheStats.maxSize,
      hits: cacheStats.hits,
      misses: cacheStats.misses,
      hitRate: cacheStats.hitRate,
      evictions: cacheStats.evictions,
    },
    
    indexes: indexStats,
    
    analytics: {
      topQueries: popularQueries,
      zeroResultQueries: queryStats.zeroResultQueries.slice(0, 20),
      hourlyTrend,
      dailyTrend,
      recentQueries: recentQueries.slice(0, 20),
    },
    
    insights: generateInsights(queryStats, cacheStats, dbStats),
  };

  res.status(200).json(response);
};

function calculateHourlyTrend(hourlyStats) {
  const now = new Date();
  const last24Hours = [];
  
  for (let i = 23; i >= 0; i--) {
    const hour = new Date(now.getTime() - i * 60 * 60 * 1000);
    const hourKey = hour.toISOString().slice(0, 13);
    const stats = hourlyStats[hourKey] || { totalQueries: 0, zeroResults: 0 };
    
    last24Hours.push({
      hour: hour.toISOString().slice(11, 13) + ':00',
      queries: stats.totalQueries,
      zeroResults: stats.zeroResults,
      uniqueQueries: stats.uniqueQueries?.length || 0,
    });
  }
  
  return last24Hours;
}

function calculateDailyTrend(dailyStats) {
  const now = new Date();
  const last7Days = [];
  
  for (let i = 6; i >= 0; i--) {
    const day = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const dayKey = day.toISOString().slice(0, 10);
    const stats = dailyStats[dayKey] || { totalQueries: 0, zeroResults: 0 };
    
    last7Days.push({
      date: dayKey,
      queries: stats.totalQueries,
      zeroResults: stats.zeroResults,
      uniqueQueries: stats.uniqueQueries?.length || 0,
    });
  }
  
  return last7Days;
}

function generateInsights(queryStats, cacheStats, dbStats) {
  const insights = [];

  if (queryStats.overview.zeroResultRate > 10) {
    insights.push({
      type: 'warning',
      priority: 'high',
      title: 'Alta taxa de queries sem resultados',
      message: `${queryStats.overview.zeroResultRate}% das queries não retornam resultados`,
      suggestion: 'Revise os termos em "zeroResultQueries" para identificar gaps na base de dados',
      metric: {
        label: 'Zero Result Rate',
        value: queryStats.overview.zeroResultRate,
        unit: '%',
      },
    });
  }

  if (cacheStats.hitRate < 20 && queryStats.overview.totalQueries > 100) {
    insights.push({
      type: 'info',
      priority: 'medium',
      title: 'Cache hit rate baixo',
      message: `Apenas ${cacheStats.hitRate}% das queries são servidas pelo cache`,
      suggestion: 'Considere aumentar cache size ou TTL para queries frequentes',
      metric: {
        label: 'Cache Hit Rate',
        value: cacheStats.hitRate,
        unit: '%',
      },
    });
  }

  if (dbStats.load_duration_ms > 5000) {
    insights.push({
      type: 'warning',
      priority: 'medium',
      title: 'Carregamento inicial lento',
      message: `Tempo de load: ${dbStats.load_duration_ms}ms`,
      suggestion: 'Considere usar lazy loading ou reduzir INPI_MAX_RECORDS_TO_INDEX',
      metric: {
        label: 'Load Time',
        value: dbStats.load_duration_ms,
        unit: 'ms',
      },
    });
  }

  if (queryStats.topQueries.length > 0) {
    const topQuery = queryStats.topQueries[0];
    if (topQuery.count > 100) {
      insights.push({
        type: 'info',
        priority: 'low',
        title: 'Query muito frequente',
        message: `"${topQuery.query}" foi buscada ${topQuery.count} vezes`,
        suggestion: 'Considere pré-indexar ou criar endpoint específico para esta query',
        metric: {
          label: 'Top Query Count',
          value: topQuery.count,
          unit: 'searches',
        },
      });
    }
  }

  if (queryStats.overview.totalQueries === 0) {
    insights.push({
      type: 'info',
      priority: 'low',
      title: 'Sem queries registradas',
      message: 'Nenhuma query foi logada ainda',
      suggestion: 'Verifique se INPI_ENABLE_QUERY_LOG=true está configurado',
    });
  }

  return insights.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
}