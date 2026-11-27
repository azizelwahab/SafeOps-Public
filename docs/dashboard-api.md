# Operational dashboard

`GET /api/v1/dashboard/summary` returns a read-only snapshot. It requires an approved, undeleted account and a valid bearer token. Responses use the standard JSON envelope and `Cache-Control: no-store`. Clients supply date bounds only.

```http
GET /api/v1/dashboard/summary?from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z
Authorization: Bearer <access-token>
```

Example response for a closed hazard with one verified action and High residual risk:

```json
{
  "success": true,
  "data": {
    "asOf": "2026-11-25T10:00:00.000Z",
    "range": {
      "from": "2026-11-01T00:00:00.000Z",
      "to": "2026-12-01T00:00:00.000Z"
    },
    "hazardsByStatus": {
      "REPORTED": 0,
      "UNDER_REVIEW": 0,
      "CONFIRMED": 0,
      "DISMISSED": 0,
      "CLOSED": 1
    },
    "riskLevels": { "LOW": 0, "MEDIUM": 0, "HIGH": 1, "CRITICAL": 0 },
    "riskSources": { "baseline": 0, "residual": 1, "unassessed": 0 },
    "correctiveActionsByStatus": {
      "OPEN": 0,
      "IN_PROGRESS": 0,
      "PENDING_VERIFICATION": 0,
      "VERIFIED": 1
    },
    "overdueActions": 0,
    "closedHazards": 1,
    "unresolvedEscalations": 0
  }
}
```

## Metrics

| Field | Definition |
| --- | --- |
| `asOf` | PostgreSQL snapshot time, also used to determine whether actions are overdue. |
| `range` | Applied bounds normalized to UTC. Both values are `null` when the range is omitted. |
| `hazardsByStatus` | Counts visible hazards by current status. Each hazard appears once. |
| `riskLevels` | Counts visible hazards with an effective rating, once per hazard. Uses a current residual rating when valid, otherwise the current baseline rating. |
| `riskSources` | Counts the source selected for each visible hazard. `baseline` uses the current baseline version. `residual` uses the latest residual revision when its baseline version matches and its verified-action count equals the current action count, with all actions verified. `unassessed` means neither source produced a rating. |
| `correctiveActionsByStatus` | Counts visible corrective actions individually by current status. |
| `overdueActions` | Counts visible actions with a due time strictly before `asOf` whose status is anything other than `VERIFIED`. |
| `closedHazards` | The `CLOSED` bucket in `hazardsByStatus`. Closure date is independent of the filter. |
| `unresolvedEscalations` | Counts visible hazards still `CONFIRMED` whose latest recorded closure decision is `ESCALATED`. Further residual revisions do not resolve an escalation by themselves. |

Every status, risk level, and source bucket is returned even when its count is zero. Historical baseline revisions and residual revisions are not counted separately. An accepted High or Critical residual risk stays in its level after the hazard is closed.

## Dates and access

Send both `from` and `to` as ISO 8601 timestamps with a time zone, or omit both to count all records. The interval includes `from`, excludes `to`, and must be positive and at most 366 days. Unknown query fields and invalid ranges return 400. Encode a literal plus sign in URL offsets as `%2B`.

Hazard, risk, closure, and escalation counts use the hazard's creation time. Corrective-action counts use the action's own creation time, even if the parent hazard is outside the range. Residual freshness considers every action on the hazard, regardless of the range. The dashboard shows current states for those creation cohorts. It does not reconstruct the database as it was at `to`.

Safety officers and administrators see their organization's records. Employees see hazards they reported and corrective actions they are assigned or can see through those reports. Assignment to an action on another employee's hazard adds only that action to the employee's dashboard. It does not expose that hazard, its risk, its closure, or its escalation. Cross-organization records are excluded from all aggregates.

One parameterized PostgreSQL query returns aggregate counts from a consistent snapshot. The endpoint exposes no row IDs or free text. Large organizations requesting all-time data can still make the database scan many scoped records.
