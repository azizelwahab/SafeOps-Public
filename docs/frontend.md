# SafeOps web frontend

Phase 10A uses semantic HTML, CSS and native JavaScript modules. Express serves the frontend at `/app/` on the same origin as the API. This keeps local development to one process, avoids a bundler and a frontend runtime dependency, and lets the browser use relative API URLs.

## Browser routes and API

`/app` redirects to `/app/`, which contains sign-in, the operational dashboard, Hazards, Risk Assessments, and Corrective Actions. Open a workspace from the navigation. Express enforces account, organization, and record visibility.

- `POST /api/v1/auth/login` supplies the access token, its lifetime, and the user profile.
- `GET /api/v1/auth/me` refreshes the user's identity and role alongside dashboard and workspace reads.
- `GET /api/v1/dashboard/summary` supplies all displayed counts. The optional date filter uses UTC dates, with the final selected day included. The API receives an exclusive endpoint at the start of the next UTC day.

## Authentication and limitations

The bearer token stays in JavaScript memory. It is never written to local storage, session storage, cookies, or URLs. The client clears authenticated content on sign-out, local expiry, or a protected API response of 401. Password fields are cleared after every submission. API data is rendered as text. Existing Helmet protections apply, and the interface loads no third-party assets.

Reloading or opening a new tab requires a new sign-in. The session lasts up to the access token's expiry, and sign-out discards the token from that tab. Use HTTPS outside loopback.

## Responsive review

The single `/app/` route switches between signed-out forms and role-aware workspaces. The review covered these surfaces:

| Screen | Components reviewed |
| --- | --- |
| Sign-in and registration | Credential fields, registration form, validation and status messages |
| Dashboard | Date filter, refresh, KPI cards, hazard and action status charts, risk distribution, closure and escalation counts |
| Hazards | Filters, paginated reports, report editor, detail facts, investigation notes and decisions |
| Risk assessments | Assessment and revision lists, hazard picker, likelihood and severity editor, assessment facts |
| Corrective actions | Filterable table, assignment form, detail and history, completion and independent verification |
| Residual risk and closure | Baseline comparison, residual editor and history, prerequisite checklist, escalation and acceptance decisions, closure record |
| User Management | Directory and status filter, registration slug, pagination, native account-change confirmations |
| Workspace navigation | Desktop sidebar, mobile Menu disclosure, active destination, skip link and sign-out |

In Edge, test at 320, 360, 375, 390, 430, 600, 768, 1024, 1280, 1440, 1600 and 1920 CSS pixels. Resize while each workspace is open. On mobile, open **Menu** with Enter, Tab to a destination, and use Escape to close it and return focus to the trigger. Check that record text wraps, actions remain reachable, and the page fits without horizontal scrolling. Use the guarded portfolio demo runner for browser testing with disposable PostgreSQL accounts and records.

## Employee onboarding and User Management

1. Sign in as an administrator and open **User Management**. Give the employee the registration organization slug shown there.
2. On the sign-in screen, select **Request an account**, enter the slug, name and work email, and choose a password. The form uses `POST /api/v1/auth/signup`. The API gives a generic response so registration cannot be used to look up accounts or organizations.
3. In **User Management**, filter by **Pending** and approve or reject the request. An approved employee can then sign in. Administrators can also suspend eligible approved accounts or switch them between Employee and Safety Officer. Suspension ends their access on subsequent protected requests.

The workspace uses the organization-scoped users API. Verify in a separate browser session that a pending user cannot sign in, an approved employee can sign in without seeing **User Management**, and a suspended employee is returned to sign-in on their next protected request. Use disposable accounts for this check.

## Hazards workspace

- `GET /api/v1/hazards` powers the list and its search, status, category, and location filters. Applying filters resets to page one. The workspace requests 10 records at a time. If **Next** finds an empty page, the current rows stay visible and the workspace announces that you reached the last page.
- `POST /api/v1/hazards` reports a hazard. The form sends title, description, category and location. `GET /api/v1/hazards/:id` supplies the detail, including investigation status and any recorded notes.
- `PATCH /api/v1/hazards/:id` edits a report. Employees see the edit control only on their own reports in `REPORTED` status.
- Safety officers and administrators can start review with `PATCH /api/v1/hazards/:id/review` on a reported hazard. Once it is under review, they can use `PATCH /api/v1/hazards/:id/confirm` or `PATCH /api/v1/hazards/:id/dismiss`. Both decisions require review notes of 10–2,000 characters after trimming.

## Risk Assessments workspace

