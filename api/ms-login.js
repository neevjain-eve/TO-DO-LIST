// POST /api/ms-login { accessToken } -> sign in with an existing account
// via Microsoft, instead of username/password.
//
// The accessToken is a Microsoft Graph "User.Read" access token obtained
// client-side via MSAL (see the "Sign in with Microsoft" button in
// index.html). We never trust the browser's claim of who signed in --
// this handler calls Microsoft Graph itself with that token to get the
// verified email, so a forged/tampered request can't impersonate someone.
//
// The Microsoft account is matched to an existing username/password
// account by email (falling back to the "<username>@pdka.in" convention
// most accounts already use) -- this does NOT create new accounts. An
// admin still has to create the employee/manager first; this only changes
// *how* that same account signs in.
const { readJSON } = require('./_lib/store');
const { signToken } = require('./_lib/auth');
const { json, parseBody } = require('./_lib/respond');

async function fetchMicrosoftEmail(accessToken) {
  const res = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', {
    headers: { Authorization: 'Bearer ' + accessToken },
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const email = (data && (data.mail || data.userPrincipalName)) || null;
  return email ? String(email).toLowerCase() : null;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST required' });
  const { accessToken } = parseBody(req);
  if (!accessToken) return json(res, 400, { error: 'accessToken is required.' });

  const email = await fetchMicrosoftEmail(accessToken);
  if (!email) return json(res, 401, { error: 'Could not verify your Microsoft sign-in. Please try again.' });
  const localPart = email.split('@')[0];

  const [users, employees, managers] = await Promise.all([
    readJSON('users', []),
    readJSON('employees', []),
    readJSON('managers', []),
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

  const user = users.find((u) => {
    const uEmail = emailOfUser(u);
    if (uEmail && uEmail === email) return true;
    // Fall back to the "<username>@pdka.in" convention used as the default
    // employee email everywhere else in this app.
    return u.username === localPart;
  });

  if (!user) {
    return json(res, 401, {
      error: 'Signed in as ' + email + ', but no matching account was found here. Ask your admin to create your account first.',
    });
  }

  let employee = null;
  if (user.role === 'employee') {
    employee = employees.find((e) => e.id === user.employeeId) || null;
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
