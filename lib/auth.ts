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

// ── 私密查看会话（与「管理员登录」完全独立）──
// 管理员登录只写 datahub_pwd_hash（用于 /admin 编辑）；
// 私密数据（位置/私密心情/私密事件）的查看必须显式 unlockPrivate，写下面这组独立令牌。
// 这样「登录后台」不会顺带解锁私密数据，默认私密是锁着的。
const PRIV_KEY = 'datahub_private_hash';
const PRIV_EXP = 'datahub_private_expiry';

export function setPrivateSession(passwordHash: string, expiresInHours = 24) {
  const expiry = Date.now() + expiresInHours * 60 * 60 * 1000;
  if (typeof window !== 'undefined') {
    localStorage.setItem(PRIV_KEY, passwordHash);
    localStorage.setItem(PRIV_EXP, expiry.toString());
  }
}

export function getPrivateSession(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = localStorage.getItem(PRIV_KEY);
  const expiry = localStorage.getItem(PRIV_EXP);
  if (!hash || !expiry) return null;
  if (Date.now() > parseInt(expiry)) {
    clearPrivateSession();
    return null;
  }
  return hash;
}

export function clearPrivateSession() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(PRIV_KEY);
    localStorage.removeItem(PRIV_EXP);
  }
}

export function isPrivateUnlocked(): boolean {
  return getPrivateSession() !== null;
}
