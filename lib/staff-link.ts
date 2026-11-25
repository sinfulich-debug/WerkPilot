/** Pure helpers for the "set your password" link an owner hands to a new employee. */

/** One-time link that logs the employee in and leads to the page where the password is chosen. */
export function buildSetPasswordLink(origin: string, tokenHash: string): string {
  const url = new URL('/auth/confirm', origin);
  url.searchParams.set('token_hash', tokenHash);
  url.searchParams.set('type', 'recovery');
  url.searchParams.set('next', '/passwort-setzen');
  return url.toString();
}

/** Only same-site paths may be used as redirect target after the link was confirmed (no open redirect). */
export function safeNextPath(next: string | null | undefined, fallback = '/'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes(String.fromCharCode(92)) || /[\r\n]/.test(next)) {
    return fallback;
  }
  return next;
}

export const MIN_PASSWORD_LENGTH = 10;

/**
 * German message for a failed "set password" call. Only a broken or used-up session needs a new link;
 * telling an employee to fetch a new link because they re-used their old password does not help them.
 */
export function passwordUpdateErrorMessage(error: { code?: string; status?: number } | null | undefined): string {
  switch (error?.code) {
    case 'same_password':
      return 'Das neue Passwort muss sich vom bisherigen Passwort unterscheiden.';
    case 'weak_password':
      return 'Das Passwort ist zu schwach. Bitte wähle ein längeres Passwort mit Buchstaben, Zahlen und Sonderzeichen.';
    default:
      return 'Das Passwort konnte nicht gespeichert werden. Bitte den Link erneut öffnen oder einen neuen Link anfordern.';
  }
}

/** Returns a German error message, or null when the new password is acceptable. */
export function validateNewPassword(password: string, repeat: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`;
  }
  if (password.length > 72) return 'Das Passwort darf höchstens 72 Zeichen lang sein.';
  if (password !== repeat) return 'Die Passwörter stimmen nicht überein.';
  return null;
}
