// 位置候选数据：国内省/自治区/直辖市/特别行政区、城市、国家（含"中国"）。
// 供 LocationEditor 的三段式候选框与位置地图复用。
import { pinyin } from 'pinyin-pro';
import { CITY_COORDS, PROVINCE_CENTROID, COUNTRY_COORDS, type LngLat } from './china-cities';

export type LocationType = 'province' | 'city' | 'country';

export interface LocationSuggestion {
  name: string;          // 规范名（如 "武汉市" / "广东省" / "日本" / "中国"）
  type: LocationType;
  coord: LngLat;
  aliases?: string[];    // 英文等别名，用于搜索
}

const CITY_NO_SUFFIX = new Set(['香港', '澳门']);
const AUTONOMOUS = new Set(['广西', '西藏', '新疆', '宁夏', '内蒙古']);
const MUNICIPALITIES = new Set(['北京', '上海', '天津', '重庆']);

const COUNTRY_ALIASES: Record<string, string[]> = {
  美国: ['usa', 'united states', 'america'],
  日本: ['japan'],
  韩国: ['korea', 'south korea'],
  朝鲜: ['north korea'],
  英国: ['uk', 'united kingdom', 'england', 'britain'],
  法国: ['france'],
  德国: ['germany'],
  意大利: ['italy'],
  西班牙: ['spain'],
  加拿大: ['canada'],
  澳大利亚: ['australia'],
  新西兰: ['new zealand'],
  俄罗斯: ['russia'],
  印度: ['india'],
  泰国: ['thailand'],
  新加坡: ['singapore'],
  马来西亚: ['malaysia'],
  越南: ['vietnam'],
  印度尼西亚: ['indonesia'],
  菲律宾: ['philippines'],
  土耳其: ['turkey'],
  巴西: ['brazil'],
  墨西哥: ['mexico'],
  埃及: ['egypt'],
  南非: ['south africa'],
  荷兰: ['netherlands', 'holland'],
  瑞士: ['switzerland'],
  瑞典: ['sweden'],
  挪威: ['norway'],
  丹麦: ['denmark'],
  奥地利: ['austria'],
  比利时: ['belgium'],
  葡萄牙: ['portugal'],
  希腊: ['greece'],
  爱尔兰: ['ireland'],
  波兰: ['poland'],
  芬兰: ['finland'],
  捷克: ['czech'],
  匈牙利: ['hungary'],
  阿根廷: ['argentina'],
  智利: ['chile'],
  阿联酋: ['uae'],
  沙特阿拉伯: ['saudi arabia'],
  以色列: ['israel'],
  蒙古: ['mongolia'],
  柬埔寨: ['cambodia'],
  缅甸: ['myanmar', 'burma'],
  老挝: ['laos'],
  尼泊尔: ['nepal'],
  斯里兰卡: ['sri lanka'],
  哈萨克斯坦: ['kazakhstan'],
  乌克兰: ['ukraine'],
  白俄罗斯: ['belarus'],
  罗马尼亚: ['romania'],
};

function pyArrOf(text: string): string[] {
  try { return pinyin(text, { toneType: 'none', type: 'array' }) || []; } catch { return []; }
}

function buildProvinces(): LocationSuggestion[] {
  const out: LocationSuggestion[] = [];
  for (const [core, coord] of Object.entries(PROVINCE_CENTROID)) {
    if (MUNICIPALITIES.has(core)) continue; // 直辖市归入城市
    const name = AUTONOMOUS.has(core) ? core + '自治区' : core + '省';
    out.push({ name, type: 'province', coord });
  }
  return out;
}

function buildCities(): LocationSuggestion[] {
  const out: LocationSuggestion[] = [];
  for (const [core, coord] of Object.entries(CITY_COORDS)) {
    const name = CITY_NO_SUFFIX.has(core) ? core : core + '市';
    out.push({ name, type: 'city', coord });
  }
  return out;
}

function buildCountries(): LocationSuggestion[] {
  const out: LocationSuggestion[] = [];
  for (const [name, coord] of Object.entries(COUNTRY_COORDS)) {
    out.push({ name, type: 'country', coord, aliases: COUNTRY_ALIASES[name] });
  }
  return out;
}

export const PROVINCE_SUGGESTIONS = buildProvinces();
export const CITY_SUGGESTIONS = buildCities();
export const COUNTRY_SUGGESTIONS = [
  ...buildCountries(),
  { name: '中国', type: 'country' as const, coord: [104, 35.5] as LngLat, aliases: ['china'] },
];

export const LOCATION_SUGGESTIONS = [
  ...PROVINCE_SUGGESTIONS,
  ...CITY_SUGGESTIONS,
  ...COUNTRY_SUGGESTIONS,
];

interface Indexed extends LocationSuggestion {
  blob: string;
}

function indexList(list: LocationSuggestion[]): Indexed[] {
  return list.map((s) => {
    const py = pyArrOf(s.name);
    const blob = [
      s.name,
      ...(s.aliases || []),
      py.join(''),
      py.map((w) => w[0] || '').join(''),
    ].join(' ').toLowerCase();
    return { ...s, blob };
  });
}

function filterList(indexed: Indexed[], q: string, limit = 12): LocationSuggestion[] {
  const qn = (q || '').trim().toLowerCase();
  if (!qn) return indexed.slice(0, limit).map(({ blob, ...rest }) => rest);
  const qpy = pyArrOf(qn);
  const qFull = qpy.join('').toLowerCase();
  const qInit = qpy.map((w) => w[0] || '').join('').toLowerCase();
  const res: LocationSuggestion[] = [];
  for (const s of indexed) {
    if (
      s.blob.includes(qn) ||
      (qFull && s.blob.includes(qFull)) ||
      (qInit && s.blob.includes(qInit))
    ) {
      const { blob, ...rest } = s;
      res.push(rest);
    }
  }
  return res.slice(0, limit);
}

const I_PROV = indexList(PROVINCE_SUGGESTIONS);
const I_CITY = indexList(CITY_SUGGESTIONS);
const I_COUN = indexList(COUNTRY_SUGGESTIONS);

export function filterProvinceSuggestions(q: string, limit = 12): LocationSuggestion[] {
  return filterList(I_PROV, q, limit);
}
export function filterCitySuggestions(q: string, limit = 12): LocationSuggestion[] {
  return filterList(I_CITY, q, limit);
}
export function filterCountrySuggestions(q: string, limit = 12): LocationSuggestion[] {
  return filterList(I_COUN, q, limit);
}

/** 兼容旧调用：混合全部候选 */
export function filterLocationSuggestions(q: string, limit = 12): LocationSuggestion[] {
  return filterList(indexList(LOCATION_SUGGESTIONS), q, limit);
}
