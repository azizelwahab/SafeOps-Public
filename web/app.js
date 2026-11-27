import { createApiClient } from './api.js';
import { dashboardNavigation, dashboardStats, dateRange, roleLabel } from './dashboard.js';
import { createSession } from './session.js';
import { createHazardsView } from './hazard-view.js';
import { createRiskView } from './risk-view.js';
import { createActionView } from './action-view.js';
import { createUserView, setupSignup } from './user-view.js';

const byId = (id) => document.getElementById(id);
const loginForm = byId('login-form');
const rangeForm = byId('range-form');
const metrics = byId('metrics');
const statusBox = byId('dashboard-status');
const navigationToggle = byId('navigation-toggle');
const number = new Intl.NumberFormat();
const localTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

let range = null;
let refreshId = 0;
let navigationRole;
let navigationTarget = 'overview';

const api = createApiClient();
setupSignup(api, loginNotice);
const session = createSession(api, {
  onEnd(reason) {
    navigationToggle.setAttribute('aria-expanded', 'false');
    refreshId++;
    hazardsView.reset();
    riskView.reset();
    actionView.reset();
    userView.reset();
    navigationTarget = 'overview';
    byId('dashboard-content').hidden = false;
    byId('workspace-path').textContent = 'Operations / Dashboard';
    range = null;
    rangeForm.reset();
    byId('filter').open = false;
    byId('range-error').hidden = true;
    byId('range-label').textContent = 'All time';
    byId('dashboard-view').hidden = true;
    metrics.hidden = true;
    metrics.removeAttribute('aria-busy');
    navigationRole = undefined;
    byId('navigation').replaceChildren();
    for (const id of ['key-metrics', 'hazard-chart', 'risk-chart', 'risk-sources', 'action-chart']) byId(id).replaceChildren();
    byId('snapshot').textContent = '';
    for (const id of ['organization', 'workspace-role', 'top-role', 'avatar', 'user-name', 'user-role', 'dashboard-scope']) {
      byId(id).textContent = '';
    }
    byId('login-view').hidden = false;
    byId('skip-link').href = '#login-title';
    loginNotice(reason === 'expired' ? 'Your session expired. Sign in again to continue.' : 'You signed out.');
    byId('login-title').focus();
  },
});
const hazardsView = createHazardsView(session, renderIdentity);
const riskView = createRiskView(session, renderIdentity, (hazardId, user) => openWorkspace('action-management', { hazardId, user }));
const actionView = createActionView(session, renderIdentity, (id) => openWorkspace('hazard-management', id));
const userView = createUserView(session, renderIdentity);
const workspaces = {
  'hazard-management': { view: hazardsView, label: 'Hazards', heading: 'hazard-list-title' },
  'risk-management': { view: riskView, label: 'Risk assessments', heading: 'risk-workspace-title' },
  'action-management': { view: actionView, label: 'Corrective actions', heading: 'action-workspace-title' },
  'user-management': { view: userView, label: 'User Management', heading: 'users-title' },
};

function openWorkspace(target, options) {
  const workspace = workspaces[target];
  selectNavigation(byId('navigation').querySelector(`[data-section="${target}"]`));
  byId('dashboard-content').hidden = true;
  byId('workspace-path').textContent = 'Operations / ' + workspace.label;
  byId('skip-link').href = '#' + workspace.heading;
  for (const { view } of Object.values(workspaces)) if (view !== workspace.view) view.hide();
  workspace.view.show(options);
}

function element(tag, className, label) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (label !== undefined) node.textContent = label;
  return node;
}

function loginNotice(message, error = false) {
  const notice = byId('login-notice');
  notice.textContent = message;
  notice.classList.toggle('error', error);
  notice.hidden = !message;
}

