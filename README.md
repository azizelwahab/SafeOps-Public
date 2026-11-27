# SafeOps

SafeOps is a workplace safety and risk management portfolio application. It pairs an Express REST API with a responsive browser workspace for employees, safety officers, and administrators.

- Employees request accounts, report hazards, and complete assigned corrective actions.
- Safety officers investigate hazards, assess baseline and residual risk, and independently verify corrective work.
- Administrators manage accounts and review escalations. A role-scoped dashboard shows hazard, risk, action, and closure metrics.

The native HTML, CSS, and JavaScript frontend uses the same-origin API. Express controllers and services enforce database-backed role and organization permissions. Prisma and PostgreSQL support transactional audit logging and version checks for concurrent updates.

**Verification:** 158 tests passed locally (65 standard and 93 PostgreSQL integration). Cloud deployment, hosted staging verification, and production verification are pending.

## Interface preview

The screenshots show a disposable local demo with synthetic data.

![SafeOps operational dashboard in Edge](docs/screenshots/dashboard.png)

[View the mobile sign-in screen](docs/screenshots/mobile-sign-in.png)

## Getting started

Use Node.js 24 LTS or Node.js 26 LTS (26.13 or later in the 26.x line), with npm.

```sh
npm ci
npx prisma generate
```

Copy `.env.example` to `.env` to customize local settings. Use `cp .env.example .env` in a POSIX shell or `Copy-Item .env.example .env` in PowerShell. Shell-provided variables take precedence over values from `.env`.

Run `npm run auth:setup` to generate a local signing secret if `.env` does not already have one. The script preserves existing database settings and prints only its status. For production, set the secret through protected configuration before starting the service.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | Tests suppress access logs. Other environments log route templates, methods, statuses and durations. |
| `PORT` | `3000` | HTTP port, between 1 and 65535. |
| `CORS_ORIGINS` | empty | Comma-separated allowlist of exact browser origins, such as `http://localhost:5173`. An empty list grants no cross-origin browser access. |
| `DATABASE_URL` | empty | PostgreSQL URL for the application and Prisma CLI. Use the dedicated `safeops_dev` database for local development. |
| `TEST_DATABASE_URL` | empty | PostgreSQL URL for the integration suite. Its database must be named `safeops_test`. |
| `JWT_SECRET` | required | At least 32 cryptographically random bytes encoded as unpadded base64url. |
| `JWT_EXPIRES_IN` | `15m` | Access token lifetime, from 60 to 900 seconds. Accepts seconds or an `s` or `m` suffix. |
| `JWT_ISSUER` | `safeops` | Expected token issuer. |
| `JWT_AUDIENCE` | `safeops-api` | Expected token audience. |
| `BCRYPT_ROUNDS` | `12` | bcrypt cost, from 10 to 14. |
| `AUTH_RATE_WINDOW_MS` | `900000` | Rate-limit window, from 1,000 to 3,600,000 milliseconds. |
| `AUTH_SIGNUP_LIMIT` | `10` | Signup attempts per client IP per window, from 1 to 1,000. |
| `AUTH_LOGIN_LIMIT` | `20` | Login attempts per client IP per window, from 1 to 1,000. |

```sh
npm run dev
npm start
npm test
```

Run either `npm run dev` for automatic restarts during development or `npm start` for a regular server process.

On Windows, run `.\start-safeops-local.ps1` from the repository root after configuring the dedicated local database below. It validates the environment, starts the dedicated cluster if needed, verifies a read-only database connection, and runs `npm start` in the foreground. It does not apply migrations. Press Ctrl+C to stop Express. Development binds to IPv4 loopback.

Open `http://localhost:3000/` to reach the sign-in interface at `/app/` and access the dashboard, Hazards, Risk Assessments, and Corrective Actions. Confirmed and closed hazard details include residual risk and closure records. Use an approved SafeOps account. The frontend uses native HTML, CSS and JavaScript modules with no build step. See the [frontend guide](docs/frontend.md) for role-based workflows, browser checks and session behavior.

Administrators can share the registration slug shown in **User Management**. Select **Request an account** on the sign-in screen, choose a password, and sign in after an administrator approves the Employee account.

