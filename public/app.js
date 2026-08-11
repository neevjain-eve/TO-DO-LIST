window.addEventListener('error', function (e) {
  var el = document.getElementById('jsErr');
  if (!el) { el = document.createElement('div'); el.id = 'jsErr';
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#EF4444;color:#fff;padding:8px 14px;font:12px monospace;z-index:9999;';
    document.body.prepend(el); }
  el.textContent = 'Script error: ' + e.message + ' (line ' + e.lineno + ')';
});

var session = JSON.parse(localStorage.getItem('etm_session') || 'null');

function api(path, opts) {
  opts = opts || {};
  var headers = { 'Content-Type': 'application/json' };
  if (session && session.token) headers.Authorization = 'Bearer ' + session.token;
  return fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }).then(function (r) {
    return r.json().then(function (data) {
      if (!r.ok) {
        var err = new Error(data.error || ('Request failed (' + r.status + ')'));
        err.status = r.status;
        throw err;
      }
      return data;
    });
  });
}

function showLoginErr(msg) { var el = document.getElementById('loginErr'); el.textContent = msg; el.classList.remove('hidden'); document.getElementById('loginOk').classList.add('hidden'); }
function showLoginOk(msg) { var el = document.getElementById('loginOk'); el.textContent = msg; el.classList.remove('hidden'); document.getElementById('loginErr').classList.add('hidden'); }

document.getElementById('seedBtn').addEventListener('click', function () {
  api('/seed', { method: 'POST', body: {} }).then(function (data) {
    showLoginOk('Ready. Admin login: admin / Admin@123. Employee login: any username (e.g. anusha) / Welcome@123.');
  }).catch(function (e) { showLoginErr(e.message); });
});

document.getElementById('signInBtn').addEventListener('click', function () {
  var u = document.getElementById('u').value.trim();
  var p = document.getElementById('p').value;
  if (!u || !p) { showLoginErr('Enter both a username and a password.'); return; }
  api('/login', { method: 'POST', body: { username: u, password: p } }).then(function (data) {
    session = data;
    localStorage.setItem('etm_session', JSON.stringify(session));
    enterApp();
  }).catch(function (e) { showLoginErr(e.message); });
});

document.getElementById('logoutBtn').addEventListener('click', function () {
  session = null;
  localStorage.removeItem('etm_session');
  document.getElementById('appScreen').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('u').value = ''; document.getElementById('p').value = '';
});

var adminNav = [['adminDashboard', 'Dashboard'], ['adminEmployees', 'Employees'], ['adminTasks', 'Tasks'], ['calendar', 'Calendar']];
// A manager reuses the exact same Dashboard/Tasks pages as admin -- the
// backend already scopes /api/employees and /api/tasks to whichever
// employees have this manager set as their managerId, so no separate
// manager-only markup is needed. Only the nav label ("Team tasks" instead
// of "Tasks") and a couple of headings differ; that's handled in
// renderAdminDashboard() by checking session.role. There's no standalone
// "Managers" page -- manager logins are created/edited from a collapsible
// panel at the top of the Employees page instead.
var managerNav = [['adminDashboard', 'Dashboard'], ['adminEmployees', 'My team'], ['adminTasks', 'Team tasks'], ['addWork', 'Add work'], ['calendar', 'Calendar']];
var employeeNav = [['employeeDashboard', 'Dashboard'], ['myTasks', 'My tasks'], ['addWork', 'Add work'], ['calendar', 'Calendar']];

function enterApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = 'block';
  document.getElementById('avatar').textContent = session.username[0].toUpperCase();
  document.getElementById('whoami').textContent = session.username + ' (' + session.role + ')';
  var nav = session.role === 'admin' ? adminNav : session.role === 'manager' ? managerNav : employeeNav;
  document.getElementById('nav').innerHTML = nav.map(function (n) {
    return '<a data-page="' + n[0] + '" id="nav-' + n[0] + '">' + n[1] + '</a>';
  }).join('');
  document.querySelectorAll('#nav a').forEach(function (a) { a.addEventListener('click', function () { showPage(a.dataset.page); }); });
  showPage(session.role === 'employee' ? 'employeeDashboard' : 'adminDashboard');
}

function showPage(key) {
  document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
  var el = document.getElementById('page-' + key);
  if (el) el.classList.add('active');
  document.querySelectorAll('#nav a').forEach(function (a) { a.classList.toggle('active', a.dataset.page === key); });
  if (key === 'adminDashboard') renderAdminDashboard();
  if (key === 'adminEmployees') renderEmployees();
  if (key === 'adminTasks') renderAdminTasks();
  if (key === 'calendar') renderCalendar();
  if (key === 'employeeDashboard') renderEmployeeDashboard();
  if (key === 'myTasks') renderMyTasks();
  if (key === 'addWork') renderAddWork();
}

