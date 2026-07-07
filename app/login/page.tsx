'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { withBasePath } from '@/lib/base-path';
import Link from 'next/link';
import { hashPassword, setSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;

    setLoading(true);
    setError('');

    try {
      const hash = hashPassword(password);

      const { data, error: rpcError } = await supabase.rpc('fn_login', {
        p_hash: hash,
      });

      if (rpcError || !data || data.error) {
        setError('密码错误');
        setLoading(false);
        return;
      }

      setSession(hash, 24);
      router.push('/admin');
    } catch (err) {
      setError('登录失败，请重试');
      setLoading(false);
    }
  };

  return (
    <div style={S.page}>
      <div style={S.card}>
        <img src={withBasePath('/avatar.png')} alt="" width={72} height={72}
          style={{ borderRadius: 20, border: '2px solid #6366f1', marginBottom: 16 }} />
        <h1 style={S.title}>DataHub</h1>
        <p style={S.subtitle}>个人数据中枢 · 管理入口</p>

        <form onSubmit={handleLogin} style={S.form}>
          <div style={S.inputWrap}>
            <span style={S.inputIcon}>🔑</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="输入访问密码"
              style={S.input}
              autoFocus
            />
          </div>

          {error && (
            <p style={S.error}>
              <span>⚠</span> {error}
            </p>
          )}

          <button type="submit" disabled={loading || !password}
            style={{...S.btn, opacity: loading || !password ? 0.5 : 1}}>
            {loading ? (
              <><span style={S.spin} /> 验证中...</>
            ) : (
              '进入后台'
            )}
          </button>
        </form>

        <Link href="/" style={S.homeLink}>← 返回首页</Link>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties & any> = {};
const styles = S;

S.page = {
  minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: '#0a0a14',
};
S.card = {
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  background: '#121224', border: '1px solid #1e1e32',
  borderRadius: 24, padding: '40px 36px', width: 340, textAlign: 'center',
};
S.title = { fontSize: 22, fontWeight: 800, color: '#fff', margin: '0 0 4px' };
S.subtitle = { fontSize: 12, color: '#52525b', margin: '0 0 28px' };
S.form = { width: '100%', display: 'flex', flexDirection: 'column', gap: 12 };
S.inputWrap = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '2px 4px 2px 14px', borderRadius: 12,
  border: '1px solid #27273d', background: '#0a0a14',
  transition: 'border-color 0.15s',
};
S.inputIcon = { fontSize: 15 };
S.input = {
  flex: 1, padding: '11px 6px', border: 'none', background: 'transparent',
  color: '#e4e4e7', fontSize: 14, outline: 'none', letterSpacing: 0.3,
};
S.btn = {
  padding: '12px 0', borderRadius: 12, border: 'none',
  background: '#6366f1', color: '#fff', fontSize: 14, fontWeight: 600,
  cursor: 'pointer', transition: 'background 0.15s',
};
S.error = {
  fontSize: 13, color: '#f87171', textAlign: 'left', margin: 0,
  padding: '8px 10px', borderRadius: 8, background: 'rgba(248,113,113,0.08)',
};
S.homeLink = {
  marginTop: 20, fontSize: 12, color: '#52525b', textDecoration: 'none',
};
// Inline spinner for button
S.spin = {
  display: 'inline-block', width: 14, height: 14, borderRadius: '50%',
  border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff',
  animation: 'spin 0.7s linear infinite', marginRight: 6, verticalAlign: 'middle',
};