## Testing

```sh
npm test                  # API, authentication checks, readiness and shutdown
npm run test:integration  # Real PostgreSQL tests after test migrations
```

Tests use Node.js's built-in `node:test` runner and `node:assert/strict` assertions. Supertest sends HTTP requests to Express without starting the standalone server. The native runner replaces Jest to reduce development dependencies and run ES modules without experimental module-mocking or VM flags.

The readiness tests pass a probe function to `createApp`. The same readiness service applies the production timeout and handles concurrent probes, while the tests control whether the injected probe succeeds, fails, or stalls. The default app supplies the real Prisma probe, which the PostgreSQL integration suite exercises.

Authentication tests use a per-process signing key and cost 10. PostgreSQL tests verify the dedicated target before writes and cleanup. Test fixtures are isolated by organization and the current test run's identifiers.

## PostgreSQL setup

### SafeOps cluster on Windows

This workspace uses a dedicated cluster under `%LOCALAPPDATA%\SafeOps\postgres`, listening on `127.0.0.1:39188`. It uses SCRAM password authentication, separate owners for `safeops_dev` and `safeops_test`, and credentials in the ignored `.env`. The instance runs independently of the Windows PostgreSQL service. Stopping the cluster retains its data.

```powershell
.\scripts\postgres-local.ps1 start
.\scripts\postgres-local.ps1 status
.\scripts\postgres-local.ps1 stop
```

The script defaults to the installed PostgreSQL 19 binaries. Set `SAFEOPS_PG_BIN` to the directory containing compatible binaries if PostgreSQL is installed elsewhere. For a fresh workstation, initialize the cluster only if the data directory does not exist. Use the PostgreSQL binaries for the desired server version.

```powershell
$cluster = Join-Path $env:LOCALAPPDATA 'SafeOps/postgres'
if (Test-Path (Join-Path $cluster 'data')) { throw 'A SafeOps data directory already exists' }
New-Item -ItemType Directory -Path $cluster -Force | Out-Null
& 'C:/Program Files/PostgreSQL/19/bin/initdb.exe' -D (Join-Path $cluster 'data') -U safeops_admin -A scram-sha-256 -W
.\scripts\postgres-local.ps1 start
& 'C:/Program Files/PostgreSQL/19/bin/psql.exe' -h 127.0.0.1 -p 39188 -U safeops_admin -d postgres -W
```

Use the SQL below to create the two databases. Set the corresponding URLs in `.env` with port `39188` and store the administrator password separately.

### Database roles and migrations

With PostgreSQL running locally, use `psql` from an administrator session. On Windows, if it is absent from PATH, use the executable under `C:\Program Files\PostgreSQL\<version>\bin`. Create separate development and test roles and databases, using fresh names or an administrator-approved dedicated server. The psql password prompts keep passwords out of SQL history.

```sql
CREATE ROLE safeops_dev_user LOGIN;
\password safeops_dev_user
CREATE ROLE safeops_test_user LOGIN;
\password safeops_test_user
CREATE DATABASE safeops_dev OWNER safeops_dev_user;
CREATE DATABASE safeops_test OWNER safeops_test_user;
REVOKE CONNECT ON DATABASE safeops_dev FROM PUBLIC;
REVOKE CONNECT ON DATABASE safeops_test FROM PUBLIC;
```

Set both URLs in the ignored `.env` file. The URL shape is `postgresql://USER:PASSWORD@127.0.0.1:5432/DATABASE`. Substitute the dedicated role and database name in each URL. Percent-encode special characters in credentials. Keep the URLs out of shell history, logs and Git.

```sh
npx prisma validate
```

Verify the host, port, database name and role in each configured URL. Then connect with `psql -h 127.0.0.1 -p 5432 -U safeops_dev_user -d safeops_dev -W` and run `SELECT current_database(), current_user, inet_server_addr(), inet_server_port();`. Repeat using the test role and database. Use the actual configured host and port if they differ from the examples. Verify the intended targets before running migrations or tests.

With `DATABASE_URL` set to development in `.env`, apply and verify the checked-in migration.

```sh
npx prisma migrate deploy
npx prisma migrate status
```

