import CryptoJS from 'crypto-js';

export function hashPassword(password: string): string {
  return CryptoJS.SHA256(password).toString(CryptoJS.enc.Hex);
}

export function setSession(passwordHash: string, expiresInHours = 24) {
  const expiry = Date.now() + expiresInHours * 60 * 60 * 1000;
  if (typeof window !== 'undefined') {
    localStorage.setItem('datahub_pwd_hash', passwordHash);
    localStorage.setItem('datahub_session_expiry', expiry.toString());
  }
}

export function getSession(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = localStorage.getItem('datahub_pwd_hash');
  const expiry = localStorage.getItem('datahub_session_expiry');
  if (!hash || !expiry) return null;
  if (Date.now() > parseInt(expiry)) {
    clearSession();
    return null;
  }
  return hash;
}

export function clearSession() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('datahub_pwd_hash');
    localStorage.removeItem('datahub_session_expiry');
  }
}

export function isAuthenticated(): boolean {
  return getSession() !== null;
}
