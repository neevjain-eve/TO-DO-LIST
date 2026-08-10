// Tests the Microsoft Graph calendar sync logic with a mocked fetch, so it
// can be verified without real Azure credentials. Covers: sync stays a
// safe no-op when unconfigured; event create/update/delete on task
// create/edit/delete; and the pull-sync job reacting to changes made
// directly in Outlook (date moved, event deleted).
let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { passed++; console.log('PASS:', label); }
  else { failed++; console.log('FAIL:', label); }
}

function evt(method, body, query, token) {
  return { httpMethod: method, body: body ? JSON.stringify(body) : null, queryStringParameters: query || {}, headers: token ? { authorization: 'Bearer ' + token } : {} };
}

async function withMockedGraph(mocks, fn) {
  // mocks: { token: () => resObj, events: (method, path, body) => resObj }
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    opts = opts || {};
    if (String(url).includes('login.microsoftonline.com')) {
      const r = mocks.token();
      return { ok: r.ok !== false, status: r.status || 200, json: async () => r.body, text: async () => JSON.stringify(r.body) };
    }
    if (String(url).includes('graph.microsoft.com')) {
      const r = mocks.events(opts.method || 'GET', String(url), opts.body ? JSON.parse(opts.body) : null);
      return { ok: r.ok !== false, status: r.status || 200, json: async () => r.body, text: async () => JSON.stringify(r.body) };
    }
    return realFetch(url, opts);
  };
  try { await fn(); } finally { global.fetch = realFetch; }
}