To migrate the test database in a separate shell, run the following from the repository root. It loads the environment and targets `TEST_DATABASE_URL` for the Prisma child process only.

```sh
npm run db:migrate:test
npm run test:integration
```

The integration suites skip when `TEST_DATABASE_URL` is unset. When configured, they verify the database name before writing fixtures and again inside the cleanup transaction. Cleanup uses the current run's fixture IDs and dedicated test organizations. If the process is killed before teardown, its fixtures remain in the dedicated test database.

## Provision the first administrator

1. From the repository root in PowerShell, run the following. Set `NODE_ENV=development` and the loopback `DATABASE_URL` for `safeops_dev` in the ignored `.env` before migrating.

   ```powershell
   .\scripts\postgres-local.ps1 start
   npm run auth:setup
   npx prisma migrate status
   ```

   If the migration is pending, verify the target is `safeops_dev`, then run `npx prisma migrate deploy`.
2. In your editor, create the ignored `.env.bootstrap` file. Restrict access to your OS account. Set the following values, supplying a unique organization slug, a new email, and a private password.

   ```dotenv
   BOOTSTRAP_DATABASE_TARGET=127.0.0.1:39188/safeops_dev
   BOOTSTRAP_ORGANIZATION_NAME=
   BOOTSTRAP_ORGANIZATION_SLUG=
   BOOTSTRAP_ADMIN_NAME=
   BOOTSTRAP_ADMIN_EMAIL=
   BOOTSTRAP_ADMIN_PASSWORD=
   ```

3. Run `npm run bootstrap:admin` from the repository root. If a value contains whitespace or `#`, quote it in the environment file so Node reads it literally. The command checks the configured target and its actual PostgreSQL database, address and port before writing. It creates the organization, approved administrator and audit records in one transaction. An existing slug or email causes the operation to fail without overwriting either record.
4. Remove the bootstrap password from the configuration file once provisioning is complete, or remove the file entirely.

The bootstrap command is restricted to a development environment and an explicit IPv4 loopback connection to `safeops_dev`. The target example uses the port of the SafeOps cluster. Adjust it to match your local development database.

For a file-free bootstrap in PowerShell, run the same CLI directly with a hidden password prompt.

```powershell
$env:BOOTSTRAP_DATABASE_TARGET = '127.0.0.1:39188/safeops_dev'
$env:BOOTSTRAP_ORGANIZATION_NAME = Read-Host 'Organization name'
$env:BOOTSTRAP_ORGANIZATION_SLUG = Read-Host 'Organization slug'
$env:BOOTSTRAP_ADMIN_NAME = Read-Host 'Administrator name'
$env:BOOTSTRAP_ADMIN_EMAIL = Read-Host 'Administrator email'
$bootstrapPassword = Read-Host 'Administrator password' -AsSecureString
try {
    $env:BOOTSTRAP_ADMIN_PASSWORD = [System.Net.NetworkCredential]::new('', $bootstrapPassword).Password
    node scripts/bootstrap-admin.js
    if ($LASTEXITCODE -ne 0) { throw 'Administrator bootstrap failed.' }
} finally {
    $bootstrapPassword.Dispose()
    Remove-Item Env:BOOTSTRAP_DATABASE_TARGET, Env:BOOTSTRAP_ORGANIZATION_NAME, Env:BOOTSTRAP_ORGANIZATION_SLUG, Env:BOOTSTRAP_ADMIN_NAME, Env:BOOTSTRAP_ADMIN_EMAIL, Env:BOOTSTRAP_ADMIN_PASSWORD -ErrorAction SilentlyContinue
}
```

Use names of 1–100 characters after trimming, a slug such as `my-workplace` of at most 80 characters, a valid email of at most 254 characters, and a password of at least 12 Unicode characters and at most 72 UTF‑8 bytes. For invalid input, the CLI reports the field names. After it reports that an approved administrator was created, sign in at `http://localhost:3000/app/` and check the organization and Administrator role.

## Deployment readiness

Use the [deployment checklist](docs/deployment-readiness.md) before exposing SafeOps beyond local development. It covers secrets, PostgreSQL permissions, administrator provisioning, proxy behavior, backups, and staging verification.

