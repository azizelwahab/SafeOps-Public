export class ApiError extends Error {
  constructor(status, code) {
    super('The SafeOps request failed.');
    this.status = status;
    this.code = code;
  }
}

export function createApiClient(fetchRequest = globalThis.fetch) {
  async function request(path, { token, body, method = body ? 'POST' : 'GET' } = {}) {
    const headers = { Accept: 'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetchRequest(`/api/v1${path}`, {
      method,
      headers,
      ...(body && { body: JSON.stringify(body) }),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    const envelope = await response.json().catch(() => null);
    if (!response.ok || envelope?.success !== true || !envelope.data) {
      throw new ApiError(response.status, envelope?.error?.code);
    }
    return envelope.data;
  }

  return {
    login: (credentials) => request('/auth/login', { body: credentials }),
    signup: (body) => request('/auth/signup', { body }),
    profile: (token) => request('/auth/me', { token }),
    dashboard: (token, range) => {
      const query = range ? `?${new URLSearchParams(range)}` : '';
      return request(`/dashboard/summary${query}`, { token });
    },
    listHazards: (token, filters) => request(`/hazards?${new URLSearchParams(filters)}`, { token }),
    getHazard: (token, id) => request(`/hazards/${encodeURIComponent(id)}`, { token }),
    reportHazard: (token, body) => request('/hazards', { token, body }),
    editHazard: (token, id, body) => request(`/hazards/${encodeURIComponent(id)}`, { token, method: 'PATCH', body }),
    startHazardReview: (token, id) => request(`/hazards/${encodeURIComponent(id)}/review`, { token, method: 'PATCH' }),
    confirmHazard: (token, id, body) => request(`/hazards/${encodeURIComponent(id)}/confirm`, { token, method: 'PATCH', body }),
    dismissHazard: (token, id, body) => request(`/hazards/${encodeURIComponent(id)}/dismiss`, { token, method: 'PATCH', body }),
    listAssessments: (token, query) => request(`/risk-assessments?${new URLSearchParams(query)}`, { token }),
    getAssessment: (token, id) => request(`/risk-assessments/${encodeURIComponent(id)}`, { token }),
    assessmentHistory: (token, id, query) => request(`/risk-assessments/${encodeURIComponent(id)}/history?${new URLSearchParams(query)}`, { token }),
    createAssessment: (token, body) => request('/risk-assessments', { token, body }),
    updateAssessment: (token, id, body) => request(`/risk-assessments/${encodeURIComponent(id)}`, { token, body, method: 'PATCH' }),
    listActions: (token, query) => request(`/corrective-actions?${new URLSearchParams(query)}`, { token }),
    getAction: (token, id) => request(`/corrective-actions/${encodeURIComponent(id)}`, { token }),
    actionHistory: (token, id, query) => request(`/corrective-actions/${encodeURIComponent(id)}/history?${new URLSearchParams(query)}`, { token }),
    createAction: (token, body) => request('/corrective-actions', { token, body }),
    updateAction: (token, id, body, transition = '') => request(
      `/corrective-actions/${encodeURIComponent(id)}${transition ? '/' + encodeURIComponent(transition) : ''}`, { token, body, method: 'PATCH' },
    ),
    approvedUsers: (token, query) => request(`/users?${new URLSearchParams({ ...query, status: 'APPROVED' })}`, { token }),
    listUsers: (token, query) => request(`/users?${new URLSearchParams(query)}`, { token }),
    changeUser: (token, id, action, body) => request(`/users/${encodeURIComponent(id)}/${encodeURIComponent(action)}`, { token, body, method: 'PATCH' }),
    residualRisk: (token, id) => request(`/hazards/${encodeURIComponent(id)}/residual-risk`, { token }),
    residualHistory: (token, id, query) => request(`/hazards/${encodeURIComponent(id)}/residual-risk/history?${new URLSearchParams(query)}`, { token }),
    closureDecision: (token, id) => request(`/hazards/${encodeURIComponent(id)}/closure`, { token }),
    recordResidual: (token, id, body) => request(`/hazards/${encodeURIComponent(id)}/residual-risk`, { token, body }),
    decideClosure: (token, id, body) => request(`/hazards/${encodeURIComponent(id)}/close`, { token, body, method: 'PATCH' }),
  };
}
