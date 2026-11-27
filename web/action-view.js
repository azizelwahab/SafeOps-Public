import { createNode } from './hazards.js';
import { readPage } from './pagination.js';
import { actionControls, actionError, actionFilters, actionPayload, actionStatuses, localDue, managesActions, renderActionEvent } from './actions.js';

const byId = (id) => document.getElementById(id);
const node = (tag, style, label) => createNode(document, tag, style, label);
const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const formatDate = (value) => date.format(new Date(value));
const messages = {
  create: ['New corrective action', 'Action created.'], plan: ['Edit plan or assignment', 'Action plan saved.'],
  notes: ['Edit work notes', 'Work notes saved.'], start: ['Start work', 'Work started.'],
  submit: ['Submit for verification', 'Completion submitted.'], verify: ['Verify action', 'Action verified.'],
  return: ['Return to work', 'Action returned to work.'],
};
const fields = {
  create: ['hazardId', 'title', 'description', 'assigneeId', 'dueAt'],
  plan: ['title', 'description', 'assigneeId', 'dueAt'], notes: ['workNotes'], submit: ['completionDetails'], return: ['reason'],
};

function button(label, handler, style = 'button') {
  const control = node('button', style, label);
  control.type = 'button';
  control.addEventListener('click', handler);
  return control;
}

