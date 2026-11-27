# SafeOps portfolio demo

**Format:** a 5–8 minute browser walkthrough with three pre-signed-in tabs. Use a single synthetic hazard to show the full workflow and why an escalated decision requires a new residual assessment before administrator acceptance.

## Prepare locally

From the SafeOps repository root in PowerShell, use the [README setup](../README.md) to configure the ignored `.env`. Set `TEST_DATABASE_URL` to the dedicated local PostgreSQL cluster's `safeops_test` database using a loopback hostname and a direct connection, with no query parameters or fragment. Use the local server port (39188 in the README setup). Do not use a forwarded port. Check the target locally without copying the URL into slides or terminal output. The browser demo uses the test fixture database, separate from the usual `safeops_dev` app and any existing accounts.

```powershell
npm ci
npx prisma generate
.\scripts\postgres-local.ps1 status
# If the dedicated cluster is stopped:
.\scripts\postgres-local.ps1 start
npm run db:migrate:test
```

Run the browser demo in a separate terminal. Choose a new disposable password using a password manager, at least 12 Unicode characters and at most 72 UTF-8 bytes. It is shared by the three synthetic accounts for this run.

```powershell
$demoPassword = Read-Host 'Disposable portfolio password' -AsSecureString
try {
    $env:SAFEOPS_PORTFOLIO_PASSWORD = [System.Net.NetworkCredential]::new('', $demoPassword).Password
    node --import ./tests/setup.js scripts/portfolio-demo.js
} finally {
    $demoPassword.Dispose()
    Remove-Item Env:SAFEOPS_PORTFOLIO_PASSWORD -ErrorAction SilentlyContinue
}
```

The runner verifies the loopback database, sets up a fresh organization and approved accounts, and prints a loopback app URL, synthetic login identifiers, and the employee assignment ID. Leave it running. Open its exact URL in three tabs and sign in as Employee, Safety Officer, and Administrator before sharing the screen. Keep the terminal and password manager off-screen. Save the employee assignment ID in a local scratch note for the assignment step.

For ordinary local development, `npm start` serves the normal app at `http://localhost:3000/app/` with the configured `safeops_dev` database. Use the printed runner URL for this walkthrough.

## Timed walkthrough

| Time | Role and actions | What to explain |
| --- | --- | --- |
| 0:00–0:45 | **Employee.** Start on Overview, then **My hazards → Report hazard**. Submit **Loose guard on Line 2**, category **Mechanical**, location **Demo workshop, Line 2**. Use “A loose guard may allow contact with moving machine parts.” | The employee starts with an empty, scoped dashboard. A report enters the workflow as **Reported**. |
| 0:45–1:45 | **Safety Officer.** Open **Hazards** and the report. Select **Start review**, enter “Inspection confirmed the guard can move during normal use,” then **Confirm hazard**. Open **Risk assessments → New assessment**, choose that hazard, and enter likelihood **5** and severity **5**. Save. | The investigation gates assessment. SafeOps calculates **25 / Critical** on the server. |
| 1:45–2:35 | **Safety Officer.** On the assessment detail, select **Create corrective action**. Title **Secure the guarding**; plan “Secure the guard and inspect the mounting points.” Paste the employee assignment ID, set a due time in the future, and save. | The API checks tenant membership and account eligibility. The link from the assessment prefills the hazard ID. |
| 2:35–3:30 | **Employee.** Open **Corrective actions → Secure the guarding → Start work → Submit for verification**. Enter “All fasteners were secured and the mounting points checked,” then save. | Completion goes to **Pending verification**. The employee cannot verify their own work. |
| 3:30–4:45 | **Safety Officer.** Reopen the action and select **Verify action**. Open the hazard and **Residual risk and closure**. Record **4 × 4** with “The guard is secured, but remaining exposure during adjustments warrants review.” Select **Escalate residual risk** and give a rationale. | Verified evidence unlocks residual assessment. **16 / High** remains high even after a reduction from baseline. Escalation leaves the hazard **Confirmed**. |
| 4:45–6:15 | **Administrator.** Refresh **Overview** and show **1 unresolved escalation**. Open the hazard and its closure panel. Record a fresh **4 × 4** revision with “Reviewed the verified control and reassessed the remaining exposure.” Select **Accept residual risk and close** and enter “Explicitly accept the remaining risk in this synthetic demonstration.” | The administrator makes an explicit decision for a new revision. The closure record shows the reviewer, time, and rationale. |
| 6:15–7:30 | **Administrator.** Return to **Overview** and press **Refresh**. Show **1 closed hazard**, **1 verified action**, **0 unresolved escalations**, and a High residual rating. Open the closed record if time remains. | The dashboard queries PostgreSQL when refreshed. Closing a hazard changes its state while preserving its risk and action histories. |

