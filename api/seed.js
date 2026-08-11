// One-time setup endpoint: POST /api/seed { "adminPassword": "..." }
// Creates the admin account, the real 54-person roster (from
// "Microsoft Users pdka.csv"), and empty tasks/personalTasks/notifications
// stores. Safe to call more than once -- it refuses to overwrite existing
// data unless you pass "force": true, so accidentally hitting it twice
// won't wipe real work.
const { readJSON, writeJSON } = require('./_lib/store');
const { hashPassword } = require('./_lib/auth');
const { json, parseBody } = require('./_lib/respond');

const EMPLOYEES = [
  { id: 1, code: 'EMP001', name: 'Anusha Shetty', email: 'Anusha@pdka.in', username: 'anusha', dept: 'Audit', designation: 'Article Assistant', active: true },
  { id: 2, code: 'EMP002', name: 'Ashika P', email: 'Ashika@pdka.in', username: 'ashika', dept: 'Taxation', designation: 'Senior Associate', active: true },
  { id: 3, code: 'EMP003', name: 'Bhanuprakash M', email: 'bhanuprakash@pdka.in', username: 'bhanuprakash', dept: 'FinOps', designation: 'Audit Executive', active: true },
  { id: 4, code: 'EMP004', name: 'Bhavya', email: 'Bhavya@pdka.in', username: 'bhavya', dept: 'CS Team', designation: 'Tax Consultant', active: true },
  { id: 5, code: 'EMP005', name: 'Bindu Rao TN', email: 'bindu@pdka.in', username: 'bindu', dept: 'Advisory', designation: 'Manager', active: true },
  { id: 6, code: 'EMP006', name: 'Dilip Kumar', email: 'dilip@pdka.in', username: 'dilip', dept: 'HR & Admin', designation: 'Compliance Officer', active: true },
  { id: 7, code: 'EMP007', name: 'Divyashree V S', email: 'divya@pdka.in', username: 'divya', dept: 'Audit', designation: 'Article Assistant', active: true },
  { id: 8, code: 'EMP008', name: 'Dodagatte Sai Preethi', email: 'Saipreethi@pdka.in', username: 'saipreethi', dept: 'Taxation', designation: 'Senior Associate', active: true },
  { id: 9, code: 'EMP009', name: 'Fayaz Hussain', email: 'fayazhussain@pdka.in', username: 'fayazhussain', dept: 'FinOps', designation: 'Audit Executive', active: true },
  { id: 10, code: 'EMP010', name: 'Iramma Patil', email: 'iramma@pdka.in', username: 'iramma', dept: 'CS Team', designation: 'Tax Consultant', active: true },
  { id: 11, code: 'EMP011', name: 'K Umamaheswar', email: 'umamaheshwar@pdka.in', username: 'umamaheshwar', dept: 'Advisory', designation: 'Manager', active: true },
  { id: 12, code: 'EMP012', name: 'Kavyashree S', email: 'kavya@pdka.in', username: 'kavya', dept: 'HR & Admin', designation: 'Compliance Officer', active: true },
  { id: 13, code: 'EMP013', name: 'Khushaal Jain', email: 'Khushaal@pdka.in', username: 'khushaal', dept: 'Audit', designation: 'Article Assistant', active: true },
  { id: 14, code: 'EMP014', name: 'Laksh Bhandari', email: 'Laksh@pdka.in', username: 'laksh', dept: 'Taxation', designation: 'Senior Associate', active: true },
  { id: 15, code: 'EMP015', name: 'Lavanya', email: 'lavanya@pdka.in', username: 'lavanya', dept: 'FinOps', designation: 'Audit Executive', active: true },
  { id: 16, code: 'EMP016', name: 'Manju S', email: 'manju@pdka.in', username: 'manju', dept: 'CS Team', designation: 'Tax Consultant', active: true },
  { id: 17, code: 'EMP017', name: 'Mansi G Jain', email: 'mansi@pdka.in', username: 'mansi', dept: 'Advisory', designation: 'Manager', active: true },
  { id: 18, code: 'EMP018', name: 'Mithun', email: 'mithun@pdka.in', username: 'mithun', dept: 'HR & Admin', designation: 'Compliance Officer', active: true },
  { id: 19, code: 'EMP019', name: 'Mohit Ramachandra', email: 'Mohit@pdka.in', username: 'mohit', dept: 'Audit', designation: 'Article Assistant', active: true },
  { id: 20, code: 'EMP020', name: 'Muskaan Jain', email: 'muskaan@pdka.in', username: 'muskaan', dept: 'Taxation', designation: 'Senior Associate', active: true },
  { id: 21, code: 'EMP021', name: 'Namratha MN', email: 'Accounts@pdka.in', username: 'accounts', dept: 'FinOps', designation: 'Audit Executive', active: true },
  { id: 22, code: 'EMP022', name: 'Narasimha Kumar M', email: 'Narasimha@pdka.in', username: 'narasimha', dept: 'CS Team', designation: 'Tax Consultant', active: true },
  { id: 23, code: 'EMP023', name: 'Naveen Kumar', email: 'naveen@pdka.in', username: 'naveen', dept: 'Advisory', designation: 'Manager', active: true },
  { id: 24, code: 'EMP024', name: 'Nithin kumar P V', email: 'nithin@pdka.in', username: 'nithin', dept: 'HR & Admin', designation: 'Compliance Officer', active: true },
  { id: 25, code: 'EMP025', name: 'Padmapriya R', email: 'padmapriya@pdka.in', username: 'padmapriya', dept: 'Audit', designation: 'Article Assistant', active: true },
  { id: 26, code: 'EMP026', name: 'Pallavi Sancheti', email: 'pallavi@pdka.in', username: 'pallavi', dept: 'Taxation', designation: 'Senior Associate', active: true },
  { id: 27, code: 'EMP027', name: 'Pooja B', email: 'Pooja@pdka.in', username: 'pooja', dept: 'FinOps', designation: 'Audit Executive', active: true },
  { id: 28, code: 'EMP028', name: 'Prachi Sharma', email: 'Prachi@pdka.in', username: 'prachi', dept: 'CS Team', designation: 'Tax Consultant', active: true },
  { id: 29, code: 'EMP029', name: 'Pratik Bhanj', email: 'Pratik@pdka.in', username: 'pratik', dept: 'Advisory', designation: 'Manager', active: true },
  { id: 30, code: 'EMP030', name: 'Rajesh U S', email: 'rajesh@pdka.in', username: 'rajesh', dept: 'HR & Admin', designation: 'Compliance Officer', active: true },
  { id: 31, code: 'EMP031', name: 'Rakesh Kumar G Jain', email: 'rakesh@pdka.in', username: 'rakesh', dept: 'Audit', designation: 'Article Assistant', active: true },
  { id: 32, code: 'EMP032', name: 'Ramya R', email: 'ramya@pdka.in', username: 'ramya', dept: 'Taxation', designation: 'Senior Associate', active: true },
  { id: 33, code: 'EMP033', name: 'Rani.S', email: 'ranis@pdka.in', username: 'ranis', dept: 'FinOps', designation: 'Audit Executive', active: true },
  { id: 34, code: 'EMP034', name: 'Raushan Kumar', email: 'Raushan@pdka.in', username: 'raushan', dept: 'CS Team', designation: 'Tax Consultant', active: true },
  { id: 35, code: 'EMP035', name: 'Richa Khetawat', email: 'richa@pdka.in', username: 'richa', dept: 'Advisory', designation: 'Manager', active: true },
  { id: 36, code: 'EMP036', name: 'Rinkal Handey', email: 'rinkal@pdka.in', username: 'rinkal', dept: 'HR & Admin', designation: 'Compliance Officer', active: true },
  { id: 37, code: 'EMP037', name: 'S Geetha', email: 'geethas@pdka.in', username: 'geethas', dept: 'Audit', designation: 'Article Assistant', active: true },
  { id: 38, code: 'EMP038', name: 'Sachin Pradeep', email: 'Sachin@pdka.in', username: 'sachin', dept: 'Taxation', designation: 'Senior Associate', active: true },
  { id: 39, code: 'EMP039', name: 'Sairam Sreekar Busetty', email: 'sairam@pdka.in', username: 'sairam', dept: 'FinOps', designation: 'Audit Executive', active: true },
  { id: 40, code: 'EMP040', name: 'Sandeep Jain S', email: 'sandeep@pdka.in', username: 'sandeep', dept: 'CS Team', designation: 'Tax Consultant', active: true },
  { id: 41, code: 'EMP041', name: 'Shalini L', email: 'shalini@pdka.in', username: 'shalini', dept: 'Advisory', designation: 'Manager', active: true },
  { id: 42, code: 'EMP042', name: 'Shamanth B T', email: 'Shamanth@pdka.in', username: 'shamanth', dept: 'HR & Admin', designation: 'Compliance Officer', active: true },
  { id: 43, code: 'EMP043', name: 'Shivam Kumar', email: 'shivam@pdka.in', username: 'shivam', dept: 'Audit', designation: 'Article Assistant', active: true },
  { id: 44, code: 'EMP044', name: 'Shivaprasad S', email: 'shivaprasad@pdka.in', username: 'shivaprasad', dept: 'Taxation', designation: 'Senior Associate', active: true },
  { id: 45, code: 'EMP045', name: 'Siddesha K', email: 'Siddesha@pdka.in', username: 'siddesha', dept: 'FinOps', designation: 'Audit Executive', active: true },
  { id: 46, code: 'EMP046', name: 'Sowmya N', email: 'sowmya@pdka.in', username: 'sowmya', dept: 'CS Team', designation: 'Tax Consultant', active: true },
  { id: 47, code: 'EMP047', name: 'SriKrishna', email: 'srikrishna@pdka.in', username: 'srikrishna', dept: 'Advisory', designation: 'Manager', active: true },
  { id: 48, code: 'EMP048', name: 'Ujwal Sharma', email: 'Ujwal@pdka.in', username: 'ujwal', dept: 'HR & Admin', designation: 'Compliance Officer', active: true },
  { id: 49, code: 'EMP049', name: 'Varsha T A', email: 'varsha@pdka.in', username: 'varsha', dept: 'Audit', designation: 'Article Assistant', active: true },
  { id: 50, code: 'EMP050', name: 'Varun', email: 'varun@pdka.in', username: 'varun', dept: 'Taxation', designation: 'Senior Associate', active: true },
  { id: 51, code: 'EMP051', name: 'Vasanth Kumar', email: 'Vasanth@pdka.in', username: 'vasanth', dept: 'FinOps', designation: 'Audit Executive', active: true },
  { id: 52, code: 'EMP052', name: 'Vedamurthy S', email: 'vedamurthy@pdka.in', username: 'vedamurthy', dept: 'CS Team', designation: 'Tax Consultant', active: true },
  { id: 53, code: 'EMP053', name: 'Vijay Kumar D N', email: 'Vijaykumar@pdka.in', username: 'vijaykumar', dept: 'Advisory', designation: 'Manager', active: true },
  { id: 54, code: 'EMP054', name: 'Vijeetha.L', email: 'vijeetha@pdka.in', username: 'vijeetha', dept: 'HR & Admin', designation: 'Compliance Officer', active: true },
];

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST required' });
  const body = parseBody(req);
  const force = body.force === true;

  const existingUsers = await readJSON('users', null);
  if (existingUsers && !force) {
    return json(res, 409, { error: 'Already seeded. Pass {"force": true} to re-seed (this wipes existing data).' });
  }

  const adminPassword = body.adminPassword || 'Admin@123';
  const employeePassword = body.employeePassword || 'Welcome@123';

  const users = [
    { id: 1, username: 'admin', role: 'admin', employeeId: null, passwordHash: hashPassword(adminPassword) },
    ...EMPLOYEES.map((e) => ({
      id: e.id + 1,
      username: e.username,
      role: 'employee',
      employeeId: e.id,
      passwordHash: hashPassword(employeePassword),
    })),
  ];

  await writeJSON('users', users);
  await writeJSON('employees', EMPLOYEES);
  await writeJSON('tasks', []);
  await writeJSON('personalTasks', []);
  await writeJSON('notifications', []);
  await writeJSON('idSeq', { task: 1, personalTask: 1, employee: EMPLOYEES.length + 1 });

  return json(res, 200, {
    ok: true,
    employeeCount: EMPLOYEES.length,
    adminLogin: { username: 'admin', password: adminPassword },
    employeeLoginExample: { username: 'anusha', password: employeePassword },
  });
};
