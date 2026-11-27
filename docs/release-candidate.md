# SafeOps v0.1.0 release candidate

**Recommended candidate label:** `v0.1.0-rc.1`. The package and API version remain `0.1.0`. The label is a proposal and requires explicit approval before tagging. Private staging verification and production approval are pending.

## Portfolio description

SafeOps is a multi-tenant workplace safety and risk management application built with Express, Prisma, PostgreSQL, and JavaScript. Employees report hazards and complete assigned corrective actions. Safety officers investigate, assess risk, and verify corrective work. Administrators can accept elevated residual risk after escalation and reassessment. The app uses role-based access, versioned records, transactional audit logging, and a dashboard that summarizes the hazard lifecycle.

## Version notes

- Role-scoped browser workspace for employees, safety officers, and administrators, backed by JWT authentication and account lifecycle controls.
- Hazard reporting, investigation, baseline risk assessments, corrective actions, independent verification, residual risk, escalation, and terminal closure.
- Tenant-scoped dashboard and audit history. Concurrent edits require reload when the supplied version is stale.
- Reproducible [browser portfolio walkthrough](portfolio-demo.md) and [automated PostgreSQL workflow](workflow-demo.md), both using disposable local data.

## Local verification and release gates

- [x] The private source branch matched its GitHub ref when exported. The publication snapshot has separate history.
- [x] `npm test` passed 65 tests. `npm run test:integration` passed 93 tests. Both ran with zero skips in the verified source checkout. `npm run demo:workflow` passed separately.
- [x] Prisma schema validation passed. All six migrations are current on local `safeops_dev` and dedicated `safeops_test`.
- [x] Full and production-only dependency audits reported zero vulnerabilities. Tracked files and reachable Git history passed checks for local credentials, sensitive paths, and common secret patterns.
- [x] The demo runner served loopback only, rejected unsafe database configurations before connecting, omitted secrets from output, and cleaned up one disposable organization without affecting a second concurrent run.
- [ ] Approve the candidate release label before creating a tag.
- [ ] Approve and complete the private staging steps below. Record staging evidence before any separate tester-access or production decision.

## Private staging blockers and deployment order

1. **Obtain approval before provisioning.** Confirm the cost ceiling, region, isolation model, repository access scope, DNS and route, named testers, and whether private-network HTTP between the connector and Express is acceptable.
2. **Create the isolated staging topology after approval.** Provision the Render Private Service, same-network tunnel worker, and a separate managed PostgreSQL instance with synthetic data only. Pin the tested Node.js version and candidate commit. Disable automatic deployment and public previews. Use the [private staging runbook](private-staging.md) for the internal origin address, secret injection, and provider settings.
3. **Prove the database boundary.** Configure separate migration and runtime roles and externally allowlisted egress. Use the external PostgreSQL hostname with `sslmode=require&sslaccept=strict` in the pinned Prisma migration job and `sslmode=verify-full` in Express. Verify valid TLS and rejection of a bad certificate or hostname for each client. Apply migrations from the migration job, confirm status, and verify application permissions with the least-privilege runtime role.
4. **Verify access and operations.** Start the application on the private network. Configure Cloudflare Access before enabling the approved route. Test anonymous denial, no public origin bypass, multi-client throttling, health, readiness, and sanitized logs. Approve and rehearse operator-only administrator provisioning and account recovery. The shipped bootstrap CLI is development-only.
5. **Rehearse recovery and sign off.** Restore a backup to a separate database and verify records, grants, and smoke results. Exercise the rollback checklist and run the full employee–officer–administrator workflow on staging HTTPS. Record evidence and obtain separate approval before enrolling testers. See the [deployment readiness checklist](deployment-readiness.md).

Hosted TLS, network access, runtime grants, monitoring, administrator recovery, and backup restoration still require staging evidence. Production requires its own environment verification and explicit approval after private staging.
