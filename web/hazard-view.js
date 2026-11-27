import {
  createNode, hazardCapabilities, hazardCategories, hazardFilters, hazardStatuses, maxHazardPage, renderHazardList,
  statusBadge, validateHazardForm, validateReviewNotes,
} from './hazards.js';
import { createClosureView } from './closure-view.js';

const byId = (id) => document.getElementById(id);
const node = (tag, className, text) => createNode(document, tag, className, text);
const formValues = (form) => Object.fromEntries(new FormData(form));
const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function options(select, values) {
  for (const [value, label] of Object.entries(values)) {
    const option = node('option', '', label);
    option.value = value;
    select.append(option);
  }
}

function notice(id, message, error = false) {
  const target = byId(id);
  target.textContent = message;
  target.hidden = !message;
  target.classList.toggle('error', error);
}

function setValidation(form, issue) {
  const field = form.elements[issue.field];
  field.setCustomValidity(issue.message);
  field.reportValidity();
  field.focus();
}

function resetForm(form) {
  form.reset();
  for (const field of form.querySelectorAll('input, textarea, select')) field.setCustomValidity('');
}

function errorMessage(error, fallback) {
  if (error.status === 404) return 'This hazard is unavailable or outside your access.';
  if (error.status === 403) return 'You do not have permission for this operation.';
  if (error.status === 400) return 'The server rejected the submitted values. Check the fields and try again.';
  return fallback;
}