- `GET /api/v1/risk-assessments` lists baseline assessments visible to the account. Each list entry identifies its hazard by ID. Details resolve the hazard title through the authorized hazard endpoint. Employees see assessments only for hazards the API allows them to read.
- `POST /api/v1/risk-assessments` accepts a confirmed hazard ID and integer likelihood and severity ratings from 1 to 5. Safety officers and administrators can find eligible hazards using the confirmed-hazard picker. A hazard that already has a baseline assessment is rejected by the API.
- `GET /api/v1/risk-assessments/:id` supplies current ratings, score, level, version, assessor ID, and assessment, creation, and update timestamps. `GET /api/v1/risk-assessments/:id/history` supplies paginated revisions, most recent first. Scores and levels come from the API. The scoring bands are Low 1–4, Medium 5–9, High 10–16, and Critical 17–25.
- `PATCH /api/v1/risk-assessments/:id` saves revised ratings with the version loaded into the editor. When a newer revision exists, saving is blocked. **Reload latest assessment** discards the draft and opens the latest record. Editing can then start again from that version. Assessments for closed hazards are read-only.

## Corrective Actions workspace

- `GET /api/v1/corrective-actions` lists authorized actions. Filters use the API's hazard ID, assignee ID, status, and overdue parameters. An overdue action is past its due date and unverified. The workspace requests 10 records per page. If Next finds an empty page, the workspace returns to the preceding page and announces the end of the results.
- `GET /api/v1/corrective-actions/:id` provides the plan, assignment, due date, current status, work notes, completion details and version. `GET /api/v1/corrective-actions/:id/history` supplies paginated event types, actor IDs, timestamps, status changes and recorded submission or return text.
- Hazard titles and links require a successful independent hazard read. An employee can see their own assignments and actions on hazards they reported, as scoped by the API. Assignment alone grants access to that action and its history. The workspace only shows sibling actions when the list API authorizes them.
- Officers and administrators can create actions with `POST /api/v1/corrective-actions` for a confirmed and assessed hazard. Start from **New action** with the hazard ID, or from **Create corrective action** on the baseline assessment detail. The due time is entered in the browser's local timezone and sent as an ISO timestamp.
- Managers can edit plans and reassign open or in-progress actions through `PATCH /api/v1/corrective-actions/:id`. **Assign to me** fills in the signed-in manager's ID. Administrators can search the approved-user directory. Officers assigning other people enter an approved assignee ID supplied by an administrator. The server checks organization membership, approval and deletion status. The list displays the current user's name for their assignments and IDs for other assignees.
- Assigned employees can use `PATCH /:id/start` to move from Open to In progress, edit work notes while In progress, and use `PATCH /:id/submit` to move to Pending verification. Managers can also perform these operations. Completion details and return reasons require 10–4,000 characters and at least three letters or numbers.
- Managers can use `PATCH /:id/verify` or `PATCH /:id/return` on pending work. Verification requires someone other than the assignee or submitter and makes the action read-only. Returning an action requires a reason and moves it back to In progress. The transition paths are relative to `/api/v1/corrective-actions`.
- Mutations send the loaded version. **Reload current data** opens the latest record after a version or state conflict. The user can then reapply changes as appropriate.

## Residual risk and closure

Open **Residual risk and closure** from a confirmed or closed hazard. The comparison shows the current baseline assessment separately from the latest residual revision. Both scores and levels come from the server. Residual revision history shows ratings, evidence versions, assessor IDs, timestamps, and rationales. The closure endpoint supplies the latest decision, including its reviewer ID, timestamp, and rationale.

- Confirmed hazards show a readiness checklist to safety officers and administrators. It checks for a baseline assessment, at least one action, verification of all actions, and a residual revision matching the current baseline version and verified-action count. The checklist reads existing endpoints. The server rechecks prerequisites and permissions together when saving.
- `POST /api/v1/hazards/:id/residual-risk` records whole-number ratings from 1 to 5 and a rationale, using version 0 for the first submission and the latest saved version thereafter. Changes to the baseline or newly verified actions require a fresh residual assessment before closure.
- `PATCH /api/v1/hazards/:id/close` uses the latest residual revision and a rationale. For Low or Medium risk, officers and administrators can close without an acceptance decision. For High or Critical risk, either role can escalate, and only an administrator can explicitly accept and close.
- Escalation keeps the hazard confirmed. That residual revision already has a decision, so record a fresh revision before escalating again or closing. **Reload closure data** is available when evidence changes or another decision is recorded. Review the latest state before resubmitting.
- Employees can read baseline, residual, and decision records only for hazards they can already read. Closure and residual forms are hidden for employees and for closed hazards.

