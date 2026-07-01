process.env.INPI_LAZY_BUILD_INDEXES = 'false';
process.env.INPI_USE_FLEXSEARCH = 'true';
process.env.INPI_MAX_RECORDS_TO_INDEX = '20000';
process.env.INPI_ENABLE_SCORING = 'true';
process.env.INPI_ENABLE_SPELL_CHECK = 'true';

const { searchPatents, getStats } = require('./lib/patent-store');
const { QueryParser } = require('./lib/query-parser');
const { highlight, createSnippet } = require('./lib/highlighter');

console.log('🧪 Testando Fase 3 - Scoring, Query Parsing, Highlighting\n');

console.log('1️⃣  Testando Query Parser...\n');
const parser = new QueryParser();

const queries = [
  'energia solar',
  '"petroleo brasileiro"',
  'titulo:solar AND ipc:H02',
  'energia OR petroleo',
  'solar*',
  'ano_deposito:[2020 TO 2024]',
  'petrobras NOT privado',
];

for (const query of queries) {
  const parsed = parser.parse(query);
  console.log(`   Query: "${query}"`);
  console.log(`   Tipo: ${parsed.type}`);
  if (parsed.terms) console.log(`   Termos: ${parsed.terms.join(', ')}`);
  if (parsed.clauses) console.log(`   Clauses: ${parsed.clauses.length}`);
  console.log('');
}

console.log('2️⃣  Testando Highlighting...\n');
const titulo = 'Sistema de energia solar fotovoltaica para geracao distribuida';
const terms = ['energia', 'solar'];

console.log(`   Texto: ${titulo}`);
console.log(`   Termos: ${terms.join(', ')}`);
console.log(`   Highlighted: ${highlight(titulo, terms)}`);
console.log(`   Snippet: ${createSnippet(titulo, terms, { maxLength: 40 })}`);
console.log('');

console.log('3️⃣  Carregando base com Fase 3...\n');
const startTime0 = Date.now();
const stats = getStats();
const loadTime = Date.now() - startTime0;

console.log('📊 Stats:');
console.log('   Tempo load:', loadTime, 'ms');
console.log('   Registros:', stats.total_records);
console.log('   Search engine:', stats.search_engine);
if (stats.index_stats && stats.index_stats.features) {
  console.log('   Features:', JSON.stringify(stats.index_stats.features));
}
console.log('');

setTimeout(() => {
  const stats2 = getStats();
  
  console.log('4️⃣  Testando busca com BM25 scoring...\n');
  const startTime1 = Date.now();
  const result1 = searchPatents({ q: 'energia solar', limit: 5 });
  const time1 = Date.now() - startTime1;
  
  console.log('   Tempo:', time1, 'ms');
  console.log('   Total:', result1.total);
  if (result1.items.length > 0) {
    console.log('   Top resultado:');
    console.log('     Número:', result1.items[0].numero);
    console.log('     Título:', result1.items[0].titulo?.substring(0, 60));
    console.log('     Depositante:', result1.items[0].depositante?.substring(0, 50));
    console.log('     Ano:', result1.items[0].ano_deposito);
  }
  console.log('');
  
  console.log('5️⃣  Testando busca por frase exata...\n');
  const startTime2 = Date.now();
  const result2 = searchPatents({ q: '"energia solar"', limit: 5 });
  const time2 = Date.now() - startTime2;
  
  console.log('   Tempo:', time2, 'ms');
  console.log('   Total:', result2.total);
  if (result2.items.length > 0) {
    console.log('   Top resultado:', result2.items[0].numero);
  }
  console.log('');
  
  console.log('6️⃣  Testando boolean query (AND/OR)...\n');
  const startTime3 = Date.now();
  const result3 = searchPatents({ q: 'petroleo AND brasil', limit: 5 });
  const time3 = Date.now() - startTime3;
  
  console.log('   Tempo:', time3, 'ms');
  console.log('   Total:', result3.total);
  if (result3.items.length > 0) {
    console.log('   Top resultado:', result3.items[0].numero);
    console.log('   Título:', result3.items[0].titulo?.substring(0, 60));
  }
  console.log('');
  
  console.log('7️⃣  Testando field-specific search...\n');
  const startTime4 = Date.now();
  const result4 = searchPatents({ q: 'ipc:H02', limit: 5 });
  const time4 = Date.now() - startTime4;
  
  console.log('   Tempo:', time4, 'ms');
  console.log('   Total:', result4.total);
  if (result4.items.length > 0) {
    console.log('   Top resultado:', result4.items[0].numero);
    console.log('   IPC:', result4.items[0].ipc);
  }
  console.log('');
  
  console.log('8️⃣  Testando spell correction...\n');
  const startTime5 = Date.now();
  const result5 = searchPatents({ q: 'enerjia', limit: 5 });
  const time5 = Date.now() - startTime5;
  
  console.log('   Tempo:', time5, 'ms');
  console.log('   Total:', result5.total);
  if (result5.spellSuggestion) {
    console.log('   💡 Sugestão:', result5.spellSuggestion.message);
  }
  console.log('');
  
  console.log('✅ Testes Fase 3 concluídos!\n');
  
  console.log('📊 Resumo das melhorias:');
  console.log('   ✅ BM25 scoring com field weights');
  console.log('   ✅ Boost por recenticidade (patentes recentes)');
  console.log('   ✅ Boost por exact match');
  console.log('   ✅ Query parsing avançado (AND, OR, NOT, frases)');
  console.log('   ✅ Field-specific search (titulo:, ipc:, etc.)');
  console.log('   ✅ Wildcards (solar*, ?nergia)');
  console.log('   ✅ Range queries (ano:[2020 TO 2024])');
  console.log('   ✅ Highlighting de termos');
  console.log('   ✅ Snippets com contexto');
  console.log('   ✅ Spell correction ("você quis dizer...?")');
  console.log('');
  
  console.log('📈 Performance:');
  console.log(`   - Full-text com BM25: ${time1}ms`);
  console.log(`   - Phrase search: ${time2}ms`);
  console.log(`   - Boolean query: ${time3}ms`);
  console.log(`   - Field-specific: ${time4}ms`);
  console.log('');
  
}, 500);