function priBadge(p) { return 'badge b-' + (p || 'medium').toLowerCase(); }
function statBadge(s) { return 'badge ' + (s === 'Pending' ? 's-pending' : s === 'In Progress' ? 's-progress' : 's-completed'); }
function isOverdue(t) { var due = t.dueDate; return t.status !== 'Completed' && due && new Date(due) < new Date(new Date().toDateString()); }
function fmt(d) { return d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '-'; }
function syncBadge(t) {
  var synced = t.assignees && t.assignees.some(function (a) { return a.graphEventId; });
  return synced ? ' <span title="Synced to Outlook/Teams calendar" style="font-size:11px;color:#0078D4;">&#128197;</span>' : '';
}

/* ---------------- Admin dashboard (also reused, scoped, for managers) ---------------- */
function renderAdminDashboard() {
  var isManager = session.role === 'manager';
  var deptLabel = isManager && session.manager ? ' (' + session.manager.department + ')' : '';
  var headingEl = document.getElementById('dashHeading');
  if (headingEl) headingEl.textContent = isManager ? 'Manager dashboard' + deptLabel : 'Admin dashboard';
  var recentHeadingEl = document.getElementById('recentTasksHeading');
  if (recentHeadingEl) recentHeadingEl.textContent = isManager ? 'Recent team tasks' : 'Recent tasks';

  // /api/employees and /api/tasks are already scoped to the manager's own
  // department server-side, so this exact same code (and the same
  // "adminTasks" page it links to) works unmodified for both roles. A
  // manager's own self-assigned "Add work" items are folded in here too,
  // so the dashboard reflects everything on their plate -- delegated AND
  // self-assigned -- just like it already does for employees.
  var workPromise = isManager ? api('/personal-tasks') : Promise.resolve({ personalTasks: [] });
  Promise.all([api('/employees'), api('/tasks'), workPromise]).then(function (r) {
    var employees = r[0].employees, tasks = r[1].tasks;
    var workAsTasks = ((r[2] && r[2].personalTasks) || []).map(function (t) {
      return { id: 'work-' + t.id, title: t.title, priority: t.priority, dueDate: t.dueDate, status: t.status, assignees: [{ name: 'You' }] };
    });
    var combined = tasks.concat(workAsTasks);
    var completed = combined.filter(function (t) { return t.status === 'Completed'; }).length;
    var pending = combined.filter(function (t) { return t.status === 'Pending'; }).length;
    var overdue = combined.filter(isOverdue).length;
    // [color, value, label, page to jump to when clicked]
    var stats = [
      ['#F472B6', employees.length, isManager ? 'Team size' : 'Total employees', 'adminEmployees'],
      ['#38BDF8', employees.filter(function (e) { return e.active; }).length, isManager ? 'Active team members' : 'Active employees', 'adminEmployees'],
      ['#F59E0B', pending, 'Pending tasks', 'adminTasks'],
      ['#22C55E', completed, 'Completed tasks', 'adminTasks'],
      ['#EF4444', overdue, 'Overdue tasks', 'adminTasks'],
    ];
    document.getElementById('adminStats').innerHTML = stats.map(function (s) {
      return '<div class="stat" data-nav="' + s[3] + '" style="background:' + s[0] + '"><div class="v">' + s[1] + '</div><div class="l">' + s[2] + '</div></div>';
    }).join('');
    document.getElementById('recentBody').innerHTML = combined.slice(-8).reverse().map(function (t) {
      var names = t.assignees.map(function (a) { return a.name; }).join(', ');
      return '<tr class="clickable' + (isOverdue(t) ? ' overdue' : '') + '" data-nav="adminTasks"><td>' + t.title + '</td><td style="font-size:11px;color:var(--muted)">' + names + '</td><td><span class="' + priBadge(t.priority) + '">' + t.priority + '</span></td><td><span class="' + statBadge(t.status) + '">' + t.status + '</span></td></tr>';
    }).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--muted)">No tasks yet.</td></tr>';
    bindNavClicks(document.getElementById('adminStats'));
    bindNavClicks(document.getElementById('recentBody'));
  }).catch(showFatal);
}

// Wires up any [data-nav] element inside `root` to jump to that page on click.
function bindNavClicks(root) {
  root.querySelectorAll('[data-nav]').forEach(function (el) {
    el.addEventListener('click', function () { showPage(el.dataset.nav); });
  });
}
/* ---------------- Employees (read-only "My team" view when role=manager) ----------------
   The "Manager logins" mini-panel and the per-employee "Manager" dropdown
   both live on this page now -- there's no separate Managers tab. Admin
   creates/renames/deactivates manager logins in the collapsible panel,
   then assigns each employee to one of those managers via the dropdown
   next to their name; that assignment (employee.managerId) is the ONLY
   thing that decides what a manager can see. */
var employeesCache = [];
var managersCache = [];

