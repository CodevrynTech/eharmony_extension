// Keep in sync with host_permissions / content_scripts.matches in manifest.json.
export const ALLOWED_HOST_SUFFIXES = ['eharmony.com'];

export function isAllowedUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && ALLOWED_HOST_SUFFIXES.some((s) => u.hostname === s || u.hostname.endsWith(`.${s}`));
  } catch {
    return false;
  }
}
