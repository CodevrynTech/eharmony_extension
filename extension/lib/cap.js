/** Daily send counter, keyed by the user's LOCAL calendar day. */
export function dayKey(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function normalizeCounter(counter, nowMs) {
  const today = dayKey(nowMs);
  if (counter && counter.date === today && Number.isInteger(counter.count) && counter.count >= 0) return counter;
  return { date: today, count: 0 };
}

export function incrementCounter(counter, nowMs) {
  const c = normalizeCounter(counter, nowMs);
  return { date: c.date, count: c.count + 1 };
}

export function remaining(limit, counter, nowMs) {
  return Math.max(0, limit - normalizeCounter(counter, nowMs).count);
}
