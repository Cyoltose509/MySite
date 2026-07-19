'use client';

import { useEffect, useState } from 'react';
import { hashPassword, setSession, clearSession, isAuthenticated } from './auth';
import { supabase } from './supabase';

// 隐私解锁事件（跨页面标签页同步）
export const PRIVATE_UNLOCKED_EVENT = 'my-site:private-unlocked';
export const PRIVATE_LOCKED_EVENT = 'my-site:private-locked';

// ── 防刷：失败计数与锁定状态（存 localStorage，同源跨标签页共享）──
const FAIL_COUNT_KEY = 'datahub_pwd_fail_count';
const LOCK_UNTIL_KEY = 'datahub_pwd_lock_until';
const MAX_ATTEMPTS = 5;
// 连续触发后依次升级的锁定时长（毫秒）：30s → 5min → 30min → 2h
const LOCK_DURATIONS_MS = [30_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];

function lsGetNum(key: string): number {
  if (typeof window === 'undefined') return 0;
  const v = window.localStorage.getItem(key);
  return v ? Number(v) || 0 : 0;
}
function lsSetNum(key: string, n: number) {
  if (typeof window === 'undefined') return;
  if (n <= 0) window.localStorage.removeItem(key);
  else window.localStorage.setItem(key, String(n));
}

/** 剩余锁定毫秒数，0 表示未锁定 */
function remainingLockMs(): number {
  const until = lsGetNum(LOCK_UNTIL_KEY);
  if (!until) return 0;
  const rem = until - Date.now();
  if (rem <= 0) { lsSetNum(LOCK_UNTIL_KEY, 0); return 0; }
  return rem;
}

/** 记录一次失败尝试；返回本次触发的锁定时长（毫秒），0 表示尚未锁定 */
function recordFailAttempt(): number {
  const fails = lsGetNum(FAIL_COUNT_KEY) + 1;
  if (fails >= MAX_ATTEMPTS) {
    const idx = Math.min(fails - MAX_ATTEMPTS, LOCK_DURATIONS_MS.length - 1);
    const dur = LOCK_DURATIONS_MS[idx];
    lsSetNum(LOCK_UNTIL_KEY, Date.now() + dur);
    lsSetNum(FAIL_COUNT_KEY, 0);
    return dur;
  }
  lsSetNum(FAIL_COUNT_KEY, fails);
  return 0;
}

/**
 * 控制台解锁：unlockPrivate('你的后台登录密码')。
 * 密码经服务端 RPC(fn_login) 校验——与 admin 登录同一套，哈希存在 Supabase 的
 * admin_config 里，前端不保存任何密码哈希，因此无需在 GitHub Pages 部署任何密钥。
 * 带防刷：连续错误 MAX_ATTEMPTS 次后临时锁定并逐级延长；锁定期间直接拒绝。
 */
export async function unlockPrivate(pw: string): Promise<boolean> {
  // 1) 已锁定 → 直接拒绝，不再打 RPC
  const rem = remainingLockMs();
  if (rem > 0) {
    if (typeof window !== 'undefined')
      console.warn(`[private] 已临时锁定，请于 ${Math.ceil(rem / 1000)} 秒后重试`);
    return false;
  }
  // 2) 服务端校验（哈希在浏览器算出后只传哈希，不传明文）
  const hash = hashPassword(pw);
  const { data, error } = await supabase.rpc('fn_login', { p_hash: hash });
  if (error || !data || (data as { error?: string }).error) {
    const dur = recordFailAttempt();
    if (typeof window !== 'undefined') {
      if (dur > 0) console.warn(`[private] 密码错误次数过多，已锁定 ${Math.ceil(dur / 60000)} 分钟`);
      else console.warn(`[private] 密码错误（${lsGetNum(FAIL_COUNT_KEY)}/${MAX_ATTEMPTS}），错误过多将临时锁定`);
    }
    return false;
  }
  // 3) 成功 → 清失败计数，建立会话并广播
  lsSetNum(FAIL_COUNT_KEY, 0);
  lsSetNum(LOCK_UNTIL_KEY, 0);
  setSession(hash);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PRIVATE_UNLOCKED_EVENT));
    console.info('[private] 已解锁隐私内容（本页及同站点其他标签页）。输入 lockPrivate() 可重新锁定。');
  }
  return true;
}