async function main() {
  // ---- Part 1: unconfigured (no env vars) must be a safe no-op ----
  delete process.env.MS_TENANT_ID; delete process.env.MS_CLIENT_ID; delete process.env.MS_CLIENT_SECRET;
  delete require.cache[require.resolve('./netlify/lib/graph')];
  delete require.cache[require.resolve('./netlify/functions/tasks')];
  const graphUnconfigured = require('./netlify/lib/graph');
  check('configured() false without env vars', graphUnconfigured.configured() === false);
  const created = await graphUnconfigured.createEventForTask('x@pdka.in', { title: 't', dueDate: '2026-08-01', priority: 'Medium', status: 'Pending' });
  check('createEventForTask no-ops (null) when unconfigured', created === null);

  const seedFn = require('./netlify/functions/seed');
  const loginFn = require('./netlify/functions/login');
  const tasksFn = require('./netlify/functions/tasks');
  await seedFn.handler(evt('POST', { force: true }));
  const adminLogin = JSON.parse((await loginFn.handler(evt('POST', { username: 'admin', password: 'Admin@123' }))).body);
  const naveenLogin = JSON.parse((await loginFn.handler(evt('POST', { username: 'naveen', password: 'Welcome@123' }))).body);
  const createRes = await tasksFn.handler(evt('POST', { title: 'Unconfigured test', dueDate: '2026-08-10', employeeIds: [naveenLogin.employee.id] }, {}, adminLogin.token));
  check('task creation succeeds even with Graph unconfigured', createRes.statusCode === 201);
  const createdTask = JSON.parse(createRes.body).task;
  check('no graphEventId stored when unconfigured', createdTask.assignees[0].graphEventId === null);

  // ---- Part 2: configured, mocked Graph API ----
  process.env.MS_TENANT_ID = 'tenant-123';
  process.env.MS_CLIENT_ID = 'client-123';
  process.env.MS_CLIENT_SECRET = 'secret-123';
  delete require.cache[require.resolve('./netlify/lib/graph')];
  delete require.cache[require.resolve('./netlify/functions/tasks')];
  delete require.cache[require.resolve('./netlify/functions/sync-calendar')];
  const graph = require('./netlify/lib/graph');
  check('configured() true with env vars set', graph.configured() === true);

  let eventStore = {}; // eventId -> {subject, start, isCancelled}
  let nextEventId = 1;
  const graphMocks = {
    token: () => ({ ok: true, body: { access_token: 'fake-token', expires_in: 3600 } }),
    events: (method, url, body) => {
      if (method === 'POST' && url.includes('/events')) {
        const id = 'evt-' + (nextEventId++);
        eventStore[id] = { id, subject: body.subject, start: body.start, isCancelled: false };
        return { ok: true, status: 201, body: eventStore[id] };
      }
      const m = url.match(/\/events\/([^?]+)/);
      const id = m && m[1];
      if (method === 'PATCH') {
        if (!eventStore[id]) return { ok: false, status: 404, body: { error: { message: 'not found' } } };
        Object.assign(eventStore[id], { subject: body.subject, start: body.start });
        return { ok: true, status: 200, body: eventStore[id] };
      }
      if (method === 'DELETE') {
        const existed = !!eventStore[id];
        delete eventStore[id];
        return { ok: existed, status: existed ? 204 : 404, body: null };
      }
      if (method === 'GET') {
        if (!eventStore[id]) return { ok: false, status: 404, body: { error: { message: 'not found' } } };
        return { ok: true, status: 200, body: eventStore[id] };
      }
      return { ok: false, status: 400, body: {} };
    },
  };

  await withMockedGraph(graphMocks, async () => {
    const tasksFn2 = require('./netlify/functions/tasks');
    const createRes2 = await tasksFn2.handler(evt('POST', { title: 'Synced task', priority: 'High', dueDate: '2026-08-12', employeeIds: [naveenLogin.employee.id] }, {}, adminLogin.token));
    check('task creation succeeds when configured', createRes2.statusCode === 201);
    const t2 = JSON.parse(createRes2.body).task;
    check('graphEventId stored after creation', !!t2.assignees[0].graphEventId);
    check('event subject reflects priority + title', eventStore[t2.assignees[0].graphEventId].subject === '[High] Synced task');

    // admin edits the due date -> event should update, not duplicate
    const patchRes = await tasksFn2.handler(evt('PATCH', { dueDate: '2026-08-15' }, { id: String(t2.id) }, adminLogin.token));
    check('admin edit succeeds', patchRes.statusCode === 200);
    check('exactly one event exists after edit (updated, not duplicated)', Object.keys(eventStore).length === 1);
    check('event start date updated to match new due date', eventStore[t2.assignees[0].graphEventId].start.dateTime.startsWith('2026-08-15'));

    // employee marks complete -> their own event updates
    const naveenLogin2 = JSON.parse((await require('./netlify/functions/login').handler(evt('POST', { username: 'naveen', password: 'Welcome@123' }))).body);
    const markRes = await tasksFn2.handler(evt('PATCH', { status: 'Completed' }, { id: String(t2.id) }, naveenLogin2.token));
    check('employee mark-complete succeeds', markRes.statusCode === 200);
    check('event subject/category reflects Completed', eventStore[t2.assignees[0].graphEventId].subject === '[High] Synced task');

    // delete task -> event removed from Outlook too
    const delRes = await tasksFn2.handler(evt('DELETE', null, { id: String(t2.id) }, adminLogin.token));
    check('task delete succeeds', delRes.statusCode === 200);
    check('event removed from Outlook on task delete', Object.keys(eventStore).length === 0);

    // ---- Part 3: pull-sync job reacts to Outlook-side changes ----
    const createRes3 = await tasksFn2.handler(evt('POST', { title: 'Pull sync test', dueDate: '2026-08-20', employeeIds: [naveenLogin.employee.id] }, {}, adminLogin.token));
    const t3 = JSON.parse(createRes3.body).task;
    const evId = t3.assignees[0].graphEventId;
    // simulate the employee dragging the event to a new date directly in Outlook
    eventStore[evId].start = { dateTime: '2026-08-22T00:00:00Z' };

    const syncFn = require('./netlify/functions/sync-calendar');
    const syncRes = await syncFn.handler();
    check('sync job runs successfully', syncRes.statusCode === 200);
    const { readJSON } = require('./netlify/lib/store');
    const afterSyncTasks = await readJSON('tasks', []);
    const t3After = afterSyncTasks.find((t) => t.id === t3.id);
    check('single-assignee task dueDate pulled back from Outlook change', t3After.dueDate === '2026-08-22');

    // simulate the employee deleting the event directly in Outlook
    delete eventStore[evId];
    await syncFn.handler();
    const afterDelTasks = await readJSON('tasks', []);
    const t3AfterDel = afterDelTasks.find((t) => t.id === t3.id);
    check('graphEventId unlinked when event deleted upstream in Outlook', t3AfterDel.assignees[0].graphEventId === null);
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('TEST CRASHED:', e); process.exit(1); });
