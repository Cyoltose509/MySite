'use client';

import { useState } from 'react';
import { C, tagChipStyle } from '@/lib/card-styles';

interface Props {
  selectedTags: string[];
  onTagsChange: (tags: string[]) => void;
  presetTags: string[];
  customTagsAll: string[];
}

export function TagInput({ selectedTags, onTagsChange, presetTags, customTagsAll }: Props) {
  const [tagInput, setTagInput] = useState('');

  const toggle = (tag: string) => {
    onTagsChange(selectedTags.includes(tag)
      ? selectedTags.filter(t => t !== tag)
      : [...selectedTags, tag]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      const v = tagInput.trim();
      if (v && !selectedTags.includes(v)) onTagsChange([...selectedTags, v]);
      setTagInput('');
      e.preventDefault();
    }
    if (e.key === 'Backspace' && !tagInput) {
      onTagsChange(selectedTags.slice(0, -1));
    }
  };

  return (
    <div>
      {/* Selected tags */}
      {selectedTags.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: C.textSec, marginBottom: 6 }}>已选标签</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {selectedTags.map(t => (
              <span key={t} style={{ ...tagChipStyle, background: '#27273d', color: C.text, fontSize: 11, padding: '4px 12px' }}>
                {t}
                <button onClick={() => toggle(t)} style={{
                  background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 12, marginLeft: 4
                }}>×</button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Preset tags */}
      <div style={{ fontSize: 12, color: C.textSec, marginBottom: 6 }}>选择标签</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {presetTags.map(tag => (
          <button key={tag} onClick={() => toggle(tag)} style={{
            padding: '4px 10px', borderRadius: 20, border: '1px solid',
            borderColor: selectedTags.includes(tag) ? C.accent : 'rgba(255,255,255,0.1)',
            background: selectedTags.includes(tag) ? 'rgba(99,102,241,0.15)' : 'transparent',
            color: selectedTags.includes(tag) ? C.accent : C.textSec,
            cursor: 'pointer', fontSize: 11,
          }}>{tag}</button>
        ))}
      </div>

      {/* Custom tags quick-select */}
      {customTagsAll.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: C.textDim, marginBottom: 4 }}>已有自定义标签（点击快速添加）</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {customTagsAll.map(t => (
              <button key={t} onClick={() => { if (!selectedTags.includes(t)) onTagsChange([...selectedTags, t]); }} style={{
                padding: '3px 8px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)',
                background: selectedTags.includes(t) ? 'rgba(99,102,241,0.15)' : 'transparent',
                color: selectedTags.includes(t) ? C.accentLt : C.textDim,
                cursor: 'pointer', fontSize: 10,
              }}>{t}</button>
            ))}
          </div>
        </div>
      )}

      {/* Custom tag input */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input value={tagInput} onChange={e => setTagInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入自定义标签..."
          style={{ flex: 1, padding: '6px 12px', borderRadius: 8,
            border: '1px solid #27273d', background: '#121224', color: C.text, fontSize: 12 }} />
      </div>
    </div>
  );
}
