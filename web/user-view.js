import { roleLabel } from './dashboard.js';
import { createNode } from './hazards.js';
import { readPage } from './pagination.js';

const byId = (id) => document.getElementById(id);
const statusLabels = { PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected', SUSPENDED: 'Suspended' };
const limit = 10;

export function accountActions(actor, account) {
  if (actor.role !== 'ADMIN' || actor.id === account.id || actor.organizationId !== account.organizationId) return [];
  if (account.status === 'PENDING') return account.role === 'ADMIN' ? ['approve'] : ['approve', 'reject'];
  if (account.status === 'APPROVED' && ['EMPLOYEE', 'SAFETY_OFFICER'].includes(account.role)) return ['suspend', 'role'];
  if (account.status === 'SUSPENDED') return ['restore'];
  return [];
}

export function setupSignup(api, notice) {
  const form = byId('signup-form');
  const submit = byId('signup-submit');

  function show(active) {
    byId('login-title').textContent = active ? 'Request an account' : 'Sign in to SafeOps';
    byId('login-description').textContent = active ? 'Use the organization slug supplied by your administrator. New accounts start as Employees and require approval.' :
      'Use your approved SafeOps account to open the operations dashboard.';
    byId('login-form').hidden = active;
    byId('signup-switch-row').hidden = active;
    byId('show-signup').setAttribute('aria-expanded', String(active));
    form.hidden = !active;
    notice('');
    byId(active ? 'signup-name' : 'login-title').focus();
  }

  byId('show-signup').addEventListener('click', () => show(true));
  byId('signup-back').addEventListener('click', () => {
    form.reset();
    show(false);
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    const { name, email, organizationSlug, password } = Object.fromEntries(new FormData(form));
    if (!name.trim() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(organizationSlug.trim())) {
      notice('Enter your name and the organization slug supplied by your administrator.', true);
      return;
    }
    if (!password.isWellFormed() || [...password].length < 12 || new TextEncoder().encode(password).length > 72) {
      notice('Choose a password of at least 12 Unicode characters and at most 72 UTF-8 bytes.', true);
      byId('signup-password').focus();
      return;
    }
    submit.disabled = true;
    byId('signup-back').disabled = true;
    notice('Submitting your request…');
    try {
      await api.signup({ name: name.trim(), email: email.trim(), organizationSlug: organizationSlug.trim(), password });
      form.reset();
      show(false);
      notice('If eligible, your registration is pending administrator approval. Sign in after your administrator approves it.');
    } catch (error) {
      notice(error.status === 429 ? 'Too many requests. Try again later.' :
        error.status === 400 ? 'Check the name, organization slug, email, and password requirements.' :
          'The request could not be confirmed. Contact your administrator before retrying.', true);
    } finally {
      form.elements.password.value = '';
      submit.disabled = false;
      byId('signup-back').disabled = false;
    }
  });
}

export function createUserView(session, renderProfile) {
  const panel = byId('user-management');
  const list = byId('users-list');
  const table = byId('users-table');
  const form = byId('users-filters');
  const node = (tag, className, content) => createNode(document, tag, className, content);
  let request = 0;
  let page = 1;
  let filter = '';
  let pending = false;

  function message(text = '', failed = false) {
    const box = byId('users-notice');
    box.textContent = text;
    box.hidden = !text;
    box.classList.toggle('error', failed);
  }

  function renderAccount(actor, account) {
    const row = node('div', 'users-row users-grid');
    row.setAttribute('role', 'row');
    const identity = node('div', 'users-identity');
    identity.append(node('strong', '', account.name), node('span', 'muted', account.email));
    const controls = node('div', 'users-controls');
    for (const action of accountActions(actor, account)) {
      const role = account.role === 'EMPLOYEE' ? 'SAFETY_OFFICER' : 'EMPLOYEE';
      const label = { approve: 'Approve', reject: 'Reject', suspend: 'Suspend', restore: 'Restore', role: 'Make ' + roleLabel(role) }[action];
      const button = node('button', action === 'approve' ? 'button primary' : 'button', label);
      button.type = 'button';
      button.setAttribute('aria-label', label + ' ' + account.name);
      button.addEventListener('click', () => void mutate(account, action, label, role));
      controls.append(button);
    }
    if (!controls.childElementCount) controls.append(node('span', 'muted', 'No actions available'));
    const badge = node('span', 'users-badge users-badge--' + account.status.toLowerCase(), statusLabels[account.status]);
    function cell(className, content, label) {
      const element = node('div', className);
      element.setAttribute('role', 'cell');
      if (label) {
        const caption = node('span', 'users-cell-label', label);
        caption.setAttribute('aria-hidden', 'true');
        element.append(caption);
      }
      element.append(content);
      return element;
    }
    row.append(cell('', identity), cell('', node('span', '', roleLabel(account.role)), 'Role'),
      cell('', badge, 'Account status'), cell('users-action-cell', controls, 'Actions'));
    return row;
  }

  function setDisabled(value) {
    for (const control of panel.querySelectorAll('button, select')) control.disabled = value;
  }

  async function showPage(index, success = '') {
    const ticket = ++request;
    list.replaceChildren();
    table.hidden = true;
    byId('users-pagination').hidden = true;
    setDisabled(true);
    message('Loading organization users…');
    try {
      const result = await readPage(
        (next) => session.loadUsers({ page: next, limit, ...(filter && { status: filter }) }),
        (value) => value.data.users, index, index > page, () => ticket === request,
      );
      if (!result || ticket !== request) return;
      const { user, data } = result.result;
      renderProfile(user);
      if (user.role !== 'ADMIN') {
        message('Only administrators can manage users.', true);
        return;
      }
      page = data.page;
      list.replaceChildren(...data.users.map((account) => renderAccount(user, account)));
      table.hidden = data.users.length === 0;
      byId('users-slug').textContent = user.organization?.slug || '';
      byId('users-organization').hidden = !user.organization?.slug;
      byId('users-page').textContent = 'Page ' + page;
      byId('users-pagination').hidden = page === 1 && data.users.length < limit;
      setDisabled(false);
      byId('users-previous').disabled = page === 1;
      byId('users-next').disabled = result.end || data.users.length < limit || page >= 10000;
      const empty = filter ? 'No users match this status. Choose another status or select All statuses.' : 'No users to display.';
      message([success, data.users.length ? result.end ? 'You’re on the last page of users.' : '' : empty].filter(Boolean).join(' '));
      if (success && document.activeElement === document.body) byId('users-notice').focus();
    } catch (error) {
      if (ticket === request) {
        setDisabled(false);
        message(error.status === 403 ? 'Only administrators can manage users.' : 'Could not load users. Select Refresh users to retry.', true);
      }
    }
  }

  async function mutate(account, action, label, role) {
    if (pending || !window.confirm(label + ' for ' + account.name + '?')) return;
    pending = true;
    const ticket = request;
    setDisabled(true);
    message('Updating account…');
    try {
      const updated = await session.changeUser(account.id, action, action === 'role' ? { role } : undefined);
      if (updated && ticket === request) await showPage(page, 'Account updated.');
    } catch (error) {
      if (ticket !== request) return;
      setDisabled(false);
      byId('users-previous').disabled = page === 1;
      byId('users-next').disabled = true;
      for (const button of list.querySelectorAll('button')) button.disabled = true;
      message(error.status === 409 ? 'The account is no longer eligible for that change. Refresh users before trying again.' :
        error.status === 403 || error.status === 404 ? 'That account or action is no longer available. Refresh users.' :
          'Could not confirm the change. Refresh users before trying again.', true);
    } finally {
      pending = false;
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    filter = form.elements.status.value;
    page = 1;
    void showPage(1);
  });
  byId('users-refresh').addEventListener('click', () => void showPage(page));
  byId('users-previous').addEventListener('click', () => void showPage(page - 1));
  byId('users-next').addEventListener('click', () => void showPage(page + 1));

  function hide() {
    request++;
    panel.hidden = true;
    list.replaceChildren();
    byId('users-slug').textContent = '';
    byId('users-organization').hidden = true;
    message();
  }

  return {
    show() {
      panel.hidden = false;
      byId('users-title').focus();
      void showPage(page);
    },
    hide,
    reset() {
      hide();
      form.reset();
      filter = '';
      page = 1;
    },
  };
}
