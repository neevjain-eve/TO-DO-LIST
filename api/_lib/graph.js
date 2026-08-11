// Microsoft Graph client for calendar sync.
//
// Uses the OAuth2 client-credentials flow (app-only permissions) with
// Calendars.ReadWrite (Application), so the app can create/update/delete
// events directly on any employee's Outlook/Teams calendar via their UPN
// (their pdka.in email) without each employee individually signing in.
//
// Requires three environment variables set in Vercel:
//   MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET
// If they're not set, every function here is a safe no-op (returns null /
// false) so the rest of the app keeps working without calendar sync.

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

function configured() {
  return Boolean(process.env.MS_TENANT_ID && process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET);
}

// Simple in-memory token cache (survives across invocations in a warm
// container, harmless to lose on a cold start -- just costs one extra
// token request).
let cachedToken = null; // { value, expiresAt }

async function getToken() {
  if (!configured()) return null;
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30000) return cachedToken.value;

  const url = `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID,
    client_secret: process.env.MS_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('GRAPH_TOKEN_FAILED', res.status, text);
    return null;
  }
  const data = await res.json();
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

async function graphFetch(path, opts) {
  const token = await getToken();
  if (!token) return { ok: false, status: 0, error: 'Microsoft Calendar sync is not configured.' };
  opts = opts || {};
  const res = await fetch(GRAPH_BASE + path, {
    method: opts.method || 'GET',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return { ok: true, status: 204, data: null };
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    console.error('GRAPH_REQUEST_FAILED', opts.method || 'GET', path, res.status, JSON.stringify(data));
    return { ok: false, status: res.status, error: (data && data.error && data.error.message) || 'Graph request failed', data };
  }
  return { ok: true, status: res.status, data };
}

function taskToEventPayload(task) {
  // Whole-day event on the due date. Subject carries priority + status so
  // it's legible directly in Outlook/Teams without opening the task tool.
  const date = task.dueDate; // 'YYYY-MM-DD'
  return {
    subject: `[${task.priority || 'Medium'}] ${task.title}`,
    body: { contentType: 'Text', content: (task.description || '') + '\n\nAssigned via Employee Task Manager (PDKA).' },
    isAllDay: true,
    start: { dateTime: `${date}T00:00:00`, timeZone: 'UTC' },
    end: { dateTime: `${date}T00:00:00`, timeZone: 'UTC' },
    categories: [task.status || 'Pending'],
  };
}

/** Creates an event on `upn`'s calendar for this task. Returns the Graph event id, or null on failure/not-configured. */
async function createEventForTask(upn, task) {
  if (!configured() || !upn || !task.dueDate) return null;
  const r = await graphFetch(`/users/${encodeURIComponent(upn)}/events`, { method: 'POST', body: taskToEventPayload(task) });
  return r.ok ? r.data.id : null;
}

/** Updates an existing event to match the task's current title/date/priority/status. */
async function updateEventForTask(upn, eventId, task) {
  if (!configured() || !upn || !eventId) return false;
  const r = await graphFetch(`/users/${encodeURIComponent(upn)}/events/${eventId}`, { method: 'PATCH', body: taskToEventPayload(task) });
  return r.ok;
}

/** Deletes the event. Treats "already gone" (404) as success. */
async function deleteEvent(upn, eventId) {
  if (!configured() || !upn || !eventId) return true;
  const r = await graphFetch(`/users/${encodeURIComponent(upn)}/events/${eventId}`, { method: 'DELETE' });
  return r.ok || r.status === 404;
}

/** Fetches an event's current state (used by the pull-sync job to detect changes made directly in Outlook/Teams). Returns null if not configured, not found, or on error. */
async function getEvent(upn, eventId) {
  if (!configured() || !upn || !eventId) return null;
  const r = await graphFetch(`/users/${encodeURIComponent(upn)}/events/${eventId}?$select=id,subject,start,isCancelled,lastModifiedDateTime`);
  if (!r.ok) return r.status === 404 ? { deleted: true } : null;
  return r.data;
}

module.exports = { configured, createEventForTask, updateEventForTask, deleteEvent, getEvent };
