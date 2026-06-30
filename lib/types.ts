export interface MusicTag {
    id?: string;
    music_id: string;
    tag: string;
    likability?: number;   // 喜欢度 1-5（夯~拉完了）
    singability?: number;  // 能唱度 1-5
    voice?: string;        // 声线：male / female / duet
    note?: string;         // 记录
    user_input?: boolean;
    created_at?: string;
    updated_at?: string;
}

// 事件计数 - 事件组
export interface EventGroup {
    id?: string;
    name: string;
    icon: string;           // emoji
    color: string;          // 显示颜色
    sort_order?: number;
    is_private?: boolean;   // 是否隐私（不公开）
    created_at?: string;
}

// 事件计数 - 事件记录（每条 = 一次事件发生，含精确时间）
export interface EventLog {
    id?: string;
    group_id: string;
    event_at: string;       // ISO timestamptz，精确到时分秒
    created_at?: string;
}

// 心情评分标签（1-10，很差→极佳）
// 心情评分对应 emoji（1-10）
export const MOOD_EMOJIS = ['😭', '😢', '😞', '😕', '😐', '🙂', '😊', '😄', '🥳', '🤩'];

// 心情评分标签（1-10）
export const MOOD_SCORE_LABELS: Record<number, string> = {
    1: '很差', 2: '差', 3: '较差', 4: '稍差', 5: '一般',
    6: '尚可', 7: '不错', 8: '很好', 9: '极佳', 10: '完美',
};


// 音乐标签预设
export const PRESET_TAGS = [
    '放松', '清新',
    '悲伤', '快乐','恋爱', '励志',
    '电子', '摇滚',
    'ACG',  'OST',
    '韩语', '和声', '柔情','旁白',
    '多人', '低音炮', '高音炮',
    'rap', '古风', '同人曲', '喊叫', '念经','紧张'
];


// 时间统计尺度（events 和 mood 共用）
export type TimeScale = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly';
export const TIME_SCALES: { value: TimeScale; label: string }[] = [
    {value: 'hourly', label: '小时'},
    {value: 'daily', label: '日'},
    {value: 'weekly', label: '周'},
    {value: 'monthly', label: '月'},
    {value: 'yearly', label: '年'},
];