function renderIdentity(user) {
  const role = roleLabel(user.role);
  byId('organization').textContent = user.organization?.name || 'SafeOps workspace';
  byId('workspace-role').textContent = user.role === 'EMPLOYEE' ? 'Personal overview' : 'Organization overview';
  byId('top-role').textContent = role;
  byId('user-name').textContent = user.name;
  byId('user-role').textContent = role;
  byId('avatar').textContent = user.name.trim().split(/\s+/).slice(0, 2).map((name) => [...name][0]).join('').toUpperCase();
  byId('dashboard-scope').textContent = user.role === 'EMPLOYEE'
    ? 'Track the hazards you reported and corrective work you can access.'
    : 'Track hazards, risk levels, and corrective work across your organization.';

  if (navigationRole === user.role) return;
  navigationRole = user.role;
  const nav = byId('navigation');
  nav.replaceChildren(...dashboardNavigation(user.role).map(({ target, label }) => {
    const link = element('a', 'nav-link', label);
    link.href = '#' + target;
    link.dataset.section = target;
    if (target === navigationTarget) link.setAttribute('aria-current', 'location');
    return link;
  }));
}

navigationToggle.addEventListener('click', () => {
  navigationToggle.setAttribute('aria-expanded', String(navigationToggle.getAttribute('aria-expanded') === 'false'));
});

byId('sidebar-menu').addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && navigationToggle.getAttribute('aria-expanded') === 'true' && navigationToggle.offsetWidth) {
    navigationToggle.setAttribute('aria-expanded', 'false');
    navigationToggle.focus();
  }
});

byId('navigation').addEventListener('click', (event) => {
  const link = event.target.closest('a');
  if (!link) return;
  navigationToggle.setAttribute('aria-expanded', 'false');
  const target = link.dataset.section;
  if (Object.hasOwn(workspaces, target)) {
    event.preventDefault();
    openWorkspace(target);
    return;
  }
  const wasInHazards = byId('dashboard-content').hidden;
  hazardsView.hide();
  riskView.hide();
  actionView.hide();
  userView.hide();
  byId('skip-link').href = '#overview';
  byId('dashboard-content').hidden = false;
  byId('workspace-path').textContent = 'Operations / Dashboard';
  const section = byId(target);
  if (wasInHazards) {
    event.preventDefault();
    selectNavigation(link);
    void refreshDashboard().then(() => {
      if (navigationTarget !== target || !section || section.closest('[hidden]')) return;
      section.tabIndex = -1;
      section.focus();
    });
    return;
  }
  if (!section || section.closest('[hidden]')) {
    event.preventDefault();
    statusBox.focus();
    return;
  }
  selectNavigation(link);
  section.tabIndex = -1;
  section.focus({ preventScroll: true });
});

function selectNavigation(link) {
  navigationTarget = link.dataset.section;
  byId('navigation').querySelector('[aria-current]')?.removeAttribute('aria-current');
  link.setAttribute('aria-current', 'location');
}

const hazardLabels = [
  ['REPORTED', 'Reported', 'blue'], ['UNDER_REVIEW', 'Under review', 'amber'],
  ['CONFIRMED', 'Confirmed', 'teal'], ['DISMISSED', 'Dismissed', 'slate'], ['CLOSED', 'Closed', 'green'],
];
const riskLabels = [
  ['LOW', 'Low', 'green'], ['MEDIUM', 'Medium', 'amber'], ['HIGH', 'High', 'orange'], ['CRITICAL', 'Critical', 'red'],
];
const actionLabels = [
  ['OPEN', 'Open', 'blue'], ['IN_PROGRESS', 'In progress', 'teal'],
  ['PENDING_VERIFICATION', 'Pending verification', 'amber'], ['VERIFIED', 'Verified', 'green'],
];

function renderBars(container, labels, counts) {
  const list = element('ul', 'chart-list');
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  for (const [key, label, color] of labels) {
    const item = element('li', 'chart-row');
    const caption = element('div', 'chart-caption');
    caption.append(element('span', '', label), element('strong', '', number.format(counts[key])));
    const bar = element('meter', `bar ${color}`);
    bar.min = 0;
    bar.max = total || 1;
    bar.value = counts[key];
    bar.setAttribute('aria-hidden', 'true');
    item.append(caption, bar);
    list.append(item);
  }
  container.replaceChildren(list);
}

