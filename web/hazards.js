export const hazardStatuses = {
  REPORTED: 'Reported', UNDER_REVIEW: 'Under review', CONFIRMED: 'Confirmed', DISMISSED: 'Dismissed', CLOSED: 'Closed',
};
export const hazardCategories = {
  ELECTRICAL: 'Electrical', CHEMICAL: 'Chemical', FIRE: 'Fire', MECHANICAL: 'Mechanical',
  ERGONOMIC: 'Ergonomic', BIOLOGICAL: 'Biological', PHYSICAL: 'Physical', PSYCHOSOCIAL: 'Psychosocial',
  ENVIRONMENTAL: 'Environmental', OTHER: 'Other',
};
export const maxHazardPage = 10_000;
export const hazardPageSize = 10;

export function hazardFilters(values, page = 1) {
  const filters = { page: Math.min(maxHazardPage, Math.max(1, page)), limit: hazardPageSize };
  for (const name of ['search', 'location']) {
    const value = (values[name] ?? '').trim();
    if (value) filters[name] = value;
  }
  for (const [name, options] of [['status', hazardStatuses], ['category', hazardCategories]]) {
    if (Object.hasOwn(options, values[name])) filters[name] = values[name];
  }
  return filters;
}

export function hazardCapabilities(user, hazard) {
  const investigator = user?.role === 'SAFETY_OFFICER' || user?.role === 'ADMIN';
  const inScope = !!user && !!hazard && user.organizationId === hazard.organizationId;
  return {
    edit: inScope && hazard.reportedById === user.id && hazard.status === 'REPORTED',
    startReview: inScope && investigator && hazard.status === 'REPORTED',
    decide: inScope && investigator && hazard.status === 'UNDER_REVIEW',
  };
}

function validText(value, min, max) {
  return value.length >= min && value.length <= max && value.isWellFormed() && !value.includes('\0');
}

export function validateHazardForm(values) {
  const data = {};
  for (const [field, max] of [['title', 160], ['description', 4000], ['location', 200]]) {
    const value = (values[field] ?? '').trim();
    if (!validText(value, 1, max)) return { field, message: `Enter 1–${max.toLocaleString()} characters.` };
    data[field] = value;
  }
  if (!Object.hasOwn(hazardCategories, values.category)) return { field: 'category', message: 'Choose a category.' };
  return { data: { ...data, category: values.category } };
}

export function validateReviewNotes(value) {
  const reviewNotes = value.trim();
  if (!validText(reviewNotes, 10, 2000) || (reviewNotes.match(/[\p{L}\p{N}]/gu)?.length ?? 0) < 3) {
    return { field: 'reviewNotes', message: 'Enter 10–2,000 characters and include at least three letters or numbers.' };
  }
  return { data: { reviewNotes } };
}

const reportedDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
export function createNode(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function statusBadge(doc, status) {
  const supported = Object.hasOwn(hazardStatuses, status);
  return createNode(doc, 'span', `hazard-badge ${supported ? 'status-' + status.toLowerCase() : ''}`,
    supported ? hazardStatuses[status] : 'Unknown status');
}

export function renderHazardList(doc, hazards, open) {
  const list = createNode(doc, 'ul', 'hazard-records');
  for (const hazard of hazards) {
    const row = createNode(doc, 'li', 'hazard-row');
    const title = createNode(doc, 'button', 'hazard-record-link', hazard.title);
    title.type = 'button';
    title.addEventListener('click', () => open(hazard.id));
    const date = createNode(doc, 'time', '', reportedDate.format(new Date(hazard.createdAt)));
    date.dateTime = hazard.createdAt;
    row.append(title, statusBadge(doc, hazard.status),
      createNode(doc, 'span', 'hazard-category-cell', hazardCategories[hazard.category] ?? 'Unknown category'),
      createNode(doc, 'span', 'hazard-location-cell', hazard.location), date);
    list.append(row);
  }
  return list;
}
