/**
 * kind:
 *  - 'fatal'     stop the whole run (bad token, server down, not logged in)
 *  - 'transient' put the profile back and retry later (rate limit, upstream outage)
 *  - 'item'      this profile failed; continue with the next one
 */
export class AppError extends Error {
  constructor(kind, message, code = 'ERROR') {
    super(message);
    this.name = 'AppError';
    this.kind = kind;
    this.code = code;
  }
}