function renderEmployees() {
  var isManager = session.role === 'manager';
  var addBtn = document.getElementById('showAddEmployee');
  if (addBtn) addBtn.classList.toggle('hidden', isManager);
  var heading = document.querySelector('#page-adminEmployees h2');
  if (heading) heading.textContent = isManager ? 'My team' : 'Employees';
  var mgrCard = document.getElementById('managerLoginsCard');
  if (mgrCard) mgrCard.classList.toggle('hidden', isManager); // managers can't manage manager logins

  // A manager isn't allowed to call GET /api/managers (admin-only), so only
  // fetch it when we're actually going to use it.
  var employeesPromise = api('/employees');
  var managersPromise = isManager ? Promise.resolve({ managers: [] }) : api('/managers');

  Promise.all([employeesPromise, managersPromise]).then(function (r) {
    employeesCache = r[0].employees;
    managersCache = r[1].managers;

    if (!isManager) renderManagerLoginsPanel();

    document.getElementById('empBody').innerHTML = employeesCache.map(function (e) {
      var emailCell = '<td style="font-size:12px;color:var(--muted);">' + (e.email || '-') + '</td>';
      var usernameCell = '<td style="font-family:monospace;font-size:12px;">' + (e.username || '-') + '</td>';
      if (isManager) {
        // Managers can see their team but not edit it -- no manager-change
        // dropdown, no client-change, no activate/deactivate/delete controls,
        // no password controls.
        return '<tr><td>' + e.code + '</td><td>' + e.name + '</td>' + emailCell + usernameCell + '<td>-</td><td>' + (e.client || '-') + '</td>' +
          '<td><span class="badge ' + (e.active ? 's-completed' : 'b-low') + '">' + (e.active ? 'Active' : 'Inactive') + '</span></td><td></td></tr>';
      }
      var mgrSelect = '<select data-mgr-assign="' + e.id + '" style="width:auto;display:inline-block;font-size:11px;padding:4px 6px;">' +
        '<option value=""' + (!e.managerId ? ' selected' : '') + '>&mdash; none &mdash;</option>' +
        managersCache.map(function (m) { return '<option value="' + m.id + '"' + (e.managerId === m.id ? ' selected' : '') + '>' + m.name + '</option>'; }).join('') +
        '</select>';
      var clientCell = '<td><input data-client="' + e.id + '" value="' + (e.client || '').replace(/"/g, '&quot;') + '" placeholder="&mdash; none &mdash;" style="width:110px;font-size:11px;padding:4px 6px;"></td>';
      return '<tr><td>' + e.code + '</td><td>' + e.name + '</td>' + emailCell + usernameCell + '<td>' + mgrSelect + '</td>' + clientCell +
        '<td><span class="badge ' + (e.active ? 's-completed' : 'b-low') + '">' + (e.active ? 'Active' : 'Inactive') + '</span></td>' +
        '<td><button class="btn btn-sm" data-toggle="' + e.id + '" data-active="' + e.active + '">' + (e.active ? 'Deactivate' : 'Activate') + '</button> ' +
        '<button class="btn btn-sm" data-emp-pw="' + e.id + '">Change password</button> ' +
        '<button class="btn btn-sm btn-outline-danger" data-del="' + e.id + '">Delete</button></td></tr>';
    }).join('');
    document.querySelectorAll('[data-client]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        api('/employees?id=' + inp.dataset.client, { method: 'PATCH', body: { client: inp.value.trim() } }).catch(showFatal);
      });
    });
    document.querySelectorAll('[data-toggle]').forEach(function (b) {
      b.addEventListener('click', function () {
        api('/employees?id=' + b.dataset.toggle, { method: 'PATCH', body: { active: b.dataset.active !== 'true' } }).then(renderEmployees).catch(showFatal);
      });
    });
    document.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!confirm('Delete this employee? Their login will stop working.')) return;
        api('/employees?id=' + b.dataset.del, { method: 'DELETE' }).then(renderEmployees).catch(showFatal);
      });
    });
    document.querySelectorAll('[data-emp-pw]').forEach(function (b) {
      b.addEventListener('click', function () {
        var next = prompt('New password for this employee:');
        if (!next || !next.trim()) return;
        api('/employees?id=' + b.dataset.empPw, { method: 'PATCH', body: { password: next.trim() } })
          .then(function () { alert('Password updated.'); })
          .catch(showFatal);
      });
    });
    document.querySelectorAll('[data-mgr-assign]').forEach(function (s) {
      s.addEventListener('change', function () {
        var managerId = s.value ? Number(s.value) : null;
        api('/employees?id=' + s.dataset.mgrAssign, { method: 'PATCH', body: { managerId: managerId } }).then(renderEmployees).catch(showFatal);
      });
    });
  }).catch(showFatal);
}
document.getElementById('showAddEmployee').addEventListener('click', function () { document.getElementById('addEmployeePanel').classList.toggle('hidden'); });
document.getElementById('neSave').addEventListener('click', function () {
  var name = document.getElementById('neName').value.trim();
  if (!name) { alert('Full name is required.'); return; }
  api('/employees', { method: 'POST', body: { name: name, dept: document.getElementById('neDept').value, designation: document.getElementById('neDesignation').value } })
    .then(function (r) {
      alert('Employee created. Temporary login: ' + name.toLowerCase().replace(/\s+/g, '.') + ' / ' + r.tempPassword);
      document.getElementById('neName').value = ''; document.getElementById('neDept').value = ''; document.getElementById('neDesignation').value = '';
      document.getElementById('addEmployeePanel').classList.add('hidden');
      renderEmployees();
    }).catch(showFatal);
});

