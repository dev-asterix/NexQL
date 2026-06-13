// Catch-all router for /api/license/* — keeps Hobby-plan function count under 12.

const { catchAllHead } = require('../_lib/catch-all-route');

const handlers = {
  validate: require('../_lib/handlers/license-validate'),
  lookup: require('../_lib/handlers/license-lookup'),
  status: require('../_lib/handlers/license-status'),
  recover: require('../_lib/handlers/license-recover'),
  devices: require('../_lib/handlers/license-devices'),
  history: require('../_lib/handlers/license-history'),
};

module.exports = async (req, res) => {
  const handler = handlers[catchAllHead(req, 'route', 'license')];
  if (!handler) {
    return res.status(404).json({ error: 'Not Found' });
  }
  return handler(req, res);
};
