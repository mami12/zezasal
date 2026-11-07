const LIMIT_FIELDS = ['dailyLimit', 'weeklyLimit', 'monthlyLimit'];
const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

export function planLimitChanges(current, requested, now = Date.now()) {
  const pending = { ...(current.pendingLimits ?? {}) };
  const immediate = {};
  let schedulesChange = false;
  for (const field of LIMIT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(requested, field)) continue;
    const raw = requested[field];
    const value = raw === null || raw === '' ? null : Number(raw);
    if (value !== null && (!Number.isFinite(value) || value <= 0)) {
      throw badRequest(`${field} must be a positive amount or null`);
    }
    const existing = current[field];
    if (existing !== null && (value === null || value > existing)) {
      pending[field] = value;
      schedulesChange = true;
    } else {
      immediate[field] = value;
      delete pending[field];
    }
  }
  const pendingFields = Object.keys(pending);
  const effectiveAt = pendingFields.length
    ? schedulesChange || !current.limitsEffectiveAt
      ? new Date(now + 7 * 24 * 60 * 60 * 1000)
      : current.limitsEffectiveAt
    : null;
  return { immediate, pending, pendingFields, effectiveAt };
}

export function assertBetWithinLimits({ stake, controls, used, now = Date.now() }) {
  if (controls.selfExcludedUntil && new Date(controls.selfExcludedUntil).getTime() > now) {
    throw Object.assign(new Error(`Llogaria është në vetëpërjashtim deri më ${new Date(controls.selfExcludedUntil).toLocaleString('sq-AL')}.`), { status: 403 });
  }
  const checks = [
    ['dailyLimit', 'daily_used', 'ditor'],
    ['weeklyLimit', 'weekly_used', 'javor'],
    ['monthlyLimit', 'monthly_used', 'mujor'],
  ];
  for (const [limitKey, usageKey, label] of checks) {
    const limit = controls[limitKey];
    if (limit !== null && Number(used[usageKey] ?? 0) + Number(stake) > limit) {
      throw badRequest(`Basti tejkalon kufirin ${label} prej ${limit.toFixed(2)} Lëk.`);
    }
  }
}