/* ---------------- Manager logins panel (embedded in the Employees page, admin only) ---------------- */
document.getElementById('toggleManagerPanel').addEventListener('click', function () {
  var panel = document.getElementById('managerLoginsPanel');
  var caret = document.getElementById('mgrPanelCaret');
  panel.classList.toggle('hidden');
  caret.innerHTML = panel.classList.contains('hidden') ? '&#9656;' : '&#9662;';
});

function renderManagerLoginsPanel() {
  // "Linked employee" lets admin tie this manager login to the same real
  // person's own employee record (e.g. "naveenmanager" <-> employee "Naveen
  // Kumar"), so admin-assigned work on that employee record also shows up
  // -- and can be marked complete -- from the manager login (see tasks.js).
  document.getElementById('mgrBody').innerHTML = managersCache.map(function (m) {
    var linkSelect = '<select data-mgr-link="' + m.id + '" style="width:auto;display:inline-block;font-size:11px;padding:4px 6px;">' +
      '<option value=""' + (!m.employeeId ? ' selected' : '') + '>&mdash; none &mdash;</option>' +
      employeesCache.map(function (e) { return '<option value="' + e.id + '"' + (m.employeeId === e.id ? ' selected' : '') + '>' + e.name + '</option>'; }).join('') +
      '</select>';
    return '<tr><td>' + m.name + '</td><td style="font-family:monospace;font-size:12px;">' + (m.username || '-') + '</td><td>' + (m.department || '-') + '</td>' +
      
      '<td><span class="badge ' + (m.active ? 's-completed' : 'b-low') + '">' + (m.active ? 'Active' : 'Inactive') + '</span></td>' +
      '<td><button class="btn btn-sm" data-mgr-rename="' + m.id + '" data-current="' + (m.username || '') + '">Rename login</button> ' +
      '<button class="btn btn-sm" data-mgr-pw="' + m.id + '">Change password</button> ' +
      '<button class="btn btn-sm" data-mgr-toggle="' + m.id + '" data-active="' + m.active + '">' + (m.active ? 'Deactivate' : 'Activate') + '</button> ' +
      '<button class="btn btn-sm btn-outline-danger" data-mgr-del="' + m.id + '">Delete</button></td></tr>';
  }).join('') || '<tr><td </td></tr>';
  document.querySelectorAll('[data-mgr-link]').forEach(function (s) {
    s.addEventListener('change', function () {
      var employeeId = s.value ? Number(s.value) : null;
      api('/managers?id=' + s.dataset.mgrLink, { method: 'PATCH', body: { employeeId: employeeId } }).then(renderEmployees).catch(showFatal);
    });
  });
  document.querySelectorAll('[data-mgr-toggle]').forEach(function (b) {
    b.addEventListener('click', function () {
      api('/managers?id=' + b.dataset.mgrToggle, { method: 'PATCH', body: { active: b.dataset.active !== 'true' } }).then(renderEmployees).catch(showFatal);
    });
  });
  document.querySelectorAll('[data-mgr-del]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (!confirm('Delete this manager? Their login will stop working, and any employees assigned to them will show "— none —" until reassigned.')) return;
      api('/managers?id=' + b.dataset.mgrDel, { method: 'DELETE' }).then(renderEmployees).catch(showFatal);
    });
  });
  document.querySelectorAll('[data-mgr-rename]').forEach(function (b) {
    b.addEventListener('click', function () {
      var next = prompt('New login username for this manager:', b.dataset.current);
      if (!next || next.trim() === '' || next.trim() === b.dataset.current) return;
      api('/managers?id=' + b.dataset.mgrRename, { method: 'PATCH', body: { username: next.trim() } }).then(renderEmployees).catch(showFatal);
    });
  });
  document.querySelectorAll('[data-mgr-pw]').forEach(function (b) {
    b.addEventListener('click', function () {
      var next = prompt('New password for this manager:');
      if (!next || !next.trim()) return;
      api('/managers?id=' + b.dataset.mgrPw, { method: 'PATCH', body: { password: next.trim() } })
        .then(function () { alert('Password updated.'); })
        .catch(showFatal);
    });
  });
}
document.getElementById('showAddManager').addEventListener('click', function (e) {
  e.stopPropagation(); // don't also trigger the panel-collapse toggle
  document.getElementById('managerLoginsPanel').classList.remove('hidden');
  document.getElementById('mgrPanelCaret').innerHTML = '&#9662;';
  document.getElementById('addManagerPanel').classList.toggle('hidden');
});
document.getElementById('nmSave').addEventListener('click', function () {
  var name = document.getElementById('nmName').value.trim();
  if (!name) { alert('Full name is required.'); return; }
  var department = document.getElementById('nmDept').value.trim();
  api('/managers', { method: 'POST', body: { name: name, department: department } })
    .then(function (r) {
      alert('Manager created. Temporary login: ' + r.username + ' / ' + r.tempPassword);
      document.getElementById('nmName').value = '';
      document.getElementById('nmDept').value = '';
      document.getElementById('addManagerPanel').classList.add('hidden');
      renderEmployees();
    }).catch(showFatal);
});
/* ---------------- Admin tasks ---------------- */
var assignEmployeesCache = [];
var selectedAssigneeIds = new Set();

