const http = require('http');
const { URL } = require('url');
const path = require('path');
const fs = require('fs');

const healthHandler = require('./api/health');
const searchHandler = require('./api/search');
const cacheHandler = require('./api/cache');
const adminStatsHandler = require('./api/admin/stats');
const adminRealtimeHandler = require('./api/admin/realtime');
const patentByNumeroHandler = require('./api/patents/[numero].js');
const marcaByNumeroHandler = require('./api/marcas/[numero].js');

function setFallbackHeaders(res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
}

function decorateResponse(res) {
  if (typeof res.status !== 'function') {
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
  }

  if (typeof res.json !== 'function') {
    res.json = (payload) => {
      setFallbackHeaders(res);
      res.end(JSON.stringify(payload));
      return res;
    };
  }
}

function sendJson(res, status, payload) {
  setFallbackHeaders(res);
  res.statusCode = status;
  res.end(JSON.stringify(payload));
}

function ensureQuery(req, parsedUrl) {
  if (req.query && typeof req.query === 'object') {
    return;
  }

  const query = {};
  for (const [key, value] of parsedUrl.searchParams.entries()) {
    if (Object.prototype.hasOwnProperty.call(query, key)) {
      const current = query[key];
      query[key] = Array.isArray(current) ? [...current, value] : [current, value];
      continue;
    }
    query[key] = value;
  }

  req.query = query;
}

function requestHandler(req, res) {
  const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname.replace(/\/+$/, '') || '/';

  decorateResponse(res);
  ensureQuery(req, parsedUrl);

  if (pathname === '/api/health') {
    healthHandler(req, res);
    return;
  }

  if (pathname === '/api/search') {
    searchHandler(req, res);
    return;
  }

  if (pathname === '/api/cache/clear') {
    cacheHandler(req, res);
    return;
  }

  if (pathname === '/api/admin/stats') {
    adminStatsHandler(req, res);
    return;
  }

  if (pathname.startsWith('/api/admin/')) {
    sendJson(res, 401, { error: 'unauthorized', message: 'Admin endpoint requires token' });
    return;
  }

  if (pathname === '/dashboard') {
    const dashboardPath = path.join(__dirname, 'public', 'dashboard.html');
    if (fs.existsSync(dashboardPath)) {
      const html = fs.readFileSync(dashboardPath, 'utf8');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.statusCode = 200;
      res.end(html);
      return;
    }
  }

  if (pathname.startsWith('/api/patents/')) {
    const numero = decodeURIComponent(pathname.slice('/api/patents/'.length)).trim();
    req.query = { ...(req.query || {}), numero };
    patentByNumeroHandler(req, res);
    return;
  }

  if (pathname.startsWith('/api/marcas/')) {
    const numero = decodeURIComponent(pathname.slice('/api/marcas/'.length)).trim();
    req.query = { ...(req.query || {}), numero };
    marcaByNumeroHandler(req, res);
    return;
  }

  if (pathname === '/' || pathname === '/api') {
    sendJson(res, 200, {
      ok: true,
      service: 'inpi-search-api',
      version: '6.0.0',
      endpoints: {
        public: [
          '/api/health',
          '/api/search',
          '/api/patents/:numero',
          '/api/cache/clear',
          '/dashboard',
        ],
        admin: [
          '/api/admin/stats (requires x-admin-token header)',
          '/api/admin/realtime (requires x-admin-token header)',
        ],
      },
      features: {
        bm25_scoring: true,
        query_parsing: true,
        spell_correction: true,
        highlighting: true,
        query_logging: true,
        caching: true,
        analytics: true,
        realtime_dashboard: true,
        lazy_loading: true,
        compression: true,
      },
      documentation: {
        dashboard: '/dashboard',
        openapi: '/api/docs',
      },
    });
    return;
  }

  sendJson(res, 404, { error: 'not_found' });
}

module.exports = requestHandler;

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  http.createServer(requestHandler).listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`inpi-search-api listening on port ${port}`);
  });
}