## Browser verification

1. Start the configured local PostgreSQL cluster, generate the Prisma client, and check that migrations are current. Use an existing approved local account or follow the [README bootstrap procedure](../README.md#provision-the-first-administrator).
2. Run `npm run dev` and open `http://localhost:3000/app/` for the default port.
3. Sign in and verify that the role, organization, and aggregate counts match the accessible records. For an employee, check the personal dashboard section labels.
4. Apply a date range with no records, then clear it. Verify that the empty message and zero counts appear for the filtered range and that clearing restores the all-time summary.
5. Use Tab and Enter to operate sign-in, date filters, navigation, Refresh, and Sign out. Try a narrow browser viewport and verify that the layout stacks without horizontal scrolling.
6. Use the browser's offline mode, press Refresh, then reconnect and retry. Reload to check that the page requests sign-in again. To verify server-side revocation, use a disposable test account and suspend it while its dashboard is open, then press Refresh.
7. With an approved disposable employee account, open My hazards. Report a hazard, open its detail, and edit it while reported. Use the list filters and pagination with fixture data. Try submitting a blank or whitespace-only required field.
8. With an approved safety officer or administrator from the same organization, open the report and start review. Confirm one report and dismiss another. Try a short note and then a valid one. Sign in as the reporting employee again and check that the decision is visible and editing is unavailable.
9. In Microsoft Edge, repeat the list and detail checks at desktop and mobile widths. Use Tab and Enter to operate filters, pagination, and forms. Switch offline before applying a filter, reconnect, and use Retry. To exercise an expired session on the Hazards screen, wait for the configured token lifetime or revoke a disposable account and refresh the hazard list.
10. In Edge, sign in as an officer or administrator and open Risk assessments. Select **New assessment**, search for a confirmed hazard, and try submitting a rating outside 1–5. Submit valid ratings and check the details and revision history against the saved assessment.
11. Open the same assessment for editing in two signed-in tabs. Save in one, then try to save in the other. Verify the conflict message and that **Reload latest assessment** shows the newer version. Use a narrow viewport and keyboard navigation to check the detail and revision list.
12. Sign in as the employee who reported the assessed hazard. Verify that the assessment is visible, create and edit controls are absent, and assessments for other reporters are absent. Revoke the disposable account and navigate back to the assessment list to verify sign-in is required again.
13. In Edge, use an officer account to create an action from a confirmed hazard's assessment. Check invalid due dates, assignee eligibility, and all four list filters. Use more than 10 action fixtures to check pagination on desktop.
14. Assign one action on an officer-reported hazard to a disposable employee and another to a different user. As the first employee, open Corrective actions at a mobile width. Verify the assignment and its history are visible, the linked hazard and the other action are unavailable, and work notes and completion can be saved.
15. As administrator, find an approved user and reassign an open or in-progress action. Return submitted work with a reason and then verify a new submission using an independent manager account. Also submit from an account with manager privileges and check that the submitter cannot verify it. Verify that completed actions have no mutation controls.
16. Edit the same work notes or plan in two signed-in tabs. Save in the first tab and check that the second tab must reload before saving again. Check error retry by going offline and session expiry by revoking a disposable account.
17. In Edge, open an isolated confirmed hazard as an officer. Check that incomplete corrective actions block residual recording. Create a baseline assessment if missing, then complete and independently verify every action. Open **Residual risk and closure**, record Low or Medium residual risk, and verify that the baseline and residual scores are presented separately.
18. With that panel open, update the baseline in another signed-in tab. Submit the closure from the first tab and check that it reports the conflict. Reload, record fresh residual risk, then close with a rationale. Verify the hazard shows **Closed**, displays its decision record, and has no mutation controls.
19. For another assessed hazard with verified actions, record High or Critical residual risk. As officer, escalate and confirm that the hazard remains confirmed. As administrator, confirm the escalated revision cannot be used for another decision. Record a fresh revision, explicitly select acceptance, and close. Use at least 11 residual revisions to check history pagination.
20. Repeat the detail check in a mobile-width Edge window. Sign in as the reporting employee and confirm that authorized records are read-only. Sign in as a different employee and verify the hazard is absent. Revoke a disposable employee account and reopen the panel to check that the sign-in screen returns.

`npm test` covers frontend validation, role-sensitive controls, score and event rendering, filters, independent verification rules, closure prerequisites and stale-version handling. `npm run test:integration` exercises the real login, dashboard, hazard, risk-assessment, corrective-action, residual-risk and closure workflows against isolated PostgreSQL fixtures.
