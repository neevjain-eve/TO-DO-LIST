// Cron-triggered route (see vercel.json "crons") -- runs every 15 minutes.
// Pull side of the two-way sync: catches changes an employee makes
// directly in Outlook/Teams (moving the due date, or deleting the event)
// and reflects them back into the task.
//
// Scope note: a task's dueDate is shared across every assignee (e.g. a
// department-wide task). Pulling a date change back only makes
// unambiguous sense for single-assignee tasks, so that's the only case
// this applies a dueDate change automatically. For multi-assignee tasks
// we only track cancellation/deletion, never overwrite the shared date.
const { readJSON, writeJSON } = require('./_lib/store');
const graph = require('./_lib/graph');
const { json } = require('./_lib/respond');

module.exports = async (req, res) => {
  if (!graph.configured()) {
    return json(res, 200, { ok: true, message: 'Microsoft Calendar sync not configured; nothing to do.' });
  }

  const [tasks, employees] = await Promise.all([readJSON('tasks', []), readJSON('employees', [])]);
  const empById = new Map(employees.map((e) => [e.id, e]));
  let changed = false;
  const log = [];

  for (const task of tasks) {
    for (const a of task.assignees) {
      if (!a.graphEventId) continue;
      const emp = empById.get(a.employeeId);
      if (!emp || !emp.email) continue;

      let ev;
      try {
        ev = await graph.getEvent(emp.email, a.graphEventId);
      } catch (e) {
        console.error('SYNC_GET_EVENT_FAILED', emp.email, a.graphEventId, e && e.message);
        continue;
      }
      if (!ev) continue; // transient failure -- try again next run

      if (ev.deleted || ev.isCancelled) {
        // Employee removed it from their calendar. Don't silently
        // recreate it (that would fight the employee) -- just drop the
        // link so a future admin edit will create a fresh event instead
        // of failing against a dead event id.
        a.graphEventId = null;
        log.push(`task ${task.id}: event deleted in Outlook by ${emp.email}, unlinked`);
        changed = true;
        continue;
      }

      if (ev.start && ev.start.dateTime && task.assignees.length === 1) {
        const outlookDate = ev.start.dateTime.slice(0, 10); // 'YYYY-MM-DD'
        if (outlookDate !== task.dueDate) {
          task.dueDate = outlookDate;
          log.push(`task ${task.id}: due date updated from Outlook (${emp.email}) to ${outlookDate}`);
          changed = true;
        }
      }
    }
  }

  if (changed) await writeJSON('tasks', tasks);
  return json(res, 200, { ok: true, changes: log });
};
