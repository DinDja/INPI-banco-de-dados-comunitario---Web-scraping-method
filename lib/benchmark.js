/**
 * benchmark.js - Benchmark e testes de performance
 */

const { searchPatents, getStats, clearCache } = require('./lib/patent-store');
const { QueryCache } = require('./lib/query-cache');

const BENCHMARK_QUERIES = [
  'energia',
  'energia solar',
  'petroleo',
  'sistema de monitoramento',
  'G06F',
  'H02M',
  'petrobras',
  'universidade',
  'instituto',
  'patente',
];

async function runBenchmark(iterations = 3) {
  console.log('🧪 Benchmark de Performance - Fase 5\n');
  
  const results = {
    cold: [],
    warm: [],
    cached: [],
  };
  
  console.log('1️⃣  Cold Start (sem cache)...\n');
  
  for (let i = 0; i < iterations; i++) {
    clearCache();
    
    const iterationResults = [];
    
    for (const query of BENCHMARK_QUERIES) {
      const startTime = Date.now();
      const result = searchPatents({ q: query, limit: 10 });
      const duration = Date.now() - startTime;
      
      iterationResults.push({
        query,
        duration,
        results: result.total,
      });
    }
    
    results.cold.push(iterationResults);
    
    const avgDuration = iterationResults.reduce((sum, r) => sum + r.duration, 0) / iterationResults.length;
    console.log(`   Iteração ${i + 1}: ${avgDuration.toFixed(2)}ms média`);
  }
  
  console.log('\n2️⃣  Warm Cache (após primeira busca)...\n');
  
  for (let i = 0; i < iterations; i++) {
    const iterationResults = [];
    
    for (const query of BENCHMARK_QUERIES) {
      const startTime = Date.now();
      const result = searchPatents({ q: query, limit: 10 });
      const duration = Date.now() - startTime;
      
      iterationResults.push({
        query,
        duration,
        results: result.total,
      });
    }
    
    results.warm.push(iterationResults);
    
    const avgDuration = iterationResults.reduce((sum, r) => sum + r.duration, 0) / iterationResults.length;
    console.log(`   Iteração ${i + 1}: ${avgDuration.toFixed(2)}ms média`);
  }
  
  console.log('\n3️⃣  With Cache (LRU enabled)...\n');
  
  const cache = new QueryCache({ maxSize: 100, ttlMs: 60000 });
  
  for (let i = 0; i < iterations; i++) {
    const iterationResults = [];
    
    for (const query of BENCHMARK_QUERIES) {
      const cacheKey = JSON.stringify({ q: query, limit: 10 });
      
      let result, duration;
      const startTime = Date.now();
      
      const cached = cache.get(cacheKey);
      if (cached) {
        duration = 0;
        result = cached;
      } else {
        result = searchPatents({ q: query, limit: 10 });
        duration = Date.now() - startTime;
        cache.set(cacheKey, result);
      }
      
      iterationResults.push({
        query,
        duration,
        results: result.total,
        cached: duration === 0,
      });
    }
    
    results.cached.push(iterationResults);
    
    const hits = iterationResults.filter(r => r.cached).length;
    const avgDuration = iterationResults
      .filter(r => !r.cached)
      .reduce((sum, r) => sum + r.duration, 0) / Math.max(1, iterationResults.filter(r => !r.cached).length);
    
    console.log(`   Iteração ${i + 1}: ${hits}/${BENCHMARK_QUERIES.length} cache hits, ${avgDuration.toFixed(2)}ms média (miss)`);
  }
  
  console.log('\n📊 Resultados Consolidados:\n');
  
  const coldAvg = results.cold[0].reduce((sum, r) => sum + r.duration, 0) / results.cold[0].length;
  const warmAvg = results.warm[0].reduce((sum, r) => sum + r.duration, 0) / results.warm[0].length;
  const cachedAvg = results.cached[0]
    .filter(r => !r.cached)
    .reduce((sum, r) => sum + r.duration, 0) / Math.max(1, results.cached[0].filter(r => !r.cached).length);
  
  console.log('   Cold Start:');
  console.log(`     - Média: ${coldAvg.toFixed(2)}ms`);
  console.log(`     - Total queries: ${BENCHMARK_QUERIES.length}`);
  console.log('');
  
  console.log('   Warm Cache:');
  console.log(`     - Média: ${warmAvg.toFixed(2)}ms`);
  console.log(`     - Melhoria: ${((coldAvg - warmAvg) / coldAvg * 100).toFixed(1)}% mais rápido`);
  console.log('');
  
  console.log('   With LRU Cache:');
  console.log(`     - Média (miss): ${cachedAvg.toFixed(2)}ms`);
  console.log(`     - Hit rate: ~${(1 - cachedAvg / coldAvg) * 100 | 0}% (estimado)`);
  console.log('');
  
  console.log('📈 Top 5 Queries por Tempo:\n');
  
  const allResults = results.warm[0].sort((a, b) => b.duration - a.duration).slice(0, 5);
  allResults.forEach((r, i) => {
    console.log(`   ${i + 1}. "${r.query}" - ${r.duration}ms (${r.results} resultados)`);
  });
  console.log('');
  
  const stats = getStats();
  console.log('📊 Stats da Base:\n');
  console.log(`   - Total records: ${stats.total_records}`);
  console.log(`   - Search engine: ${stats.search_engine}`);
  console.log(`   - Indexes built: ${stats.indexes_built || stats.search_engine_built}`);
  if (stats.memory_usage) {
    console.log(`   - Heap used: ${stats.memory_usage.heap_used_mb}MB`);
    console.log(`   - Heap total: ${stats.memory_usage.heap_total_mb}MB`);
  }
  console.log('');
  
  console.log('✅ Benchmark concluído!\n');
  
  return {
    coldAvg,
    warmAvg,
    cachedAvg,
    queries: BENCHMARK_QUERIES,
    results,
  };
}

if (require.main === module) {
  process.env.INPI_LAZY_BUILD_INDEXES = 'false';
  process.env.INPI_USE_FLEXSEARCH = 'true';
  process.env.INPI_MAX_RECORDS_TO_INDEX = '30000';
  process.env.INPI_ENABLE_CACHE = 'true';
  
  runBenchmark(2).catch(console.error);
}

module.exports = {
  runBenchmark,
  BENCHMARK_QUERIES,
};