const { getStats } = require('../lib/patent-store');
const path = require('path');
const fs = require('fs');

const packageJsonPath = path.join(__dirname, '..', 'package.json');
let packageJson = {};
try {
  packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
} catch (_) {}

function getUptime() {
  return {
    seconds: Math.round(process.uptime()),
    formatted: formatDuration(process.uptime()),
  };
}

function formatDuration(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);
  
  return parts.join(' ');
}

function getMemoryUsage() {
  const mem = process.memoryUsage();
  return {
    heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
    heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
    rss_mb: Math.round(mem.rss / 1024 / 1024),
    external_mb: Math.round(mem.external / 1024 / 1024),
    heap_utilization_percent: Math.round((mem.heapUsed / mem.heapTotal) * 100) || 0,
  };
}

function checkDataFiles() {
  const dataDir = path.join(__dirname, '..', 'data');
  const files = {
    patentes: 0,
    marcas: 0,
    programas: 0,
    total_size_mb: 0,
  };
  
  if (!fs.existsSync(dataDir)) {
    return { ...files, exists: false };
  }
  
  const dirFiles = fs.readdirSync(dataDir);
  
  for (const file of dirFiles) {
    if (!file.endsWith('.jsonl')) continue;
    
    const filePath = path.join(dataDir, file);
    const stat = fs.statSync(filePath);
    files.total_size_mb += stat.size / 1024 / 1024;
    
    if (file.includes('patentes')) files.patentes++;
    else if (file.includes('marcas')) files.marcas++;
    else if (file.includes('programas')) files.programas++;
  }
  
  return {
    ...files,
    total_size_mb: Math.round(files.total_size_mb * 100) / 100,
    exists: true,
  };
}

function getIndexHealth(indexStats) {
  if (!indexStats) {
    return {
      status: 'not_loaded',
      message: 'Índices ainda não carregados',
    };
  }
  
  const issues = [];
  let status = 'healthy';
  
  if (indexStats.documentCount === 0) {
    issues.push('Nenhum documento indexado');
    status = 'warning';
  }
  
  if (indexStats.invertedIndexSize === 0) {
    issues.push('Inverted index vazio');
    status = 'warning';
  }
  
  if (indexStats.buildDurationMs > 10000) {
    issues.push(`Build lento: ${indexStats.buildDurationMs}ms`);
    status = 'warning';
  }
  
  return {
    status,
    document_count: indexStats.documentCount,
    index_terms: indexStats.invertedIndexSize,
    build_time_ms: indexStats.buildDurationMs,
    issues: issues.length > 0 ? issues : null,
  };
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

  const stats = getStats();
  const dataFiles = checkDataFiles();
  const indexHealth = getIndexHealth(stats.index_stats);
  
  const response = {
    ok: true,
    service: 'inpi-search-api',
    version: packageJson.version || '1.0.0',
    now: new Date().toISOString(),
    
    uptime: getUptime(),
    memory: getMemoryUsage(),
    
    data: {
      files: dataFiles,
      records: stats.total_records,
      loaded: stats.loaded,
    },
    
    indexes: {
      ...indexHealth,
      stats: stats.index_stats || null,
    },
    
    performance: {
      load_attempts: stats.load_attempts || 0,
      last_load_time: stats.last_load_time,
      load_duration_ms: stats.load_duration_ms || 0,
      invalid_lines: stats.invalid_lines || 0,
      load_error: stats.load_error,
    },
    
    source_files: stats.source_files || [],
  };
  
  const overallStatus = indexHealth.status === 'healthy' && stats.loaded ? 200 : 503;
  res.status(overallStatus).json(response);
};