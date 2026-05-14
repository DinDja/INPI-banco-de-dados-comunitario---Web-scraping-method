const { clearCache, getStats } = require('../lib/patent-store');

module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed', allowed_methods: ['POST'] });
    return;
  }

  clearCache();
  
  res.status(200).json({
    ok: true,
    message: 'Cache cleared successfully',
    stats: getStats(),
  });
};
