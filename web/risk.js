import { createNode } from './hazards.js';

const levels = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', CRITICAL: 'Critical' };

export function canWriteRisk(user, hazard) {
  return ['ADMIN', 'SAFETY_OFFICER'].includes(user?.role) && (!hazard || hazard.status === 'CONFIRMED');
}

export function riskPayload(values, assessment) {
  const { likelihood, severity } = values;
  if (![likelihood, severity].every((rating) => /^[1-5]$/.test(rating))) {
    throw new RangeError('Choose whole-number ratings from 1 to 5.');
  }
  const ratings = { likelihood: Number(likelihood), severity: Number(severity) };
  if (assessment) {
    if (!Number.isInteger(assessment.version) || assessment.version < 1 || assessment.version > 2147483646) {
      throw new RangeError('Reload the assessment before editing.');
    }
    return { ...ratings, version: assessment.version };
  }
  if (!values.hazardId) throw new RangeError('Choose a confirmed hazard.');
  return { ...ratings, hazardId: values.hazardId };
}

export function scoreText(record) {
  return `${levels[record.level] ?? 'Unknown'} · ${record.score}/25`;
}

export function riskSaveError({ status, code }) {
  if (status === 409) {
    if (code === 'STALE_RISK_ASSESSMENT') return { message: 'This assessment changed. Reload the latest version before editing again.', reload: true };
    if (code === 'RISK_ASSESSMENT_EXISTS') return { message: 'This hazard already has an assessment. Open it from the assessments list.' };
    if (code === 'HAZARD_CLOSED') return { message: 'This assessment is read-only because its hazard is closed.', reload: true };
    return { message: 'The hazard is no longer eligible for this assessment. Check its status and try again.' };
  }
  if (status === 403 || status === 404) return { message: 'You no longer have access to make this change.' };
  if (status === 400) return { message: 'The server rejected the submitted values. Check the ratings and try again.' };
  return { message: 'The assessment could not be saved. Check the latest record before retrying.' };
}

export function renderRevision(document, record, formatDate) {
  const row = createNode(document, 'li');
  row.append(
    createNode(document, 'strong', '', `Version ${record.version} · ${scoreText(record)}`),
    createNode(document, 'span', '', `Likelihood ${record.likelihood} · Severity ${record.severity}`),
    createNode(document, 'span', '', formatDate(record.createdAt)),
    createNode(document, 'span', '', `Assessor ID ${record.assessedById}`),
  );
  return row;
}
