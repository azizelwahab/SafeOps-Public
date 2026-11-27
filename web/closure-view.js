import { createNode } from './hazards.js';
import { readPage } from './pagination.js';
import { scoreText } from './risk.js';
import { closureFailure, closureManager, closurePayload, closureReadiness, residualPayload, verifiedActionEvidence } from './closure.js';

const byId = (id) => document.getElementById(id);
const node = (tag, style, text) => createNode(document, tag, style, text);
const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const outcomes = { NOT_REQUIRED: 'Closed', ACCEPTED: 'Closed with administrator acceptance', ESCALATED: 'Escalated · hazard remains confirmed' };
const operations = { close: 'Close hazard', escalate: 'Escalate residual risk', accept: 'Accept residual risk and close' };

async function optional(operation, missingCode) {
  try {
    return await operation;
  } catch (error) {
    if (error.status === 404 && error.code === missingCode) return null;
    throw error;
  }
}

function assessment(target, record, empty, residual = false) {
  target.replaceChildren();
  if (!record) {
    target.append(node('p', 'muted', empty));
    return;
  }
  target.append(
    node('strong', 'closure-score', scoreText(record)),
    node('p', '', 'Likelihood ' + record.likelihood + ' · Severity ' + record.severity + ' · Version ' + record.version),
    node('p', 'muted', 'Assessed ' + date.format(new Date(residual ? record.createdAt : record.assessedAt))),
    node('p', 'closure-identifier', 'Assessor ID ' + record.assessedById),
  );
  if (residual) {
    target.append(
      node('p', 'muted', 'Baseline version ' + record.baselineVersion + ' · Verified actions ' + record.verifiedActionCount),
      node('p', 'hazard-text', record.rationale),
    );
  }
}

