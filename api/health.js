const fs = require('fs');
const path = require('path');

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

  const dataFiles = checkDataFiles();
  
  const response = {
    ok: true,
    service: 'inpi-search-api',
    version: packageJson.version || '1.0.0',
    now: new Date().toISOString(),
    
    uptime: getUptime(),
    memory: getMemoryUsage(),
    
    data: {
      files: dataFiles,
      status: 'ready',
    },
    
    features: {
      search: true,
      bm25_scoring: true,
      spell_correction: true,
      caching: true,
      analytics: true,
      dashboard: true,
    },
  };
  
  res.status(200).json(response);
};