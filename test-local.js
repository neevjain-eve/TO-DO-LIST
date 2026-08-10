// Local logic test: invokes the Netlify Function handlers directly with
// mocked event objects (no real Netlify CLI / deployed site needed).
// Uses the in-memory storage fallback in netlify/lib/store.js so state
// persists across calls within this one Node process, simulating a real
// request lifecycle end to end.
const seedFn = require('./netlify/functions/seed');
const loginFn = require('./netlify/functions/login');
const employeesFn = require('./netlify/functions/employees');
const tasksFn = require('./netlify/functions/tasks');
const personalFn = require('./netlify/functions/personal-tasks');

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { passed++; console.log('PASS:', label); }
  else { failed++; console.log('FAIL:', label); }
}

function evt(method, body, query, token) {
  return {
    httpMethod: method,
    body: body ? JSON.stringify(body) : null,
    queryStringParameters: query || {},
    headers: token ? { authorization: 'Bearer ' + token } : {},
  };
}

async function main() {
  // 1. Seed
  const seedRes = await seedFn.handler(evt('POST', {}));
  const seedBody = JSON.parse(seedRes.body);
  check('seed succeeds', seedRes.statusCode === 200);
  check('seed creates 54 employees', seedBody.employeeCount === 54);

  // 2. Seeding again without force should be rejected
  const seedAgain = await seedFn.handler(evt('POST', {}));
  check('re-seed without force is rejected (409)', seedAgain.statusCode === 409);

  // 3. Admin login
  const adminLoginRes = await loginFn.handler(evt('POST', { username: 'admin', password: 'Admin@123' }));
  const adminLogin = JSON.parse(adminLoginRes.body);
  check('admin login succeeds', adminLoginRes.statusCode === 200 && adminLogin.role === 'admin');
  const adminToken = adminLogin.token;

  // 4. Wrong password rejected
  const badLogin = await loginFn.handler(evt('POST', { username: 'admin', password: 'wrong' }));
  check('wrong password rejected (401)', badLogin.statusCode === 401);

  // 5. Employee login (naveen, from the real roster)
  const naveenLoginRes = await loginFn.handler(evt('POST', { username: 'naveen', password: 'Welcome@123' }));
  const naveenLogin = JSON.parse(naveenLoginRes.body);
  check('naveen login succeeds', naveenLoginRes.statusCode === 200 && naveenLogin.employee.name === 'Naveen Kumar');
  const naveenToken = naveenLogin.token;
  const naveenEmpId = naveenLogin.employee.id;

  // 6. Admin assigns a task to Naveen specifically
  const createTaskRes = await tasksFn.handler(evt('POST', {
    title: 'Prepare GST filing for ABC Traders', priority: 'High', dueDate: '2026-08-15', employeeIds: [naveenEmpId],
  }, {}, adminToken));
  check('admin creates task (201)', createTaskRes.statusCode === 201);
  const createdTask = JSON.parse(createTaskRes.body).task;

  // 7. Employee cannot create tasks
  const empCreateAttempt = await tasksFn.handler(evt('POST', { title: 'x', dueDate: '2026-01-01', employeeIds: [1] }, {}, naveenToken));
  check('employee blocked from creating tasks (403)', empCreateAttempt.statusCode === 403);

  // 8. Naveen sees the assigned task
  const naveenTasksRes = await tasksFn.handler(evt('GET', null, {}, naveenToken));
  const naveenTasks = JSON.parse(naveenTasksRes.body).tasks;
  check('naveen sees his assigned task', naveenTasks.some((t) => t.title === 'Prepare GST filing for ABC Traders'));

  // 9. A DIFFERENT employee should NOT see it
  const anushaLoginRes = await loginFn.handler(evt('POST', { username: 'anusha', password: 'Welcome@123' }));
  const anushaToken = JSON.parse(anushaLoginRes.body).token;
  const anushaTasksRes = await tasksFn.handler(evt('GET', null, {}, anushaToken));
  const anushaTasks = JSON.parse(anushaTasksRes.body).tasks;
  check('anusha (different employee) does NOT see it', !anushaTasks.some((t) => t.title === 'Prepare GST filing for ABC Traders'));

  // 10. Naveen marks it complete
  const completeRes = await tasksFn.handler(evt('PATCH', { status: 'Completed' }, { id: String(createdTask.id) }, naveenToken));
  check('naveen marks task complete (200)', completeRes.statusCode === 200);

  // 11. Admin sees it as Completed now
  const adminTasksRes = await tasksFn.handler(evt('GET', null, {}, adminToken));
  const adminTasks = JSON.parse(adminTasksRes.body).tasks;
  const seenByAdmin = adminTasks.find((t) => t.id === createdTask.id);
  check('admin sees task status = Completed', seenByAdmin.status === 'Completed');

  // 12. Department-wide assignment
  const deptTaskRes = await tasksFn.handler(evt('POST', { title: 'Team audit sync', priority: 'Medium', dueDate: '2026-08-01', department: 'Audit' }, {}, adminToken));
  check('department-wide task created (201)', deptTaskRes.statusCode === 201);
  const deptTask = JSON.parse(deptTaskRes.body).task;
  check('department task has multiple assignees', deptTask.assignees.length > 1);

  // 13. Add employee (admin)
  const addEmpRes = await employeesFn.handler(evt('POST', { name: 'Test New Hire', dept: 'Audit', designation: 'Trainee' }, {}, adminToken));
  check('admin can add a new employee (201)', addEmpRes.statusCode === 201);
  const newEmp = JSON.parse(addEmpRes.body).employee;

  // 14. New employee can log in immediately
  const newEmpLoginRes = await loginFn.handler(evt('POST', { username: 'test.new.hire', password: 'Welcome@123' }));
  check('newly added employee can log in', newEmpLoginRes.statusCode === 200);

  // 15. Employee adds their own "work" item
  const addWorkRes = await personalFn.handler(evt('POST', { title: 'Draft internal memo', priority: 'Low', dueDate: '2026-08-05' }, {}, naveenToken));
  check('employee can add work item (201)', addWorkRes.statusCode === 201);
  const workItem = JSON.parse(addWorkRes.body).personalTask;

  // 16. That work item is private to naveen -- anusha should not see it
  const anushaWorkRes = await personalFn.handler(evt('GET', null, {}, anushaToken));
  const anushaWork = JSON.parse(anushaWorkRes.body).personalTasks;
  check('work items are private per employee', !anushaWork.some((w) => w.title === 'Draft internal memo'));

  // 17. Employee cannot list all employees data mutation (GET is fine, but no admin actions)
  const empDeleteAttempt = await employeesFn.handler(evt('DELETE', null, { id: String(naveenEmpId) }, naveenToken));
  check('employee blocked from deleting employees (403)', empDeleteAttempt.statusCode === 403);

  // 18. Unauthenticated request rejected
  const noAuth = await tasksFn.handler(evt('GET', null, {}, null));
  check('unauthenticated request rejected (401)', noAuth.statusCode === 401);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('TEST CRASHED:', e); process.exit(1); });
