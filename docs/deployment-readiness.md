# Deployment readiness

SafeOps can be evaluated locally with an isolated PostgreSQL database. Complete the following checks on the intended private staging topology before authorizing any public release.

The [private staging runbook](private-staging.md) defines the recommended topology, environment and role separation, operator gates, and staging smoke tests.

Use its client-specific PostgreSQL TLS settings. The application runtime and the pinned Prisma migration engine interpret the URL's TLS parameters differently.

## Release checklist

- [ ] Pin the supported Node.js runtime. Use `npm ci`, generate the Prisma client, and run `npm test`, `npm run test:integration`, `npx prisma validate`, `npm audit`, and `npm audit --omit=dev`. Confirm all database tests ran with zero skips.
- [ ] Separate staging, production, and test databases. Use a migration owner and a separate runtime role that can perform the required application reads and writes. Restrict database connectivity and verify TLS and certificate handling for the deployment database. Restrict direct access to the Express listener at the network layer.
- [ ] Inject `NODE_ENV=production`, the runtime database URL, a random JWT secret, explicit issuer and audience, and the approved origin list through deployment secret and configuration management. Keep JWT lifetimes short. Document key rotation and the expected invalidation of existing sessions.
- [ ] Apply migrations with the migration identity. Run `prisma migrate status` against the intended database. Verify backup restoration and plan how to recover from a failed migration before running it on production.
- [ ] Terminate HTTPS at the deployment edge. Verify CSP, HSTS, CORS allowlist, cache controls and trusted proxy behavior over the real hostname. Add edge rate limiting or a shared limiter suited to the topology. Verify actual `429` behavior without relying on caller-supplied forwarding headers.
- [ ] Establish an approved production path to provision the first administrator and recover access. The existing bootstrap CLI targets loopback `safeops_dev` in development. Test the production provisioning and recovery process on staging before inviting users.
- [ ] Configure health and readiness probes, sanitized log collection, alerting, and database availability monitoring. Confirm shutdown, rollback or service recovery under the actual process supervisor.
- [ ] Run the [role-based browser smoke checks](frontend.md#browser-verification) over staging HTTPS with disposable accounts. Check a physical mobile browser and screen-reader navigation. Record who verified the checks and approve the release separately.

## Gaps to resolve before public release

The local cluster uses separate database owners for development and tests. That setup does not establish least-privilege production grants. The application currently uses per-process, socket-IP authentication throttling. Behind a proxy, multiple users can share a limiter bucket, and multiple replicas can have separate counters. The intended proxy and enforcement layer need explicit testing. The bootstrap command is development-only, and the application has no built-in password recovery, MFA, or email verification. Production administrator provisioning and recovery, HTTPS/network controls, backups and restore, and operational monitoring require deployment-specific verification.
