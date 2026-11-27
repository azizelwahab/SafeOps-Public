export function closureManager(user, hazard) {
  return !!user && !!hazard && user.organizationId === hazard.organizationId &&
    (user.role === 'ADMIN' || user.role === 'SAFETY_OFFICER');
}

export function closureReadiness(user, hazard, baseline, actions, residual, decision) {
  const confirmed = hazard.status === 'CONFIRMED';
  const current = !!baseline && !!residual && actions.verified && residual.baselineVersion === baseline.version &&
    residual.verifiedActionCount === actions.count;
  const alreadyDecided = !!decision && !!residual && decision.residualVersion === residual.version;
  const canAssess = closureManager(user, hazard) && confirmed && !!baseline && actions.verified;
  const ready = canAssess && current && !alreadyDecided;
  const elevated = residual?.level === 'HIGH' || residual?.level === 'CRITICAL';
  const routine = residual?.level === 'LOW' || residual?.level === 'MEDIUM';
  return {
    confirmed, current, alreadyDecided, canAssess,
    decisions: ready ? routine ? ['close'] : elevated ? (user.role === 'ADMIN' ? ['escalate', 'accept'] : ['escalate']) : [] : [],
  };
}

function rationale(value) {
  const trimmed = (value ?? '').trim();
  if (trimmed.length < 10 || trimmed.length > 4000 || !trimmed.isWellFormed() || trimmed.includes('\0') ||
      (trimmed.match(/[\p{L}\p{N}]/gu)?.length ?? 0) < 3) {
    throw new RangeError('Enter a rationale of 10 to 4,000 characters with at least three letters or numbers.');
  }
  return trimmed;
}

export function residualPayload(values, latest) {
  if (![values.likelihood, values.severity].every((value) => /^[1-5]$/.test(value))) {
    throw new RangeError('Enter whole-number ratings from 1 to 5.');
  }
  const version = latest?.version ?? 0;
  if (!Number.isInteger(version) || version < 0 || version > 2147483646) throw new RangeError('Reload the residual assessment.');
  return { version, likelihood: Number(values.likelihood), severity: Number(values.severity), rationale: rationale(values.rationale) };
}

export function closurePayload(values, latest, operation) {
  const residualVersion = latest?.version;
  if (!Number.isInteger(residualVersion) || residualVersion < 1 || residualVersion > 2147483647) {
    throw new RangeError('Reload the latest residual assessment.');
  }
  const payload = { residualVersion, rationale: rationale(values.rationale) };
  if (operation === 'accept') payload.decision = 'ACCEPTED';
  if (operation === 'escalate') payload.decision = 'ESCALATED';
  return payload;
}

export function closureFailure({ status, code }) {
  const conflicts = {
    STALE_RESIDUAL_RISK: 'The residual assessment or its evidence changed.',
    CLOSURE_ALREADY_DECIDED: 'This revision already has a decision. A fresh residual revision is required.',
    VERIFIED_ACTIONS_REQUIRED: 'At least one corrective action is required and all actions must be verified.',
    HAZARD_NOT_CONFIRMED: 'This hazard is no longer confirmed.',
    BASELINE_REQUIRED: 'A baseline assessment is required.',
    RESIDUAL_RISK_REQUIRED: 'A current residual assessment is required.',
    RISK_DECISION_REQUIRED: 'High or critical risk requires explicit acceptance or escalation.',
    RISK_DECISION_NOT_APPLICABLE: 'Low and medium risk use the standard closure decision.',
  };
  if (status === 409) return {
    reload: true,
    message: (Object.hasOwn(conflicts, code) ? conflicts[code] : 'The evidence or decision changed.') + ' Reload closure data before trying again.',
  };
  if (status === 403 || status === 404) return { reload: true, message: 'This operation is no longer available. Reload closure data.' };
  if (status === 400) return { message: 'The server rejected the form. Check the ratings and rationale.' };
  return { reload: true, message: 'The outcome could not be confirmed. Reload closure data before trying again.' };
}

export async function verifiedActionEvidence(loadPage, isCurrent = () => true) {
  let count = 0;
  const seen = new Set();
  for (let page = 1; page <= 10000 && isCurrent(); page++) {
    const result = await loadPage(page);
    if (!result || !isCurrent()) return null;
    const { actions, limit } = result;
    for (const action of actions) {
      if (seen.has(action.id)) throw new Error('Corrective actions changed during pagination.');
      seen.add(action.id);
      if (action.status !== 'VERIFIED') return { count: 1, verified: false };
    }
    count += actions.length;
    if (actions.length < limit) return { count, verified: count > 0 };
  }
  if (isCurrent()) throw new Error('Corrective-action evidence exceeds the available pages.');
  return null;
}
