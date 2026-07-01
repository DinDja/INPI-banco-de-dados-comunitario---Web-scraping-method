process.env.INPI_LAZY_BUILD_INDEXES = 'true';
process.env.INPI_USE_FLEXSEARCH = 'true';
process.env.INPI_MAX_RECORDS_TO_INDEX = '10000';
process.env.INPI_ENABLE_CACHE = 'true';
process.env.INPI_ENABLE_QUERY_LOG = 'true';

const { searchPatents, getStats, clearCache } = require('./lib/patent-store');
const { QueryCache } = require('./lib/query-cache');
const { QueryLogger } = require('./lib/query-logger');

console.log('🧪 Testando Fase 4 - Analytics, Cache, Query Logging\n');

console.log('1️⃣  Testando Query Cache...\n');
const cache = new QueryCache({ maxSize: 100, ttlMs: 60000 });

const testQuery = { q: 'energia solar', limit: 10 };
const cacheKey = JSON.stringify(testQuery);

console.log('   Primeira busca (cache miss)...');
const result1 = searchPatents(testQuery);
console.log('   Tempo:', result1.response_time_ms, 'ms');
console.log('   Cached:', result1.cached);

console.log('\n   Segunda busca (cache hit)...');
const result2 = searchPatents(testQuery);
console.log('   Tempo:', result2.response_time_ms, 'ms');
console.log('   Cached:', result2.cached);

const cacheStats = cache.getStats();
console.log('\n📊 Cache stats:');
console.log('   Hits:', cacheStats.hits);
console.log('   Misses:', cacheStats.misses);
console.log('   Hit rate:', cacheStats.hitRate, '%');
console.log('');

console.log('2️⃣  Testando Query Logger...\n');
const logger = new QueryLogger({ enabled: true });

const queries = [
  { query: 'energia solar', results: 100 },
  { query: 'petroleo', results: 50 },
  { query: 'teste sem resultado xyz123', results: 0 },
  { query: 'energia', results: 200 },
  { query: 'solar', results: 150 },
];

for (const q of queries) {
  logger.log({
    query: q.query,
    results: new Array(q.results),
    responseTimeMs: Math.random() * 100,
  });
}

const stats = logger.getStats();
console.log('📊 Query stats:');
console.log('   Total queries:', stats.overview.totalQueries);
console.log('   Unique queries:', stats.overview.uniqueQueries);
console.log('   Zero result queries:', stats.overview.zeroResultQueries);
console.log('   Zero result rate:', stats.overview.zeroResultRate, '%');
console.log('   Avg response time:', stats.overview.avgResponseTimeMs, 'ms');
console.log('');

console.log('   Top 5 queries:');
stats.topQueries.slice(0, 5).forEach((q, i) => {
  console.log(`   ${i + 1}. "${q.query}" - ${q.count} buscas`);
});
console.log('');

if (stats.zeroResultQueries.length > 0) {
  console.log('   Queries sem resultados:');
  stats.zeroResultQueries.slice(0, 5).forEach((q, i) => {
    console.log(`   ${i + 1}. "${q}"`);
  });
  console.log('');
}

console.log('3️⃣  Testando Admin Stats endpoint...\n');
console.log('   Para testar o endpoint completo, use:');
console.log('   curl -H "x-admin-token: admin-secret-token" http://localhost:3000/api/admin/stats');
console.log('');

console.log('4️⃣  Simulando múltiplas queries para analytics...\n');
const testQueries = [
  'energia',
  'energia',
  'energia solar',
  'petroleo',
  'petroleo',
  'gas',
  'solar',
  'eolica',
  'renovavel',
  'teste xyz sem resultado',
];

console.log('   Executando', testQueries.length, 'queries...');
for (const q of testQueries) {
  searchPatents({ q, limit: 5 });
}

const finalStats = logger.getStats({ limit: 10 });
console.log('\n📊 Stats após testes:');
console.log('   Total queries:', finalStats.overview.totalQueries);
console.log('   Queries com resultados:', finalStats.overview.queriesWithResults);
console.log('   Queries sem resultados:', finalStats.overview.zeroResultQueries);
console.log('   Top query:', finalStats.topQueries[0]?.query || 'N/A');
console.log('');

console.log('✅ Testes Fase 4 concluídos!\n');

console.log('📝 Recursos da Fase 4:');
console.log('   ✅ Query logging em JSONL');
console.log('   ✅ Analytics de uso (top queries, zero results)');
console.log('   ✅ LRU Cache com TTL');
console.log('   ✅ Cache stats (hit rate, evictions)');
console.log('   ✅ Admin stats endpoint');
console.log('   ✅ Insights automáticos');
console.log('   ✅ Click tracking (opcional)');
console.log('');

console.log('🔧 Configurações:');
console.log('   INPI_ENABLE_CACHE=true');
console.log('   INPI_ENABLE_QUERY_LOG=true');
console.log('   INPI_CACHE_MAX_SIZE=1000');
console.log('   INPI_CACHE_TTL_MS=900000 (15min)');
console.log('   INPI_ADMIN_TOKEN=seu-token-secreto');
console.log('   INPI_TRACK_CLICKS=true');
console.log('');

console.log('📊 Endpoints:');
console.log('   GET /api/admin/stats (requires x-admin-token)');
console.log('   GET /api/search (com logging automático)');
console.log('');