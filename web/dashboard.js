const roleLabels = {
  EMPLOYEE: 'Employee',
  SAFETY_OFFICER: 'Safety Officer',
  ADMIN: 'Administrator',
};

export function dashboardNavigation(role) {
  const employee = role === 'EMPLOYEE';
  const links = [
    { target: 'overview', label: 'Overview' },
    { target: 'hazard-management', label: employee ? 'My hazards' : 'Hazards' },
    { target: 'risk', label: employee ? 'My hazard risk' : 'Risk distribution' },
    { target: 'risk-management', label: 'Risk assessments' },
    { target: 'actions', label: employee ? 'My action summary' : 'Action summary' },
    { target: 'action-management', label: 'Corrective actions' },
  ];
  if (role === 'ADMIN' || role === 'SAFETY_OFFICER') links.push({ target: 'escalations', label: 'Escalations' });
  if (role === 'ADMIN') links.push({ target: 'closures', label: 'Hazard closures' }, { target: 'user-management', label: 'User Management' });
  return links;
}

export function roleLabel(role) {
  return Object.hasOwn(roleLabels, role) ? roleLabels[role] : 'Member';
}

export function dashboardStats(data) {
  const hazards = Object.values(data.hazardsByStatus).reduce((total, count) => total + count, 0);
  const actions = Object.values(data.correctiveActionsByStatus).reduce((total, count) => total + count, 0);
  return { hazards, actions, empty: hazards === 0 && actions === 0 };
}

const dayMs = 86_400_000;
export function dateRange(fromDate, throughDate) {
  if (!fromDate && !throughDate) return null;
  const dateFormat = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateFormat.test(fromDate) || !dateFormat.test(throughDate)) throw new RangeError('Choose both dates.');
  const from = new Date(`${fromDate}T00:00:00Z`);
  const through = new Date(`${throughDate}T00:00:00Z`);
  if (!Number.isFinite(+from) || !Number.isFinite(+through) ||
    from.toISOString().slice(0, 10) !== fromDate || through.toISOString().slice(0, 10) !== throughDate) {
    throw new RangeError('Choose valid dates.');
  }
  const to = new Date(+through + dayMs);
  if (to <= from || to - from > 366 * dayMs || to.getUTCFullYear() > 9999) {
    throw new RangeError('Choose an ordered date range of no more than 366 days.');
  }
  return { from: from.toISOString(), to: to.toISOString() };
}
