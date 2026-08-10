const { readJSON } = require('../lib/store');
const { verifyPassword, signToken } = require('../lib/auth');
const { json, parseBody } = require('../lib/respond');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST required' });
  const { username, password } = parseBody(event);
  if (!username || !password) return json(400, { error: 'Username and password are required.' });

  const users = await readJSON('users', []);
  const user = users.find((u) => u.username === String(username).toLowerCase());
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return json(401, { error: 'Invalid username or password.' });
  }

  let employee = null;
  if (user.role === 'employee') {
    const employees = await readJSON('employees', []);
    employee = employees.find((e) => e.id === user.employeeId) || null;
    if (employee && employee.active === false) {
      return json(403, { error: 'This account has been deactivated. Contact your administrator.' });
    }
  }

  let manager = null;
  if (user.role === 'manager') {
    const managers = await readJSON('managers', []);
    manager = managers.find((m) => m.id === user.managerId) || null;
    if (manager && manager.active === false) {
      return json(403, { error: 'This manager account has been deactivated. Contact your administrator.' });
    }
  }

  // If this manager is linked to their own employee record (set via the
  // "Linked employee" dropdown on the Employees page), carry that
  // employeeId in the token too -- tasks.js uses it to fold work admin
  // assigned to them AS AN EMPLOYEE into this manager login, so they don't
  // need a second login just to see/complete their own assigned work.
  const linkedEmployeeId = user.role === 'manager' && manager ? manager.employeeId || null : user.employeeId;

  const token = signToken({ userId: user.id, role: user.role, employeeId: linkedEmployeeId, managerId: user.managerId, username: user.username });
  return json(200, { token, role: user.role, username: user.username, employee, manager });
};
