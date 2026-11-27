import { CorrectiveActionStatus, HazardStatus, RiskLevel } from '@prisma/client';
import { hasPermission, Permission } from '../config/permissions.js';
import { summarizeDashboard } from '../models/dashboardModel.js';

function countsFor(keys, counts) {
  return Object.fromEntries(keys.map((key) => [key, counts?.[key] ?? 0]));
}

export async function getDashboardSummary(auth, range) {
  const summary = await summarizeDashboard({
    organizationId: auth.organizationId,
    actorId: auth.id,
    allHazards: hasPermission(auth, Permission.HAZARD_READ_ALL),
    allActions: hasPermission(auth, Permission.CORRECTIVE_ACTION_MANAGE),
  }, range);
  const hazardsByStatus = countsFor(Object.values(HazardStatus), summary.hazardsByStatus);

  return {
    asOf: summary.asOf,
    range: { from: range.from ?? null, to: range.to ?? null },
    hazardsByStatus,
    riskLevels: countsFor(Object.values(RiskLevel), summary.riskLevels),
    riskSources: countsFor(['baseline', 'residual', 'unassessed'], summary.riskSources),
    correctiveActionsByStatus: countsFor(Object.values(CorrectiveActionStatus), summary.correctiveActionsByStatus),
    overdueActions: Number(summary.overdueActions),
    closedHazards: hazardsByStatus.CLOSED,
    unresolvedEscalations: Number(summary.unresolvedEscalations),
  };
}
