# Employee Task Manager

A frontend-only build hosted on GitHub. This repo holds the UI (`public/index.html` + `public/app.js`) for an employee task manager: admin/manager task assignment, per-employee task visibility, mark-complete, "Add work" personal items, and an in-app calendar view.

## Status: frontend only, no live backend

This project originally ran on Netlify Functions (serverless Node) + Netlify Blobs for storage. Those backend files (`netlify/functions/`, `netlify/lib/`, `netlify.toml`) have been removed from this repo, so **the app has no working server right now** -- opening `public/index.html` will show the login screen, but sign-in and all `/api/*` calls will fail since there's nothing to answer them.

GitHub only stores and serves static files; it can't run server-side code. To get a working app again, the backend would need to be hosted somewhere that can execute Node (Netlify, Vercel, a small VPS, etc.) and the frontend pointed at it.

## What's in this repo

```
public/
  index.html       Frontend shell (login screen, dashboard, tasks, calendar UI)
  app.js            Talks to /api/* endpoints (currently unreachable, no backend)
package.json         @netlify/blobs dependency (unused now that Netlify Functions are removed)
test-local.js         20 automated checks -- BROKEN, requires ./netlify/functions/* which no longer exists
test-calendar-sync.js Microsoft Graph calendar sync tests -- BROKEN, same reason
```

## Known issue: test files reference deleted backend code

`test-local.js` and `test-calendar-sync.js` both `require('./netlify/functions/...')` and `./netlify/lib/...`, which were deleted along with the rest of the Netlify backend. Running either with `node` will now throw a "Cannot find module" error. They're left in place as a record of what was tested when the backend existed; they won't run until the backend code (or equivalent) is restored.

## Feature reference (from when the backend was live)

- **Real**: login, roles, task assignment (single/multiple/department), per-employee task visibility, mark-complete, "Add work" (personal tasks), employee management.
- **Calendar**: in-app calendar view (FullCalendar), plus optional two-way sync with Outlook/Teams via Microsoft Graph (`MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`).
- Admin login: `admin` / `Admin@123` (set during the original seed step).
- Employee login: username = email prefix (e.g. `naveen`), password `Welcome@123`.

These credentials and behaviors only apply once a backend is deployed and seeded again -- they don't work against this repo alone.
