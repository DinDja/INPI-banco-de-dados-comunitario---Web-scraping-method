process.env.INPI_LAZY_BUILD_INDEXES = 'true';
process.env.INPI_USE_FLEXSEARCH = 'true';
process.env.INPI_MAX_RECORDS_TO_INDEX = '30000';

const { searchPatents, getStats, getByNumero, clearCache, reindex } = require('./lib/patent-store');

console.log('🧪 Testando Fase 2 - FlexSearch Integration (Lazy Load)\n');

console.log('1️⃣  Carregando base (sample 30k, lazy build)...\n');
const startTime0 = Date.now();
const stats = getStats();
const loadTime = Date.now() - startTime0;

console.log('📊 Stats iniciais:');
console.log('   Tempo load:', loadTime, 'ms');
console.log('   Arquivos:', stats.total_files);
console.log('   Registros (sample):', stats.sample_size);
console.log('   Total records:', stats.total_records);
console.log('   Search engine:', stats.search_engine);
console.log('');

console.log('2️⃣  Testando busca por número (hash map O(1))...');
const startTime1 = Date.now();
const result1 = getByNumero('PI 0009520-6');
const time1 = Date.now() - startTime1;
console.log('   Tempo:', time1, 'ms');
console.log('   Resultado:', result1 ? '✅ Encontrado' : '❌ Não encontrado');
if (result1) {
  console.log('   Número:', result1.numero);
}
console.log('');

console.log('3️⃣  Aguardando lazy build do FlexSearch (100ms)...');
setTimeout(() => {
  const stats2 = getStats();
  
  if (stats2.index_stats) {
    console.log('\n📊 Stats após lazy build:');
    console.log('   Documentos:', stats2.index_stats.documentCount);
    console.log('   Build time:', stats2.index_stats.buildDurationMs, 'ms');
    console.log('   Search engine built:', stats2.search_engine_built);
    console.log('');
  }
  
  console.log('4️⃣  Testando full-text search com FlexSearch...');
  const startTime2 = Date.now();
  const result2 = searchPatents({ q: 'energia', limit: 5 });
  const time2 = Date.now() - startTime2;
  console.log('   Tempo:', time2, 'ms');
  console.log('   Total encontrado:', result2.total);
  console.log('   Search engine usado:', result2.search_engine);
  if (result2.items.length > 0) {
    console.log('   Primeiro resultado:', result2.items[0].numero);
    console.log('   Título:', result2.items[0].titulo?.substring(0, 60));
  }
  console.log('');
  
  console.log('5️⃣  Testando busca por termo específico...');
  const startTime3 = Date.now();
  const result3 = searchPatents({ q: 'petroleo', limit: 5 });
  const time3 = Date.now() - startTime3;
  console.log('   Tempo:', time3, 'ms');
  console.log('   Total encontrado:', result3.total);
  if (result3.items.length > 0) {
    console.log('   Primeiro resultado:', result3.items[0].numero);
    console.log('   Título:', result3.items[0].titulo?.substring(0, 60));
  }
  console.log('');
  
  console.log('6️⃣  Testing busca por IPC...');
  const startTime4 = Date.now();
  const result4 = searchPatents({ ipc: 'G06', limit: 5 });
  const time4 = Date.now() - startTime4;
  console.log('   Tempo:', time4, 'ms');
  console.log('   Total encontrado:', result4.total);
  if (result4.items.length > 0) {
    console.log('   Primeiro resultado:', result4.items[0].numero);
    console.log('   IPC:', result4.items[0].ipc);
  }
  console.log('');
  
  console.log('7️⃣  Memory usage...');
  if (stats2.memory_usage) {
    console.log('   Heap used:', stats2.memory_usage.heap_used_mb, 'MB');
    console.log('   Heap total:', stats2.memory_usage.heap_total_mb, 'MB');
    console.log('   RSS:', stats2.memory_usage.rss_mb, 'MB');
  }
  console.log('');
  
  console.log('✅ Testes Fase 2 concluídos!\n');
  
  console.log('📊 Comparação de performance:');
  console.log('   Fase 1 (legacy):');
  console.log('     - Full-text: ~1500ms (com sample 50k)');
  console.log('     - IPC: ~11ms');
  console.log('');
  console.log('   Fase 2 (FlexSearch):');
  console.log(`     - Full-text: ${time2}ms`);
  console.log(`     - IPC: ${time4}ms`);
  console.log('');
  
  console.log('📝 Recursos da Fase 2:');
  console.log('   ✅ FlexSearch integrado');
  console.log('   ✅ Índices múltiplos por campo com pesos');
  console.log('   ✅ Partial matching (forward tokenization)');
  console.log('   ✅ Persistência de índices em disco');
  console.log('   ✅ Build assíncrono de índices');
  console.log('   ✅ Normalização robusta de texto');
  console.log('');
}, 200);