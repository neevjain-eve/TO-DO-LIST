// GET    /api/employees            -> list (any logged-in user; a manager only sees employees explicitly assigned to them)
// POST   /api/employees             { name, dept, client, designation, username, password } -> create (admin only)
// PATCH  /api/employees?id=5        { active: false, dept: '...', client: '...', managerId: 3|null, username, password } -> edit (admin only)
// DELETE /api/employees?id=5                                                          -> remove (admin only)
//
// Who a manager sees is decided purely by employee.managerId -- a direct,
// per-person "reports to" assignment the admin sets from the Employees
// page -- NOT by matching department strings. Department is just an
// informational field on the employee record.
const { readJSON, writeJSON } = require('../lib/store');
const { currentUser, hashPassword } = require('../lib/auth');
const { json, parseBody } = require('../lib/respond');

exports.handler = async (event) => {
  const me = currentUser(event);
  if (!me) return json(401, { error: 'Not logged in.' });

  if (event.httpMethod === 'GET') {
    const employees = await readJSON('employees', []);
    if (me.role === 'manager') {
      return json(200, { employees: employees.filter((e) => e.managerId === me.managerId) });
    }
    return json(200, { employees });
  }

  if (me.role !== 'admin') return json(403, { error: 'Only an admin can manage employees.' });

  if (event.httpMethod === 'POST') {
    const body = parseBody(event);
    const name = (body.name || '').trim();
    const username = (body.username || name.toLowerCase().replace(/\s+/g, '.')).trim().toLowerCase();
    const password = body.password || 'Welcome@123';
    if (!name) return json(400, { error: 'Name is required.' });

    const [employees, users, idSeq] = await Promise.all([
      readJSON('employees', []),
      readJSON('users', []),
      readJSON('idSeq', { task: 1, personalTask: 1, employee: 1 }),
    ]);
    if (users.some((u) => u.username === username)) {
      return json(409, { error: `Username "${username}" is already taken.` });
    }

    const id = idSeq.employee;
    const employee = {
      id, code: 'EMP' + String(id).padStart(3, '0'), name,
      email: body.email || `${username}@pdka.in`,
      dept: body.dept || 'Unassigned', client: body.client || '', designation: body.designation || 'Associate', active: true,
      managerId: body.managerId ? Number(body.managerId) : null,
    };
    employees.push(employee);
    users.push({ id: users.length ? Math.max(...users.map((u) => u.id)) + 1 : 1, username, role: 'employee', employeeId: id, passwordHash: hashPassword(password) });
    idSeq.employee = id + 1;

    await Promise.all([writeJSON('employees', employees), writeJSON('users', users), writeJSON('idSeq', idSeq)]);
    return json(201, { employee, tempPassword: password });
  }

  const id = Number((event.queryStringParameters || {}).id);
  if (!id) return json(400, { error: 'id query parameter is required.' });

  if (event.httpMethod === 'PATCH') {
    const body = parseBody(event);
    const employees = await readJSON('employees', []);
    const emp = employees.find((e) => e.id === id);
    if (!emp) return json(404, { error: 'Employee not found.' });
    if (typeof body.active === 'boolean') emp.active = body.active;
    if (body.dept) emp.dept = body.dept;
    if ('client' in body) emp.client = body.client;
    if (body.designation) emp.designation = body.designation;
    if ('managerId' in body) emp.managerId = body.managerId === null ? null : Number(body.managerId);
    await writeJSON('employees', employees);

    // Username/password live on the linked `users` entry, not the employee
    // record itself -- update that entry in lockstep when asked to (same
    // pattern managers.js uses for manager logins).
    let newUsername = null;
    if (body.username || body.password) {
      const users = await readJSON('users', []);
      const userEntry = users.find((u) => u.employeeId === id);
      if (userEntry) {
        if (body.username) {
          const wanted = String(body.username).trim().toLowerCase();
          if (users.some((u) => u.username === wanted && u.employeeId !== id)) {
            return json(409, { error: `Username "${wanted}" is already taken.` });
          }
          userEntry.username = wanted;
          newUsername = wanted;
        }
        if (body.password) userEntry.passwordHash = hashPassword(body.password);
        await writeJSON('users', users);
      }
    }

    return json(200, { employee: emp, username: newUsername });
  }

  if (event.httpMethod === 'DELETE') {
    const [employees, users] = await Promise.all([readJSON('employees', []), readJSON('users', [])]);
    await Promise.all([
      writeJSON('employees', employees.filter((e) => e.id !== id)),
      writeJSON('users', users.filter((u) => u.employeeId !== id)),
    ]);
    return json(200, { ok: true });
  }

  return json(405, { error: 'Method not allowed.' });
};
