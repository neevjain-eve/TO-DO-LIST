// GET /api/tasks -> admin: all tasks. manager: tasks touching their direct reports PLUS tasks assigned to their own linked employee record (see managers.js). employee: only tasks assigned to them.
// POST /api/tasks { title, dueDate, priority, employeeIds: [..] OR department: "Audit", ... } -> admin (either) or manager (employeeIds only, scoped to their direct reports)
// PATCH /api/tasks?id=7 { status } -> employee updates their OWN assignee status
// PATCH /api/tasks?id=7 { title, dueDate, priority, status, ... } -> admin (any task) or manager (only tasks assigned entirely to their own direct reports)
// PATCH /api/tasks?id=7 { status } -> manager, on a task NOT owned via direct reports but where they're personally an assignee (their linked employee record) -> updates just their own status, like an employee would
// DELETE /api/tasks?id=7 -> admin (any task) or manager (only tasks assigned entirely to their own direct reports)
const { readJSON, writeJSON } = require('./_lib/store');
const { currentUser } = require('./_lib/auth');
const { json, parseBody } = require('./_lib/respond');
const graph = require('./_lib/graph');

function recomputeOverallStatus(task) {
  const statuses = task.assignees.map((a) => a.status);
  if (statuses.length && statuses.every((s) => s === 'Completed')) task.status = 'Completed';
  else if (statuses.some((s) => s === 'In Progress' || s === 'Completed')) task.status = 'In Progress';
  else task.status = 'Pending';
}

// Who a manager can see/assign/edit is decided purely by employee.managerId
// -- an explicit, per-person "reports to" assignment the admin sets on the
// Employees page -- not by matching department strings.
function allAssigneesReportTo(task, employees, managerId) {
  return task.assignees.every((a) => {
    const emp = employees.find((e) => e.id === a.employeeId);
    return emp && emp.managerId === managerId;
  });
}