export function createActionView(session, renderProfile, openHazard) {
  const workspace = byId('action-management');
  const form = byId('action-form');
  const filters = byId('action-filters');
  let ticket = 0;
  let directoryTicket = 0;
  let pending = false;
  let conflict = false;
  let user;
  let current;
  let mode;
  let query = actionFilters({});
  let eventPage = 1;
  let usersPage = 1;
  let usersSearch = '';
  let retry;

  for (const [value, label] of Object.entries(actionStatuses)) {
    byId('action-filter-status').add(new Option(label, value));
  }

  function message(id, label = '', error = false) {
    const target = byId(id);
    target.textContent = label;
    target.hidden = !label;
    target.classList.toggle('error', error);
  }

  function notice(label, action, retryLabel = 'Retry') {
    retry = action;
    message('action-notice', label, Boolean(action));
    byId('action-retry').hidden = !action;
    byId('action-retry').textContent = retryLabel;
  }

  function pane(visible) {
    for (const id of ['action-list', 'action-detail', 'action-editor']) byId(id).hidden = id !== visible;
    if (visible !== 'action-editor') byId('action-user-options').replaceChildren();
    notice('');
  }

  function paging(prefix, page, count) {
    byId(prefix + '-pages').hidden = page === 1 && count < 10;
    byId(prefix + '-page').textContent = 'Page ' + page;
    byId(prefix + '-previous').disabled = page <= 1;
    byId(prefix + '-next').disabled = page >= 10000 || count < 10;
  }

  function profile(identity) {
    user = identity;
    renderProfile(user);
  }

  async function readHazard(id) {
    try {
      return await session.actionHazard(id);
    } catch {
      // Action visibility does not grant hazard visibility.
      return null;
    }
  }

  function linkedHazard(hazard) {
    return hazard ? button(hazard.title, () => openHazard(hazard.id), 'hazard-record-link') : node('span', 'muted', 'Unavailable');
  }

  function assignee(record) {
    return record.assigneeId === user.id ? user.name + ' (you)' : record.assigneeId;
  }

  function row(record, hazard) {
    const tr = node('tr');
    tr.setAttribute('role', 'row');
    const cells = [
      ['Title', button(record.title, () => void detail(record.id), 'hazard-record-link')],
      ['Status', node('span', 'hazard-badge action-' + record.status.toLowerCase(), actionStatuses[record.status])],
      ['Assignee', node('span', '', assignee(record))],
      ['Due date', node('time', '', formatDate(record.dueAt))],
      ['Hazard', linkedHazard(hazard)],
    ];
    cells[3][1].dateTime = record.dueAt;
    for (const [label, value] of cells) {
      const cell = node('td');
      cell.setAttribute('role', 'cell');
      cell.append(node('span', 'action-mobile-label', label), value);
      cell.firstChild.setAttribute('aria-hidden', 'true');
      tr.append(cell);
    }
    return tr;
  }

  async function list(advancing = false) {
    const request = ++ticket;
    const requested = query;
    current = undefined;
    conflict = false;
    pane('action-list');
    byId('action-table').hidden = true;
    byId('action-results').replaceChildren();
    byId('action-pages').hidden = true;
    byId('action-new').hidden = true;
    notice('Loading actions…');
    try {
      const loaded = await readPage((page) => session.loadActions({ ...requested, page }),
        (value) => value.data.actions, requested.page, advancing, () => request === ticket);
      if (!loaded || request !== ticket) return;
      const { result, end } = loaded;
      profile(result.user);
      const { actions, page } = result.data;
      const ids = [...new Set(actions.map((entry) => entry.hazardId))];
      const hazards = await Promise.all(ids.map(readHazard));
      if (request !== ticket) return;
      query = { ...requested, page };
      const byHazard = new Map(ids.map((id, index) => [id, hazards[index]]));
      byId('action-results').replaceChildren(...actions.map((entry) => row(entry, byHazard.get(entry.hazardId))));
      byId('action-table').hidden = !actions.length;
      byId('action-new').hidden = !managesActions(user);
      paging('action', page, actions.length);
      if (end) byId('action-next').disabled = true;
      notice(end && actions.length ? 'You’re on the last page of matching actions.' : actions.length ? '' : 'No actions match these filters on this page.');
    } catch {
      if (request === ticket) notice('Corrective actions could not be loaded.', () => list(advancing));
    }
  }

  async function history(id, page, request) {
    byId('action-history').replaceChildren();
    byId('action-history-pages').hidden = true;
    message('action-history-message', 'Loading history…');
    try {
      const loaded = await readPage((requested) => session.actionHistory(id, { page: requested, limit: 10 }),
        (value) => value.events, page, page > eventPage, () => request === ticket);
      if (!loaded || request !== ticket) return;
      const { result: data, end } = loaded;
      eventPage = data.page;
      byId('action-history').replaceChildren(...data.events.map((entry) => renderActionEvent(document, entry, formatDate)));
      paging('action-history', eventPage, data.events.length);
      if (end) byId('action-history-next').disabled = true;
      message('action-history-message', end && data.events.length ? 'You’re on the last page of action history.' : data.events.length ? '' : 'No events on this page.');
    } catch {
      if (request !== ticket) return;
      const target = byId('action-history-message');
      message('action-history-message', 'Action history could not be loaded.', true);
      target.append(document.createTextNode(' '), button('Retry history', () => void history(id, page, request)));
    }
  }

  async function detail(id, success = '') {
    const request = ++ticket;
    current = undefined;
    conflict = false;
    eventPage = 1;
    pane('action-detail');
    for (const slot of ['action-facts', 'action-text', 'action-controls', 'action-history']) byId(slot).replaceChildren();
    byId('action-history-pages').hidden = true;
    byId('action-title').textContent = 'Action details';
    byId('action-title').focus();
    message('action-history-message');
    notice('Loading action…');
    try {
      const result = await session.loadAction(id);
      if (request !== ticket || !result) return;
      const record = result.data;
      const hazard = await readHazard(record.hazardId);
      if (request !== ticket) return;
      profile(result.user);
      current = record;
      byId('action-title').textContent = record.title;
      const facts = [
        ['Status', actionStatuses[record.status]], ['Assignee', assignee(record)], ['Due', formatDate(record.dueAt)],
        ['Hazard', linkedHazard(hazard)], ...(hazard ? [['Hazard ID', hazard.id]] : []),
        ['Created', formatDate(record.createdAt)], ['Updated', formatDate(record.updatedAt)],
        ['Version', record.version],
      ];
      byId('action-facts').replaceChildren(...facts.map(([label, value]) => {
        const item = node('div');
        const description = node('dd');
        if (typeof value === 'object') description.append(value);
        else description.textContent = value;
        item.append(node('dt', '', label), description);
        return item;
      }));
      byId('action-text').replaceChildren(...[
        ['Action plan', record.description], ['Work notes', record.workNotes], ['Completion details', record.completionDetails],
      ].map(([label, value]) => {
        const section = node('section', 'action-description');
        section.append(node('h3', '', label), node('p', 'hazard-text', value || 'None recorded.'));
        return section;
      }));
      byId('action-controls').replaceChildren(...actionControls(user, record, hazard?.status).map((operation) =>
        button(messages[operation][0], () => fields[operation] ? editor(operation) : void save(operation))));
      notice(success);
      void history(id, 1, request);
    } catch {
      if (request === ticket) notice('This action could not be loaded. It may be outside your access.', () => detail(id));
    }
  }

  async function directory(page = 1) {
    const request = ticket;
    const lookup = ++directoryTicket;
    const options = byId('action-user-options');
    options.replaceChildren(new Option('Choose an approved user', ''));
    byId('action-users-next').disabled = true;
    byId('action-users-previous').disabled = true;
    message('action-user-message', 'Loading approved users…');
    try {
      const isCurrent = () => request === ticket && lookup === directoryTicket;
      const search = usersSearch;
      const loaded = await readPage((requested) => session.approvedUsers({ page: requested, limit: 10, ...(search && { search }) }),
        (value) => value.users, page, page > usersPage, isCurrent);
      if (!loaded || !isCurrent()) return;
      const { result: data, end } = loaded;
      usersPage = data.page;
      for (const entry of data.users) options.add(new Option(entry.name + ' · ' + entry.email, entry.id));
      byId('action-users-previous').disabled = usersPage <= 1;
      byId('action-users-next').disabled = end || usersPage >= 10000 || data.users.length < 10;
      message('action-user-message', end && data.users.length ? 'You’re on the last page of approved users.'
        : data.users.length ? 'Approved users · Page ' + usersPage : 'No approved users on this page.');
    } catch {
      if (request === ticket && lookup === directoryTicket) message('action-user-message', 'The directory is unavailable. Enter an approved assignee ID or try searching again.', true);
    }
  }

  function editor(operation, hazardId = '') {
    if (pending || conflict) return;
    ++ticket;
    mode = operation;
    pane('action-editor');
    form.reset();
    byId('action-fields').disabled = false;
    message('action-save-error');
    byId('action-editor-title').textContent = messages[operation][0];
    byId('action-editor-title').focus();
    for (const wrapper of form.querySelectorAll('[data-action-field]')) {
      const key = wrapper.dataset.actionField;
      wrapper.hidden = !fields[operation].includes(key);
      const input = form.elements.namedItem(key);
      input.disabled = wrapper.hidden;
      input.required = !wrapper.hidden;
      if (!wrapper.hidden && current?.[key]) input.value = key === 'dueAt' ? localDue(current[key]) : current[key];
    }
    if (operation === 'create') form.elements.hazardId.value = hazardId;
    const hasDirectory = user.role === 'ADMIN' && fields[operation].includes('assigneeId');
    byId('action-directory').hidden = !hasDirectory;
    if (hasDirectory) {
      usersSearch = '';
      void directory();
    }
  }

  function setBusy(busy) {
    byId('action-fields').disabled = busy;
    byId('action-cancel').disabled = busy;
    byId('action-back').disabled = busy;
    for (const control of byId('action-controls').querySelectorAll('button')) control.disabled = busy;
  }

  async function save(operation, values = {}) {
    if (pending || conflict) return;
    const record = current;
    let body;
    try {
      body = actionPayload(operation, values, record);
    } catch (error) {
      message('action-save-error', error.message, true);
      return;
    }
    const request = ticket;
    pending = true;
    message('action-save-error');
    setBusy(true);
    notice('Saving action…');
    try {
      const transition = ['start', 'submit', 'verify', 'return'].includes(operation) ? operation : '';
      const result = await (operation === 'create' ? session.createAction(body) : session.updateAction(record.id, body, transition));
      if (request === ticket && result) void detail(result.id, messages[operation][1]);
    } catch (error) {
      if (request !== ticket) return;
      const failure = actionError(error);
      conflict = failure.reload;
      if (conflict) {
        notice(failure.message, record ? () => detail(record.id, 'Latest action loaded.') : list, 'Reload current data');
        byId('action-retry').focus();
      } else if (fields[operation]) {
        notice('');
        message('action-save-error', failure.message, true);
      } else {
        message('action-notice', failure.message, true);
      }
    } finally {
      pending = false;
      setBusy(conflict);
      // A conflicted draft may be discarded with Cancel.
      byId('action-cancel').disabled = false;
      byId('action-back').disabled = false;
    }
  }

  filters.addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      query = actionFilters(Object.fromEntries(new FormData(filters)));
      message('action-filter-error');
      void list();
    } catch (error) {
      message('action-filter-error', error.message, true);
    }
  });
  byId('action-clear').addEventListener('click', () => {
    filters.reset();
    filters.requestSubmit();
  });
  function movePage(step) {
    query = { ...query, page: Math.min(10000, Math.max(1, query.page + step)) };
    void list(step > 0);
  }
  byId('action-previous').addEventListener('click', () => movePage(-1));
  byId('action-next').addEventListener('click', () => movePage(1));
  byId('action-back').addEventListener('click', () => { byId('action-workspace-title').focus(); void list(); });
  byId('action-new').addEventListener('click', () => editor('create'));
  byId('action-retry').addEventListener('click', () => retry?.());
  byId('action-cancel').addEventListener('click', () => current ? void detail(current.id) : void list());
  byId('action-history-previous').addEventListener('click', () => void history(current.id, eventPage - 1, ticket));
  byId('action-history-next').addEventListener('click', () => void history(current.id, eventPage + 1, ticket));
  byId('action-find-users').addEventListener('click', () => {
    usersSearch = byId('action-user-search').value.trim();
    void directory();
  });
  byId('action-user-search').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      byId('action-find-users').click();
    }
  });
  byId('action-users-previous').addEventListener('click', () => void directory(usersPage - 1));
  byId('action-users-next').addEventListener('click', () => void directory(usersPage + 1));
  byId('action-user-options').addEventListener('change', (event) => {
    if (event.target.value) form.elements.assigneeId.value = event.target.value;
  });
  byId('action-assign-self').addEventListener('click', () => {
    if (!managesActions(user)) return;
    form.elements.assigneeId.value = user.id;
    form.elements.assigneeId.focus();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void save(mode, Object.fromEntries(new FormData(form)));
  });

  function hide() {
    ++ticket;
    workspace.hidden = true;
    byId('action-user-options').replaceChildren();
  }

  return {
    show(options) {
      workspace.hidden = false;
      conflict = false;
      if (options?.hazardId && managesActions(options.user) && !pending) {
        current = undefined;
        profile(options.user);
        editor('create', options.hazardId);
      } else {
        byId('action-workspace-title').focus();
        void list();
      }
    },
    hide,
    reset() {
      hide();
      current = user = undefined;
      conflict = false;
      mode = undefined;
      filters.reset();
      form.reset();
      query = actionFilters({});
      for (const id of ['action-results', 'action-history', 'action-facts', 'action-text', 'action-controls', 'action-user-options']) byId(id).replaceChildren();
      for (const id of ['action-title', 'action-filter-error', 'action-save-error', 'action-user-message', 'action-history-message']) message(id);
      notice('');
    },
  };
}