// Rebuilds the "Assign to" option list from assignEmployeesCache, filtered
// by the search box text, while keeping selections that persist even for
// employees currently scrolled/filtered out of view.
function renderAssigneeOptions(filterText) {
  var q = (filterText || '').trim().toLowerCase();
  var filtered = assignEmployeesCache.filter(function (e) { return !q || e.name.toLowerCase().indexOf(q) !== -1; });
  var sel = document.getElementById('ntAssignees');
  sel.innerHTML = filtered.map(function (e) {
    return '<option value="' + e.id + '"' + (selectedAssigneeIds.has(e.id) ? ' selected' : '') + '>' + e.name + ' (' + e.dept + ')</option>';
  }).join('') || '<option disabled>No employees match "' + filterText + '".</option>';
  updateSelectedCount();
}
function updateSelectedCount() {
  var el = document.getElementById('ntAssigneeSelectedCount');
  if (!el) return;
  el.textContent = selectedAssigneeIds.size ? selectedAssigneeIds.size + ' selected' : '';
}
document.getElementById('ntAssigneeSearch').addEventListener('input', function () { renderAssigneeOptions(this.value); });
document.getElementById('ntAssignees').addEventListener('change', function () {
  Array.from(this.options).forEach(function (o) {
    var id = Number(o.value);
    if (o.selected) selectedAssigneeIds.add(id); else selectedAssigneeIds.delete(id);
  });
  updateSelectedCount();
});