export function createHazardsView(session, renderProfile) {
  const container = byId('hazard-management');
  const filterForm = byId('hazard-filters');
  const editForm = byId('hazard-editor');
  const reviewForm = byId('hazard-review-form');
  const panes = ['hazard-list-view', 'hazard-detail-view', 'hazard-editor-view'];
  let active = false;
  let revision = 0;
  let pending = null;
  let filters = hazardFilters({});
  let currentId;
  let currentHazard;
  let editorId;
  const closure = createClosureView(session, (hazard, user) => {
    if (!active || currentId !== hazard.id) return;
    profile(user);
    renderDetail(hazard, user, false);
  });
  const closureButton = byId('show-hazard-closure');

  function hideClosure() {
    closure.hide();
    closureButton.setAttribute('aria-expanded', 'false');
  }

  options(byId('hazard-status'), hazardStatuses);
  options(byId('hazard-category'), hazardCategories);
  options(byId('report-category'), hazardCategories);
  for (const form of [editForm, reviewForm]) {
    form.addEventListener('input', ({ target }) => target.setCustomValidity?.(''));
  }

  function pane(id) {
    hideClosure();
    for (const name of panes) byId(name).hidden = name !== id;
  }

  function profile(user) {
    renderProfile(user);
    notice('hazard-scope', user.role === 'EMPLOYEE' ? 'Review hazards you reported.' : 'Review hazards reported in your organization.');
  }

  function listNotice(message, error = false) {
    const box = byId('hazard-list-notice');
    box.hidden = !message;
    box.classList.toggle('error', error);
    byId('hazard-list-message').textContent = message;
    byId('retry-hazards').hidden = !error;
  }

  async function list(focus = false, next = false) {
    const ticket = ++revision;
    const query = next ? { ...filters, page: filters.page + 1 } : filters;
    pane('hazard-list-view');
    if (focus) byId('hazard-list-title').focus();
    if (next) byId('next-hazards').disabled = true;
    else {
      byId('hazard-results').hidden = true;
      byId('hazard-pagination').hidden = true;
    }
    listNotice('Loading hazards…');
    try {
      const result = await session.loadHazards(query);
      if (!active || ticket !== revision || !result) return;
      profile(result.user);
      const { hazards, page, limit } = result.data;
      if (next && hazards.length === 0) {
        listNotice('You’re on the last page of matching hazards.');
        return;
      }
      filters = query;
      const results = byId('hazard-results');
      const header = node('div', 'hazard-list-columns');
      header.setAttribute('aria-hidden', 'true');
      header.append(...['Hazard', 'Status', 'Category', 'Location', 'Reported'].map((label) => node('span', '', label)));
      results.replaceChildren(header, renderHazardList(document, hazards, (id) => void detail(id)));
      results.hidden = hazards.length === 0;
      byId('hazard-pagination').hidden = hazards.length === 0 && page === 1;
      byId('hazard-page').textContent = `Page ${page}`;
      byId('previous-hazards').disabled = page <= 1;
      byId('next-hazards').disabled = page >= maxHazardPage || hazards.length < limit;
      listNotice(hazards.length ? '' : 'No hazards match these filters.');
    } catch (error) {
      if (active && ticket === revision) {
        if (next) byId('next-hazards').disabled = false;
        listNotice(errorMessage(error, 'Hazards could not be loaded. Try again.'), true);
      }
    }
  }

  function renderDetail(hazard, user, focus = true) {
    currentHazard = hazard;
    const controls = hazardCapabilities(user, hazard);
    byId('hazard-detail-title').textContent = hazard.title;
    byId('hazard-detail-status').replaceChildren(statusBadge(document, hazard.status));
    byId('hazard-detail-description').textContent = hazard.description;
    byId('hazard-detail-facts').replaceChildren(...[
      ['Category', hazardCategories[hazard.category] ?? 'Unknown category'],
      ['Location', hazard.location],
      ['Reported', date.format(new Date(hazard.createdAt))],
      ['Updated', date.format(new Date(hazard.updatedAt))],
    ].map(([name, value]) => {
      const fact = node('div');
      fact.append(node('dt', '', name), node('dd', '', value));
      return fact;
    }));
    byId('hazard-review-state').textContent = hazard.reviewedAt
      ? `Decision recorded ${date.format(new Date(hazard.reviewedAt))}.`
      : hazard.status === 'UNDER_REVIEW' ? 'Review is in progress.' : 'No review decision has been recorded.';
    notice('hazard-review-notes', hazard.reviewNotes ?? '');
    byId('edit-hazard').hidden = !controls.edit;
    byId('start-hazard-review').hidden = !controls.startReview;
    reviewForm.hidden = !controls.decide;
    closureButton.hidden = hazard.status !== 'CONFIRMED' && hazard.status !== 'CLOSED';
    byId('hazard-detail-card').hidden = false;
    if (focus) byId('hazard-detail-title').focus();
  }

  async function detail(id, message = '', conflict = false) {
    const ticket = ++revision;
    currentId = id;
    currentHazard = undefined;
    pane('hazard-detail-view');
    byId('hazard-detail-card').hidden = true;
    byId('reload-hazard').hidden = true;
    resetForm(reviewForm);
    notice('hazard-detail-notice', 'Loading hazard…');
    byId('back-to-hazards').focus();
    try {
      const result = await session.loadHazard(id);
      if (!active || ticket !== revision || !result) return;
      profile(result.user);
      renderDetail(result.data, result.user);
      notice('hazard-detail-notice', message, conflict);
    } catch (error) {
      if (!active || ticket !== revision) return;
      notice('hazard-detail-notice', errorMessage(error, 'This hazard could not be loaded.'), true);
      byId('reload-hazard').hidden = error.status === 404;
    }
  }

  function editor(hazard) {
    if (pending) return;
    ++revision;
    editorId = hazard?.id;
    pane('hazard-editor-view');
    resetForm(editForm);
    notice('hazard-editor-error', '');
    byId('hazard-editor-title').textContent = editorId ? 'Edit hazard report' : 'Report hazard';
    byId('submit-hazard').textContent = editorId ? 'Save changes' : 'Submit report';
    if (hazard) {
      for (const name of ['title', 'description', 'category', 'location']) editForm.elements[name].value = hazard[name];
    }
    byId('hazard-editor-title').focus();
  }

  function disableMutations(disabled) {
    for (const id of ['hazard-editor-fields', 'hazard-review-fields', 'start-hazard-review', 'report-hazard', 'edit-hazard', 'cancel-hazard-edit']) {
      byId(id).disabled = disabled;
    }
  }

  async function mutate(operation, { id, success, noticeId }) {
    if (pending) return;
    const lock = {};
    pending = lock;
    const ticket = revision;
    disableMutations(true);
    notice(noticeId, 'Saving changes…');
    try {
      const hazard = await operation();
      if (active && ticket === revision && hazard) await detail(hazard.id, success);
    } catch (error) {
      if (!active || ticket !== revision) return;
      if (id && error.status === 409) {
        await detail(id, 'This hazard changed. The latest report has been loaded.', true);
      } else {
        notice(noticeId, errorMessage(error, 'Changes could not be saved. Try again.'), true);
      }
    } finally {
      if (pending === lock) {
        pending = null;
        disableMutations(false);
      }
    }
  }

  filterForm.addEventListener('submit', (event) => {
    event.preventDefault();
    filters = hazardFilters(formValues(filterForm));
    void list();
  });
  byId('clear-hazard-filters').addEventListener('click', () => {
    filterForm.reset();
    filters = hazardFilters({});
    void list();
  });
  byId('previous-hazards').addEventListener('click', () => {
    filters = { ...filters, page: Math.max(1, filters.page - 1) };
    void list(true);
  });
  byId('next-hazards').addEventListener('click', () => {
    if (filters.page < maxHazardPage) void list(true, true);
  });
  byId('retry-hazards').addEventListener('click', () => void list(true));
  byId('reload-hazard').addEventListener('click', () => void detail(currentId));
  closureButton.addEventListener('click', () => {
    if (closureButton.getAttribute('aria-expanded') === 'true') hideClosure();
    else if (currentHazard) {
      closureButton.setAttribute('aria-expanded', 'true');
      closure.show(currentHazard.id);
    }
  });
  byId('back-to-hazards').addEventListener('click', () => void list(true));
  byId('report-hazard').addEventListener('click', () => editor());
  byId('edit-hazard').addEventListener('click', () => {
    if (currentHazard) editor(currentHazard);
  });
  byId('cancel-hazard-edit').addEventListener('click', () => {
    if (editorId) void detail(editorId);
    else void list(true);
  });
  editForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (pending) return;
    const result = validateHazardForm(formValues(editForm));
    if (!result.data) return setValidation(editForm, result);
    const id = editorId;
    void mutate(() => id ? session.editHazard(id, result.data) : session.reportHazard(result.data), {
      id, success: id ? 'Hazard updated.' : 'Hazard reported.', noticeId: 'hazard-editor-error',
    });
  });
  byId('start-hazard-review').addEventListener('click', () => {
    const id = currentId;
    void mutate(() => session.startHazardReview(id), { id, success: 'Review started.', noticeId: 'hazard-detail-notice' });
  });
  reviewForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (pending || !event.submitter) return;
    const result = validateReviewNotes(reviewForm.elements.reviewNotes.value);
    if (!result.data) return setValidation(reviewForm, result);
    const id = currentId;
    const confirm = event.submitter.value === 'confirm';
    void mutate(() => confirm ? session.confirmHazard(id, result.data) : session.dismissHazard(id, result.data), {
      id, success: confirm ? 'Hazard confirmed.' : 'Hazard dismissed.', noticeId: 'hazard-detail-notice',
    });
  });

  function hide() {
    active = false;
    ++revision;
    hideClosure();
    container.hidden = true;
  }

  return {
    show(id) {
      active = true;
      container.hidden = false;
      if (id) void detail(id);
      else void list(true);
    },
    hide,
    reset() {
      hide();
      filterForm.reset();
      resetForm(editForm);
      resetForm(reviewForm);
      filters = hazardFilters({});
      currentId = currentHazard = editorId = undefined;
      pending = null;
      disableMutations(false);
      byId('hazard-results').replaceChildren();
      for (const id of ['hazard-detail-title', 'hazard-detail-status', 'hazard-detail-facts', 'hazard-detail-description',
        'hazard-review-state', 'hazard-review-notes', 'hazard-scope']) byId(id).replaceChildren();
      notice('hazard-detail-notice', '');
      notice('hazard-editor-error', '');
      listNotice('');
    },
  };
}
