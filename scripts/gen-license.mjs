// Usage: pnpm license <label> [dailyLimit]
// Prints a LICENSES entry (label:token[:dailyLimit]) and the token to hand to that user.
import crypto from 'node:crypto';

const [label, limit] = process.argv.slice(2);
if (!label || !/^[A-Za-z0-9_-]{1,32}$/.test(label)) {
  console.error('Usage: pnpm license <label> [dailyLimit]\n  label: 1-32 letters, digits, "_" or "-" (e.g. the client name)');
  process.exit(1);
}
if (limit !== undefined && !(Number.isInteger(Number(limit)) && Number(limit) >= 1 && Number(limit) <= 5000)) {
  console.error('dailyLimit must be an integer between 1 and 5000');
  process.exit(1);
}

const token = crypto.randomBytes(24).toString('hex');
const entry = `${label}:${token}${limit ? `:${limit}` : ''}`;
console.log(`Give this token to "${label}" (they paste it into the extension):\n  ${token}\n`);
console.log(`Add this entry to the LICENSES environment variable (comma-separated):\n  ${entry}`);
