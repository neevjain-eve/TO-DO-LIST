// Persistence layer backed by Netlify Blobs (no external database account
// needed -- Blobs is built into every Netlify site). Falls back to a
// process-local in-memory object when Blobs isn't available (e.g. running
// the function code directly in a plain Node process for local unit
// testing) so the business logic can be exercised without a live site.
const { getStore } = require('@netlify/blobs');

const memoryFallback = {};

// Manual "drop" deploys (drag-and-drop via the Netlify UI, no Git/CLI)
// don't get Netlify's automatic Blobs runtime credentials -- only
// Git-linked or CLI (`netlify deploy`) deploys do. In that case we fall
// back to explicit credentials: a fixed site ID (not secret, just an
// identifier) plus a personal access token supplied via the BLOBS_TOKEN
// environment variable (set in Site settings > Environment variables).
const SITE_ID = '7a3da687-b074-4cdf-ac7d-2a34335a8bbd';

function store() {
  try {
    const opts = { name: 'task-manager', consistency: 'strong' };
    if (process.env.BLOBS_TOKEN) {
      opts.siteID = SITE_ID;
      opts.token = process.env.BLOBS_TOKEN;
    }
    return getStore(opts);
  } catch (e) {
    console.error('BLOBS_GETSTORE_FAILED', e && e.message, e && e.stack);
    return null; // triggers in-memory fallback below
  }
}

async function readJSON(key, fallbackValue) {
  const s = store();
  if (s) {
    try {
      const val = await s.get(key, { type: 'json' });
      return val === null || val === undefined ? fallbackValue : val;
    } catch (e) {
      console.error('BLOBS_GET_FAILED', key, e && e.message, e && e.stack);
      if (!(key in memoryFallback)) memoryFallback[key] = fallbackValue;
      return memoryFallback[key];
    }
  }
  if (!(key in memoryFallback)) memoryFallback[key] = fallbackValue;
  return memoryFallback[key];
}

async function writeJSON(key, value) {
  const s = store();
  if (s) {
    try {
      await s.setJSON(key, value);
      return;
    } catch (e) {
      console.error('BLOBS_SET_FAILED', key, e && e.message, e && e.stack);
      memoryFallback[key] = value;
      return;
    }
  }
  memoryFallback[key] = value;
}

module.exports = { readJSON, writeJSON };
