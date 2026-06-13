// Resolve catch-all segments for /api/{segment}/* routers.
// Sources: req.query (Vercel ?route= or legacy), req.params (Express 5 dev), req.url path.

/**
 * @param {import('http').IncomingMessage & { query?: Record<string, unknown>; params?: Record<string, unknown>; url?: string }} req
 * @param {string} paramKey  Catch-all param name in the file ([...route] → 'route')
 * @param {string} apiSegment  URL segment after /api/ ('license', 'auth', 'sync')
 * @returns {string[]}
 */
function catchAllSegments(req, paramKey, apiSegment) {
  const fromQuery = req.query?.[paramKey];
  if (Array.isArray(fromQuery) && fromQuery.length > 0) {
    return fromQuery.map(String).filter(Boolean);
  }
  if (typeof fromQuery === 'string' && fromQuery) {
    return fromQuery.split('/').filter(Boolean);
  }

  const fromParams = req.params?.[paramKey];
  if (Array.isArray(fromParams) && fromParams.length > 0) {
    return fromParams.map(String).filter(Boolean);
  }
  if (typeof fromParams === 'string' && fromParams) {
    return fromParams.split('/').filter(Boolean);
  }

  const url = (req.url || '').split('?')[0];
  const prefix = `/api/${apiSegment}/`;
  if (url.startsWith(prefix)) {
    const rest = url.slice(prefix.length).replace(/^\/+|\/+$/g, '');
    if (rest) {
      return rest.split('/').filter(Boolean);
    }
  }

  return [];
}

/**
 * @param {import('http').IncomingMessage & { query?: Record<string, unknown>; params?: Record<string, unknown>; url?: string }} req
 * @param {string} paramKey
 * @param {string} apiSegment
 * @returns {string | undefined}
 */
function catchAllHead(req, paramKey, apiSegment) {
  return catchAllSegments(req, paramKey, apiSegment)[0];
}

module.exports = { catchAllSegments, catchAllHead };
