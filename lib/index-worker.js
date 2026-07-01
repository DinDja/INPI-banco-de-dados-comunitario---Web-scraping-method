/**
 * index-worker.js - Worker thread para construção de índices
 */

const { workerData, parentPort } = require('worker_threads');
const { SearchEngine } = require('./search-engine');

if (workerData) {
  const { name, documents, options } = workerData;
  
  console.log(`[worker] Building index "${name}" with ${documents.length} documents`);
  
  const startTime = Date.now();
  
  const engine = new SearchEngine({
    enableScoring: options?.enableScoring !== false,
    enableSpellCheck: options?.enableSpellCheck !== false,
  });
  
  try {
    engine.build(documents);
    
    const buildTime = Date.now() - startTime;
    
    console.log(`[worker] Index "${name}" built in ${buildTime}ms`);
    
    parentPort.postMessage({
      name,
      documents: Array.from(engine.documents.entries()).slice(0, 100),
      stats: engine.getStats(),
      buildTime,
    });
  } catch (error) {
    console.error(`[worker] Error building index "${name}":`, error.message);
    parentPort.postMessage({ error: error.message });
  }
}