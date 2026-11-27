import { getDatabase } from '../config/database.js';

export async function summarizeDashboard({ organizationId, actorId, allHazards, allActions }, { from, to }) {
  // One statement gives every metric the same PostgreSQL snapshot.
  const [summary] = await getDatabase().$queryRaw`
    WITH scope AS (
      SELECT ${organizationId}::uuid AS organization_id, ${actorId}::uuid AS actor_id,
        COALESCE(${from ?? null}::timestamptz, '-infinity'::timestamptz) AS start_at,
        COALESCE(${to ?? null}::timestamptz, 'infinity'::timestamptz) AS end_at
    ),
    visible_hazards AS (
      SELECT h.id, h.status, h."organizationId"
      FROM "Hazard" h CROSS JOIN scope s
      WHERE h."organizationId" = s.organization_id
        AND (${allHazards}::boolean OR h."reportedById" = s.actor_id)
        AND h."createdAt" >= s.start_at AND h."createdAt" < s.end_at
    ),
    visible_actions AS (
      SELECT a.status, a."dueAt"
      FROM "CorrectiveAction" a
      JOIN "Hazard" h ON h."organizationId" = a."organizationId" AND h.id = a."hazardId"
      CROSS JOIN scope s
      WHERE a."organizationId" = s.organization_id
        AND (${allActions}::boolean OR a."assigneeId" = s.actor_id OR h."reportedById" = s.actor_id)
        AND a."createdAt" >= s.start_at AND a."createdAt" < s.end_at
    ),
    effective_risks AS (
      SELECT COALESCE(residual.level, baseline.level) AS level,
        CASE WHEN residual.level IS NOT NULL THEN 'residual'
             WHEN baseline.level IS NOT NULL THEN 'baseline'
             ELSE 'unassessed' END AS source
      FROM visible_hazards h
      LEFT JOIN "RiskAssessment" a
        ON a."organizationId" = h."organizationId" AND a."hazardId" = h.id
      LEFT JOIN "RiskAssessmentRevision" baseline
        ON baseline."organizationId" = a."organizationId" AND baseline."assessmentId" = a.id
        AND baseline.version = a.version
      LEFT JOIN LATERAL (
        SELECT r.level, r."baselineVersion", r."verifiedActionCount"
        FROM "ResidualRiskRevision" r
        WHERE r."organizationId" = h."organizationId" AND r."hazardId" = h.id
        ORDER BY r.version DESC LIMIT 1
      ) residual ON residual."baselineVersion" = a.version AND EXISTS (
        SELECT 1 FROM "CorrectiveAction" actions
        WHERE actions."organizationId" = h."organizationId" AND actions."hazardId" = h.id
        HAVING count(*) = residual."verifiedActionCount" AND bool_and(actions.status = 'VERIFIED')
      )
    ),
    hazard_counts AS (
      SELECT status, count(*) AS total FROM visible_hazards GROUP BY status
    ),
    action_counts AS (
      SELECT status, count(*) AS total,
        count(*) FILTER (WHERE status <> 'VERIFIED' AND "dueAt" < CURRENT_TIMESTAMP) AS overdue
      FROM visible_actions GROUP BY status
    )
    SELECT
      CURRENT_TIMESTAMP AS "asOf",
      (SELECT jsonb_object_agg(status, total) FROM hazard_counts) AS "hazardsByStatus",
      (SELECT jsonb_object_agg(status, total) FROM action_counts) AS "correctiveActionsByStatus",
      (SELECT jsonb_object_agg(level, total) FROM (
        SELECT level, count(*) AS total FROM effective_risks WHERE level IS NOT NULL GROUP BY level
      ) counts) AS "riskLevels",
      (SELECT jsonb_object_agg(source, total) FROM (
        SELECT source, count(*) AS total FROM effective_risks GROUP BY source
      ) counts) AS "riskSources",
      (SELECT COALESCE(sum(overdue), 0)::bigint FROM action_counts) AS "overdueActions",
      (SELECT count(*)
        FROM visible_hazards h
        JOIN LATERAL (
          SELECT d.outcome FROM "HazardClosureDecision" d
          WHERE d."organizationId" = h."organizationId" AND d."hazardId" = h.id
          ORDER BY d."residualVersion" DESC LIMIT 1
        ) latest ON latest.outcome = 'ESCALATED'
        WHERE h.status = 'CONFIRMED'
      ) AS "unresolvedEscalations"
  `;
  return summary;
}
