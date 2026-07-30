# Dream2Fly Backend (v1.0)

Real API backing the Employee Dashboard prototype: authentication, leads,
tasks, comments, follow-ups, lead-to-task conversion, and admin-controlled
feature flags — replacing the in-memory arrays and `localStorage` used in
the front-end HTML files.

This was written by hand (not installed/tested in a sandboxed environment
without internet access) — run the steps below yourself and fix anything
that surfaces; it hasn't been executed end-to-end yet.

## 1. Install

```bash
cd dream2fly-backend
npm install
cp .env.example .env
```

Open `.env` and at minimum set a real `JWT_SECRET`. The default
`DATABASE_URL` uses SQLite, so no separate database server is needed for
local development.

## 2. Set up the database

```bash
npx prisma migrate dev --name init
npm run seed
```

This creates `dev.db` (SQLite file) and prints four test accounts,
all with password `Password123!`:

```
SUPER_ADMIN      admin@dream2fly.co.uk
EMPLOYEE         ananya.rao@dream2fly.co.uk
CHANNEL_PARTNER  partner@globalreach.example
STUDENT          rahul.sharma@example.com
```

## 3. Run it

```bash
npm run dev
```

Visit `http://localhost:4000/api/health` — you should see
`{"status":"ok"}`.

## 4. Try it with curl

```bash
# Log in
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ananya.rao@dream2fly.co.uk","password":"Password123!"}'

# Copy the returned token, then:
curl http://localhost:4000/api/leads \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

## 5. API summary

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/auth/login` | Sign in, returns JWT |
| GET | `/api/auth/me` | Current user |
| PATCH | `/api/auth/me` | Update own phone number |
| POST | `/api/auth/change-password` | Reset own password |
| GET | `/api/leads?name=&source=&country=&from=&to=` | List/filter leads |
| POST | `/api/leads` | Create a lead |
| PATCH | `/api/leads/:id/status` | Change status → sends/logs email |
| POST | `/api/leads/:id/followups` | Log a call/message/email |
| POST | `/api/leads/:id/comments` | Add a comment |
| POST | `/api/leads/:id/convert` | Convert lead → task, carrying history |
| GET | `/api/tasks?name=&country=&from=&to=` | List/filter tasks |
| POST | `/api/tasks` | Create a task |
| PATCH | `/api/tasks/:id/status` | Change status → sends/logs email |
| POST | `/api/tasks/:id/comments` | Add a comment |
| GET | `/api/feature-flags?scope=EMPLOYEE` | Read feature toggles (any signed-in user) |
| PUT | `/api/feature-flags` | Set feature toggles (Admin/Super Admin only) |

All routes except `/api/auth/login` and `/api/health` require
`Authorization: Bearer <token>`.

## 6. Connecting the front-end dashboards

See `frontend-integration/api-client.js` for a drop-in replacement of the
hardcoded arrays in `employee-dashboard.html`. In short: set `API_BASE_URL`
to wherever this backend is deployed, log in to get a token, store it, and
replace the `leads`/`tasks` arrays with `fetch()` calls to the routes above.
The admin feature-toggle panel switches from `localStorage` to
`GET`/`PUT /api/feature-flags`, which is what makes it genuinely
enforceable across different devices and browsers.

## 7. Moving to Postgres for production

SQLite is fine for development but not for a real multi-user deployment.
To switch:

1. Provision a Postgres database (Railway, Render, Supabase, Neon, AWS RDS
   — pick one).
2. In `.env`, replace `DATABASE_URL` with the Postgres connection string
   given by your provider (see the commented example in `.env.example`).
3. In `prisma/schema.prisma`, change:
   ```
   datasource db {
     provider = "sqlite"
     url      = env("DATABASE_URL")
   }
   ```
   to:
   ```
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```
4. Run `npx prisma migrate deploy` (production-safe migration command,
   instead of `migrate dev`).
5. Run `npm run seed` again if you want the same test accounts in
   production (change the password afterwards!).

## 8. Deploying

Any Node host works (Railway, Render, Fly.io, a plain VPS). General shape:

1. Push this folder to a Git repository.
2. Create a new Node service on your host, pointed at this repo.
3. Set environment variables (`DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGINS`,
   etc.) in the host's dashboard — never commit `.env` itself.
4. Build command: `npm install && npx prisma generate`
5. Start command: `npm start`
6. Add your deployed front-end's URL to `CORS_ORIGINS` so the browser is
   allowed to call this API.
7. Point the dashboards' `API_BASE_URL` (see step 6 above) at this
   service's public URL.

## 9. What's still missing vs. the full original spec

This backend covers only the Employee Dashboard v1.0 slice: leads, tasks,
comments, follow-ups, conversion, and feature flags. Not yet built:
channel partner/commission module, HR/payroll, documents/e-signature,
universities/offers, visa process tracking, chat/WebSockets, audit logs,
and the Admin/Partner/Student portals' own endpoints. Add these as
additional Prisma models + route files following the same pattern used
here, keyed off the table list in section 33 of the original project
brief.
<!-- force redeploy -->