function renderAdminTasks() {
  var isManager = session.role === 'manager';
  var workPromise = isManager ? api('/personal-tasks') : Promise.resolve({ personalTasks: [] });
  Promise.all([api('/tasks'), api('/employees'), workPromise]).then(function (r) {
    var tasks = r[0].tasks, employees = r[1].employees, work = (r[2] && r[2].personalTasks) || [];
    var reportIds = new Set(employees.map(function (e) { return e.id; })); // for a manager, /api/employees is already scoped to just their own reports
    var taskRows = tasks.slice().reverse().map(function (t) {
      var names = t.assignees.map(function (a) { return a.name; }).join(', ');
      // t.myStatus is only present when this manager is personally an
      // assignee (their own linked employee record, see managers.js) --
      // give them a way to mark it complete right from Team tasks, instead
      // of needing a separate employee login. If EVERY assignee on the task
      // is one of their direct reports they still get full edit/delete
      // rights as usual; a task assigned only to their own linked record
      // (not a "report") only offers Mark complete, matching what the
      // backend actually allows (tasks.js).
      var hasOwnWork = isManager && t.myStatus !== undefined;
      var isFullReportsTask = !isManager || t.assignees.every(function (a) { return reportIds.has(a.employeeId); });
      var actionCell = '';
      if (hasOwnWork && t.myStatus !== 'Completed') actionCell += '<button class="btn btn-sm" data-complete-own="' + t.id + '">Mark complete</button> ';
      if (isFullReportsTask) actionCell += '<button class="btn btn-sm btn-outline-danger" data-del="' + t.id + '">Delete</button>';
      return '<tr' + (isOverdue(t) ? ' class="overdue"' : '') + '><td>' + t.title + syncBadge(t) + (hasOwnWork ? ' <span class="badge b-low" style="font-size:10px;">Assigned to you</span>' : '') + '</td><td style="font-size:12px;color:var(--muted)">' + (t.client || '-') + '</td><td style="font-size:11px;color:var(--muted)">' + names + '</td>' +
        '<td><span class="' + priBadge(t.priority) + '">' + t.priority + '</span></td><td>' + fmt(t.dueDate) + '</td><td><span class="' + statBadge(hasOwnWork ? t.myStatus : t.status) + '">' + (hasOwnWork ? t.myStatus : t.status) + '</span></td>' +
        '<td>' + actionCell + '</td></tr>';
    });
    // A manager's own "Add work" items (self-assigned) show up in this same
    // list, tagged "You", so Team tasks is the one place to see everything
    // on their plate -- what they've delegated AND what they're doing themselves.
    var workRows = work.slice().reverse().map(function (t) {
      var overdue = t.status !== 'Completed' && t.dueDate && new Date(t.dueDate) < new Date(new Date().toDateString());
      return '<tr' + (overdue ? ' class="overdue"' : '') + '><td>' + t.title + (t.description ? '<div class="desc-text">' + t.description + '</div>' : '') + '</td><td>-</td><td style="font-size:11px;color:var(--muted)">You</td>' +
        '<td><span class="' + priBadge(t.priority) + '">' + t.priority + '</span></td><td>' + fmt(t.dueDate) + '</td><td><span class="' + statBadge(t.status) + '">' + t.status + '</span></td>' +
        '<td>' + (t.status === 'Completed' ? '' : '<button class="btn btn-sm" data-complete-personal="' + t.id + '">Mark complete</button> ') + '<button class="btn btn-sm btn-outline-danger" data-del-personal="' + t.id + '">Delete</button></td></tr>';
    });
    document.getElementById('taskBody').innerHTML = taskRows.concat(workRows).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--muted)">No tasks yet.</td></tr>';
    document.querySelectorAll('#taskBody [data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!confirm('Delete this task?')) return;
        api('/tasks?id=' + b.dataset.del, { method: 'DELETE' }).then(renderAdminTasks).catch(showFatal);
      });
    });
    document.querySelectorAll('#taskBody [data-complete-own]').forEach(function (b) {
      b.addEventListener('click', function () {
        api('/tasks?id=' + b.dataset.completeOwn, { method: 'PATCH', body: { status: 'Completed' } }).then(renderAdminTasks).catch(showFatal);
      });
    });
    document.querySelectorAll('#taskBody [data-del-personal]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!confirm('Delete this work item?')) return;
        api('/personal-tasks?id=' + b.dataset.delPersonal, { method: 'DELETE' }).then(renderAdminTasks).catch(showFatal);
      });
    });
    document.querySelectorAll('#taskBody [data-complete-personal]').forEach(function (b) {
      b.addEventListener('click', function () {
        api('/personal-tasks?id=' + b.dataset.completePersonal, { method: 'PATCH', body: { status: 'Completed' } }).then(renderAdminTasks).catch(showFatal);
      });
    });
    var deptSet = Array.from(new Set(employees.map(function (e) { return e.dept; }))).filter(Boolean);
    assignEmployeesCache = employees;
    renderAssigneeOptions(document.getElementById('ntAssigneeSearch').value);
    document.getElementById('ntDept').innerHTML = '<option value="">&mdash; none &mdash;</option>' + deptSet.map(function (d) { return '<option>' + d + '</option>'; }).join('');
  }).catch(showFatal);
}
document.getElementById('showAddTask').addEventListener('click', function () {
  document.getElementById('addTaskPanel').classList.toggle('hidden');
});
document.getElementById('ntSave').addEventListener('click', function () {
  var title = document.getElementById('ntTitle').value.trim();
  if (!title) { alert('Title is required.'); return; }
  var dept = document.getElementById('ntDept').value;
  var employeeIds = Array.from(selectedAssigneeIds);
  if (!dept && !employeeIds.length) { alert('Pick at least one employee, or a whole department.'); return; }
  var body = { title: title, client: document.getElementById('ntClient').value.trim(), priority: document.getElementById('ntPriority').value, dueDate: document.getElementById('ntDue').value };
  if (dept) body.department = dept; else body.employeeIds = employeeIds;
  api('/tasks', { method: 'POST', body: body }).then(function () {
    document.getElementById('ntTitle').value = '';
    document.getElementById('ntClient').value = '';
    document.getElementById('ntAssigneeSearch').value = '';
    selectedAssigneeIds = new Set();
    document.getElementById('addTaskPanel').classList.add('hidden');
    renderAdminTasks();
  }).catch(showFatal);
});

/* ---------------- Employee dashboard / my tasks ---------------- */
function overdueOf(x) { return x.status !== 'Completed' && x.dueDate && new Date(x.dueDate) < new Date(new Date().toDateString()); }

