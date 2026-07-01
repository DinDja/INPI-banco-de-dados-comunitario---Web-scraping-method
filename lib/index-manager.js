/**
 * index-manager.js - Gerenciador de índices com lazy loading e otimizações
 * 
 * Implementa:
 * - Lazy loading sob demanda
 * - Cache warming automático
 * - Worker threads para indexação
 * - Compressão de índices
 * - Memory management
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { SearchEngine, INDEX_DIR } = require('./search-engine');

const INDEX_DIR_PATH = path.join(__dirname, '..', 'data', 'indexes');
const COMPRESSION_ENABLED = process.env.INPI_COMPRESS_INDEXES === 'true';

class IndexManager {
  constructor(options = {}) {
    this.options = {
      lazyLoad: options.lazyLoad !== false,
      autoWarm: options.autoWarm === true,
      useWorkers: options.useWorkers !== false,
      maxMemoryMB: options.maxMemoryMB || 512,
      compression: COMPRESSION_ENABLED,
      ...options,
    };
    
    this.indexes = new Map();
    this.loadingIndexes = new Map();
    this.warmedQueries = new Set();
    this.workers = [];
    this.maxWorkers = 2;
    
    this._ensureIndexDir();
  }
  
  _ensureIndexDir() {
    if (!fs.existsSync(INDEX_DIR_PATH)) {
      fs.mkdirSync(INDEX_DIR_PATH, { recursive: true });
    }
  }
  
  _getIndexFilePath(name, compressed = false) {
    const ext = compressed ? '.idx.gz' : '.idx.json';
    return path.join(INDEX_DIR_PATH, `${name}${ext}`);
  }
  
  async getIndex(name, documents = null) {
    if (this.indexes.has(name)) {
      return this.indexes.get(name);
    }
    
    if (this.loadingIndexes.has(name)) {
      return this.loadingIndexes.get(name);
    }
    
    const loadPromise = this._loadIndex(name, documents);
    this.loadingIndexes.set(name, loadPromise);
    
    try {
      const index = await loadPromise;
      this.indexes.set(name, index);
      return index;
    } finally {
      this.loadingIndexes.delete(name);
    }
  }
  
  async _loadIndex(name, documents) {
    const compressedPath = this._getIndexFilePath(name, true);
    const uncompressedPath = this._getIndexFilePath(name, false);
    
    let indexPath = null;
    if (this.options.compression && fs.existsSync(compressedPath)) {
      indexPath = compressedPath;
    } else if (fs.existsSync(uncompressedPath)) {
      indexPath = uncompressedPath;
    }
    
    if (indexPath && documents) {
      const mtime = fs.statSync(indexPath).mtimeMs;
      const docMtime = documents._mtimeMs || 0;
      
      if (docMtime > mtime) {
        console.log(`[index-manager] Rebuilding index "${name}" (data changed)`);
        return this._buildIndex(name, documents);
      }
    }
    
    if (indexPath) {
      console.log(`[index-manager] Loading index "${name}" from disk`);
      return this._loadFromDisk(indexPath);
    }
    
    if (documents) {
      console.log(`[index-manager] Building index "${name}" (${documents.length} docs)`);
      return this._buildIndex(name, documents);
    }
    
    return null;
  }
  
  async _buildIndex(name, documents) {
    const engine = new SearchEngine({
      enableScoring: true,
      enableSpellCheck: true,
    });
    
    if (this.options.useWorkers && documents.length > 10000) {
      return this._buildIndexWithWorker(name, documents);
    }
    
    engine.build(documents);
    
    await this._saveIndex(name, engine);
    
    return engine;
  }
  
  async _buildIndexWithWorker(name, documents) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, 'index-worker.js'), {
        workerData: {
          name,
          documents: documents.slice(0, 50000),
          options: this.options,
        },
      });
      
      this.workers.push(worker);
      
      worker.on('message', async (result) => {
        const engine = new SearchEngine({
          enableScoring: true,
          enableSpellCheck: true,
        });
        
        engine.build(result.documents);
        await this._saveIndex(name, engine);
        
        this._removeWorker(worker);
        resolve(engine);
      });
      
      worker.on('error', (err) => {
        this._removeWorker(worker);
        reject(err);
      });
      
      worker.on('exit', (code) => {
        if (code !== 0) {
          this._removeWorker(worker);
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
      });
    });
  }
  
  _removeWorker(worker) {
    const index = this.workers.indexOf(worker);
    if (index > -1) {
      this.workers.splice(index, 1);
    }
  }
  
  async _saveIndex(name, engine) {
    const data = {
      documents: Array.from(engine.documents.entries()),
      indexes: {},
    };
    
    for (const [fieldName, fieldData] of Object.entries(engine.indexes)) {
      try {
        const exported = await fieldData.index.export();
        if (exported) {
          data.indexes[fieldName] = exported;
        }
      } catch (error) {
        console.error(`[index-manager] Error exporting ${fieldName}:`, error.message);
      }
    }
    
    const uncompressedPath = this._getIndexFilePath(name, false);
    const compressedPath = this._getIndexFilePath(name, true);
    
    const jsonData = JSON.stringify(data);
    
    if (this.options.compression) {
      const compressed = zlib.gzipSync(Buffer.from(jsonData));
      fs.writeFileSync(compressedPath, compressed);
      
      if (fs.existsSync(uncompressedPath)) {
        fs.unlinkSync(uncompressedPath);
      }
      
      const originalSize = jsonData.length;
      const compressedSize = compressed.length;
      const ratio = ((1 - compressedSize / originalSize) * 100).toFixed(1);
      
      console.log(`[index-manager] Saved "${name}" (${(compressedSize/1024/1024).toFixed(2)}MB, ${ratio}% compression)`);
    } else {
      fs.writeFileSync(uncompressedPath, jsonData);
      console.log(`[index-manager] Saved "${name}" (${(jsonData.length/1024/1024).toFixed(2)}MB)`);
    }
    
    const metaPath = path.join(INDEX_DIR_PATH, `${name}.meta.json`);
    fs.writeFileSync(metaPath, JSON.stringify({
      savedAt: new Date().toISOString(),
      documentCount: engine.documentCount,
      compression: this.options.compression,
    }));
  }
  
  async _loadFromDisk(filePath) {
    let data;
    
    if (filePath.endsWith('.gz')) {
      const compressed = fs.readFileSync(filePath);
      const decompressed = zlib.gunzipSync(compressed);
      data = JSON.parse(decompressed.toString('utf8'));
    } else {
      data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
    
    const engine = new SearchEngine({
      enableScoring: true,
      enableSpellCheck: true,
    });
    
    if (data.documents) {
      engine.documents = new Map(data.documents);
      engine.documentCount = engine.documents.size;
    }
    
    if (data.indexes) {
      engine._createIndexes();
      
      for (const [fieldName, exportData] of Object.entries(data.indexes)) {
        if (engine.indexes[fieldName] && exportData) {
          await engine.indexes[fieldName].index.import(exportData);
        }
      }
    }
    
    engine.isBuilt = true;
    engine.buildTime = new Date().toISOString();
    
    return engine;
  }
  
  async warmUp(popularQueries, fetchFn) {
    console.log(`[index-manager] Warming up cache for ${popularQueries.length} queries`);
    
    const results = [];
    
    for (const query of popularQueries) {
      if (!this.warmedQueries.has(query)) {
        try {
          const result = await fetchFn(query);
          if (result) {
            this.warmedQueries.add(query);
            results.push({ query, cached: true, success: true });
          }
        } catch (error) {
          results.push({ query, cached: false, success: false, error: error.message });
        }
      } else {
        results.push({ query, cached: true, alreadyWarmed: true });
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    console.log(`[index-manager] Cache warming complete: ${successCount}/${popularQueries.length} successful`);
    
    return results;
  }
  
  async getPopularQueries(logFile, limit = 20) {
    if (!fs.existsSync(logFile)) {
      return [];
    }
    
    const queryCounts = new Map();
    const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
    
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.query && !entry.type) {
          const count = queryCounts.get(entry.query) || 0;
          queryCounts.set(entry.query, count + 1);
        }
      } catch (_) {}
    }
    
    return Array.from(queryCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([query, count]) => ({ query, count }));
  }
  
  getMemoryUsage() {
    const mem = process.memoryUsage();
    const heapUsedMB = mem.heapUsed / 1024 / 1024;
    const heapTotalMB = mem.heapTotal / 1024 / 1024;
    
    const shouldGC = heapUsedMB > this.options.maxMemoryMB * 0.9;
    
    return {
      heapUsedMB: Math.round(heapUsedMB * 100) / 100,
      heapTotalMB: Math.round(heapTotalMB * 100) / 100,
      rssMB: Math.round(mem.rss / 1024 / 1024 * 100) / 100,
      indexesLoaded: this.indexes.size,
      indexesLoading: this.loadingIndexes.size,
      shouldGC,
      workersActive: this.workers.length,
    };
  }
  
  triggerGC() {
    if (global.gc) {
      global.gc();
      console.log('[index-manager] Manual GC triggered');
    } else {
      console.log('[index-manager] GC not exposed. Run with --expose-gc');
    }
  }
  
  async clearIndex(name) {
    if (this.indexes.has(name)) {
      this.indexes.get(name).clear();
      this.indexes.delete(name);
    }
    
    const uncompressedPath = this._getIndexFilePath(name, false);
    const compressedPath = this._getIndexFilePath(name, true);
    
    if (fs.existsSync(uncompressedPath)) {
      fs.unlinkSync(uncompressedPath);
    }
    if (fs.existsSync(compressedPath)) {
      fs.unlinkSync(compressedPath);
    }
  }
  
  clearAll() {
    for (const index of this.indexes.values()) {
      index.clear();
    }
    this.indexes.clear();
    this.loadingIndexes.clear();
    this.warmedQueries.clear();
    
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers.length = 0;
  }
  
  getStats() {
    const memory = this.getMemoryUsage();
    
    return {
      indexes: {
        loaded: this.indexes.size,
        loading: this.loadingIndexes.size,
        warmedQueries: this.warmedQueries.size,
      },
      memory,
      workers: {
        active: this.workers.length,
        max: this.maxWorkers,
      },
      compression: this.options.compression,
    };
  }
}

if (!isMainThread) {
  const { name, documents, options } = workerData;
  
  const engine = new SearchEngine({
    enableScoring: options.enableScoring,
    enableSpellCheck: options.enableSpellCheck,
  });
  
  engine.build(documents);
  
  parentPort.postMessage({
    name,
    documents: documents,
    stats: engine.getStats(),
  });
}

module.exports = {
  IndexManager,
  INDEX_DIR_PATH,
};