function renderDashboard(data) {
  const stats = dashboardStats(data);
  const cards = [
    ['hazard-total', 'Visible hazards', stats.hazards, 'blue', 'All hazard statuses'],
    ['overdue', 'Overdue actions', data.overdueActions, 'orange', 'Past due and unverified'],
    ['closures', 'Closed hazards', data.closedHazards, 'green', 'Closure recorded'],
    ['escalations', 'Unresolved escalations', data.unresolvedEscalations, 'red', 'Confirmed hazards awaiting a decision'],
  ];
  byId('key-metrics').replaceChildren(...cards.map(([id, label, count, color, description]) => {
    const card = element('section', `kpi ${color}`);
    card.id = id;
    card.append(element('h2', '', label), element('p', 'kpi-value', number.format(count)),
      element('p', 'kpi-description', description));
    return card;
  }));
  renderBars(byId('hazard-chart'), hazardLabels, data.hazardsByStatus);
  renderBars(byId('risk-chart'), riskLabels, data.riskLevels);
  renderBars(byId('action-chart'), actionLabels, data.correctiveActionsByStatus);
  byId('risk-sources').replaceChildren(...[
    ['Baseline', data.riskSources.baseline], ['Residual', data.riskSources.residual], ['Unassessed', data.riskSources.unassessed],
  ].map(([label, count]) => {
    const entry = element('div');
    entry.append(element('dt', '', label), element('dd', '', number.format(count)));
    return entry;
  }));
  byId('snapshot').textContent = `As of ${localTime.format(new Date(data.asOf))}`;
  byId('snapshot').hidden = false;
  metrics.hidden = false;
  setDashboardStatus(stats.empty ? 'No hazards or corrective actions are visible in this date range.' : '');
}

function setDashboardStatus(message, failed = false) {
  byId('dashboard-status-text').textContent = message;
  statusBox.hidden = !message;
  statusBox.tabIndex = -1;
  statusBox.classList.toggle('error', failed);
  byId('retry').hidden = !failed;
}

async function refreshDashboard() {
  const id = ++refreshId;
  const refresh = byId('refresh');
  refresh.disabled = true;
  metrics.hidden = true;
  byId('snapshot').hidden = true;
  metrics.setAttribute('aria-busy', 'true');
  setDashboardStatus('Loading dashboard…');
  try {
    const result = await session.loadDashboard(range);
    if (id !== refreshId || !result) return;
    renderIdentity(result.user);
    renderDashboard(result.data);
  } catch {
    if (id === refreshId) {
      setDashboardStatus('The dashboard could not be loaded. Try again in a moment.', true);
    }
  } finally {
    if (id === refreshId) {
      refresh.disabled = false;
      metrics.removeAttribute('aria-busy');
    }
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = byId('login-button');
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = 'Signing in…';
  loginNotice('');
  try {
    const user = await session.signIn({ email: loginForm.elements.email.value.trim(), password: loginForm.elements.password.value });
    loginForm.reset();
    renderIdentity(user);
    byId('login-view').hidden = true;
    byId('dashboard-view').hidden = false;
    byId('skip-link').href = '#overview';
    byId('dashboard-title').focus();
    void refreshDashboard();
  } catch (error) {
    const message = error.status === 401 ? 'Sign-in failed. Check your credentials and account approval.'
      : error.status === 429 ? 'Too many sign-in attempts. Try again later.'
        : error.status === 400 ? 'Enter a valid email and password.'
          : 'SafeOps could not complete sign-in. Check your connection and try again.';
    loginNotice(message, true);
  } finally {
    loginForm.elements.password.value = '';
    button.disabled = false;
    button.textContent = 'Sign in';
  }
});

byId('refresh').addEventListener('click', refreshDashboard);
byId('retry').addEventListener('click', refreshDashboard);
byId('logout').addEventListener('click', () => session.end());

function applyRange() {
  const error = byId('range-error');
  error.hidden = true;
  const from = rangeForm.elements.from.value;
  const to = rangeForm.elements.to.value;
  try {
    range = dateRange(from, to);
    byId('range-label').textContent = range ? `${from} to ${to}` : 'All time';
    byId('filter').open = false;
    byId('range-label').focus();
    void refreshDashboard();
  } catch (reason) {
    error.textContent = reason.message;
    error.hidden = false;
  }
}

rangeForm.addEventListener('submit', (event) => {
  event.preventDefault();
  applyRange();
});
byId('reset-range').addEventListener('click', () => {
  rangeForm.reset();
  applyRange();
});