function renderEmployeeDashboard() {
  document.getElementById('empName').textContent = session.employee ? session.employee.name : session.username;
  // The dashboard should reflect everything on your plate -- tasks your
  // manager assigned you AND your own "Add work" items -- not just one or
  // the other, so it matches what My tasks shows.
  Promise.all([api('/tasks'), api('/personal-tasks')]).then(function (r) {
    var assigned = r[0].tasks.map(function (t) {
      return { title: t.title, priority: t.priority, dueDate: t.dueDate, status: t.myStatus, kind: 'task' };
    });
    var work = r[1].personalTasks.map(function (t) {
      return { title: t.title, priority: t.priority, dueDate: t.dueDate, status: t.status, kind: 'work' };
    });
    var all = assigned.concat(work).sort(function (a, b) {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate) - new Date(b.dueDate);
    });
    var completed = all.filter(function (x) { return x.status === 'Completed'; }).length;
    var overdue = all.filter(overdueOf).length;
    var stats = [['#2563EB', all.length, 'My tasks', 'myTasks'], ['#22C55E', completed, 'Completed', 'myTasks'], ['#EF4444', overdue, 'Overdue', 'myTasks']];
    document.getElementById('empStats').innerHTML = stats.map(function (s) {
      return '<div class="stat" data-nav="' + s[3] + '" style="background:' + s[0] + '"><div class="v">' + s[1] + '</div><div class="l">' + s[2] + '</div></div>';
    }).join('');
    document.getElementById('empDashBody').innerHTML = all.slice(0, 8).map(function (x) {
      return '<tr class="clickable' + (overdueOf(x) ? ' overdue' : '') + '" data-nav="myTasks"><td>' + x.title + '</td><td><span class="' + priBadge(x.priority) + '">' + x.priority + '</span></td><td>' + fmt(x.dueDate) + '</td><td><span class="' + statBadge(x.status) + '">' + x.status + '</span></td></tr>';
    }).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--muted)">No tasks assigned yet.</td></tr>';
    bindNavClicks(document.getElementById('empStats'));
    bindNavClicks(document.getElementById('empDashBody'));
  }).catch(showFatal);
}

function renderMyTasks() {
  Promise.all([api('/tasks'), api('/personal-tasks')]).then(function (r) {
    var myDept = session.employee ? session.employee.dept : '-';
    var assignedRows = r[0].tasks.map(function (t) {
      var dept = t.department || myDept || '-'; // department-wide tasks carry their own dept; individual ones fall back to your own
      return '<tr' + (isOverdue(t) ? ' class="overdue"' : '') + '>' +
        '<td>' + t.title + syncBadge(t) + (t.description ? '<div class="desc-text">' + t.description + '</div>' : '') + '</td>' +
        '<td>' + (t.createdBy || '-') + '</td>' +
        '<td>' + dept + '</td>' +
        '<td><span class="' + priBadge(t.priority) + '">' + t.priority + '</span></td>' +
        '<td>' + fmt(t.dueDate) + (isOverdue(t) ? ' &mdash; overdue' : '') + '</td>' +
        '<td><span class="' + statBadge(t.myStatus) + '">' + t.myStatus + '</span></td>' +
        '<td>' + (t.myStatus === 'Completed' ? '' : '<button class="btn btn-sm" data-complete="' + t.id + '">Mark complete</button>') + '</td>' +
        '</tr>';
    });
    // Your own "Add work" items show up here too, tagged as self-assigned,
    // so My tasks is the one place to see everything on your plate.
    var workRows = r[1].personalTasks.map(function (t) {
      var overdue = t.status !== 'Completed' && t.dueDate && new Date(t.dueDate) < new Date(new Date().toDateString());
      return '<tr' + (overdue ? ' class="overdue"' : '') + '>' +
        '<td>' + t.title + (t.description ? '<div class="desc-text">' + t.description + '</div>' : '') + '</td>' +
        '<td>You</td>' +
        '<td>Personal</td>' +
        '<td><span class="' + priBadge(t.priority) + '">' + t.priority + '</span></td>' +
        '<td>' + fmt(t.dueDate) + (overdue ? ' &mdash; overdue' : '') + '</td>' +
        '<td><span class="' + statBadge(t.status) + '">' + t.status + '</span></td>' +
        '<td>' + (t.status === 'Completed' ? '' : '<button class="btn btn-sm" data-complete-personal="' + t.id + '">Mark complete</button>') + '</td>' +
        '</tr>';
    });
    document.getElementById('myTasksBody').innerHTML = assignedRows.join('') + workRows.join('') ||
      '<tr><td colspan="7" style="text-align:center;color:var(--muted)">No tasks assigned yet.</td></tr>';
    document.querySelectorAll('[data-complete]').forEach(function (b) {
      b.addEventListener('click', function () {
        api('/tasks?id=' + b.dataset.complete, { method: 'PATCH', body: { status: 'Completed' } }).then(renderMyTasks).catch(showFatal);
      });
    });
    document.querySelectorAll('[data-complete-personal]').forEach(function (b) {
      b.addEventListener('click', function () {
        api('/personal-tasks?id=' + b.dataset.completePersonal, { method: 'PATCH', body: { status: 'Completed' } }).then(renderMyTasks).catch(showFatal);
      });
    });
  }).catch(showFatal);
}
/* ---------------- Add work (personal tasks) ---------------- */
function renderAddWork() {
  var descEl = document.getElementById('addWorkDesc');
  if (descEl) {
    descEl.textContent = session.role === 'manager'
      ? 'Your own work items, separate from the tasks you delegate to your team.'
      : 'Your own work items, separate from tasks your manager assigns you.';
  }
  api('/personal-tasks').then(function (r) {
    var overdueOf = function (t) { return t.status !== 'Completed' && t.dueDate && new Date(t.dueDate) < new Date(new Date().toDateString()); };
    document.getElementById('workBody').innerHTML = r.personalTasks.map(function (t) {
      return '<tr' + (overdueOf(t) ? ' class="overdue"' : '') + '>' +
        '<td>' + t.title + (t.description ? '<div class="desc-text">' + t.description + '</div>' : '') + '</td>' +
        '<td><span class="' + priBadge(t.priority) + '">' + t.priority + '</span></td>' +
        '<td>' + fmt(t.dueDate) + (overdueOf(t) ? ' &mdash; overdue' : '') + '</td>' +
        '<td><span class="' + statBadge(t.status) + '">' + t.status + '</span></td>' +
        '<td><button class="btn btn-sm" data-toggle="' + t.id + '" data-status="' + t.status + '">' + (t.status === 'Completed' ? 'Reopen' : 'Mark complete') + '</button> ' +
        '<button class="btn btn-sm btn-outline-danger" data-del="' + t.id + '">Delete</button></td>' +
        '</tr>';
    }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--muted)">No work items yet.</td></tr>';
    document.querySelectorAll('#workBody [data-toggle]').forEach(function (b) {
      b.addEventListener('click', function () {
        var next = b.dataset.status === 'Completed' ? 'Pending' : 'Completed';
        api('/personal-tasks?id=' + b.dataset.toggle, { method: 'PATCH', body: { status: next } }).then(renderAddWork).catch(showFatal);
      });
    });
    document.querySelectorAll('#workBody [data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        api('/personal-tasks?id=' + b.dataset.del, { method: 'DELETE' }).then(renderAddWork).catch(showFatal);
      });
    });
  }).catch(showFatal);
}
document.getElementById('showAddWork').addEventListener('click', function () { document.getElementById('addWorkPanel').classList.toggle('hidden'); });
document.getElementById('npSave').addEventListener('click', function () {
  var title = document.getElementById('npTitle').value.trim();
  if (!title) { alert('Title is required.'); return; }
  api('/personal-tasks', {
    method: 'POST',
    body: {
      title: title,
      description: document.getElementById('npDescription').value.trim(),
      priority: document.getElementById('npPriority').value,
      dueDate: document.getElementById('npDue').value,
    },
  })
    .then(function () {
      document.getElementById('npTitle').value = '';
      document.getElementById('npDescription').value = '';
      document.getElementById('addWorkPanel').classList.add('hidden');
      renderAddWork();
    }).catch(showFatal);
});

