import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// RLS 门禁：登录后 localStorage 里存的就是密码的 SHA256 哈希，
// 与 admin_config.password_hash 一致。把它作为请求头带上，
// people / meals 等表的 RLS 策略（fn_has_admin_key）才会放行 admin 的直连读写。
const ADMIN_KEY_HEADER = 'x-datahub-key';

const fetchWithAdminKey = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  // 用 Headers 合并，避免直接展开把 supabase-js 传入的 Headers 实例（含 apikey / Content-Type）丢掉
  const h = new Headers(init?.headers as any);
  // RPC 函数都是 SECURITY DEFINER 且自带 p_hash 校验，不需要也不应带自定义头（避免触发 CORS 预检等副作用）；
  // 只有 people / meals 这些直连 .from() 的表级读写才需要 x-datahub-key 让 RLS 放行。
  const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : '');
  const isRpc = url.includes('/rpc/');
  if (!isRpc && typeof window !== 'undefined') {
    const key = window.localStorage.getItem('datahub_pwd_hash');
    if (key) h.set(ADMIN_KEY_HEADER, key);
  }
  const merged: RequestInit = { ...init, headers: h };
  return fetch(input as any, merged as any);
};

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Missing Supabase environment variables');
}

export const supabase: SupabaseClient = createClient(
  supabaseUrl || '',
  supabaseAnonKey || '',
  { global: { fetch: fetchWithAdminKey as any } }
);
