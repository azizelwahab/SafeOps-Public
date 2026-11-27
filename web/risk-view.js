import { createNode, hazardFilters } from './hazards.js';
import { readPage } from './pagination.js';
import { canWriteRisk, renderRevision, riskPayload, riskSaveError, scoreText } from './risk.js';

const byId = (id) => document.getElementById(id);
const node = (tag, style, text) => createNode(document, tag, style, text);
const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const formatDate = (value) => date.format(new Date(value));
const limit = 10;
const maxPage = 10000;

export function createRiskView(session, renderProfile, createAction) {
  const workspace = byId('risk-management');
  const form = byId('risk-ratings');
  const search = byId('risk-hazard-search');
  const hazardSelect = form.elements.hazardId;
  let ticket = 0;
  let pickerTicket = 0;
  let page = 1;
  let historyPage = 1;
  let pickerPage = 1;
  let hazardSearch = '';
  let current;
  let pending = false;
  let conflict = false;
  let retry;
  let actionContext;

  function message(id, text = '', error = false) {
    const target = byId(id);
    target.textContent = text;
    target.hidden = !text;
    target.classList.toggle('error', error);
  }

  function notice(text, action) {
    retry = action;
    message('risk-notice', text, Boolean(action));
    byId('risk-retry').hidden = !action;
  }

  function pane(visible) {
    for (const id of ['risk-list', 'risk-detail', 'risk-editor']) byId(id).hidden = id !== visible;
    notice('');
  }

  function paginate(prefix, requested, count) {
    byId(`${prefix}-pages`).hidden = requested === 1 && count < limit;
    byId(`${prefix}-previous`).disabled = requested <= 1;
    byId(`${prefix}-next`).disabled = requested >= maxPage || count < limit;
    byId(`${prefix}-page`).textContent = `Page ${requested}`;
  }

  async function list(requested = page) {
    const request = ++ticket;
    pane('risk-list');
    byId('risk-new').hidden = true;
    byId('risk-results').replaceChildren();
    byId('risk-pages').hidden = true;
    notice('Loading assessments…');
    try {
      const loaded = await readPage((page) => session.loadAssessments({ page, limit }),
        (value) => value.data.assessments, requested, requested > page, () => request === ticket);
      if (!loaded || request !== ticket) return;
      const { result, end } = loaded;
      renderProfile(result.user);
      page = result.data.page;
      const { assessments } = result.data;
      byId('risk-new').hidden = !canWriteRisk(result.user);
      byId('risk-results').replaceChildren(...assessments.map((record) => {
        const item = node('li');
        const open = node('button', 'button', `View ${scoreText(record)} assessment`);
        open.type = 'button';
        open.addEventListener('click', () => void detail(record.id));
        item.append(open, node('span', '', `Hazard ID ${record.hazardId}`), node('span', '', `Updated ${formatDate(record.updatedAt)}`));
        return item;
      }));
      paginate('risk', page, assessments.length);
      if (end) byId('risk-next').disabled = true;
      notice(end && assessments.length ? 'You’re on the last page of assessments.' : assessments.length ? '' : 'No assessments on this page.');
    } catch {
      if (request === ticket) notice('Assessments could not be loaded.', () => list(requested));
    }
  }

  async function history(id, requested, request) {
    byId('risk-history').replaceChildren();
    byId('risk-history-pages').hidden = true;
    message('risk-history-message', 'Loading revisions…');
    try {
      const loaded = await readPage((page) => session.loadAssessmentHistory(id, { page, limit }),
        (value) => value.revisions, requested, requested > historyPage, () => request === ticket);
      if (!loaded || request !== ticket) return;
      const { result, end } = loaded;
      historyPage = result.page;
      byId('risk-history').replaceChildren(...result.revisions.map((entry) => renderRevision(document, entry, formatDate)));
      paginate('risk-history', historyPage, result.revisions.length);
      if (end) byId('risk-history-next').disabled = true;
      message('risk-history-message', end && result.revisions.length ? 'You’re on the last page of assessment revisions.'
        : result.revisions.length ? '' : 'No revisions on this page.');
    } catch {
      if (request === ticket) {
        message('risk-history-message');
        notice('Revision history could not be loaded.', () => history(id, requested, request));
      }
    }
  }

  async function detail(id, success = '') {
    const request = ++ticket;
    current = undefined;
    historyPage = 1;
    actionContext = undefined;
    byId('risk-edit').hidden = true;
    byId('risk-create-action').hidden = true;
    pane('risk-detail');
    byId('risk-detail-title').focus();
    byId('risk-facts').replaceChildren();
    byId('risk-history').replaceChildren();
    byId('risk-history-pages').hidden = true;
    message('risk-history-message');
    notice('Loading assessment…');
    try {
      const result = await session.loadAssessment(id);
      if (request !== ticket || !result) return;
      const record = result.data;
      const hazard = await session.loadHazard(record.hazardId);
      if (request !== ticket || !hazard) return;
      renderProfile(hazard.user);
      current = record;
      const facts = [
        ['Hazard', hazard.data.title], ['Current risk', scoreText(record)], ['Likelihood', record.likelihood],
        ['Severity', record.severity], ['Version', record.version], ['Assessor ID', record.assessedById],
        ['Assessed', formatDate(record.assessedAt)], ['Created', formatDate(record.createdAt)], ['Updated', formatDate(record.updatedAt)],
      ];
      byId('risk-facts').replaceChildren(...facts.map(([label, value]) => {
        const fact = node('div');
        fact.append(node('dt', '', label), node('dd', '', value));
        return fact;
      }));
      byId('risk-edit').hidden = !canWriteRisk(hazard.user, hazard.data);
      if (canWriteRisk(hazard.user, hazard.data)) {
        actionContext = [record.hazardId, hazard.user];
        byId('risk-create-action').hidden = false;
      }
      notice(success);
      await history(id, 1, request);
    } catch {
      if (request === ticket) notice('This assessment could not be loaded. It may be outside your access.', () => detail(id));
    }
  }

  async function loadPicker(requested = 1) {
    const request = ticket;
    const lookup = ++pickerTicket;
    hazardSelect.replaceChildren(new Option('Choose a hazard', ''));
    byId('risk-picker-next').disabled = true;
    byId('risk-picker-previous').disabled = true;
    message('risk-picker-message', 'Loading confirmed hazards…');
    try {
      const isCurrent = () => request === ticket && lookup === pickerTicket;
      const searchTerm = hazardSearch;
      const loaded = await readPage((page) => session.loadHazards(hazardFilters({ status: 'CONFIRMED', search: searchTerm }, page)),
        (value) => value.data.hazards, requested, requested > pickerPage, isCurrent);
      if (!loaded || !isCurrent()) return;
      const { result, end } = loaded;
      renderProfile(result.user);
      if (!canWriteRisk(result.user)) return void list();
      pickerPage = result.data.page;
      const { hazards } = result.data;
      for (const hazard of hazards) hazardSelect.add(new Option(`${hazard.title} — ${hazard.location}`, hazard.id));
      byId('risk-picker-previous').disabled = pickerPage <= 1;
      byId('risk-picker-next').disabled = end || pickerPage >= maxPage || hazards.length < limit;
      message('risk-picker-message', end && hazards.length ? 'You’re on the last page of confirmed hazards.'
        : hazards.length ? `Confirmed hazards · Page ${pickerPage}` : 'No confirmed hazards on this page.');
    } catch {
      if (request === ticket && lookup === pickerTicket) notice('Confirmed hazards could not be loaded.', () => loadPicker(requested));
    }
  }

  function editor(record) {
    if (pending) return;
    ++ticket;
    current = record;
    conflict = false;
    pane('risk-editor');
    form.reset();
    search.reset();
    hazardSearch = '';
    byId('risk-editor-title').textContent = record ? 'Edit assessment ratings' : 'New assessment';
    byId('risk-rating-legend').textContent = record ? `Ratings · Version ${record.version}` : 'Ratings';
    byId('risk-editor-title').focus();
    byId('risk-picker').hidden = Boolean(record);
    hazardSelect.disabled = Boolean(record);
    hazardSelect.required = !record;
    search.hidden = Boolean(record);
    message('risk-picker-message');
    message('risk-save-error');
    byId('risk-reload').hidden = true;
    byId('risk-fields').disabled = false;
    if (record) {
      form.elements.likelihood.value = record.likelihood;
      form.elements.severity.value = record.severity;
    } else void loadPicker();
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (pending || conflict) return;
    const record = current;
    let payload;
    try {
      payload = riskPayload(Object.fromEntries(new FormData(form)), record);
    } catch (error) {
      message('risk-save-error', error.message, true);
      return;
    }
    const request = ticket;
    pending = true;
    byId('risk-fields').disabled = true;
    byId('risk-cancel').disabled = true;
    message('risk-save-error');
    notice('Saving assessment…');
    try {
      const result = await (record ? session.updateAssessment(record.id, payload) : session.createAssessment(payload));
      if (request === ticket && result) void detail(result.id, 'Assessment saved.');
    } catch (error) {
      if (request !== ticket) return;
      const failure = riskSaveError(error);
      conflict = Boolean(failure.reload);
      notice('');
      message('risk-save-error', failure.message, true);
      byId('risk-reload').hidden = !conflict;
      if (conflict) byId('risk-reload').focus();
    } finally {
      pending = false;
      byId('risk-fields').disabled = conflict;
      byId('risk-cancel').disabled = false;
    }
  });

  byId('risk-edit').addEventListener('click', () => editor(current));
  byId('risk-create-action').addEventListener('click', () => { if (actionContext) createAction(...actionContext); });
  byId('risk-new').addEventListener('click', () => editor());
  byId('risk-back').addEventListener('click', () => { byId('risk-workspace-title').focus(); void list(); });
  byId('risk-cancel').addEventListener('click', () => current ? void detail(current.id) : void list());
  byId('risk-reload').addEventListener('click', () => void detail(current.id, 'Latest assessment loaded.'));
  byId('risk-retry').addEventListener('click', () => retry?.());
  byId('risk-previous').addEventListener('click', () => void list(page - 1));
  byId('risk-next').addEventListener('click', () => void list(page + 1));
  byId('risk-history-previous').addEventListener('click', () => void history(current.id, historyPage - 1, ticket));
  byId('risk-history-next').addEventListener('click', () => void history(current.id, historyPage + 1, ticket));
  byId('risk-picker-previous').addEventListener('click', () => void loadPicker(pickerPage - 1));
  byId('risk-picker-next').addEventListener('click', () => void loadPicker(pickerPage + 1));
  search.addEventListener('submit', (event) => {
    event.preventDefault();
    if (pending) return;
    hazardSearch = search.elements.search.value.trim();
    void loadPicker();
  });

  function hide() {
    ++ticket;
    workspace.hidden = true;
  }

  return {
    show() {
      workspace.hidden = false;
      byId('risk-workspace-title').focus();
      void list();
    },
    hide,
    reset() {
      hide();
      current = undefined;
      actionContext = undefined;
      conflict = false;
      page = 1;
      form.reset();
      search.reset();
      hazardSelect.replaceChildren();
      for (const id of ['risk-results', 'risk-facts', 'risk-history']) byId(id).replaceChildren();
      byId('risk-edit').hidden = true;
      byId('risk-create-action').hidden = true;
      message('risk-save-error');
      message('risk-picker-message');
      message('risk-history-message');
      notice('');
    },
  };
}