module.exports = async (req, res) => {
  const me = currentUser(req);
  if (!me) return json(res, 401, { error: 'Not logged in.' });

  if (req.method === 'GET') {
    const tasks = await readJSON('tasks', []);
    if (me.role === 'admin' || me.role === 'manager') {
      const employees = await readJSON('employees', []);
      const nameOf = (id) => (employees.find((e) => e.id === id) || {}).name || 'Unknown';
      let scoped = tasks;
      if (me.role === 'manager') {
        const reportIds = new Set(employees.filter((e) => e.managerId === me.managerId).map((e) => e.id));
        // Also fold in tasks assigned to the manager's OWN linked employee
        // record (see managers.js) so admin-assigned work shows up here too,
        // without them needing a second employee login to see it.
        scoped = tasks.filter((t) => t.assignees.some((a) => reportIds.has(a.employeeId) || (me.employeeId && a.employeeId === me.employeeId)));
      }
      return json(res, 200, {
        tasks: scoped.map((t) => {
          const mapped = { ...t, assignees: t.assignees.map((a) => ({ ...a, name: nameOf(a.employeeId) })) };
          if (me.role === 'manager' && me.employeeId) {
            const mine = t.assignees.find((a) => a.employeeId === me.employeeId);
            if (mine) mapped.myStatus = mine.status;
          }
          return mapped;
        }),
      });
    }
    const mine = tasks
      .filter((t) => t.assignees.some((a) => a.employeeId === me.employeeId))
      .map((t) => ({ ...t, myStatus: t.assignees.find((a) => a.employeeId === me.employeeId).status }));
    return json(res, 200, { tasks: mine });
  }

  if (req.method === 'POST') {
    if (me.role !== 'admin' && me.role !== 'manager') return json(res, 403, { error: 'Only an admin or manager can assign tasks.' });
    const body = parseBody(req);
    const title = (body.title || '').trim();
    if (!title) return json(res, 400, { error: 'Title is required.' });
    if (!body.dueDate) return json(res, 400, { error: 'Due date is required.' });

    const employees = await readJSON('employees', []);

    if (me.role === 'manager' && body.department) {
      return json(res, 403, { error: 'Whole-department assignment isn\'t available to managers -- select your direct reports individually.' });
    }

    let targetIds = [];
    if (body.department) {
      targetIds = employees.filter((e) => e.dept === body.department && e.active).map((e) => e.id);
    } else {
      targetIds = (body.employeeIds || []).map(Number).filter((id) => employees.some((e) => e.id === id));
    }

    if (me.role === 'manager') {
      const reportIds = new Set(employees.filter((e) => e.managerId === me.managerId).map((e) => e.id));
      const outsideReports = targetIds.some((id) => !reportIds.has(id));
      if (outsideReports) return json(res, 403, { error: 'You can only assign tasks to employees who report to you.' });
    }

    if (!targetIds.length) return json(res, 400, { error: 'No valid employees to assign to.' });

    const [tasks, idSeq] = await Promise.all([readJSON('tasks', []), readJSON('idSeq', { task: 1, personalTask: 1, employee: 1 })]);
    const task = {
      id: idSeq.task,
      title,
      client: body.client || '',
      description: body.description || '',
      priority: body.priority || 'Medium',
      category: body.category || '',
      startDate: body.startDate || null,
      dueDate: body.dueDate,
      dueTime: body.dueTime || null,
      reminderMinutesBefore: body.reminderMinutesBefore ?? null,
      notes: body.notes || '',
      status: 'Pending',
      isDepartmentWide: Boolean(body.department),
      department: body.department || null,
      assignees: targetIds.map((employeeId) => ({ employeeId, status: 'Pending', completedAt: null, graphEventId: null })),
      createdBy: me.username,
      createdAt: new Date().toISOString(),
    };
    tasks.push(task);
    idSeq.task += 1;
    await Promise.all([writeJSON('tasks', tasks), writeJSON('idSeq', idSeq)]);

    // Best-effort: push a calendar event to each assignee's Outlook/Teams
    // calendar. Failures here (Graph not configured, employee has no
    // email, transient API error) must never break task creation -- the
    // task itself is already saved above.
    if (graph.configured()) {
      const employeesForGraph = await readJSON('employees', []);
      await Promise.all(task.assignees.map(async (a) => {
        const emp = employeesForGraph.find((e) => e.id === a.employeeId);
        if (!emp || !emp.email) return;
        try {
          a.graphEventId = await graph.createEventForTask(emp.email, task);
        } catch (e) {
          console.error('GRAPH_CREATE_EVENT_FAILED', emp.email, e && e.message);
        }
      }));
      await writeJSON('tasks', tasks);
    }

    return json(res, 201, { task });
  }

  const id = Number((req.query || {}).id);
  if (!id) return json(res, 400, { error: 'id query parameter is required.' });
  const tasks = await readJSON('tasks', []);
  const task = tasks.find((t) => t.id === id);
  if (!task) return json(res, 404, { error: 'Task not found.' });

  if (req.method === 'PATCH') {
    const body = parseBody(req);
    let touchedAssigneeIds = null; // null = sync every assignee's event; array = sync just these
    if (me.role === 'employee') {
      const mine = task.assignees.find((a) => a.employeeId === me.employeeId);
      if (!mine) return json(res, 403, { error: 'This task is not assigned to you.' });
      if (!['Pending', 'In Progress', 'Completed'].includes(body.status)) return json(res, 400, { error: 'Invalid status.' });
      mine.status = body.status;
      mine.completedAt = body.status === 'Completed' ? new Date().toISOString() : null;
      recomputeOverallStatus(task);
      touchedAssigneeIds = [me.employeeId];
    } else if (me.role === 'manager') {
      const employees = await readJSON('employees', []);
      const isFullReportsTask = allAssigneesReportTo(task, employees, me.managerId);
      const ownAssignee = me.employeeId ? task.assignees.find((a) => a.employeeId === me.employeeId) : null;

      if (isFullReportsTask) {
        for (const field of ['title', 'client', 'description', 'priority', 'category', 'dueDate', 'dueTime', 'reminderMinutesBefore', 'notes', 'status']) {
          if (field in body) task[field] = body[field];
        }
      } else if (ownAssignee) {
        // Not a task this manager owns as a manager (e.g. admin assigned it
        // directly to their own linked employee record) -- let them update
        // only their own assignee status, same as an employee would, rather
        // than the full edit rights they'd get over their reports' tasks.
        if (!['Pending', 'In Progress', 'Completed'].includes(body.status)) return json(res, 400, { error: 'Invalid status.' });
        ownAssignee.status = body.status;
        ownAssignee.completedAt = body.status === 'Completed' ? new Date().toISOString() : null;
        recomputeOverallStatus(task);
        touchedAssigneeIds = [me.employeeId];
      } else {
        return json(res, 403, { error: 'You can only edit tasks assigned entirely to your own direct reports.' });
      }
    } else if (me.role === 'admin') {
      // admin: full edit, including extending the deadline
      for (const field of ['title', 'client', 'description', 'priority', 'category', 'dueDate', 'dueTime', 'reminderMinutesBefore', 'notes', 'status']) {
        if (field in body) task[field] = body[field];
      }
    } else {
      return json(res, 403, { error: 'Not allowed.' });
    }
    await writeJSON('tasks', tasks);

    if (graph.configured()) {
      const employees = await readJSON('employees', []);
      const targets = touchedAssigneeIds ? task.assignees.filter((a) => touchedAssigneeIds.includes(a.employeeId)) : task.assignees;
      await Promise.all(targets.map(async (a) => {
        const emp = employees.find((e) => e.id === a.employeeId);
        if (!emp || !emp.email) return;
        try {
          if (a.graphEventId) {
            const ok = await graph.updateEventForTask(emp.email, a.graphEventId, task);
            if (!ok) a.graphEventId = await graph.createEventForTask(emp.email, task); // event was deleted upstream -- recreate it
          } else {
            a.graphEventId = await graph.createEventForTask(emp.email, task);
          }
        } catch (e) {
          console.error('GRAPH_UPDATE_EVENT_FAILED', emp.email, e && e.message);
        }
      }));
      await writeJSON('tasks', tasks);
    }

    return json(res, 200, { task });
  }

  if (req.method === 'DELETE') {
    if (me.role !== 'admin' && me.role !== 'manager') return json(res, 403, { error: 'Only an admin or manager can delete tasks.' });
    if (me.role === 'manager') {
      const employees = await readJSON('employees', []);
      if (!allAssigneesReportTo(task, employees, me.managerId)) {
        return json(res, 403, { error: 'You can only delete tasks assigned entirely to your own direct reports.' });
      }
    }
    if (graph.configured()) {
      const employees = await readJSON('employees', []);
      await Promise.all(task.assignees.map(async (a) => {
        const emp = employees.find((e) => e.id === a.employeeId);
        if (!emp || !emp.email || !a.graphEventId) return;
        try { await graph.deleteEvent(emp.email, a.graphEventId); } catch (e) { console.error('GRAPH_DELETE_EVENT_FAILED', emp.email, e && e.message); }
      }));
    }
    await writeJSON('tasks', tasks.filter((t) => t.id !== id));
    return json(res, 200, { ok: true });
  }

  return json(res, 405, { error: 'Method not allowed.' });
};