## API

| Method and path | HTTP status | Response |
| --- | --- | --- |
| `GET /api/v1` | 200 | Application name, version, and health endpoint path |
| `GET /api/v1/health` | 200 | Application name, version, process status, and ISO 8601 UTC timestamp |
| `GET /api/v1/ready` | 200 or 503 | Database readiness. An unavailable or unconfigured database returns `DATABASE_UNAVAILABLE`. |
| Unknown route | 404 | Error code `NOT_FOUND` and a public message |

```sh
curl http://localhost:3000/api/v1
curl http://localhost:3000/api/v1/health
```

Successful responses use `{ "success": true, "data": { ... } }`. Errors use `{ "success": false, "error": { "code": "...", "message": "..." } }`. The health endpoint checks HTTP process liveness.

Readiness runs a bounded PostgreSQL probe with a two-second response deadline. Liveness and API information remain available without a database.

### Authentication and user management

| Endpoint | Access and behavior |
| --- | --- |
| `POST /api/v1/auth/signup` | Public. Accepts `name`, `email`, `password`, and `organizationSlug`. Returns a generic 202 for new and duplicate submissions to an existing organization. A missing organization returns 404. |
| `POST /api/v1/auth/login` | Public. Accepts `email` and `password`. Returns a bearer token, lifetime in seconds and safe user profile for approved users. Incorrect credentials and ineligible accounts share a 401 response. |
| `GET /api/v1/auth/me` | Returns the authenticated user's profile and organization. |
| `GET /api/v1/users` | Administrator only. Optional `status`, `role`, `search`, `page` and `limit`. Search matches literal substrings in names or emails, ignoring case. Soft-deleted users are excluded. |
| `GET /api/v1/users/:id` | The account owner or an administrator in that organization. |
| `PATCH /api/v1/users/:id` | The account owner or an administrator in that organization. Accepts only `name`. |
| `PATCH /api/v1/users/:id/approve` | Administrator only. Approves another pending user in the same organization. Invalid transitions return 409. |
| `PATCH /api/v1/users/:id/reject` | Administrator only. Rejects a pending non-administrator in the same organization. Send no body or `{}`. Returns the safe profile or 409 if the account cannot be rejected. |
| `PATCH /api/v1/users/:id/suspend` | Administrator only. Suspends an approved non-administrator and invalidates existing access tokens. |
| `PATCH /api/v1/users/:id/restore` | Administrator only. Restores a suspended account, preserving its original approval information. The restored user must log in again. |
| `PATCH /api/v1/users/:id/role` | Administrator only. Accepts only `{"role":"EMPLOYEE"}` or `{"role":"SAFETY_OFFICER"}`. Targets must be approved, undeleted, and distinct from the caller. Administrator accounts and the `ADMIN` role are protected. |
| `DELETE /api/v1/users/:id` | Administrator only. Soft-deletes a non-administrator account in the same organization. |
| `GET /api/v1/audit-logs` | Administrator only. Read-only list scoped to the caller's organization. Optional `action`, `entityType`, `actorId`, `from`, `to`, `page`, and `limit`. |
| `GET /api/v1/audit-logs/:id` | Administrator only. Returns an audit record in the caller's organization, with metadata filtered to approved fields. |

Both lists sort by creation time, newest first, then by descending ID. Pagination defaults to page 1 and limit 20, with maximums of 10,000 and 100. Audit dates are inclusive ISO 8601 timestamps with a time zone. Audit actions and entity types are exact matches.

For suspend and restore, send no body or `{}`. Lifecycle changes and role updates return the safe profile on success, HTTP 404 for missing, deleted, or cross-organization targets, and HTTP 409 for ineligible targets. See the [account lifecycle and permission matrix](docs/authentication-design.md).

```http
PATCH /api/v1/users/<user-id>/role
Authorization: Bearer <administrator-token>
Content-Type: application/json

{"role":"SAFETY_OFFICER"}
```

```http
GET /api/v1/audit-logs?action=USER_ROLE_CHANGED&entityType=User&from=2026-11-01T00:00:00Z&limit=20
Authorization: Bearer <administrator-token>
```

