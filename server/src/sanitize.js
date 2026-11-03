const URL_RE = /(https?:\/\/\S+|www\.\S+)/gi;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/g;

export function cleanName(raw) {
  if (typeof raw !== 'string') return '';
  const first = raw.trim().split(/\s+/)[0] || '';
  const letters = first.replace(/[^\p{L}'’-]/gu, '').slice(0, 30);
  if (letters.length < 2) return '';
  return letters.charAt(0).toUpperCase() + letters.slice(1);
}

function truncateAtBoundary(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  if (lastStop >= max * 0.5) return cut.slice(0, lastStop + 1).trim();
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[,;:\-–]+$/, '').trim() + '…';
}

/**
 * Normalises model output into a single-line message body that does NOT contain
 * a greeting (the extension prepends "Hi <Name>, ").
 */
export function cleanMessage(raw, { name = '', maxChars = 400 } = {}) {
  if (typeof raw !== 'string') return '';
  let text = raw.replace(URL_RE, '').replace(EMAIL_RE, '').replace(/\s+/g, ' ').trim();
  // Drop a leading greeting the model may have added anyway.
  text = text.replace(/^(hi|hello|hey|dear)\b[^,!.\n]{0,40}[,!.]\s*/i, '');
  if (name) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`^${esc}\\b[,!.]?\\s*`, 'i'), '');
  }
  text = text.replace(/^[\s,.\-–]+/, '');
  if (text) text = text.charAt(0).toUpperCase() + text.slice(1);
  return truncateAtBoundary(text, maxChars);
}
