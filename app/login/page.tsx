'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { hashPassword, setSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const hash = hashPassword(password);

    const { data, error: rpcError } = await supabase.rpc('fn_login', {
      p_hash: hash,
    });

    if (rpcError || !data || data.error) {
      setError('密码错误');
      setLoading(false);
      return;
    }

    // Store password hash as session
    setSession(hash, 24);
    router.push('/admin');
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>🔒 管理员登录</h1>
        <form onSubmit={handleLogin} style={styles.form}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="请输入密码"
            style={styles.input}
            autoFocus
          />
          {error && <p style={styles.error}>{error}</p>}
          <button type="submit" disabled={loading} style={styles.button}>
            {loading ? '登录中...' : '登录'}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--color-bg)',
  },
  card: {
    background: 'var(--color-card)',
    border: '1px solid var(--color-border)',
    borderRadius: 12,
    padding: 40,
    width: 360,
  },
  title: {
    fontSize: 20,
    fontWeight: 600,
    marginBottom: 24,
    color: 'var(--color-text)',
  },
  form: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 16,
  },
  input: {
    padding: '10px 14px',
    borderRadius: 8,
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
    fontSize: 14,
    outline: 'none',
  },
  button: {
    padding: '10px 0',
    borderRadius: 8,
    border: 'none',
    background: 'var(--color-accent)',
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  error: {
    color: '#ff6b6b',
    fontSize: 13,
    margin: 0,
  },
};