The numbers and acceptance rationale are demonstration data. Real risk acceptance follows the organization's operating policy. The [automated workflow](workflow-demo.md) exercises the same path and shows rejected cross-organization reads, premature transitions, and unauthorized verification.

## Interview notes and source map

**One-minute architecture answer.** Express serves both the same-origin browser UI and the REST API. Routes compose authentication, RBAC, and Zod validation before controllers call services. Services enforce lifecycle transitions and call Prisma models. PostgreSQL stores tenant-scoped records, review histories and audit events. The browser holds a short-lived JWT in memory. On each protected request the API verifies the signature and claims, then reloads the account to check approval, role, organization, and authentication version.

| Files | Concepts to be ready to explain |
| --- | --- |
| [server.js](../server.js), [src/app.js](../src/app.js), [API routes](../src/routes/apiRoutes.js) | App and process separation, middleware order, health/readiness, same-origin static assets, HTTP error responses. |
| [Database config](../src/config/database.js), [Prisma schema](../prisma/schema.prisma), [migrations](../prisma/migrations/) | Connection pool, migrations, compound tenant keys, foreign keys, and why database constraints back up application checks. |
| [Auth service](../src/services/authService.js), [JWT utilities](../src/utils/token.js), [authentication middleware](../src/middleware/authenticate.js), [permissions](../src/config/permissions.js) | bcrypt, JWT verification and revocation, current database-backed roles, tenant-scoped lookups, and independent verification. |
| [Risk](../src/services/riskAssessmentService.js), [actions](../src/services/correctiveActionService.js), [closure](../src/services/hazardClosureService.js), [audit model](../src/models/auditLogModel.js) | Transactions commit a mutation and its audit row together. Expected versions reject stale writes with HTTP 409. Hazard-row locking coordinates relevant writes and closure checks under concurrency. |
| [Dashboard query](../src/models/dashboardModel.js), [browser session](../web/session.js), [workflow integration test](../tests/workflow.integration.test.js) | Snapshot consistency, tenant-scoped aggregates, in-memory tokens, and testing transitions through the real API and PostgreSQL. |

Be ready to answer three questions. **What happens if two users write at once?** Show the version check and explain the reload path. **Why is escalation still open?** It records a decision while keeping the hazard confirmed. **How do you know tenant isolation works?** Explain the scoped queries and show the automated test that expects a 404 from a foreign organization.

## Rehearsal and fixture reset

- [ ] Confirm the printed URL opens, all three role labels are correct, and the dashboard starts empty. Verify the employee ID is ready to paste and the browser is on private loopback.
- [ ] Rehearse in the three tabs. The JWT is tab-local and short-lived. Reloading a tab signs it out. Sign in shortly before presenting and use the dashboard's **Refresh** button for updated counts.
- [ ] Review the two demo friction points. Officers enter an assignee UUID because the user directory is administrator-only. Assessment lists show hazard IDs while the picker and assessment detail resolve titles. Start with the **New assessment** picker and use the printed employee ID.
- [ ] Keep credentials in the password manager and use synthetic values only. If a step fails, use the terminal fallback: `npm run demo:workflow` against the dedicated test database.
- [ ] To reset a completed rehearsal, press **Enter** in the runner terminal and wait for **Removed this run’s portfolio fixtures.** The runner deletes only records belonging to the organization it created, after verifying the database target. Start a new runner for fresh identifiers and a clean dashboard.
- [ ] If the process was forcibly terminated, start a new run. It creates a fresh organization and leaves any interrupted run's records isolated in `safeops_test`. For later cleanup, the UUID in that run's synthetic login domain identifies its exact organization slug, `portfolio-<UUID>`. Have the local database owner verify that exact slug and its synthetic accounts before authorizing scoped cleanup. Avoid database-wide resets or cleanup based on a shared prefix.
