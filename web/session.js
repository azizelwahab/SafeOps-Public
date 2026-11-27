import { ApiError } from './api.js';

export function createSession(api, {
  onEnd,
  now = Date.now,
  schedule = setTimeout,
  cancel = clearTimeout,
}) {
  let active;

  function end(reason = 'signed-out') {
    if (!active) return;
    cancel(active.timer);
    active = undefined;
    onEnd(reason);
  }

  async function signIn(credentials) {
    const startedAt = now();
    const { accessToken, expiresIn, user } = await api.login(credentials);
    if (typeof accessToken !== 'string' || !accessToken || !Number.isSafeInteger(expiresIn) || expiresIn <= 0 || !user) {
      throw new ApiError(502);
    }
    if (active) cancel(active.timer);
    const expiresAt = startedAt + expiresIn * 1000;
    const session = { token: accessToken, expiresAt };
    active = session;
    session.timer = schedule(() => {
      if (active === session) end('expired');
    }, Math.max(0, expiresAt - now()));
    return user;
  }

  async function authenticated(operation) {
    const session = active;
    if (!session || now() >= session.expiresAt) {
      end('expired');
      return null;
    }
    try {
      const data = await operation(session.token);
      if (active !== session) return null;
      if (now() >= session.expiresAt) {
        end('expired');
        return null;
      }
      return data;
    } catch (error) {
      if (active !== session) return null;
      if (error.status === 401) {
        end('expired');
        return null;
      }
      throw error;
    }
  }

  async function withProfile(token, pending) {
    const [user, data] = await Promise.all([api.profile(token), pending]);
    return { user, data };
  }

  return {
    signIn, end,
    loadDashboard: (range) => authenticated((token) => withProfile(token, api.dashboard(token, range))),
    loadHazards: (filters) => authenticated((token) => withProfile(token, api.listHazards(token, filters))),
    loadHazard: (id) => authenticated((token) => withProfile(token, api.getHazard(token, id))),
    reportHazard: (body) => authenticated((token) => api.reportHazard(token, body)),
    editHazard: (id, body) => authenticated((token) => api.editHazard(token, id, body)),
    startHazardReview: (id) => authenticated((token) => api.startHazardReview(token, id)),
    confirmHazard: (id, body) => authenticated((token) => api.confirmHazard(token, id, body)),
    dismissHazard: (id, body) => authenticated((token) => api.dismissHazard(token, id, body)),
    loadAssessments: (query) => authenticated((token) => withProfile(token, api.listAssessments(token, query))),
    loadAssessment: (id) => authenticated((token) => withProfile(token, api.getAssessment(token, id))),
    loadAssessmentHistory: (id, query) => authenticated((token) => api.assessmentHistory(token, id, query)),
    createAssessment: (body) => authenticated((token) => api.createAssessment(token, body)),
    updateAssessment: (id, body) => authenticated((token) => api.updateAssessment(token, id, body)),
    loadActions: (query) => authenticated((token) => withProfile(token, api.listActions(token, query))),
    loadAction: (id) => authenticated((token) => withProfile(token, api.getAction(token, id))),
    actionHistory: (id, query) => authenticated((token) => api.actionHistory(token, id, query)),
    actionHazard: (id) => authenticated((token) => api.getHazard(token, id)),
    createAction: (body) => authenticated((token) => api.createAction(token, body)),
    updateAction: (id, body, transition) => authenticated((token) => api.updateAction(token, id, body, transition)),
    approvedUsers: (query) => authenticated((token) => api.approvedUsers(token, query)),
    loadUsers: (query) => authenticated((token) => withProfile(token, api.listUsers(token, query))),
    changeUser: (id, action, body) => authenticated((token) => api.changeUser(token, id, action, body)),
    closureBaseline: (id) => authenticated((token) => api.listAssessments(token, { hazardId: id, page: 1, limit: 1 })),
    closureActions: (id, page) => authenticated((token) => api.listActions(token, { hazardId: id, page, limit: 100 })),
    residualRisk: (id) => authenticated((token) => api.residualRisk(token, id)),
    residualHistory: (id, query) => authenticated((token) => api.residualHistory(token, id, query)),
    closureDecision: (id) => authenticated((token) => api.closureDecision(token, id)),
    recordResidual: (id, body) => authenticated((token) => api.recordResidual(token, id, body)),
    decideClosure: (id, body) => authenticated((token) => api.decideClosure(token, id, body)),
  };
}
