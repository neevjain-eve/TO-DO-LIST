// GET /api/managers -> list all managers (admin only)
// POST /api/managers { name, department, username, password, employeeId } -> create (admin only)
// PATCH /api/managers?id=5 { active, department, name, username, employeeId } -> edit (admin only)
// DELETE /api/managers?id=5 -> remove (admin only)
//
// A manager's login is a separate account from any employee login -- but a
// manager can OPTIONALLY be linked to their own employee record via
// `employeeId` (set from the "Linked employee" dropdown next to their name
// in the Manager logins panel). This covers the common case where the same
// real person is both a manager AND someone admin can assign work to
// directly: once linked, work admin assigns to their employee record shows
// up -- and can be marked complete -- from their MANAGER login too (see
// tasks.js), so they don't need to juggle two separate logins to see
// everything on their plate. Who a manager can see/assign as a manager is
// still decided purely by each employee's own `managerId` field, not by
// this link and not by `department`, which remains just an informational
// label.
const { readJSON, writeJSON } = require('./_lib/store');
const { currentUser, hashPassword } = require('./_lib/auth');
const { json, parseBody } = require('./_lib/respond');

module.exports = async (req, res) => {
  const me = currentUser(req);
  if (!me) return json(res, 401, { error: 'Not logged in.' });
  if (me.role !== 'admin') return json(res, 403, { error: 'Only an admin can manage managers.' });

  if (req.method === 'GET') {
    const [managers, users] = await Promise.all([readJSON('managers', []), readJSON('users', [])]);
    const usernameOf = (managerId) => (users.find((u) => u.managerId === managerId) || {}).username || null;
    return json(res, 200, { managers: managers.map((m) => ({ ...m, username: usernameOf(m.id) })) });
  }

  if (req.method === 'POST') {
    const body = parseBody(req);
    const name = (body.name || '').trim();
    const department = (body.department || '').trim();
    if (!name) return json(res, 400, { error: 'Name is required.' });

    // Manager first names very often collide with an existing employee's
    // username (e.g. employee "Naveen Kumar" -> "naveen"). Default to a
    // "manager" suffix (e.g. "naveenmanager") so a fresh manager account
    // never silently fails to be creatable; the admin can still override
    // via body.username.
    const defaultUsername = name.toLowerCase().replace(/\s+/g, '') + 'manager';
    const username = (body.username || defaultUsername).trim().toLowerCase();
    const password = body.password || 'Manager@123';

    const [managers, users, idSeq] = await Promise.all([
      readJSON('managers', []),
      readJSON('users', []),
      readJSON('idSeq', { task: 1, personalTask: 1, employee: 1, manager: 1 }),
    ]);
    if (users.some((u) => u.username === username)) {
      return json(res, 409, { error: `Username "${username}" is already taken.` });
    }

    const id = idSeq.manager || 1;
    const employeeId = body.employeeId ? Number(body.employeeId) : null;
    const manager = { id, name, department, employeeId, active: true, createdAt: new Date().toISOString() };
    managers.push(manager);
    users.push({ id: users.length ? Math.max(...users.map((u) => u.id)) + 1 : 1, username, role: 'manager', managerId: id, passwordHash: hashPassword(password) });
    idSeq.manager = id + 1;

    await Promise.all([writeJSON('managers', managers), writeJSON('users', users), writeJSON('idSeq', idSeq)]);
    return json(res, 201, { manager, username, tempPassword: password });
  }

  const id = Number((req.query || {}).id);
  if (!id) return json(res, 400, { error: 'id query parameter is required.' });

  if (req.method === 'PATCH') {
    const body = parseBody(req);
    const managers = await readJSON('managers', []);
    const mgr = managers.find((m) => m.id === id);
    if (!mgr) return json(res, 404, { error: 'Manager not found.' });
    if (typeof body.active === 'boolean') mgr.active = body.active;
    if (body.department) mgr.department = body.department;
    if (body.name) mgr.name = body.name;
    if ('employeeId' in body) mgr.employeeId = body.employeeId === null || body.employeeId === '' ? null : Number(body.employeeId);
    await writeJSON('managers', managers);

    // Username/password live on the linked `users` entry, not the manager
    // record itself -- update that entry in lockstep when asked to.
    let newUsername = null;
    if (body.username || body.password) {
      const users = await readJSON('users', []);
      const userEntry = users.find((u) => u.managerId === id);
      if (userEntry) {
        if (body.username) {
          const wanted = String(body.username).trim().toLowerCase();
          if (users.some((u) => u.username === wanted && u.managerId !== id)) {
            return json(res, 409, { error: `Username "${wanted}" is already taken.` });
          }
          userEntry.username = wanted;
          newUsername = wanted;
        }
        if (body.password) userEntry.passwordHash = hashPassword(body.password);
        await writeJSON('users', users);
      }
    }

    return json(res, 200, { manager: mgr, username: newUsername });
  }

  if (req.method === 'DELETE') {
    const [managers, users] = await Promise.all([readJSON('managers', []), readJSON('users', [])]);
    await Promise.all([
      writeJSON('managers', managers.filter((m) => m.id !== id)),
      writeJSON('users', users.filter((u) => u.managerId !== id)),
    ]);
    return json(res, 200, { ok: true });
  }

  return json(res, 405, { error: 'Method not allowed.' });
};
