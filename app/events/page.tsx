'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { C, pageStyle, headerStyle, h1Style, backLinkStyle, emptyStyle, loadingContainerStyle, spinnerStyle, loadingTextStyle } from '@/lib/card-styles';

interface EventGroup {
  id: string;
  name: string;
  icon: string;
  color: string;
  sort_order: number;
  is_private: boolean;
}

interface EventLog {
  id: string;
  group_id: string;
  event_at: string;
  event_groups: {
    name: string;
    icon: string;
    color: string;
  };
}

export default function EventsPage() {
  const [groups, setGroups] = useState<EventGroup[]>([]);
  const [logs, setLogs] = useState<EventLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState(30); // 默认看30天

  useEffect(() => { fetchData(); }, [range]);

  const fetchData = async () => {
    setLoading(true);

    const { data: gData } = await supabase
      .from('event_groups')
      .select('*')
      .order('sort_order', { ascending: true });
    setGroups(gData || []);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - range);
    const startStr = startDate.toISOString();

    const { data: lData } = await supabase
      .from('event_logs')
      .select('*, event_groups(name, icon, color)')
      .gte('event_at', startStr)
      .order('event_at', { ascending: false })
      .limit(500);
    setLogs(lData || []);
    setLoading(false);
  };

  // 按日期聚合
  const groupedByDate = useMemo(() => {
    const map: Record<string, EventLog[]> = {};
    for (const l of logs) {
      const day = l.event_at.slice(0, 10);
      if (!map[day]) map[day] = [];
      map[day].push(l);
    }
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]));
  }, [logs]);

  // 每组总次数
  const groupTotals = useMemo(() => {
    const map: Record<string, number> = {};
    for (const l of logs) {
      map[l.group_id] = (map[l.group_id] || 0) + 1;
    }
    return map;
  }, [logs]);

  if (loading) return (
    <div style={loadingContainerStyle}>
      <div style={spinnerStyle} />
      <p style={loadingTextStyle}>加载中...</p>
    </div>
  );

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <Link href="/" style={backLinkStyle}>← 返回首页</Link>
        <h1 style={h1Style}>📅 事件记录</h1>
      </header>

      {/* 范围选择 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {[30, 60, 90, 180, 365].map(d => (
          <button key={d} onClick={() => setRange(d)}
            style={{
              ...rangeBtnStyle,
              ...(range === d ? rangeBtnActiveStyle : {}),
            }}>
            {d} 天
          </button>
        ))}
      </div>

      {/* 总览卡片 */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
        {groups.map(g => (
          <div key={g.id} style={{
            ...statCardStyle,
            borderColor: g.color,
            background: g.color + '15',
          }}>
            <div style={{ fontSize: 22, marginBottom: 4 }}>{g.icon}</div>
            <div style={{ fontSize: 12, color: '#a1a1aa', marginBottom: 4 }}>{g.name}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#e4e4e7' }}>{groupTotals[g.id] || 0}</div>
            <div style={{ fontSize: 11, color: '#52525b' }}>次 / {range}天</div>
          </div>
        ))}
      </div>

      {/* 按日期展开 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {groupedByDate.map(([date, dayLogs]) => (
          <div key={date} style={dayBlockStyle}>
            <div style={dayHeaderStyle}>
              <span style={{ color: '#e4e4e7', fontWeight: 600, fontSize: 14 }}>{date}</span>
              <span style={{ color: '#52525b', fontSize: 12 }}>共 {dayLogs.length} 次</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {dayLogs.map(l => (
                <span key={l.id} style={{
                  ...logChipStyle,
                  background: (l.event_groups?.color || '#6366f1') + '22',
                  color: l.event_groups?.color || '#818cf8',
                }}>
                  {l.event_groups?.icon} {l.event_groups?.name}
                  <span style={{ marginLeft: 4, fontSize: 10, color: '#71717a' }}>
                    {new Date(l.event_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {groupedByDate.length === 0 && (
        <p style={emptyStyle}>暂无数据</p>
      )}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const rangeBtnStyle: React.CSSProperties = {
  padding: '6px 14px', borderRadius: 8, border: '1px solid #2a2a40',
  background: 'transparent', color: '#a1a1aa', cursor: 'pointer', fontSize: 12,
};
const rangeBtnActiveStyle: React.CSSProperties = {
  borderColor: '#6366f1', background: 'rgba(99,102,241,0.15)', color: '#818cf8',
};
const statCardStyle: React.CSSProperties = {
  flex: '1 1 120px', maxWidth: 160, padding: '14px 16px', borderRadius: 12,
  border: '1px solid', textAlign: 'center',
};
const dayBlockStyle: React.CSSProperties = {
  padding: '12px 16px', borderRadius: 12, background: '#16162a', border: '1px solid #2a2a40',
};
const dayHeaderStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  marginBottom: 10,
};
const logChipStyle: React.CSSProperties = {
  padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500,
};
