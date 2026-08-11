// Vercel API routes use an Express-style (req, res) signature rather than
// Netlify's (event) => response-object signature. `json(res, status, body)`
// keeps handler code reading almost identically to the original Netlify
// version -- `return json(res, 400, { error: '...' })` still works as a
// short-circuit return, it just performs the response as a side effect
// instead of building a response object.
function json(res, statusCode, body) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.status(statusCode).json(body);
}

// Vercel parses a JSON request body into req.body automatically when the
// request's Content-Type is application/json (which the frontend always
// sends), so this is just a safe accessor -- no manual JSON.parse needed.
function parseBody(req) {
  return req.body || {};
}

module.exports = { json, parseBody };
