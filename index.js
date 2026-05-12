const http = require('http');
const { URL } = require('url');

const healthHandler = require('./api/health');
const searchHandler = require('./api/search');
const patentByNumeroHandler = require('./api/patents/[numero].js');

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

  if (pathname.startsWith('/api/patents/')) {
    const numero = decodeURIComponent(pathname.slice('/api/patents/'.length)).trim();
    req.query = { ...(req.query || {}), numero };
    patentByNumeroHandler(req, res);
    return;
  }

  if (pathname === '/' || pathname === '/api') {
    sendJson(res, 200, {
      ok: true,
      service: 'inpi-search-api',
      endpoints: ['/api/health', '/api/search', '/api/patents/:numero'],
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