Public registration creates a pending employee request and does not establish verified organization membership. An administrator must confirm membership before approving. Passwords must contain at least 12 characters and at most 72 UTF-8 bytes. They are used as entered, including leading and trailing whitespace.

Send access tokens in the `Authorization: Bearer <token>` header. Signed JWT payloads are readable and are not encrypted. Every protected request checks the current organization, role, status, deletion state, and authentication version in PostgreSQL. Suspension and restoration advance that version. Old tokens stay invalid after restoration. Tokens issued before the version claim was added require a fresh login. Cross-organization records return 404.

Signup and login use separate in-memory rate limits based on the connected client address. Requests over the limit receive HTTP 429 and `Retry-After`. Express does not trust client-supplied `X-Forwarded-For` values. The limiter is suitable for one application instance. Distributed deployments need a shared store and an explicit proxy trust policy.

Use HTTPS outside loopback. SafeOps has no refresh tokens, per-token logout, MFA, password recovery, or email verification. Requests already authenticated may finish during a lifecycle change. An eligible account's bearer token remains usable until expiration or account-level invalidation. Offset pagination can shift when records are added between requests. Public signup reveals whether an organization slug exists. See the [authentication design](docs/authentication-design.md) for audit behavior, account checks and timing limitations.

| Phase 3 dependency | Installed version | Purpose |
| --- | --- | --- |
| bcrypt | 6.0.0 | Asynchronous password hashing and comparison |
| jsonwebtoken | 9.0.3 | HS256 token signing and verification |
| zod | 4.6.7 | Strict request validation and JWT claim validation |
| express-rate-limit | 8.7.5 | Per-IP signup and login throttling |

### Hazard management

| Endpoint | Access and behavior |
| --- | --- |
| `POST /api/v1/hazards` | Any approved user. Accepts `title`, `description`, `category`, and `location`. Returns 201 with status `REPORTED`. |
| `GET /api/v1/hazards` | Employees see their own reports. Safety officers and administrators see all reports in their organization. |
| `GET /api/v1/hazards/:id` | Same visibility as the list. |
| `PATCH /api/v1/hazards/:id` | Reporter only while `REPORTED`. Accepts one or more creation fields. |
| `PATCH /api/v1/hazards/:id/review` | Safety officer or administrator. Moves `REPORTED` to `UNDER_REVIEW`. |
| `PATCH /api/v1/hazards/:id/confirm` | Safety officer or administrator. Moves `UNDER_REVIEW` to `CONFIRMED` with `reviewNotes`. |
| `PATCH /api/v1/hazards/:id/dismiss` | Safety officer or administrator. Moves `UNDER_REVIEW` to `DISMISSED` with justification in `reviewNotes`. |

List filters are `status`, `category`, `location`, `search`, `from`, `to`, `page`, and `limit`. Results sort newest first with descending IDs as a tie-breaker. State conflicts return 409 and inaccessible hazards return 404. See the [hazard management design](docs/hazard-management-design.md) for request examples, field limits, the lifecycle diagram, and the permission matrix.

### Risk assessments

| Endpoint | Access and behavior |
| --- | --- |
| `POST /api/v1/risk-assessments` | Safety officer or administrator. Creates the assessment for a confirmed hazard in their organization. |
| `GET /api/v1/risk-assessments` | Lists assessments for hazards the caller can read. Supports `hazardId`, `page`, and `limit`. |
| `GET /api/v1/risk-assessments/:id` | Returns the current assessment when the caller can read its hazard. |
| `PATCH /api/v1/risk-assessments/:id` | Safety officer or administrator in the same organization. Requires the current `version` and at least one rating. A stale version returns 409. |
| `GET /api/v1/risk-assessments/:id/history` | Returns paginated revisions for a visible assessment, newest version first. |

Submit integer likelihood and severity ratings from 1 to 5. SafeOps multiplies them and assigns Low (1–4), Medium (5–9), High (10–16), or Critical (17–25). Each successful update records a new version and its assessor. Employees can read assessments only for their own hazards. See the [risk assessment design](docs/risk-assessment-design.md) for request examples and persistence rules.

### Corrective actions