export function createClosureView(session, onHazard) {
  const panel = byId('hazard-closure-panel');
  const residualForm = byId('residual-form');
  const closureForm = byId('closure-form');
  let ticket = 0;
  let id;
  let latest;
  let readiness;
  let pending = false;
  let blocked = false;
  let historyPage = 1;
  let historyRequest = 1;

  function message(target, value = '', error = false) {
    const box = byId(target);
    box.textContent = value;
    box.hidden = !value;
    box.classList.toggle('error', error);
  }

  function notice(value = '', reload = false) {
    message('closure-notice', value, reload);
    byId('closure-reload').hidden = !reload;
  }

  function clear() {
    latest = undefined;
    readiness = undefined;
    byId('closure-evidence').hidden = true;
    byId('closure-history-pages').hidden = true;
    byId('closure-history-retry').hidden = true;
    for (const key of ['closure-baseline', 'closure-residual', 'closure-decision-record', 'closure-checks', 'closure-history']) {
      byId(key).replaceChildren();
    }
    message('closure-history-notice');
    for (const [form, error] of [[residualForm, 'residual-form-error'], [closureForm, 'closure-form-error']]) {
      form.reset();
      form.hidden = true;
      message(error);
    }
  }

  function disableForms() {
    byId('residual-fields').disabled = pending || blocked;
    byId('closure-fields').disabled = pending || blocked;
  }

  function renderDecision(record) {
    byId('closure-decision').hidden = !record;
    const details = byId('closure-decision-record');
    if (record) details.replaceChildren(
      node('strong', '', outcomes[record.outcome] ?? 'Decision recorded'),
      node('p', 'muted', 'Residual revision ' + record.residualVersion + ' · ' + date.format(new Date(record.createdAt))),
      node('p', 'closure-identifier', 'Reviewer ID ' + record.decidedById),
      node('p', 'hazard-text', record.rationale),
    );
  }

  function renderReadiness(baseline, actions) {
    const checks = [
      [readiness.confirmed, 'Hazard is confirmed.', 'Hazard must be confirmed.'],
      [!!baseline, 'Baseline risk assessment recorded.', 'Create a baseline risk assessment.'],
      [actions.count > 0, 'At least one corrective action recorded.', 'Create at least one corrective action.'],
      [actions.verified, 'All corrective actions verified.', 'Complete and independently verify every corrective action.'],
      [readiness.current, 'Residual risk reflects the current evidence.', latest ? 'Record a fresh residual assessment for the current evidence.' : 'Record a residual assessment.'],
    ];
    byId('closure-checks').replaceChildren(...checks.map(([met, yes, no]) =>
      node('li', met ? 'closure-check-met' : '', (met ? 'Met · ' : 'Required · ') + (met ? yes : no))));
    if (readiness.alreadyDecided) {
      byId('closure-checks').append(node('li', '', 'Required · Record a new residual revision before making another decision.'));
    }
    residualForm.hidden = !readiness.canAssess;
    const choices = readiness.decisions;
    closureForm.hidden = !choices.length;
    const picker = closureForm.elements.operation;
    picker.replaceChildren(new Option('Choose a decision', ''));
    for (const operation of choices) picker.add(new Option(operations[operation], operation));
    if (choices.length === 1 && choices[0] === 'close') picker.value = 'close';
    byId('closure-decision-hint').textContent = choices.includes('close') ? 'Low and medium residual risk can be closed with a rationale.'
      : choices.includes('accept') ? 'High and critical residual risk require explicit acceptance or escalation.'
        : 'An administrator must accept high or critical residual risk to close this hazard. You can escalate it for review.';
  }

  async function history(page, request) {
    historyRequest = page;
    byId('closure-history').replaceChildren();
    byId('closure-history-pages').hidden = true;
    byId('closure-history-retry').hidden = true;
    message('closure-history-notice', 'Loading residual revisions…');
    try {
      const hazardId = id;
      const loaded = await readPage((requested) => session.residualHistory(hazardId, { page: requested, limit: 10 }),
        (value) => value.revisions, page, page > historyPage, () => request === ticket);
      if (!loaded || request !== ticket) return;
      const { result, end } = loaded;
      historyPage = result.page;
      byId('closure-history').replaceChildren(...result.revisions.map((record) => {
        const entry = node('li');
        assessment(entry, record, '', true);
        return entry;
      }));
      byId('closure-history-pages').hidden = historyPage === 1 && result.revisions.length < result.limit;
      byId('closure-history-page').textContent = 'Page ' + historyPage;
      byId('closure-history-previous').disabled = historyPage <= 1;
      byId('closure-history-next').disabled = end || historyPage >= 10000 || result.revisions.length < result.limit;
      message('closure-history-notice', end && result.revisions.length ? 'You’re on the last page of residual revisions.'
        : result.revisions.length ? '' : 'No residual revisions on this page.');
    } catch {
      if (request !== ticket) return;
      message('closure-history-notice', 'Residual risk history could not be loaded.', true);
      byId('closure-history-retry').hidden = false;
    }
  }

  async function load(hazardId, success = '') {
    const request = ++ticket;
    id = hazardId;
    blocked = false;
    historyPage = 1;
    clear();
    disableForms();
    notice('Loading closure data…');
    try {
      const result = await session.loadHazard(hazardId);
      if (request !== ticket || !result) return;
      const { data: hazard, user } = result;
      onHazard(hazard, user);
      if (request !== ticket) return;
      if (hazard.status !== 'CONFIRMED' && hazard.status !== 'CLOSED') {
        notice('Closure evidence is available for confirmed or closed hazards.');
        return;
      }
      const showChecks = closureManager(user, hazard) && hazard.status === 'CONFIRMED';
      const [baselineResult, residual, decision, actions] = await Promise.all([
        session.closureBaseline(hazardId),
        optional(session.residualRisk(hazardId), 'RESIDUAL_RISK_NOT_FOUND'),
        optional(session.closureDecision(hazardId), 'CLOSURE_DECISION_NOT_FOUND'),
        showChecks ? verifiedActionEvidence((page) => session.closureActions(hazardId, page), () => request === ticket) : null,
      ]);
      if (request !== ticket || !baselineResult) return;
      const baseline = baselineResult.assessments[0];
      latest = residual;
      assessment(byId('closure-baseline'), baseline, 'No baseline assessment has been recorded.');
      assessment(byId('closure-residual'), residual, 'No residual assessment has been recorded.', true);
      renderDecision(decision);
      byId('closure-readiness').hidden = !showChecks;
      if (showChecks) {
        if (!actions) return;
        readiness = closureReadiness(user, hazard, baseline, actions, residual, decision);
        renderReadiness(baseline, actions);
      }
      byId('closure-evidence').hidden = false;
      notice(success || (hazard.status === 'CLOSED' ? 'This hazard is closed and its assessment and decision are read-only.' : ''));
      void history(1, request);
    } catch {
      if (request !== ticket) return;
      notice((success ? success + ' ' : '') + 'Closure data could not be loaded. The hazard may be outside your access.', true);
    }
  }

  async function save(form) {
    if (pending || blocked || !readiness) return;
    const isResidual = form === residualForm;
    const errorBox = isResidual ? 'residual-form-error' : 'closure-form-error';
    const values = Object.fromEntries(new FormData(form));
    if (isResidual ? !readiness.canAssess : !readiness.decisions.includes(values.operation)) return;
    let payload;
    try {
      payload = isResidual ? residualPayload(values, latest) : closurePayload(values, latest, values.operation);
    } catch (error) {
      message(errorBox, error.message, true);
      return;
    }
    const request = ticket;
    const hazardId = id;
    pending = true;
    disableForms();
    notice('Saving…');
    message(errorBox);
    try {
      const record = await (isResidual ? session.recordResidual(hazardId, payload) : session.decideClosure(hazardId, payload));
      if (request !== ticket || !record) return;
      const success = isResidual ? 'Residual assessment saved.' : record.outcome === 'ESCALATED'
        ? 'Decision recorded. The hazard remains confirmed and requires a fresh residual assessment.' : 'Hazard closed.';
      void load(hazardId, success);
    } catch (error) {
      if (request !== ticket) return;
      const failure = closureFailure(error);
      if (failure.reload) {
        blocked = true;
        notice(failure.message, true);
        byId('closure-reload').focus();
      } else {
        notice('');
        message(errorBox, failure.message, true);
      }
    } finally {
      pending = false;
      disableForms();
    }
  }

  for (const form of [residualForm, closureForm]) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void save(form);
    });
  }
  byId('closure-reload').addEventListener('click', () => {
    if (id && !pending) {
      byId('hazard-closure-title').focus();
      void load(id);
    }
  });
  byId('closure-history-previous').addEventListener('click', () => void history(historyPage - 1, ticket));
  byId('closure-history-next').addEventListener('click', () => void history(historyPage + 1, ticket));
  byId('closure-history-retry').addEventListener('click', () => void history(historyRequest, ticket));

  return {
    show(hazardId) {
      panel.hidden = false;
      byId('hazard-closure-title').focus();
      void load(hazardId);
    },
    hide() {
      ++ticket;
      id = undefined;
      panel.hidden = true;
      clear();
      notice();
    },
  };
}
