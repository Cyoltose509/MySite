'use client';

import { useState, useRef, useEffect } from 'react';
import { type LocationSuggestion } from '@/lib/locations-data';

const TYPE_LABEL: Record<LocationSuggestion['type'], string> = {
  province: '省',
  city: '市',
  country: '国',
};
const TYPE_COLOR: Record<LocationSuggestion['type'], string> = {
  province: '#60a5fa',
  city: '#a78bfa',
  country: '#34d399',
};

export function LocationAutocomplete({
  value,
  onChange,
  filter,
  placeholder,
  style,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  filter: (q: string) => LocationSuggestion[];
  placeholder?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(value);
  const [active, setActive] = useState(0);
  const [items, setItems] = useState<LocationSuggestion[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setQ(value); }, [value]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const update = (text: string) => {
    setQ(text);
    const r = filter(text);
    setItems(r);
    setActive(0);
    setOpen(true);
    onChange(text);
  };

  const choose = (s: LocationSuggestion) => {
    setQ(s.name);
    onChange(s.name);
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown') {
        setItems(filter(q));
        setOpen(true);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[active]) choose(items[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        value={q}
        onChange={(e) => update(e.target.value)}
        onFocus={() => { setItems(filter(q)); setOpen(true); }}
        onKeyDown={onKey}
        placeholder={placeholder}
        style={{ ...style, opacity: disabled ? 0.4 : 1 }}
        disabled={disabled}
        autoComplete="off"
      />
      {open && items.length > 0 && (
        <div style={{
          position: 'absolute', zIndex: 50, top: '100%', left: 0, right: 0, marginTop: 4,
          background: '#121224', border: '1px solid #2a2a40', borderRadius: 8,
          maxHeight: 240, overflowY: 'auto',
          boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
        }}>
          {items.map((s, i) => (
            <div
              key={s.name}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); choose(s); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 12px', cursor: 'pointer',
                background: i === active ? '#1e1e38' : 'transparent',
              }}
            >
              <span style={{
                fontSize: 10, padding: '1px 6px', borderRadius: 4,
                background: TYPE_COLOR[s.type] + '22', color: TYPE_COLOR[s.type],
                border: '1px solid' + TYPE_COLOR[s.type] + '55', flexShrink: 0,
              }}>{TYPE_LABEL[s.type]}</span>
              <span style={{ fontSize: 13, color: '#e4e4e7' }}>{s.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