| Method | Endpoint |
| --- | --- |
| `POST`, `GET` | `/api/v1/corrective-actions` |
| `GET`, `PATCH` | `/api/v1/corrective-actions/:id` |
| `GET` | `/api/v1/corrective-actions/:id/history` |
| `PATCH` | `/api/v1/corrective-actions/:id/start`, `/submit`, `/verify`, `/return` under the same action ID |

Safety officers and administrators manage actions for confirmed, assessed hazards in their organization. Employees can read actions assigned to them or tied to hazards they reported. An assignment does not grant access to the hazard or its risk assessment. Employees can start their assigned work, update progress notes and submit completion details. Verification requires a manager other than the assignee or submitter.

Every update requires the current version. List filters include `hazardId`, `assigneeId`, `status`, and `overdue`, with bounded `page` and `limit`. See the [corrective action design](docs/corrective-action-design.md) for JSON examples, permission rules, and lifecycle transitions.

### Hazard closure and residual risk

| Method | Endpoint | Behavior |
| --- | --- | --- |
| `POST`, `GET` | `/api/v1/hazards/:id/residual-risk` | Record a versioned residual assessment or read the latest revision. |
| `GET` | `/api/v1/hazards/:id/residual-risk/history` | List residual revisions in descending version order with bounded pagination. |
| `PATCH` | `/api/v1/hazards/:id/close` | Record a closure or escalation decision for the current residual version. |
| `GET` | `/api/v1/hazards/:id/closure` | Read the latest decision. |

Officers and administrators record residual risk and closure decisions. Reads follow hazard visibility. Closure requires a confirmed hazard, a baseline assessment, at least one corrective action, every action verified, and a current residual assessment. High or Critical residual risk requires explicit administrator acceptance to close. Escalation records the rationale and leaves the hazard confirmed. The hazard list accepts `status=CLOSED`.

See the [hazard closure design](docs/hazard-closure-design.md) for API examples, version checks, and the acceptance policy.

### Operational dashboard

`GET /api/v1/dashboard/summary` counts visible hazards, effective risk levels, corrective actions, overdue work, closures, and unresolved escalations. Approved managers see organization-wide counts. Employees see counts under the existing hazard and action visibility rules.

Supply both `from` and `to` for a creation-date interval of up to 366 days, or omit both for all time. Metrics describe current status for the selected records. See the [dashboard API](docs/dashboard-api.md) for the complete JSON response, exact metric definitions, and baseline versus residual risk rules.

### End-to-end demo

For a 5–8 minute interview walkthrough in the browser, use the [local portfolio demo guide](docs/portfolio-demo.md) and its disposable accounts.

With the local test database configured and migrated, run `npm run demo:workflow`. It verifies signup through administrator-approved hazard closure, including independent corrective-action verification, rejected cross-organization access, invalid transitions, and the dashboard before and after acceptance. Follow the [demo walkthrough](docs/workflow-demo.md) for setup and expected output.

## Architecture

| Directory | Responsibility |
| --- | --- |
| `src/models/` | Persistence operations for organizations, users, and audit logs |
| `src/views/` | Shared JSON response formatting and HTTP status handling |
| `src/controllers/` | Request handlers that prepare response data |
| `src/routes/` | Map HTTP methods and paths to controllers |
| `src/services/` | Readiness probing and future business orchestration |
| `src/middleware/` | Shared HTTP concerns, including the 404 fallback and centralized errors |
| `src/config/` | Environment loading and shared Prisma client |
| `src/validators/` | Request validation for future modules |
| `src/utils/` | Shared utilities as needed |
| `prisma/` | Prisma schema and SQL migrations |
| `docs/` | Database design and operational documentation |
| `tests/` | Native Node.js tests and Supertest HTTP assertions |

Routes invoke controllers, which pass response data to the JSON views. Models use the shared Prisma client, and the readiness controller delegates its database probe to a service. `src/app.js` configures and exports Express. `server.js` binds the HTTP listener, handles SIGINT and SIGTERM, and disconnects Prisma after draining HTTP requests.

See [Database design](docs/database-design.md) for schema, tenancy, soft deletion, and the approval workflow.