/* ---------------- Calendar (in-app view; not synced to real Outlook/365) ---------------- */
var calendarInstance = null;
function renderCalendar() {
  var el = document.getElementById('calendarEl');
  var priorityColor = { Low: '#6B7280', Medium: '#0EA5E9', High: '#F59E0B', Critical: '#EF4444' };
  var tasksPromise = api('/tasks');
  var workPromise = session.role === 'employee' ? api('/personal-tasks') : Promise.resolve({ personalTasks: [] });
  Promise.all([tasksPromise, workPromise]).then(function (r) {
    var events = r[0].tasks.filter(function (t) { return t.dueDate; }).map(function (t) {
      return { id: 'task-' + t.id, title: t.title, start: t.dueDate, color: priorityColor[t.priority] || '#6B7280' };
    });
    r[1].personalTasks.filter(function (t) { return t.dueDate; }).forEach(function (t) {
      events.push({ id: 'work-' + t.id, title: t.title + ' (work)', start: t.dueDate, color: '#7C3AED' });
    });
    if (calendarInstance) calendarInstance.destroy();
    calendarInstance = new FullCalendar.Calendar(el, {
      initialView: 'dayGridMonth',
      headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,listWeek' },
      height: 'auto',
      events: events,
    });
    calendarInstance.render();
  }).catch(showFatal);
}

function showFatal(e) {
  // Only clear the session on a genuine 401 (token missing/invalid/expired
  // as judged by the server). Any other failure -- a network hiccup, a
  // cold-start timeout, a 500 -- should NOT log the user out; it just
  // shows an alert so a refresh or retry can recover without re-entering
  // credentials.
  if (e && e.status === 401) {
    document.getElementById('logoutBtn').click();
    return;
  }
  alert(e.message || 'Something went wrong. Please try again.');
}

if (session && session.token) enterApp();
