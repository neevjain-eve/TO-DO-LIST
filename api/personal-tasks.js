// GET /api/personal-tasks -> your own "add work" items (employee OR manager)
// POST /api/personal-tasks { title, priority, dueDate } -> create
// PATCH /api/personal-tasks?id=3 { status } -> update
// DELETE /api/personal-tasks?id=3 -> remove
// DELETE /api/personal-tasks (no id, admin only) -> wipe every
// "Add work" item for every employee AND manager in one shot
//
// Both employees and managers can self-assign work here -- an employee's
// items are keyed by employeeId, a manager's by managerId (managers have no
// employeeId of their own). Older records predate the manager role and only
// ever have employeeId set, so they're unambiguously employee-owned.
const { readJSON, writeJSON } = require('./_lib/store');
const { currentUser } = require('./_lib/auth');
const { json, parseBody } = require('./_lib/respond');

module.exports = async (req, res) => {
  const me = currentUser(req);
  if (!me) return json(res, 401, { error: 'Not logged in.' });

  if (me.role === 'admin') {
    const hasId = Boolean((req.query || {}).id);
    if (req.method === 'DELETE' && !hasId) {
      await writeJSON('personalTasks', []);
      return json(res, 200, { ok: true, cleared: true });
    }
    return json(res, 403, { error: 'Admin can only bulk-clear all personal work items (DELETE with no id).' });
  }

  if (me.role !== 'employee' && me.role !== 'manager') {
    return json(res, 401, { error: 'Employee or manager login required.' });
  }
  const isManager = me.role === 'manager';
  const ownerMatches = (t) => (isManager ? t.managerId === me.managerId : t.employeeId === me.employeeId && !t.managerId);

  const all = await readJSON('personalTasks', []);

  if (req.method === 'GET') {
    return json(res, 200, { personalTasks: all.filter(ownerMatches) });
  }

  if (req.method === 'POST') {
    const body = parseBody(req);
    const title = (body.title || '').trim();
    if (!title) return json(res, 400, { error: 'Title is required.' });
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
    return json(res, 201, { personalTask: item });
  }

  const id = Number((req.query || {}).id);
  if (!id) return json(res, 400, { error: 'id query parameter is required.' });
  const item = all.find((t) => t.id === id && ownerMatches(t));
  if (!item) return json(res, 404, { error: 'Not found.' });

  if (req.method === 'PATCH') {
    const body = parseBody(req);
    if (body.status) item.status = body.status;
    if (body.title) item.title = body.title;
    if ('description' in body) item.description = body.description;
    if (body.priority) item.priority = body.priority;
    if ('dueDate' in body) item.dueDate = body.dueDate;
    await writeJSON('personalTasks', all);
    return json(res, 200, { personalTask: item });
  }

  if (req.method === 'DELETE') {
    await writeJSON('personalTasks', all.filter((t) => t.id !== id));
    return json(res, 200, { ok: true });
  }

  return json(res, 405, { error: 'Method not allowed.' });
};
