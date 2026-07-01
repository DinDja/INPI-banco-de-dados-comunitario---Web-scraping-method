process.env.INPI_LAZY_BUILD_INDEXES = 'true';
process.env.INPI_MAX_RECORDS_TO_INDEX = '50000';

const { searchPatents, getStats, getByNumero } = require('./lib/patent-store');
const {
  normalizeText,
  normalizeNumeroPatente,
  normalizeNomeEmpresarial,
  normalizeIPC,
  tokenize,
} = require('./lib/normalizer');

console.log('🧪 Testando melhorias da Fase 1\n');

console.log('1️⃣  Testando normalização...');
console.log('   "Petróleo" →', normalizeText('Petróleo'));
console.log('   "PETROBRAS S.A." →', normalizeNomeEmpresarial('PETROBRAS S.A.'));
console.log('   "PI 0009520-6" →', normalizeNumeroPatente('PI 0009520-6'));
console.log('   "G06F 17/00" →', normalizeIPC('G06F 17/00'));
console.log('   Tokenize "Sistema de energia solar" →', tokenize('Sistema de energia solar', { removeStopwords: true }));
console.log('');

console.log('2️⃣  Carregando stats (lazy load, sample de 50k)...');
const startTime0 = Date.now();
const stats = getStats();
const loadTime = Date.now() - startTime0;
console.log('   Tempo load:', loadTime, 'ms');
console.log('   Arquivos:', stats.total_files);
console.log('   Registros (sample):', stats.sample_size);
console.log('   Total records:', stats.total_records);
console.log('   Loaded:', stats.loaded);
console.log('   Load duration:', stats.load_duration_ms, 'ms');
console.log('');

if (stats.index_stats) {
  console.log('3️⃣  Stats dos índices...');
  console.log('   Documentos:', stats.index_stats.documentCount);
  console.log('   Termos no inverted index:', stats.index_stats.invertedIndexSize);
  console.log('   Build time:', stats.index_stats.buildDurationMs, 'ms');
  console.log('   Índices construídos:', stats.index_stats.isBuilt);
  console.log('');
}

console.log('4️⃣  Testando busca por número (O(1) hash map)...');
const startTime1 = Date.now();
const result1 = getByNumero('PI 0009520-6');
const time1 = Date.now() - startTime1;
console.log('   Tempo:', time1, 'ms');
console.log('   Resultado:', result1 ? '✅ Encontrado' : '❌ Não encontrado');
if (result1) {
  console.log('   Número:', result1.numero);
}
console.log('');

console.log('5️⃣  Testando busca full-text...');
const startTime2 = Date.now();
const result2 = searchPatents({ q: 'energia', limit: 5 });
const time2 = Date.now() - startTime2;
console.log('   Tempo:', time2, 'ms');
console.log('   Total encontrado:', result2.total);
if (result2.items.length > 0) {
  console.log('   Primeiro resultado:', result2.items[0].numero);
}
console.log('');

console.log('6️⃣  Testando busca por IPC...');
const startTime3 = Date.now();
const result3 = searchPatents({ ipc: 'G06', limit: 5 });
const time3 = Date.now() - startTime3;
console.log('   Tempo:', time3, 'ms');
console.log('   Total encontrado:', result3.total);
if (result3.items.length > 0) {
  console.log('   Primeiro resultado:', result3.items[0].numero);
  console.log('   IPC:', result3.items[0].ipc);
}
console.log('');

console.log('7️⃣  Memory usage...');
if (stats.memory_usage) {
  console.log('   Heap used:', stats.memory_usage.heapUsed, 'MB');
  console.log('   Heap total:', stats.memory_usage.heapTotal, 'MB');
}
console.log('');

console.log('✅ Testes concluídos!\n');

console.log('📊 Resumo das melhorias da Fase 1:');
console.log('   ✅ Normalização robusta (acentos, case, variações)');
console.log('   ✅ Schema bem definido com pesos por campo');
console.log('   ✅ Hash map O(1) para busca por número');
console.log('   ✅ Inverted index para full-text search');
console.log('   ✅ Facet indexes para agregações');
console.log('   ✅ Lazy loading + sample para inicialização rápida');
console.log('   ✅ Health check com stats detalhados');
console.log(`   ✅ Performance: load ${loadTime}ms, getByNumero ${time1}ms, full-text ${time2}ms`);
console.log('');

if (stats.lazy_build_complete) {
  console.log('🔄 Lazy build completo! Índices prontos para buscas avançadas.');
} else if (stats.is_sample) {
  console.log(`🔄 Sample mode: ${stats.sample_size} registros indexados (total: ${stats.total_records})`);
}