/** 控制台锁定：lockPrivate()。清除会话并广播锁定事件。 */
export function lockPrivate(): void {
  clearSession();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PRIVATE_LOCKED_EVENT));
    console.info('[private] 已锁定隐私内容。');
  }
}

export function privateStatus(): { unlocked: boolean; locked: boolean; retryAfterSec: number } {
  const rem = remainingLockMs();
  return { unlocked: isAuthenticated(), locked: rem > 0, retryAfterSec: Math.ceil(rem / 1000) };
}

// 在浏览器中安装全局控制台命令（/private [password] 的等价实现）
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).unlockPrivate = unlockPrivate;
  (window as unknown as Record<string, unknown>).lockPrivate = lockPrivate;
  (window as unknown as Record<string, unknown>).privateStatus = privateStatus;
  // 诊断工具：绕过 React 直接调用 admin RPC，验证数据通路
  (window as unknown as Record<string, unknown>).testPrivate = async () => {
    const s = privateStatus();
    console.log('[testPrivate] localStorage 会话:', s);
    if (!s.unlocked) { console.warn('[testPrivate] 未解锁，请先 unlockPrivate'); return; }
    const hash = localStorage.getItem('datahub_pwd_hash');
    console.log('[testPrivate] 哈希:', hash?.slice(0, 12) + '...');
    const [{ data: ev }, { data: mo }] = await Promise.all([
      supabase.rpc('fn_get_event_logs_admin', { p_hash: hash }),
      supabase.rpc('fn_get_mood_logs_admin',   { p_hash: hash }),
    ]);
    const evCount = Array.isArray(ev) ? ev.length : 'Error/NULL';
    const moCount = Array.isArray(mo) ? mo.length : 'Error/NULL';
    const evPrivate = Array.isArray(ev) ? ev.filter((l: any) => l.is_private).length : '?';
    console.log(`[testPrivate] 事件日志: ${evCount} 条, 其中私密组: ${evPrivate} 条`);
    console.log(`[testPrivate] 心情日志: ${moCount} 条`);
    if (Array.isArray(ev) && ev.length > 0) {
      // 找一条私密事件展示
      const priv = ev.filter((l: any) => l.is_private);
      if (priv.length) {
        console.log('[testPrivate] 示例私密事件:', priv[0].group_name, priv[0].event_at);
      } else {
        console.warn('[testPrivate] RPC 返回了数据但 is_private 全为 false？');
      }
    }
    return { evCount, moCount, evPrivate };
  };
  //console.info('[private] 已就绪');
}

/**
 * 订阅隐私解锁/锁定事件。
 * 返回 { unlocked, refreshKey }：unlocked 表示是否已解锁；refreshKey 在解锁/锁定状态变化时自增，
 * 页面可将其加入 fetchData 的依赖以触发重新拉取私密数据。
 */
export function usePrivateAccess(): { unlocked: boolean; refreshKey: number } {
  const [unlocked, setUnlocked] = useState<boolean>(isAuthenticated());
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    const onUnlock = () => { setUnlocked(true); setRefreshKey((k) => k + 1); };
    const onLock = () => { setUnlocked(false); setRefreshKey((k) => k + 1); };
    window.addEventListener(PRIVATE_UNLOCKED_EVENT, onUnlock);
    window.addEventListener(PRIVATE_LOCKED_EVENT, onLock);
    return () => {
      window.removeEventListener(PRIVATE_UNLOCKED_EVENT, onUnlock);
      window.removeEventListener(PRIVATE_LOCKED_EVENT, onLock);
    };
  }, []);
  return { unlocked, refreshKey };
}
