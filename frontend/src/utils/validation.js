// Email + password rules shared by the login and registration forms. The
// backend re-checks the same rules on /api/users/register-profile — this copy
// exists for the live inline feedback, not as the enforcement point.

// Standard "something@something.tld" check, deliberately not an RFC parser.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email) {
  return EMAIL_RE.test(String(email).trim());
}

// Each rule shown as its own line under the password field so the user can see
// which one is still failing.
export const PASSWORD_RULES = [
  { key: 'length', label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { key: 'letter', label: 'Contains a letter', test: (p) => /[a-zA-Z]/.test(p) },
  { key: 'number', label: 'Contains a number', test: (p) => /[0-9]/.test(p) },
  {
    key: 'special',
    label: 'Contains a special character',
    test: (p) => /[^a-zA-Z0-9]/.test(p),
  },
];

// { length: true, letter: false, … } for the live checklist.
export function checkPassword(password) {
  const pw = String(password ?? '');
  return Object.fromEntries(PASSWORD_RULES.map((r) => [r.key, r.test(pw)]));
}

export function isValidPassword(password) {
  return PASSWORD_RULES.every((r) => r.test(String(password ?? '')));
}
