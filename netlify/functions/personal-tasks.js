// GET    /api/personal-tasks             -> your own "add work" items (employee OR manager)
// POST   /api/personal-tasks { title, priority, dueDate } -> create
// PATCH  /api/personal-tasks?id=3 { status }              -> update
// DELETE /api/personal-tasks?id=3                          -> remove
// DELETE /api/personal-tasks (no id, admin only)            -> wipe every
//         "Add work" item for every employee AND manager in one shot
//
// Both employees and managers can self-assign work here -- an employee's
// items are keyed by employeeId, a manager's by managerId (managers have no
// employeeId of their own). Older records predate the manager role and only
// ever have employeeId set, so they're unambiguously employee-owned.
const { readJSON, writeJSON } = require('../lib/store');
const { currentUser } = require('../lib/auth');
const { json, parseBody } = require('../lib/respond');

exports.handler = async (event) => {
  const me = currentUser(event);
  if (!me) return json(401, { error: 'Not logged in.' });

  if (me.role === 'admin') {
    const hasId = Boolean((event.queryStringParameters || {}).id);
    if (event.httpMethod === 'DELETE' && !hasId) {
      await writeJSON('personalTasks', []);
      return json(200, { ok: true, cleared: true });
    }
    return json(403, { error: 'Admin can only bulk-clear all personal work items (DELETE with no id).' });
  }

  if (me.role !== 'employee' && me.role !== 'manager') {
    return json(401, { error: 'Employee or manager login required.' });
  }
  const isManager = me.role === 'manager';
  const ownerMatches = (t) => (isManager ? t.managerId === me.managerId : t.employeeId === me.employeeId && !t.managerId);

  const all = await readJSON('personalTasks', []);

  if (event.httpMethod === 'GET') {
    return json(200, { personalTasks: all.filter(ownerMatches) });
  }

  if (event.httpMethod === 'POST') {
    const body = parseBody(event);
    const title = (body.title || '').trim();
    if (!title) return json(400, { error: 'Title is required.' });
    const idSeq = await readJSON('idSeq', { task: 1, personalTask: 1, employee: 1, manager: 1 });
    const item = {
      id: idSeq.personalTask,
      employeeId: isManager ? null : me.employeeId,
      managerId: isManager ? me.managerId : null,
      title,
      description: body.description || '',
      priority: body.priority || 'Medium',
      dueDate: body.dueDate || null,
      status: 'Pending',
      createdAt: new Date().toISOString(),
    };
    all.push(item);
    idSeq.personalTask += 1;
    await Promise.all([writeJSON('personalTasks', all), writeJSON('idSeq', idSeq)]);
    return json(201, { personalTask: item });
  }

  const id = Number((event.queryStringParameters || {}).id);
  if (!id) return json(400, { error: 'id query parameter is required.' });
  const item = all.find((t) => t.id === id && ownerMatches(t));
  if (!item) return json(404, { error: 'Not found.' });

  if (event.httpMethod === 'PATCH') {
    const body = parseBody(event);
    if (body.status) item.status = body.status;
    if (body.title) item.title = body.title;
    if ('description' in body) item.description = body.description;
    if (body.priority) item.priority = body.priority;
    if ('dueDate' in body) item.dueDate = body.dueDate;
    await writeJSON('personalTasks', all);
    return json(200, { personalTask: item });
  }

  if (event.httpMethod === 'DELETE') {
    await writeJSON('personalTasks', all.filter((t) => t.id !== id));
    return json(200, { ok: true });
  }

  return json(405, { error: 'Method not allowed.' });
};
