# Employee Task Manager — Netlify build

A real backend version: Netlify Functions (serverless Node) + Netlify Blobs
for storage (built into every Netlify site — no separate database account
needed). Unlike the earlier HTML mockup, task assignments here actually
persist and are visible to the correct employee, permanently, from any
device.

Tested locally end-to-end by invoking the function handlers directly with
20 automated checks (`node test-local.js`) — including the exact scenario
that was broken in the mockup: admin assigns a task to Naveen, and it
shows up only in Naveen's login, not anyone else's. All 20 checks pass.

## What's real vs. what's not

- **Real**: login, roles, task assignment (single/multiple/department), per-employee
  task visibility, mark-complete, "Add work" (personal tasks), employee
  management — all persisted via Netlify Blobs, survives reloads/devices/logout.
- **Calendar**: an in-app calendar view (FullCalendar) showing assigned tasks and
  work items, **plus real two-way sync with Outlook/Teams calendars** once
  `MS_TENANT_ID`, `MS_CLIENT_ID`, and `MS_CLIENT_SECRET` are set (see below).
  When configured: assigning a task creates an event on the assignee's real
  Outlook/Teams calendar; editing the task (title/date/priority/status)
  updates that event; deleting the task removes it. A scheduled job
  (`sync-calendar`, runs every 15 minutes) pulls changes back the other
  way — if an employee reschedules or deletes the event directly in
  Outlook, the task updates to match (date changes only flow back for
  single-assignee tasks, since a department-wide task's due date is shared
  across everyone and there's no single "correct" date to pull from one
  person's calendar). If the env vars aren't set, calendar sync is
  silently skipped and everything else works exactly as before.

### Setting up Microsoft Calendar sync

1. In Azure AD (portal.azure.com) for the pdka.in tenant: App registrations →
   New registration → single-tenant, no redirect URI needed.
2. Note the **Application (client) ID** and **Directory (tenant) ID** from
   the Overview page.
3. Certificates & secrets → New client secret → copy the value immediately.
4. API permissions → Add a permission → Microsoft Graph → **Application
   permissions** → `Calendars.ReadWrite` → Add → **Grant admin consent**.
5. In Netlify: Site configuration → Environment variables, add:
   - `MS_TENANT_ID` = the Directory (tenant) ID
   - `MS_CLIENT_ID` = the Application (client) ID
   - `MS_CLIENT_SECRET` = the client secret value
6. Redeploy. New tasks (and edits to existing ones) will start syncing.

This uses app-only (client-credentials) auth with `Calendars.ReadWrite`
Application permission, so it acts directly on each employee's calendar via
their pdka.in email address — no individual employee sign-in required.

## Deploying (you'll need to do the account parts yourself)

I can't create accounts or sign up on your behalf. Here's the fastest path:

1. **Sign up at Netlify** (free): https://app.netlify.com/signup
2. Once you're logged into Netlify **in Chrome**, tell me — I'll use the
   Claude in Chrome browser tool to drive the actual deploy (drag-and-drop
   the `task-manager-netlify` folder onto Netlify's deploy page) so you
   don't have to do it manually.
3. Alternative if you'd rather do it yourself: install the Netlify CLI and run:
   ```
   npm install -g netlify-cli
   cd task-manager-netlify
   npm install
   netlify deploy --prod
   ```
   Follow the prompts to log in and create a new site.

## First-time setup after deploying

1. Open your new Netlify site URL.
2. On the login screen, click **"Initialize system"** once. This loads
   the real 54-person roster (from your CSV) and creates the admin account.
3. Log in as `admin` / `Admin@123`. **Change this password** (there's no
   change-password UI yet — ask me to add one, or reset it by re-running
   `/api/seed` with a custom password).
4. Employees log in with their username (email prefix, e.g. `naveen`) and
   password `Welcome@123` — also worth rotating per-person once real use starts.

## Environment variable to set in Netlify

In Site settings → Environment variables, add:

```
SESSION_SECRET = <any long random string>
```

Without this, login tokens are signed with a default dev secret, which is
fine for testing but not for real deployment.

## Project structure

```
task-manager-netlify/
├── netlify.toml              Routes /api/* to functions, sets publish dir
├── package.json               @netlify/blobs dependency
├── netlify/
│   ├── functions/
│   │   ├── seed.js            One-time: creates admin + real 54-employee roster
│   │   ├── login.js           Username/password -> signed session token
│   │   ├── employees.js       List/add/deactivate/delete employees (admin)
│   │   ├── tasks.js           List/assign/update/delete tasks
│   │   └── personal-tasks.js  Employee's own "Add work" items
│   └── lib/
│       ├── store.js           Netlify Blobs wrapper
│       ├── auth.js            Password hashing + session tokens
│       └── respond.js         JSON response helper
├── public/
│   ├── index.html             Frontend shell
│   └── app.js                 Talks to /api/* endpoints
└── test-local.js              20 automated checks, runs without a live deploy
```

## Extending later

- **Change-password UI**: small addition to add now if useful.
- **Notifications center**: dropped from this version to control scope —
  can add a Blobs-backed notifications list + polling, matching the
  earlier PHP build's design.
- **Real Microsoft Calendar sync**: needs an Azure AD app registration for
  pdka.in with `Calendars.ReadWrite` delegated permission and admin
  consent. Once you have that, I'll wire up OAuth login via Microsoft and
  push/pull events through Microsoft Graph.
- **CSV bulk import**: the seed script already encodes your CSV; a proper
  upload-a-CSV admin feature can be added the same way as in the PHP build.
