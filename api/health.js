const { getStats } = require('../lib/patent-store');

module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const stats = getStats();
  res.status(200).json({
    ok: true,
    service: 'inpi-search-api',
    now: new Date().toISOString(),
    ...stats,
  });
};
