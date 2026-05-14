const { getByNumero } = require('../../lib/patent-store');

module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const numero = (req.query && req.query.numero) || null;
  const item = getByNumero(numero, 'marca');

  if (!item) {
    res.status(404).json({ error: 'not_found', numero, tipo: 'marca' });
    return;
  }

  res.status(200).json(item);
};
