# Reproducible end-to-end demo

Run these commands from the SafeOps repository root against the dedicated local test database. See the [README](../README.md) for PostgreSQL setup.

```powershell
npm ci
npx prisma generate
.\scripts\postgres-local.ps1 status
npm run db:migrate:test
npm run demo:workflow
```

Start the local cluster with `.\scripts\postgres-local.ps1 start` if it is stopped. Configure `TEST_DATABASE_URL` to point to the loopback `safeops_test` database. The demo skips with an explicit reason when this URL is unset and refuses other database names or non-loopback targets. It verifies the connected database name and address before fixture writes and teardown. The same workflow runs in `npm run test:integration`.

The demo creates two uniquely named organizations and generates random credentials in memory. It uses the bootstrap service only for the two initial administrators. It exercises the remaining workflow through the normal API with Supertest. The output shows checkpoints and aggregate metrics without printing credentials, tokens, or fixture IDs.

| Step | Expected behavior |
| --- | --- |
| Signup and approval | Two public signups return 202. Pending login returns 401. The administrator approves both accounts, promotes one to safety officer, and both users log in. |
| Hazard investigation | The employee reports a hazard. Confirming before review returns 409. The safety officer starts review and confirms it. A foreign administrator receives 404 on hazard read and risk assessment creation. |
| Baseline risk and assignment | The safety officer records a Critical baseline rating and assigns a corrective action to the employee. |
| Completion and verification | Submitting before work starts returns 409. The employee starts and submits work. Employee verification returns 403. The safety officer independently verifies the action. |
| Residual risk and escalation | The officer records High residual risk. A closure request without a decision returns 409 and officer acceptance returns 403. Escalation leaves the hazard confirmed, and the dashboard shows one unresolved escalation. |
| Administrator acceptance | The administrator records a new residual revision and explicitly accepts the High risk. The hazard closes. The reporter's dashboard shows one closed hazard, one verified action, one High residual rating, and zero unresolved escalations. The foreign dashboard shows no local hazard or action counts. |

Teardown removes records only from the organizations created for this run. A process killed before teardown may leave its unique fixtures in `safeops_test`. The test harness is intended for isolated development and CI databases.
