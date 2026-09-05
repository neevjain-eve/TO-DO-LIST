// POST /api/ms-login { accessToken } -> sign in with Microsoft.
//
// The accessToken is a Microsoft Graph "User.Read" access token obtained
// client-side via MSAL (see the "Sign in with Microsoft" button in
// index.html). We never trust the browser's claim of who signed in --
// this handler calls Microsoft Graph itself with that token to get the
// verified email, so a forged/tampered request can't impersonate someone.
//
// The Microsoft account is matched to an existing account by email
// (falling back to the "<username>@pdka.in" convention most accounts
// already use). If nothing matches, a new employee account is
// auto-provisioned with the lowest-privilege role ("employee") -- no
// admin has to pre-create the account. Since the shared Azure AD app is
// single-tenant, only people who already have a real account in our
// Microsoft tenant can ever reach this point, so auto-provisioning here
// doesn't open the door to outsiders. An admin can still edit/deactivate
// or promote the new account afterwards from the Employees page.
const { readJSON, writeJSON } = require('./_lib/store');
const { signToken, hashPassword } = require('./_lib/auth');
const { json, parseBody } = require('./_lib/respond');
const crypto = require('crypto');

async function fetchMicrosoftProfile(accessToken) {
  const res = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName', {
    headers: { Authorization: 'Bearer ' + accessToken },
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  if (!data) return null;
  const email = (data.mail || data.userPrincipalName) || null;
  if (!email) return null;
  return { email: String(email).toLowerCase(), name: data.displayName || null };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST required' });
  const { accessToken } = parseBody(req);
  if (!accessToken) return json(res, 400, { error: 'accessToken is required.' });

  const profile = await fetchMicrosoftProfile(accessToken);
  if (!profile) return json(res, 401, { error: 'Could not verify your Microsoft sign-in. Please try again.' });
  const { email } = profile;
  const localPart = email.split('@')[0];

  const [users, employees, managers, idSeq] = await Promise.all([
    readJSON('users', []),
    readJSON('employees', []),
    readJSON('managers', []),
    readJSON('idSeq', { task: 1, personalTask: 1, employee: 1 }),
  ]);

  function emailOfUser(u) {
    if (u.role === 'employee') {
      const emp = employees.find((e) => e.id === u.employeeId);
      return (emp && emp.email) ? emp.email.toLowerCase() : null;
    }
    if (u.role === 'manager') {
      const mgr = managers.find((m) => m.id === u.managerId);
      const linkedEmp = mgr && mgr.employeeId ? employees.find((e) => e.id === mgr.employeeId) : null;
      return linkedEmp && linkedEmp.email ? linkedEmp.email.toLowerCase() : null;
    }
    return null; // admin has no employee record
  }

  let user = users.find((u) => {
    const uEmail = emailOfUser(u);
    if (uEmail && uEmail === email) return true;
    // Fall back to the "<username>@pdka.in" convention used as the default
    // employee email everywhere else in this app.
    return u.username === localPart;
  });

  let employee = null;

  if (!user) {
    // Auto-provision: new employee record + user record, lowest-privilege role.
    const id = idSeq.employee;
    employee = {
      id, code: 'EMP' + String(id).padStart(3, '0'),
      name: profile.name || localPart,
      email, dept: 'Unassigned', client: '', designation: 'Associate', active: true,
      managerId: null,
    };
    employees.push(employee);
    idSeq.employee = id + 1;

    let username = localPart;
    if (users.some((u) => u.username === username)) {
      username = username + id; // avoid collision with an existing username
    }
    user = {
      id: users.length ? Math.max(...users.map((u) => u.id)) + 1 : 1,
      username, role: 'employee', employeeId: id,
      // Random, unknown password -- this account only ever signs in via
      // Microsoft unless an admin resets its password later.
      passwordHash: hashPassword(crypto.randomBytes(24).toString('hex')),
    };
    users.push(user);

    await Promise.all([
      writeJSON('employees', employees),
      writeJSON('users', users),
      writeJSON('idSeq', idSeq),
    ]);
  }

  if (user.role === 'employee') {
    employee = employee || employees.find((e) => e.id === user.employeeId) || null;
    if (employee && employee.active === false) {
      return json(res, 403, { error: 'This account has been deactivated. Contact your administrator.' });
    }
  }

  let manager = null;
  if (user.role === 'manager') {
    manager = managers.find((m) => m.id === user.managerId) || null;
    if (manager && manager.active === false) {
      return json(res, 403, { error: 'This manager account has been deactivated. Contact your administrator.' });
    }
  }

  const linkedEmployeeId = user.role === 'manager' && manager ? manager.employeeId || null : user.employeeId;
  const token = signToken({ userId: user.id, role: user.role, employeeId: linkedEmployeeId, managerId: user.managerId, username: user.username });
  return json(res, 200, { token, role: user.role, username: user.username, employee, manager });
};
