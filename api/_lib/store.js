// Persistence layer backed by Vercel KV (Redis, via @vercel/kv). Falls back
// to a process-local in-memory object when KV isn't configured (e.g.
// running function code directly in a plain Node process for local unit
// testing, or before the KV store is linked in the Vercel dashboard) so the
// business logic can be exercised without a live store.
const memoryFallback = {};

function kvConfigured() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function readJSON(key, fallbackValue) {
  if (kvConfigured()) {
    try {
      const { kv } = require('@vercel/kv');
      const val = await kv.get(key);
      return val === null || val === undefined ? fallbackValue : val;
    } catch (e) {
      console.error('KV_GET_FAILED', key, e && e.message, e && e.stack);
    }
  }
  if (!(key in memoryFallback)) memoryFallback[key] = fallbackValue;
  return memoryFallback[key];
}

async function writeJSON(key, value) {
  if (kvConfigured()) {
    try {
      const { kv } = require('@vercel/kv');
      await kv.set(key, value);
      return;
    } catch (e) {
      console.error('KV_SET_FAILED', key, e && e.message, e && e.stack);
    }
  }
  memoryFallback[key] = value;
}

module.exports = { readJSON, writeJSON };
