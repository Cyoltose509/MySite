"""
番剧 Tier 图生成脚本
====================
用法：
    python generate_tier.py [--anime-dir 番剧大全] [--output tier_chart.png]
                            [--thumb-w 120] [--thumb-h 170] [--cols 10]
                            [--cache-dir .tier_cache]

参数说明：
  --anime-dir   番剧 md 文件所在目录，默认 ./番剧大全
  --output      输出图片路径，默认 tier_chart.png
  --thumb-w     每个封面宽度 px，默认 120
  --thumb-h     每个封面高度 px，默认 170
  --cols        每行最多放几张封面（0=自动根据图宽），默认 0
  --img-width   整体图片宽度 px，默认 2400
  --cache-dir   封面图缓存目录，默认 .tier_cache
  --force       忽略缓存，重新获取所有封面
  --only        只测试指定番剧（逗号分隔）
  --timeline-dir 时间线目录（用于按时间排序）
"""

import os
import re
import sys
import json
import time
import argparse
import textwrap
import urllib.parse

# ─────────────────────────────────────────────
# SSL 安全初始化（必须在 cloudscraper/requests 导入前执行）
# 修复部分 OpenSSL 版本（如 3.5.7）加载 Windows 证书库时
# ASN1: NOT_ENOUGH_DATA 错误 → 自动改用 certifi 证书包
# ─────────────────────────────────────────────
import ssl as _ssl_mod

_orig_create_default_context = _ssl_mod.create_default_context


def _safe_create_default_context(purpose=_ssl_mod.Purpose.SERVER_AUTH, *args, **kwargs):
    try:
        return _orig_create_default_context(purpose, *args, **kwargs)
    except _ssl_mod.SSLError:
        # Windows 证书库 ASN1 解析失败 → 用 certifi 证书代替
        ctx = _ssl_mod.SSLContext(_ssl_mod.PROTOCOL_TLS_CLIENT)
        if purpose == _ssl_mod.Purpose.SERVER_AUTH:
            ctx.check_hostname = True
            ctx.verify_mode = _ssl_mod.CERT_REQUIRED
        else:
            ctx.check_hostname = False
            ctx.verify_mode = _ssl_mod.CERT_NONE
        try:
            import certifi
            ctx.load_verify_locations(certifi.where())
        except ImportError:
            pass
        return ctx


_ssl_mod.create_default_context = _safe_create_default_context

try:
    import cloudscraper
    _HAS_CLOUDSCRAPER = True
except ImportError:
    _HAS_CLOUDSCRAPER = False


class _ResponseWrapper:
    """封装 urllib 响应为 requests 兼容接口（.status_code/.text/.content）"""
    def __init__(self, status_code, content_bytes):
        self.status_code = status_code
        self.content = content_bytes
        self.text = content_bytes.decode("utf-8", errors="replace")


def _make_permissive_ssl_context():
    """创建宽松 SSL 上下文：不验证证书 + 降安全等级 + 强制 TLS 1.2"""
    import ssl
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        ctx.set_ciphers("DEFAULT@SECLEVEL=1")
    except Exception:
        pass
    # 强制 TLS 1.2（TLS 1.3 与某些服务器配置不兼容，导致 ASN1 错误）
    try:
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        ctx.maximum_version = ssl.TLSVersion.TLSv1_2
    except Exception:
        pass
    return ctx


def _anibk_requests_tls12(url, flog, timeout=20):
    """策略2：requests + 强制 TLS 1.2 自定义适配器"""
    try:
        import ssl as _ssl
        import requests
        from requests.adapters import HTTPAdapter
        try:
            from urllib3.util.ssl_ import create_urllib3_context
        except ImportError:
            create_urllib3_context = _ssl.create_default_context

        class TLS12Adapter(HTTPAdapter):
            def init_poolmanager(self, *args, **kwargs):
                ctx = create_urllib3_context()
                ctx.check_hostname = False
                ctx.verify_mode = _ssl.CERT_NONE
                try:
                    ctx.set_ciphers("DEFAULT@SECLEVEL=1")
                except Exception:
                    pass
                try:
                    ctx.minimum_version = _ssl.TLSVersion.TLSv1_2
                    ctx.maximum_version = _ssl.TLSVersion.TLSv1_2
                except Exception:
                    pass
                kwargs["ssl_context"] = ctx
                return super().init_poolmanager(*args, **kwargs)

        session = requests.Session()
        session.mount("https://", TLS12Adapter())
        session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                          "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        })
        resp = session.get(url, timeout=timeout, verify=False)
        if resp.status_code == 200:
            flog.add(f"  \u2192 requests TLS1.2 \u515c\u5e95 \u2713", "dim")
            return resp
        flog.add(f"  requests TLS1.2 HTTP {resp.status_code}", "dim")
    except ImportError:
        flog.add(f"  requests \u672a\u5b89\u88c5\uff0c\u8df3\u8fc7\u6b64\u7b56\u7565", "dim")
    except Exception as e:
        flog.add(f"  requests TLS1.2 \u515c\u5e95\u5931\u8d25: {e}", "dim")
    return None


def _anibk_urllib_ssl(url, flog, timeout=20):
    """策略3：urllib + 宽松 SSL 上下文（最后兜底）"""
    try:
        import urllib.request
        ctx = _make_permissive_ssl_context()
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                          "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9",
        })
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            data = resp.read()
            flog.add(f"  \u2192 urllib \u5bbd\u677eSSL \u515c\u5e95 \u2713", "dim")
            return _ResponseWrapper(200, data)
    except Exception as e:
        flog.add(f"  urllib \u5bbd\u677eSSL \u515c\u5e95\u5931\u8d25: {e}", "dim")
    return None


def _anibk_request(url, flog, max_retries=3, timeout=20):
    """
    向 anibk.com 发起 GET 请求，多策略兜底。
    策略顺序：cloudscraper(重试3次) → requests+TLS1.2 → urllib+宽松SSL
    返回 response 对象（含 .status_code/.text/.content）或 None。
    """
    # ── 策略1：cloudscraper（带重试，可绕 Cloudflare）──
    if _HAS_CLOUDSCRAPER:
        import cloudscraper
        for attempt in range(max_retries):
            try:
                scraper = cloudscraper.create_scraper(
                    browser={
                        "browser": "chrome",
                        "platform": "windows",
                        "desktop": True,
                    }
                )
                resp = scraper.get(url, timeout=timeout)
                if resp.status_code == 200:
                    return resp
                flog.add(f"  HTTP {resp.status_code} (cloudscraper 尝试 {attempt + 1}/{max_retries})", "dim")
            except Exception as e:
                err_str = str(e)
                is_ssl = any(k in err_str for k in ("ASN1", "SSL", "ssl", "TLS", "tls", "CERTIFICATE"))
                if attempt < max_retries - 1:
                    wait = 4 * (attempt + 1) if is_ssl else 2 * (attempt + 1)
                    flog.add(f"  请求异常 (尝试 {attempt + 1}/{max_retries}): {e} → 等待 {wait}s 重试", "dim")
                    time.sleep(wait)
                else:
                    flog.add(f"  cloudscraper 失败（已重试 {max_retries} 次）: {e}", "dim")
                continue

            if attempt < max_retries - 1:
                time.sleep(2)

    # ── 策略2：requests + 强制 TLS 1.2 ──
    flog.add("  → 切换到 requests + TLS1.2 兜底", "dim")
    resp = _anibk_requests_tls12(url, flog, timeout)
    if resp:
        return resp

    # ── 策略3：urllib + 宽松 SSL 上下文 ──
    flog.add("  → 切换到 urllib + 宽松 SSL 兜底", "dim")
    resp = _anibk_urllib_ssl(url, flog, timeout)
    if resp:
        return resp

    return None


def anibk_get_cover(page_url, flog, strict_portrait=True):
    """
    从 anibk.com 详情页提取封面图。
    封面图是页面里第一个 bgmbk.tv 的 webp 图片。
    返回 (img_bytes, method) 或 (None, None)。
    """
    if not _HAS_CLOUDSCRAPER:
        flog.add("  ⚠ anibk: cloudscraper 未安装，跳过", "yellow")
        return None, None

    resp = _anibk_request(page_url, flog)
    if not resp:
        return None, None

    try:
        html = resp.text
        # 提取第一个 bgmbk.tv 图片 URL（封面图，后续的是剧集/角色图）
        imgs = re.findall(
            r'https?://imgcn\d?\.bgmbk\.tv/file/bk/\d+/[a-f0-9]{20,}\.webp',
            html
        )
        if not imgs:
            flog.add(f"  anibk 页面无封面图", "dim")
            return None, None

        img_url = imgs[0]
        # 下载封面图也走多策略兜底（与页面请求一致）
        img_resp = _anibk_request(img_url, flog, max_retries=2, timeout=15)
        img_data = img_resp.content if img_resp else None

        if not img_data or len(img_data) < 500:
            flog.add(f"  anibk 封面下载失败", "dim")
            return None, None

        # 检查竖版
        if strict_portrait and not is_portrait_image(img_data):
            flog.add(f"  anibk 封面为横版 → 跳过", "dim")
            return None, None

        # 转换 webp → JPEG（与缓存格式一致）
        from PIL import Image
        from io import BytesIO
        try:
            img = Image.open(BytesIO(img_data))
            if img.format == "WEBP":
                buf = BytesIO()
                img.convert("RGB").save(buf, "JPEG", quality=90)
                img_data = buf.getvalue()
        except Exception:
            pass

        return img_data, f"anibk:{page_url}"

    except Exception as e:
        flog.add(f"  anibk 异常: {e}", "dim")
        return None, None


def _extract_season_num(cand_title):
    """从候选标题提取季数：越小越优先（0=无季数标识/本体）"""
    # 中文"第X季"
    m = re.search(r"第\s*([\d一二三四五六七八九十]+)\s*季", cand_title)
    if m:
        map_cn = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}
        s = m.group(1)
        return map_cn.get(s) or int(s) if s.isdigit() else 99
    # 英文 Season X / S1 / S2
    m = re.search(r"[Ss]eason\s*(\d+)", cand_title)
    if m:
        return int(m.group(1))
    m = re.search(r"\bS(\d{1,2})\b", cand_title)
    if m:
        return int(m.group(1))
    # 日语 第X期
    m = re.search(r"第\s*(\d+)\s*期", cand_title)
    if m:
        return int(m.group(1))
    # 带"(202X)"年份的视为新季
    m = re.search(r"\((\d{4})\)", cand_title)
    if m:
        return int(m.group(1)) - 2000
    return 0  # 无标识 = 本体/第一季


def _sort_candidates_by_season(candidates):
    """按季数升序排列（S1优先），同季保持原序"""
    decorated = [(c, _extract_season_num(c["title"])) for c in candidates]
    decorated.sort(key=lambda x: (x[1], x[0].get("_orig_idx", 99)))
    return [c for c, _ in decorated]


def _anibk_do_search(keyword, flog):
    """
    用指定关键词搜索 anibk.com，解析结果返回候选列表。
    返回 candidates 列表（可能为空）。
    """
    from urllib.parse import quote
    search_url = f"https://www.anibk.com/list/---------?order=20&kw={quote(keyword)}"
    flog.add(f"anibk 搜索: {search_url}", "dim")

    resp = _anibk_request(search_url, flog)
    if not resp:
        return []

    html = resp.text
    matches = re.findall(r'<a[^>]*title="([^"]+)"[^>]*href="/bk/(\d+)"', html)

    candidates = []
    seen_ids = set()
    for cand_title, bk_id in matches:
        cand_title = cand_title.strip()
        if bk_id in seen_ids:
            continue
        seen_ids.add(bk_id)
        candidates.append({
            "id": bk_id,
            "title": cand_title,
            "url": f"https://www.anibk.com/bk/{bk_id}",
        })

    return candidates


def _anibk_pick_best(candidates, title, flog):
    """从候选列表中挑选最佳候选，返回 chosen dict 或 None"""
    if not candidates:
        return None

    # 按季数排序（S1 优先）
    candidates = _sort_candidates_by_season(candidates)
    flog.add(f"anibk \u2192 {len(candidates)} 个候选（S1优先）: {[c['title'] for c in candidates[:5]]}", "dim")

    if len(candidates) == 1:
        return candidates[0]

    # 模糊匹配：编辑距离 ≤ 2 视为匹配（处理「大田/太田」等一字之差）
    def edit_distance_le_2(a, b):
        if abs(len(a) - len(b)) > 2:
            return False
        if a == b:
            return True
        # 简单 Levenshtein
        m, n = len(a), len(b)
        dp = [[0] * (n + 1) for _ in range(m + 1)]
        for i in range(m + 1):
            dp[i][0] = i
        for j in range(n + 1):
            dp[0][j] = j
        for i in range(1, m + 1):
            for j in range(1, n + 1):
                cost = 0 if a[i - 1] == b[j - 1] else 1
                dp[i][j] = min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
        return dp[m][n] <= 2

    # 精确匹配 > 模糊匹配（编辑距离≤2）> S1 优先
    exact_matches = [c for c in candidates if c["title"] == title or c["title"] in title or title in c["title"]]
    if exact_matches:
        flog.add(f"  \u2192 名字精确匹配\u300c{exact_matches[0]['title']}\u300d，直接选用", "dim")
        return exact_matches[0]

    fuzzy_matches = [c for c in candidates if edit_distance_le_2(c["title"], title)]
    if fuzzy_matches:
        flog.add(f"  \u2192 模糊匹配\u300c{fuzzy_matches[0]['title']}\u300d（编辑距离≤2），选用", "dim")
        return fuzzy_matches[0]

    flog.add(f"  \u2192 多个候选，按 S1 优先选用\u300c{candidates[0]['title']}\u300d", "dim")
    return candidates[0]


def anibk_search_by_title(title, flog):
    """
    直接搜索 anibk.com 列表页找到番剧封面（与官网搜索完全一致）。
    若多个候选则按 S1 优先 + 名字精确/模糊匹配挑选。
    全标题搜索失败时自动尝试短关键词兜底。
    返回 (img_bytes, method) 或 (None, None)。
    """
    if not _HAS_CLOUDSCRAPER:
        return None, None

    try:
        # ── 第一轮：全标题搜索 ──
        candidates = _anibk_do_search(title, flog)

        # ── 兜底：全标题无结果时尝试短关键词 ──
        if not candidates and len(title) > 6:
            # 取标题前 4~6 个字作为短关键词（去掉助词"的"）
            short_kw = title[:6]
            for trim in ("的", "之", "与", "和"):
                short_kw = short_kw.rstrip(trim)
            if short_kw and short_kw != title:
                flog.add(f"  \u2192 全标题无结果，尝试短关键词\u300c{short_kw}\u300d", "dim")
                time.sleep(1)
                candidates = _anibk_do_search(short_kw, flog)

        if not candidates:
            flog.add(f"anibk \u300c{title}\u300d\u2192 0 结果", "dim")
            return None, None

        chosen = _anibk_pick_best(candidates, title, flog)
        if not chosen:
            return None, None

        # 获取封面
        detail_url = chosen["url"]
        flog.add(f"  \u2192 选\u300c{chosen['title']}\u300d({detail_url})", "dim")
        img_bytes, method = anibk_get_cover(detail_url, flog)
        if img_bytes:
            return img_bytes, f"anibk:{detail_url}"

    except Exception as e:
        flog.add(f"anibk 搜索异常: {e}", "dim")
    return None, None


from pathlib import Path


# ─────────────────────────────────────────────
# 工具函数：打印带颜色的进度
# ─────────────────────────────────────────────

def log(msg, color=None, end="\n"):
    codes = {"green": "\033[32m", "yellow": "\033[33m", "red": "\033[31m",
             "cyan": "\033[36m", "bold": "\033[1m", "dim": "\033[2m",
             "reset": "\033[0m"}
    if color and color in codes:
        print(f"{codes[color]}{msg}{codes['reset']}", end=end, flush=True)
    else:
        print(msg, end=end, flush=True)


def log_step(step, total, msg):
    log(f"[{step}/{total}] {msg}", "cyan")


def log_ok(msg):
    log(f"  \u2713 {msg}", "green")


def log_warn(msg):
    log(f"  \u26a0 {msg}", "yellow")


def log_err(msg):
    log(f"  \u2717 {msg}", "red")


# ─────────────────────────────────────────────
# Step 1：解析 md 文件
# ─────────────────────────────────────────────

TIER_ORDER = ["夯", "顶级", "人上人", "NPC", "拉完了"]
TIER_COLORS = {
    "夯":   {"bg": "#C0392B", "fg": "#FFFFFF"},
    "顶级":  {"bg": "#E67E22", "fg": "#FFFFFF"},
    "人上人": {"bg": "#F1C40F", "fg": "#000000"},
    "NPC":   {"bg": "#FAE5C8", "fg": "#000000"},
    "拉完了": {"bg": "#FFFFFF", "fg": "#000000"},
}


def parse_frontmatter(text):
    """解析 YAML frontmatter，返回 (tags列表, source字符串, 正文描述)"""
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n?(.*)", text, re.DOTALL)
    if not match:
        return [], None, ""
    fm = match.group(1)
    body = match.group(2).strip() if match.lastindex >= 2 else ""

    # 解析 tags
    tags = []
    in_tags = False
    for line in fm.split("\n"):
        stripped = line.strip()
        if re.match(r"^tags\s*:", stripped):
            in_tags = True
            continue
        if in_tags:
            if stripped.startswith("- "):
                tags.append(stripped[2:].strip())
            elif stripped and not stripped.startswith("#"):
                if ":" in stripped and not stripped.startswith("-"):
                    in_tags = False

    # 解析 source
    source = None
    src_match = re.search(r"^source:\s*(.+)$", fm, re.MULTILINE)
    if src_match:
        source = src_match.group(1).strip()

    return tags, source, body


def update_md_source(md_path, new_source_url):
    """
    更新番剧 .md 文件中的 source 字段。
    如果已有 source 行则替换，否则在 tags 块之后插入。
    返回 True 表示文件被修改。
    """
    try:
        text = Path(md_path).read_text(encoding="utf-8")
    except Exception:
        return False

    new_line = f"source: {new_source_url}"
    if re.search(r"^source:\s*.+$", text, re.MULTILINE):
        new_text = re.sub(
            r"^source:\s*.+$",
            new_line,
            text,
            flags=re.MULTILINE
        )
    else:
        lines = text.split("\n")
        insert_at = None
        for i, line in enumerate(lines):
            if re.match(r"^  - ", line):
                insert_at = i
        if insert_at is not None:
            lines.insert(insert_at + 1, new_line)
        else:
            for i, line in enumerate(lines):
                if line.strip() == "---" and i > 0:
                    lines.insert(i, new_line)
                    break
        new_text = "\n".join(lines)

    if new_text == text:
        return False

    try:
        Path(md_path).write_text(new_text, encoding="utf-8")
        return True
    except Exception:
        return False


# ─────────────────────────────────────────────
# 时间线解析：建立番剧→(year, quarter, position) 映射
# ─────────────────────────────────────────────

def load_timeline_order(timeline_dir):
    """
    解析时间线目录，返回 {番剧标题: sort_key} 字典。
    sort_key 越大表示越新（新番排前面）。

    文件名规则：
      - YYYY年M月.md  → sort_key = (year*100 + quarter_index, -position)
      - 国产.md        → sort_key = (20000000, ...)  当作 "早于最新" 的一批
      - 电影.md        → sort_key = (20000001, ...)
      - 老番.md        → sort_key = (-1, ...)  排最后

    wiki 链接格式：[[番剧文件名]] 或 [[番剧文件名|显示名]]
    解析 | 前的部分作为匹配键（与番剧大全 md 文件名对应）。
    """
    timeline_dir = Path(timeline_dir)
    if not timeline_dir.exists():
        return {}

    # 季度月份 → 季度顺序（1月=1, 4月=2, 7月=3, 10月=4）
    QUARTER_MAP = {1: 1, 4: 2, 7: 3, 10: 4}

    # 收集所有 (sort_key_base, position, title) 三元组
    title_to_key = {}  # title → (year_sort, position)

    for md_file in sorted(timeline_dir.glob("*.md")):
        fname = md_file.stem  # e.g. "2024年10月" or "老番" or "国产"

        # 解析文件名得到基础排序值（越大越新）
        m = re.match(r'^(\d{4})年(\d{1,2})月$', fname)
        if m:
            year = int(m.group(1))
            month = int(m.group(2))
            quarter = QUARTER_MAP.get(month, 0)
            base_sort = year * 10 + quarter  # e.g. 2024*10+4 = 20244
        elif fname == "老番":
            base_sort = -1  # 新番之后
        elif fname == "电影":
            base_sort = -2  # 老番之后
        elif fname == "国产":
            base_sort = -3  # 最后
        else:
            base_sort = 1  # 其他未知文件

        try:
            lines = md_file.read_text(encoding="utf-8").splitlines()
        except Exception:
            continue

        position = 0
        for line in lines:
            line = line.strip()
            if not line.startswith("- [["):
                continue
            # 提取 [[xxx]] 或 [[xxx|yyy]] 中的 xxx
            link_match = re.search(r'\[\[([^\]|]+)', line)
            if not link_match:
                continue
            raw_title = link_match.group(1).strip()
            # 同一番剧可能在多个季度出现（续集），取最新一个覆盖
            key = (base_sort, position)
            if raw_title not in title_to_key or title_to_key[raw_title][0] < base_sort:
                title_to_key[raw_title] = key
            position += 1

    return title_to_key


def load_anime_list(anime_dir, timeline_dir=None):
    """读取所有番剧 md，返回按 tier 分组的字典（每 tier 内按时间线倒序排列）"""
    anime_dir = Path(anime_dir)
    if not anime_dir.exists():
        log_err(f"目录不存在：{anime_dir}")
        sys.exit(1)

    # 加载时间线排序
    timeline_order = {}
    if timeline_dir:
        timeline_order = load_timeline_order(timeline_dir)
        if timeline_order:
            log_ok(f"时间线：已加载 {len(timeline_order)} 条番剧时间映射")
        else:
            log_warn("时间线目录为空或无法解析，将按文件名排序")

    md_files = sorted(anime_dir.glob("*.md"))
    log(f"  发现 {len(md_files)} 个 md 文件", "bold")

    # tier → list of dicts
    grouped = {t: [] for t in TIER_ORDER}
    no_tier = []

    for f in md_files:
        title = f.stem
        try:
            text = f.read_text(encoding="utf-8")
        except Exception as e:
            log_warn(f"读取失败：{f.name} — {e}")
            continue

        tags, source, body = parse_frontmatter(text)
        tier = None
        for tag in tags:
            if tag.startswith("评级-"):
                tier_name = tag[3:]
                if tier_name in grouped:
                    tier = tier_name
                    break

        if tier:
            # 查找时间线排序键：先用原名，再尝试去掉括号/后缀
            tl_key = timeline_order.get(title)
            if tl_key is None:
                # 尝试去掉常见后缀（如 " 第二季" 等）再匹配
                stripped = re.split(r'[（(【\s]', title)[0].strip()
                tl_key = timeline_order.get(stripped)
            grouped[tier].append({
                "title": title,
                "source": source,
                "tags": [t for t in tags if not t.startswith("评级-")
                         and not t.startswith("观看状态-")
                         and not t.startswith("记忆程度-")],
                "desc": body,
                "_tl_key": tl_key,   # (base_sort, position) 或 None
            })
        else:
            no_tier.append(title)

    # 按时间线排序：新番在前（base_sort 降序），同一季度按 position 升序，
    # 无时间线记录的放最后（按文件名字母序）
    if timeline_order:
        def sort_key(anime):
            k = anime.get("_tl_key")
            if k is None:
                # 无时间线记录 → 放最后，保持文件名原始排序
                return (0, 0, anime["title"])
            base_sort, position = k
            # base_sort 越大越新，所以取负值降序
            return (-base_sort, position, anime["title"])

        for t in TIER_ORDER:
            grouped[t].sort(key=sort_key)
        log_ok("时间线排序完成（新番在前）")

    # 统计
    for t in TIER_ORDER:
        log_ok(f"{t}：{len(grouped[t])} 部")
    if no_tier:
        log_warn(f"无评级（不纳入图）：{len(no_tier)} 部")

    return grouped


# ─────────────────────────────────────────────
# Step 2：获取封面图
# ─────────────────────────────────────────────

def http_get(url, timeout=15, retries=3):
    """HTTP GET 带重试和限流检测。遇到 429 自动等待后重试。retries=3 即最多4次尝试。"""
    last_error = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "AnimeTierGen/1.0 (anime tier list generator)"}
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            last_error = e
            if e.code == 429 and attempt < retries:
                wait = 3 * (2 ** attempt)
                time.sleep(wait)
                continue
            return None
        except Exception as e:
            last_error = e
            if attempt < retries:
                time.sleep(1.0 * (attempt + 1))
                continue
            return None
    return None


def extract_wiki_title_from_url(url):
    """从 Wikipedia URL 提取词条标题"""
    m = re.search(r"wikipedia\.org/wiki/(.+)$", url)
    if m:
        return urllib.parse.unquote(m.group(1))
    return None


def extract_moegirl_title_from_url(url):
    """从萌娘百科 URL 提取词条标题；兼容 mzh / zh 子域名"""
    m = re.search(r"moegirl\.org\.\w+/(.+?)(?:\?|$)", url)
    if m:
        return urllib.parse.unquote(m.group(1))
    return None


def wiki_rest_cover(wiki_title, lang="en"):
    """
    用 Wikimedia REST API /page/summary/ 获取词条封面图 + 描述 + 摘要。
    返回 (img_url, description, extract) 或 (None, None, None)。
    """
    encoded = urllib.parse.quote(wiki_title, safe="")
    url = f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{encoded}"
    data = http_get(url)
    if not data:
        return None, None, None
    try:
        j = json.loads(data.decode("utf-8"))
        orig = j.get("originalimage", {})
        img_url = None
        if orig.get("source"):
            img_url = orig["source"]
        else:
            thumb = j.get("thumbnail", {})
            img_url = thumb.get("source")
        desc = j.get("description", "") or ""
        extract = j.get("extract", "") or ""
        return img_url, desc, extract
    except Exception:
        return None, None, None


def wiki_action_cover(wiki_title, lang="zh"):
    """用 Wikipedia Action API 获取词条封面图 URL（备用）"""
    encoded = urllib.parse.quote(wiki_title, safe="")
    api_url = (
        f"https://{lang}.wikipedia.org/w/api.php"
        f"?action=query&titles={encoded}"
        f"&prop=pageimages&pithumbsize=500&format=json&redirects=1"
    )
    data = http_get(api_url)
    if not data:
        return None
    try:
        j = json.loads(data.decode("utf-8"))
        pages = j.get("query", {}).get("pages", {})
        for page in pages.values():
            thumb = page.get("thumbnail", {})
            if thumb.get("source"):
                return thumb["source"]
    except Exception:
        pass
    return None


def is_portrait_image(img_bytes):
    """返回 True 如果图片是竖版（height > width）。无法判断时默认通过。"""
    try:
        from PIL import Image
        import io
        img = Image.open(io.BytesIO(img_bytes))
        w, h = img.size
        return h > w
    except Exception:
        return True


def is_likely_anime_title(wiki_title):
    """
    粗略判断 Wikipedia 词条名是否可能是动画词条。
    标题含 (manga)/(novel)/(live-action) 但不含 (anime)/(TV series) → 返回 False。
    """
    title_lower = wiki_title.lower()
    anime_signals = ["(anime)", "(tv series)", "(アニメ)", "(動畫)", "(動画)"]
    has_anime_signal = any(s in title_lower for s in anime_signals)
    non_anime = ["(manga)", "(漫画)", "(漫畫)", "(novel)", "(小説)", "(小說)",
                 "(light novel)", "(live-action)", "(実写)", "(film)", "(movie)",
                 "(真人)", "(実写映画)"]
    has_non_anime = any(s in title_lower for s in non_anime)
    if has_non_anime and not has_anime_signal:
        return False
    return True


def is_manga_description(desc, extract=""):
    """
    检查 Wikipedia 页面描述/摘要是否指向漫画/小说/真人而非动画。
    同时检查 description 和 extract（首段摘要）。
    返回 True 表示这是非动画页面（不应使用其封面）。
    """
    text = (desc or "") + " " + (extract or "")
    text_lower = text.lower()
    # 动画关键词
    anime_kw = ["anime", "动画", "動畫", "アニメ", "tv series", "television series",
                "電視動畫", "电视动画", "日本電視動畫", "日本电视动画"]
    is_anime = any(k in text_lower for k in anime_kw)
    if is_anime:
        return False  # 有动画标记，OK
    # 漫画关键词
    manga_kw = ["manga", "漫画", "漫畫", "japanese manga", "comic series"]
    if any(k in text_lower for k in manga_kw):
        return True
    # 小说
    novel_kw = ["novel", "小説", "小说", "light novel", "ライトノベル"]
    if any(k in text_lower for k in novel_kw):
        return True
    # 真人/电影（关键：extract 中常有 "電影"、"改编電影" 等）
    live_kw = ["live-action", "film", "电影", "電影", "実写", "真人",
               "改編電影", "改编电影", "映画"]
    if any(k in text_lower for k in live_kw):
        return True
    return False


def is_entertainment_media_page(desc, extract):
    """检查 Wikipedia 页面是否与 ACG/影视娱乐相关（而非历史/政治/地理等无关词条）。"""
    text = f"{(desc or '')} {(extract or '')}".lower()
    # 硬编码黑名单：确认非娱乐的词条
    hard_deny = {
        "清朝宗室爵位", "清朝爵位", "清朝", "官制", "官职",
    }
    if any(k in text for k in hard_deny):
        return False
    # 娱乐关键词
    media_kw = [
        "动画", "動畫", "アニメ", "anime",
        "漫画", "漫畫", "manga", "comic",
        "轻小说", "輕小說", "轻小説", "ライトノベル", "light novel",
        "电视", "電視", "television", "tv series",
        "电影", "電影", "film", "movie",
        "小说", "小説", "novel",
        "游戏", "遊戲", "game",
        "角色", "character",
        "播出", "放送", "broadcast",
        "声优", "聲優", "声優", "voice actor",
        "原作", "original",
        "日本动画",
        "番組", "番组",
    ]
    return any(k in text for k in media_kw)


def try_get_portrait_cover(wiki_title, lang, check_desc=True):
    """
    对一个词条名：获取封面图 → 下载 → 检查是否为竖版。
    同时检查描述+摘要，如果是漫画/小说/真人页面则跳过。
    zh wiki 经常限流，失败时自动等5秒重试一次。
    返回 (img_bytes, method_desc, detail_msg) 或 (None, None, reason)。
    """
    # 跳过明显非动画的词条
    if not is_likely_anime_title(wiki_title):
        return None, None, f"词条名含非动画消歧义 → 跳过"

    img_url, desc, extract = wiki_rest_cover(wiki_title, lang)

    # zh wiki 易被限流，失败时等5秒再试一次
    if not img_url and lang == "zh":
        time.sleep(5.0)
        img_url, desc, extract = wiki_rest_cover(wiki_title, lang)

    # 检查描述+摘要判断是否为漫画/真人页面
    if check_desc and img_url and is_manga_description(desc, extract):
        snippet = (extract or desc or "")[:80]
        return None, None, f"页面描述指向漫画/小说/真人（\"{snippet}...\"）→ 跳过"

    # 过滤非娱乐词条（如历史爵位「多罗贝勒」被搜到）
    if check_desc and img_url and not is_entertainment_media_page(desc, extract):
        snippet = (extract or desc or "")[:80]
        return None, None, f"页面与 ACG/影视无关（\"{snippet}...\"）→ 跳过"

    if not img_url:
        img_url = wiki_action_cover(wiki_title, lang)
    if not img_url:
        # zh wiki 再试一次 action API
        if lang == "zh":
            time.sleep(5.0)
            img_url = wiki_action_cover(wiki_title, lang)
    if not img_url:
        return None, None, "REST & Action API 均无封面"

    img_bytes = http_get(img_url)
    if not img_bytes:
        return None, None, "封面图片下载失败"
    if not is_portrait_image(img_bytes):
        return None, None, "图片为横版 → 跳过"

    return img_bytes, f"{lang}:{wiki_title}", ""


# ── 日志辅助：fetch_cover 的详细输出 ──

class FetchLog:
    """收集 fetch_cover 过程中的日志行"""
    def __init__(self):
        self.lines = []

    def add(self, msg, color=None):
        self.lines.append((msg, color))

    def print(self):
        for msg, color in self.lines:
            if color:
                log(f"  {msg}", color)
            else:
                log(f"  {msg}")

    def flush(self):
        self.print()
        self.lines.clear()


def wiki_search_candidates(query, lang="zh", limit=5, retries=2):
    """用 Wikipedia opensearch 搜索，返回候选词条名列表（带重试）"""
    encoded = urllib.parse.quote(query, safe="")
    search_url = (
        f"https://{lang}.wikipedia.org/w/api.php"
        f"?action=opensearch&search={encoded}&limit={limit}&format=json"
    )
    for attempt in range(retries + 1):
        if attempt > 0:
            time.sleep(1.5 * attempt)
        data = http_get(search_url)
        if not data:
            continue
        try:
            j = json.loads(data.decode("utf-8"))
            result = j[1] if len(j) > 1 else []
            if result:
                return result
        except Exception:
            pass
    return []


def wikidata_id_from_title(wiki_title, lang="zh"):
    """通过 Wikipedia API 获取词条的 Wikidata 实体 ID。"""
    encoded = urllib.parse.quote(wiki_title, safe="")
    api_url = (
        f"https://{lang}.wikipedia.org/w/api.php"
        f"?action=query&titles={encoded}&prop=pageprops&format=json&redirects=1"
    )
    data = http_get(api_url)
    if not data:
        return None
    try:
        j = json.loads(data.decode("utf-8"))
        pages = j.get("query", {}).get("pages", {})
        for page in pages.values():
            return page.get("pageprops", {}).get("wikibase_item")
    except Exception:
        pass
    return None


def en_title_from_wikidata(wikidata_id):
    """通过 Wikidata API 获取英文 Wikipedia 词条名。"""
    encoded = urllib.parse.quote(wikidata_id, safe="")
    url = f"https://www.wikidata.org/wiki/Special:EntityData/{encoded}.json"
    data = http_get(url)
    if not data:
        return None
    try:
        j = json.loads(data.decode("utf-8"))
        entity = j.get("entities", {}).get(wikidata_id, {})
        sitelinks = entity.get("sitelinks", {})
        en_link = sitelinks.get("enwiki", {})
        return en_link.get("title")
    except Exception:
        return None


def search_cover_multilang(anime_title, tags, desc, flog):
    """
    多语言搜索封面，对每個候选词条都检查是否为竖版海报。
    优先尝试带 (动画)/(アニメ)/(TV series) 后缀的词条。
    返回 (img_bytes, method_desc) 或 (None, None)。
    """
    # 如果标题本身已经含消歧义，直接用
    if "(" in anime_title:
        for lang in ["zh", "ja", "en"]:
            time.sleep(0.2)
            img_bytes, method, reason = try_get_portrait_cover(anime_title, lang)
            if img_bytes:
                flog.add(f"\u2192 {lang} wiki \u300c{anime_title}\u300d \u2713 竖版封面")
                return img_bytes, method
            elif reason:
                flog.add(f"\u2192 {lang} wiki \u300c{anime_title}\u300d: {reason}", "dim")

    # ── 一次性搜索三个语言（搜一次，加延迟防429）──
    lang_configs = [
        ("zh", [" (动画)", " (動畫)", " (電視動畫)"]),
        ("ja", [" (アニメ)", " (テレビアニメ)"]),
        ("en", [" (TV series)", " (anime)"]),
    ]

    all_candidates = []  # [(wiki_title, lang)]
    for lang, suffixes in lang_configs:
        candidates = wiki_search_candidates(anime_title, lang, limit=8)
        if candidates:
            flog.add(f"{lang} wiki 搜索 \u300c{anime_title}\u300d \u2192 {len(candidates)} 个候选", "dim")
        else:
            flog.add(f"{lang} wiki 搜索 \u300c{anime_title}\u300d \u2192 0 个候选", "dim")
        for c in candidates:
            all_candidates.append((c, lang))
        # 语言间加延迟，避免同语言连续请求触发429
        time.sleep(0.8)

    if not all_candidates:
        return None, None

    # 多等1秒再开始逐候选检查（避免与搜索请求撞429）
    time.sleep(1.0)

    # 优先检查带动画后缀的候选（如 "(動畫)" / "(アニメ)" / "(TV series)"）
    anime_suffixed = []
    others = []
    for c, lang in all_candidates:
        if any(sfx in c for sfx in ["(動畫)", "(动画)", "(アニメ)", "(TV series)", "(anime)"]):
            anime_suffixed.append((c, lang))
        else:
            others.append((c, lang))

    # 按语言优先级排序动画后缀候选：zh → ja → en
    def lang_priority(item):
        lang = item[1]
        return {"zh": 0, "ja": 1, "en": 2}.get(lang, 3)

    anime_suffixed.sort(key=lang_priority)
    others.sort(key=lang_priority)

    all_sorted = anime_suffixed + others

    seen = set()
    last_lang = None
    for candidate, lang in all_sorted[:12]:  # 最多检查12个候选
        key = (candidate, lang)
        if key in seen:
            continue
        seen.add(key)
        # 同语言请求加延迟防429（zh尤其需要）
        if lang == last_lang:
            time.sleep(0.6 if lang != "zh" else 1.2)
        else:
            time.sleep(0.4)
        last_lang = lang
        img_bytes, method, reason = try_get_portrait_cover(candidate, lang)
        if img_bytes:
            suffix_tag = " [动画]" if (candidate, lang) in anime_suffixed else ""
            flog.add(f"\u2192 候选\u300c{candidate}\u300d({lang}){suffix_tag} \u2713 竖版封面")
            return img_bytes, method
        elif reason:
            flog.add(f"\u2192 候选\u300c{candidate}\u300d({lang}): {reason}", "dim")

    # 跨语言 Wikidata 尝试（优先动画后缀候选）
    for candidate, lang in anime_suffixed[:3] + [c for c in others[:3] if c not in anime_suffixed]:
        wd_id = wikidata_id_from_title(candidate, lang)
        if wd_id:
            en_title = en_title_from_wikidata(wd_id)
            if en_title and (en_title, "en") not in seen:
                time.sleep(0.2)
                img_bytes, method, reason = try_get_portrait_cover(en_title, "en")
                if img_bytes:
                    flog.add(f"\u2192 Wikidata跨语言 \u300c{en_title}\u300d(en) \u2713 竖版封面")
                    return img_bytes, f"wikidata_{lang}->en({en_title})"
                elif reason:
                    flog.add(f"\u2192 Wikidata跨语言 \u300c{en_title}\u300d(en): {reason}", "dim")

    # 最后尝试追加动画后缀直接查
    searched_suffixes = set()
    for lang, suffixes in lang_configs:
        for suffix in suffixes:
            if suffix in searched_suffixes:
                continue
            searched_suffixes.add(suffix)
            anime_query = f"{anime_title}{suffix}"
            if (anime_query, lang) in seen:
                continue
            time.sleep(0.2)
            img_bytes, method, reason = try_get_portrait_cover(anime_query, lang)
            if img_bytes:
                flog.add(f"\u2192 追加后缀\u300c{anime_query}\u300d({lang}) \u2713 竖版封面")
                return img_bytes, method
            elif reason:
                flog.add(f"\u2192 追加后缀\u300c{anime_query}\u300d({lang}): {reason}", "dim")

    return None, None


def deepseek_guess_wiki_title(anime_title, tags, desc, api_key, flog):
    """
    用 DeepSeek 推断正确的英文 Wikipedia 词条名。
    使用标签和描述作为额外上下文。
    返回 (en_title, ja_title) 或 (None, None)。
    """
    if not api_key:
        return None, None
    try:
        # 构建上下文
        context_parts = []
        if tags:
            context_parts.append(f"Tags: {', '.join(tags)}")
        if desc:
            # 截断过长的描述
            short_desc = desc[:200]
            context_parts.append(f"User notes: {short_desc}")
        context = "\n".join(context_parts)

        system_prompt = (
            "You are an anime encyclopedia expert.\n"
            "Given a Chinese anime (Japanese animation TV/streaming series) title,\n"
            "reply with the EXACT Wikipedia article title for the ANIME (TV/streaming series),\n"
            "NOT the manga, NOT the light novel, NOT the live-action adaptation.\n"
            "\n"
        )
        if context:
            system_prompt += f"Additional context about this anime:\n{context}\n\n"

        system_prompt += (
            "Reply with ONLY two lines:\n"
            "Line 1: English Wikipedia title, MUST include '(TV series)' or '(anime)' disambiguation if applicable. Or NONE\n"
            "Line 2: Japanese Wikipedia title, MUST include '(アニメ)' if applicable. Or NONE\n"
            "If there is no dedicated anime article (only manga/live-action exists), reply NONE for both lines.\n"
            "Examples:\n"
            "  夏目友人帐 -> Line1: 'Natsume's Book of Friends'  Line2: '夏目友人帳 (アニメ)'\n"
            "  冰菓 -> Line1: 'Hyouka (TV series)'  Line2: '氷菓 (アニメ)'\n"
            "No explanation, no extra text."
        )
        payload = json.dumps({
            "model": "deepseek-chat",
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": anime_title}
            ],
            "max_tokens": 120,
            "temperature": 0.0,
        }).encode("utf-8")

        req = urllib.request.Request(
            "https://api.deepseek.com/chat/completions",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            }
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            answer = result["choices"][0]["message"]["content"].strip()
            lines = answer.split("\n")
            en_title = lines[0].strip() if len(lines) > 0 else None
            ja_title = lines[1].strip() if len(lines) > 1 else None
            # 清理 DeepSeek 可能返回的 "Line1: " "Line2: " 前缀
            for prefix in ["Line1:", "Line2:", "line1:", "line2:"]:
                if en_title and en_title.lower().startswith(prefix.lower()):
                    en_title = en_title[len(prefix):].strip()
                if ja_title and ja_title.lower().startswith(prefix.lower()):
                    ja_title = ja_title[len(prefix):].strip()
            if en_title and en_title.upper() == "NONE":
                en_title = None
            if ja_title and ja_title.upper() == "NONE":
                ja_title = None

            if en_title or ja_title:
                flog.add(f"DeepSeek 推断: en=\"{en_title}\", ja=\"{ja_title}\"", "dim")
            else:
                flog.add(f"DeepSeek: 无法确定动画词条 → NONE", "dim")
            return en_title, ja_title
    except Exception as e:
        flog.add(f"DeepSeek API 错误: {e}", "red")
        return None, None


# ── 萌娘百科 ──

MOEGIRL_API = "https://zh.moegirl.org.cn/api.php"


def moegirl_pageimage_cover(page_title, strict_portrait=True):
    """
    用萌娘百科 pageimages API 获取词条封面图。
    返回 (img_bytes, desc_method) 或 (None, None)。
    strict_portrait=True  → 严格竖版检查（h > w），用于 source 策略；
    strict_portrait=False → 宽松检查（h/w >= 0.6），用于搜索兜底。
    """
    encoded = urllib.parse.quote(page_title, safe="")
    api_url = (
        f"{MOEGIRL_API}?action=query&titles={encoded}"
        f"&prop=pageimages&pithumbsize=800&format=json&redirects=1"
    )
    data = http_get(api_url)
    if not data:
        return None, None
    try:
        j = json.loads(data.decode("utf-8"))
        pages = j.get("query", {}).get("pages", {})
        for page in pages.values():
            if "missing" in page:
                return None, None
            thumb = page.get("thumbnail", {})
            src = thumb.get("source")
            if not src:
                return None, None
            w, h = thumb.get("width", 0), thumb.get("height", 0)
            if w <= 0:
                return None, None
            if strict_portrait:
                if h <= w:
                    return None, None
            else:
                if h / w < 0.6:
                    return None, None
            img_bytes = http_get(src)
            if img_bytes and len(img_bytes) > 500:
                return img_bytes, f"moegirl:{page_title}"
    except Exception:
        pass
    return None, None


def moegirl_search_cover(anime_title, flog):
    """
    在萌娘百科搜索番剧并尝试获取封面。
    返回 (img_bytes, method_desc) 或 (None, None)。
    """
    # 搜索
    encoded = urllib.parse.quote(anime_title, safe="")
    search_url = (
        f"{MOEGIRL_API}?action=opensearch"
        f"&search={encoded}&limit=5&format=json"
    )
    data = http_get(search_url)
    if not data:
        return None, None
    try:
        j = json.loads(data.decode("utf-8"))
        candidates = j[1] if len(j) > 1 else []
    except Exception:
        return None, None

    if not candidates:
        flog.add(f"萌百搜索「{anime_title}」→ 0 个候选", "dim")
        return None, None

    flog.add(f"萌百搜索「{anime_title}」→ {len(candidates)} 个候选: {candidates[:5]}", "dim")

    for candidate in candidates[:5]:
        time.sleep(0.3)
        img_bytes, method = moegirl_pageimage_cover(candidate, strict_portrait=False)
        if img_bytes:
            flog.add(f"  → 萌百「{candidate}」✓ 封面图片", "green")
            return img_bytes, method
        else:
            flog.add(f"  → 萌百「{candidate}」: 无合适封面", "dim")

    return None, None


# ─────────────────────────────────────────────
# 百度百科封面获取
# ─────────────────────────────────────────────

def extract_baike_title_from_url(url):
    """从百度百科 URL 提取词条名。"""
    # https://baike.baidu.com/item/Let's%20Play/...
    # https://baike.baidu.com/item/%E9%98%B4%E9%98%B3%E5%9B%9E%E5%A4%A9%20Re:Birth/65464980
    m = re.search(r"baike\.baidu\.com/item/(.+)$", url)
    if m:
        path = m.group(1)
        # remove trailing lemma_id if present: /xxxxx
        path = re.sub(r"/\d+$", "", path)
        return urllib.parse.unquote(path)
    return None


def baike_get_cover(page_url, flog):
    """
    从百度百科页面提取 og:image 封面图。
    需要 cloudscraper 绕过反爬（百度百科封禁普通 HTTP 请求）。
    返回 (img_bytes, method_desc) 或 (None, None)。
    """
    if not _HAS_CLOUDSCRAPER:
        flog.add("  ⚠ cloudscraper 未安装，跳过百度百科", "yellow")
        return None, None

    try:
        scraper = cloudscraper.create_scraper()
        resp = scraper.get(page_url, timeout=20)
        if resp.status_code != 200:
            flog.add(f"  百度百科请求失败 HTTP {resp.status_code}", "dim")
            return None, None

        # 提取 og:image
        m = re.search(r'<meta property="og:image" content="([^"]+)"', resp.text)
        if not m:
            flog.add(f"  百度百科页面无 og:image", "dim")
            return None, None

        img_url = m.group(1)
        # 去掉 URL 中的缩放参数，取原图（去掉 ?x-bce-process=...）
        img_url_orig = re.sub(r'\?x-bce-process=.+$', '', img_url)

        # 下载图片（百度百科 og:image 可能被裁剪为横版用于社交分享，
        # 但作为最后兜底，不强制竖版检查）
        img_data = scraper.get(img_url_orig, timeout=15).content
        if not img_data or len(img_data) < 500:
            img_data = scraper.get(img_url, timeout=15).content
            if not img_data or len(img_data) < 500:
                flog.add(f"  百度百科封面下载失败", "dim")
                return None, None

        return img_data, f"baike:{page_url}"
    except Exception as e:
        flog.add(f"  百度百科异常: {e}", "dim")
        return None, None


def fetch_cover(anime, cache_dir, force=False, anime_dir=None):
    """
    获取单个番剧封面图字节流（anibk.com 唯一来源）。
    返回 (img_bytes, method, error_reason)。

    策略：
      1. source 已是 anibk + 缓存命中 → 秒过
      2. source 不是 anibk 或缓存未命中 → anibk.com 搜索/直取
         → 找到后强制覆盖 source 为 anibk 链接
    """
    title = anime["title"]
    source = anime.get("source")
    is_anibk_source = source and "anibk.com/bk/" in source

    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)

    # 用番名作为缓存文件名（清理非法字符）
    safe_title = re.sub(r'[<>:"/\\|?*]', '_', title).strip()
    cache_img = cache_dir / f"{safe_title}.jpg"
    cache_meta = cache_dir / f"{safe_title}.meta"

    flog = FetchLog()

    # ── 策略1：缓存检查（仅 source 已是 anibk 时使用缓存）──
    if not force and is_anibk_source:
        if cache_img.exists() and cache_img.stat().st_size > 500:
            flog.add("\u2713 缓存命中（即时）", "green")
            return cache_img.read_bytes(), "cache", None

    if force:
        if cache_img.exists():
            cache_img.unlink()
        if cache_meta.exists():
            cache_meta.unlink()

    img_bytes = None
    method = None
    error_reason = None

    # ── 策略2：anibk.com（唯一来源）──
    # source 已是 anibk → 直接取详情页
    if is_anibk_source:
        flog.add(f"anibk source URL \u2192 详情页", "dim")
        img_bytes, method = anibk_get_cover(source, flog)
        if img_bytes:
            flog.add(f"  \u2192 anibk.com \u2713 封面", "green")

    # source 不是 anibk 或直接取失败 → 搜索
    if not img_bytes:
        if is_anibk_source:
            flog.add(f"  \u2192 source URL 失败，尝试搜索", "dim")
        flog.add(f"anibk.com 官网搜索", "dim")
        img_bytes, method = anibk_search_by_title(title, flog)
        if img_bytes:
            flog.add(f"  \u2192 anibk.com \u2713 封面", "green")

    # ── 写缓存 & 强制覆盖 source ──
    if img_bytes and len(img_bytes) > 500:
        cache_img.write_bytes(img_bytes)
        if cache_meta.exists():
            cache_meta.unlink()

        # 强制覆盖 source 为 anibk 链接（不论原来是什么）
        if method and method.startswith("anibk:") and anime_dir:
            found_url = method[6:]  # 去掉 "anibk:" 前缀
            if not is_anibk_source or source != found_url:
                md_path = Path(anime_dir) / f"{title}.md"
                if update_md_source(md_path, found_url):
                    flog.add(f"  \u2192 已更新 source: {found_url}", "dim")

        flog.add(f"\u2713 成功！方法: {method}", "green")
    else:
        error_reason = f"anibk 未找到\u300c{title}\u300d的封面"
        cache_meta.write_text(json.dumps({
            "status": "not_found",
            "error": error_reason,
        }), "utf-8")
        flog.add(f"\u2717 失败：{error_reason}", "red")

    flog.print()
    return img_bytes, method, error_reason


def fetch_all_covers(grouped, cache_dir, force=False, anime_dir=None):
    """批量获取所有番剧封面，返回 {title: img_bytes_or_None}"""
    log(f"\n  开始获取封面图，缓存目录：{cache_dir}", "bold")
    log(f"  {'─' * 60}", "dim")
    all_anime = []
    for tier in TIER_ORDER:
        all_anime.extend(grouped[tier])

    total = len(all_anime)
    covers = {}
    found = 0
    not_found = 0
    cached = 0
    failed = []  # (title, error_reason)

    for i, anime in enumerate(all_anime, 1):
        title = anime["title"]
        tier_name = None
        for t in TIER_ORDER:
            if anime in grouped[t]:
                tier_name = t
                break

        tags = anime.get("tags", [])
        desc = anime.get("desc", "")
        source = anime.get("source")

        # ── 番剧头部信息 ──
        tag_str = ", ".join(tags[:8]) if tags else "-"
        if len(tags) > 8:
            tag_str += " ..."
        desc_preview = (desc[:60] + "...") if len(desc) > 60 else desc

        header = f"[{i}/{total}] {title}"
        log(f"\n  {'─' * 60}", "dim")
        log(f"  {header}", "bold")
        log(f"    评级: {tier_name}  |  标签: {tag_str}", "dim")
        if desc:
            log(f"    描述: {desc_preview}", "dim")
        if source:
            short_src = source[:80] + ("..." if len(source) > 80 else "")
            log(f"    source: {short_src}", "dim")
        else:
            log(f"    source: 无", "dim")

        # 获取封面（内部打印详细步骤）
        img_bytes, method, error_reason = fetch_cover(anime, cache_dir, force, anime_dir)
        covers[title] = img_bytes

        if img_bytes:
            found += 1
            if method == "cache":
                cached += 1
        else:
            not_found += 1
            failed.append((title, error_reason or "未知原因", tier_name))

        # 已缓存的秒过，实际请求的等 0.6s 防限流
        if method not in ("cache", "cache_miss"):
            time.sleep(0.6)

    # ── 汇总 ──
    log(f"\n  {'=' * 60}", "bold")
    log_ok(f"封面获取完成：{found} 成功（{cached} 缓存） / {not_found} 未找到 / {total} 总计")
    log(f"  {'=' * 60}", "bold")

    # 失败详情
    if failed:
        log(f"\n  未获取到封面的番剧（{len(failed)} 部）：", "yellow")
        for title, reason, tier_name in failed:
            log_warn(f"    [{tier_name}] {title}")
            log(f"      原因：{reason}", "yellow")
        log(f"\n  \U0001f4a1 提示：失败可能为 anibk 无此条目或网络限流", "bold")

    return covers


# ─────────────────────────────────────────────
# Step 3：绘制 Tier 大图
# ─────────────────────────────────────────────

def load_image_from_bytes(img_bytes):
    """从字节流加载 PIL Image"""
    from PIL import Image
    import io
    try:
        img = Image.open(io.BytesIO(img_bytes)).convert("RGBA")
        return img
    except Exception:
        return None


def make_placeholder(w, h, bg_hex, title):
    """生成占位色块（对应 tier 颜色底 + 番名）"""
    from PIL import Image, ImageDraw
    r, g, b = hex_to_rgb(bg_hex)
    fill = (min(r + 80, 255), min(g + 80, 255), min(b + 80, 255))
    img = Image.new("RGBA", (w, h), color=(*fill, 255))
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, w-1, h-1], outline=(max(r-20,0), max(g-20,0), max(b-20,0), 200), width=1)
    font = get_font(10)
    chars_per_line = max(1, w // 11)
    lines = []
    current = ""
    for ch in title:
        current += ch
        if len(current) >= chars_per_line:
            lines.append(current)
            current = ""
    if current:
        lines.append(current)
    lines = lines[:4]
    total_h = len(lines) * 15
    y = (h - total_h) // 2
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=font)
        tw = bbox[2] - bbox[0]
        x = (w - tw) // 2
        draw.text((x, y), line, font=font, fill=(50, 50, 50, 230))
        y += 15
    return img


def fit_cover(img_bytes, w, h, title, tier_bg):
    """将封面图缩放裁剪到 w×h，失败则返回占位块"""
    from PIL import Image
    result = None
    if img_bytes:
        result = load_image_from_bytes(img_bytes)
    if result is None:
        return make_placeholder(w, h, tier_bg, title)
    src_w, src_h = result.size
    scale = max(w / src_w, h / src_h)
    nw, nh = int(src_w * scale), int(src_h * scale)
    result = result.resize((nw, nh), Image.LANCZOS)
    left = (nw - w) // 2
    top = (nh - h) // 2
    result = result.crop((left, top, left + w, top + h))
    return result


def get_font(size, bold=False):
    """获取字体，优先系统中文字体"""
    from PIL import ImageFont
    candidates = []
    if sys.platform == "win32":
        candidates = [
            "C:/Windows/Fonts/msyh.ttc",
            "C:/Windows/Fonts/simhei.ttf",
            "C:/Windows/Fonts/simsun.ttc",
        ]
    elif sys.platform == "darwin":
        candidates = [
            "/System/Library/Fonts/PingFang.ttc",
            "/Library/Fonts/Arial Unicode MS.ttf",
        ]
    else:
        candidates = [
            "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        ]
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                pass
    try:
        return ImageFont.load_default(size=size)
    except Exception:
        return ImageFont.load_default()


def hex_to_rgb(hex_color):
    h = hex_color.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))


def draw_tier_chart(grouped, covers, output_path, thumb_w, thumb_h, img_width, cols_override):
    """绘制完整 Tier 大图"""
    from PIL import Image, ImageDraw

    LABEL_W = 160
    PADDING = 8
    ROW_PADDING_V = 12
    BORDER_W = 3
    FONT_TIER = 60
    FONT_TITLE = 25

    content_w = img_width - LABEL_W
    if cols_override > 0:
        cols = cols_override
    else:
        cols = max(1, (content_w + PADDING) // (thumb_w + PADDING))

    log(f"  布局参数：label={LABEL_W}px, 封面={thumb_w}×{thumb_h}px, 每行{cols}列")

    total_h = 0
    row_heights = []
    for tier in TIER_ORDER:
        anime_list = grouped[tier]
        if not anime_list:
            continue
        rows = max(1, -(-len(anime_list) // cols))
        row_h = rows * (thumb_h + FONT_TITLE + 4 + PADDING) + ROW_PADDING_V * 2
        row_heights.append((tier, row_h))
        total_h += row_h + BORDER_W

    log(f"  最终图片尺寸：{img_width} × {total_h} px")

    canvas = Image.new("RGB", (img_width, total_h), color=(30, 30, 30))
    draw = ImageDraw.Draw(canvas)

    font_tier = get_font(FONT_TIER, bold=True)
    font_title = get_font(FONT_TITLE)

    y_offset = 0
    for tier, row_h in row_heights:
        anime_list = grouped[tier]
        colors = TIER_COLORS[tier]
        bg = hex_to_rgb(colors["bg"])
        fg = hex_to_rgb(colors["fg"])

        draw.rectangle([0, y_offset, img_width - 1, y_offset + row_h - 1],
                       fill=(20, 20, 20))
        draw.rectangle([0, y_offset, LABEL_W - 1, y_offset + row_h - 1],
                       fill=bg)

        bbox = draw.textbbox((0, 0), tier, font=font_tier)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        tx = (LABEL_W - tw) // 2
        ty = y_offset + (row_h - th) // 2
        draw.text((tx, ty), tier, font=font_tier, fill=fg)

        x0 = LABEL_W + PADDING
        y0 = y_offset + ROW_PADDING_V

        for idx, anime in enumerate(anime_list):
            col = idx % cols
            row = idx // cols
            x = x0 + col * (thumb_w + PADDING)
            y = y0 + row * (thumb_h + FONT_TITLE + 4 + PADDING)

            img_bytes = covers.get(anime["title"])
            thumb = fit_cover(img_bytes, thumb_w, thumb_h, anime["title"], colors["bg"])
            canvas.paste(thumb.convert("RGB"), (x, y))

            short_title = anime["title"]
            if len(short_title) > 10:
                short_title = short_title[:9] + "\u2026"
            tbbox = draw.textbbox((0, 0), short_title, font=font_title)
            tw2 = tbbox[2] - tbbox[0]
            tx2 = x + (thumb_w - tw2) // 2
            draw.text((tx2, y + thumb_h + 2), short_title,
                      font=font_title, fill=(200, 200, 200))

        y_offset += row_h
        draw.rectangle([0, y_offset, img_width - 1, y_offset + BORDER_W - 1],
                       fill=(50, 50, 50))
        y_offset += BORDER_W

    log(f"  保存图片到：{output_path}")
    canvas.save(str(output_path), quality=85)
    log_ok(f"图片已保存：{output_path}（{img_width}×{total_h} px）")


# ─────────────────────────────────────────────
# 主程序
# ─────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="番剧 Tier 图生成器",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument("--anime-dir", default="番剧大全", help="番剧 md 目录")
    parser.add_argument("--output", default="tier_chart.jpg", help="输出图片路径")
    parser.add_argument("--thumb-w", type=int, default=460, help="封面宽度 px")
    parser.add_argument("--thumb-h", type=int, default=600, help="封面高度 px")
    parser.add_argument("--cols", type=int, default=0, help="每行列数（0=自动）")
    parser.add_argument("--img-width", type=int, default=10000, help="图片总宽 px")
    parser.add_argument("--cache-dir", default=".tier_cache", help="封面缓存目录")
    parser.add_argument("--force", action="store_true", help="忽略缓存重新获取")
    parser.add_argument("--only", type=str, default="", help="只测试指定番剧（逗号分隔）")
    parser.add_argument("--timeline-dir", default="时间线", help="时间线目录（用于按时间排序）")
    args = parser.parse_args()

    script_dir = Path(__file__).parent
    anime_dir = Path(args.anime_dir) if Path(args.anime_dir).is_absolute() \
        else script_dir / args.anime_dir
    output_path = Path(args.output) if Path(args.output).is_absolute() \
        else script_dir / args.output
    cache_dir = Path(args.cache_dir) if Path(args.cache_dir).is_absolute() \
        else script_dir / args.cache_dir
    timeline_dir = Path(args.timeline_dir) if Path(args.timeline_dir).is_absolute() \
        else script_dir / args.timeline_dir

    log("\n========================================", "bold")
    log("   番剧 Tier 图生成器", "bold")
    log("========================================\n", "bold")

    # 检查依赖
    log_step(1, 4, "检查依赖（Pillow）")
    try:
        from PIL import Image, ImageDraw, ImageFont
        log_ok("Pillow 已安装")
    except ImportError:
        log_err("缺少 Pillow，请运行：pip install Pillow")
        sys.exit(1)

    # 读取番剧列表
    log_step(2, 4, f"读取番剧列表：{anime_dir}")
    grouped = load_anime_list(anime_dir, timeline_dir=timeline_dir)
    total = sum(len(v) for v in grouped.values())
    log_ok(f"共 {total} 部番剧纳入 Tier 图")

    # --only 模式：只测试指定番剧
    if args.only:
        only_titles = [t.strip() for t in args.only.split(",")]
        log(f"\n  --only 模式：仅处理 {only_titles}", "bold")
        filtered = {t: [] for t in TIER_ORDER}
        total_before = sum(len(v) for v in grouped.values())
        for tier in TIER_ORDER:
            filtered[tier] = [a for a in grouped[tier] if a["title"] in only_titles]
        found_titles = []
        for t in TIER_ORDER:
            found_titles.extend([a["title"] for a in filtered[t]])
        not_found_titles = [t for t in only_titles if t not in found_titles]
        if not_found_titles:
            log_warn(f"未找到的番剧：{not_found_titles}")
        grouped = filtered
        total = sum(len(v) for v in grouped.values())
        log_ok(f"筛选后共 {total} 部")
        if total == 0:
            log_err("没有匹配的番剧，退出")
            sys.exit(1)

    # 获取封面
    log_step(3, 4, "获取封面图（带缓存）")

    # 清除旧的 meta 文件（图片缓存保留），--only 模式下不清除
    if not args.only:
        meta_files = list(cache_dir.glob("*.meta"))
        if meta_files:
            for mf in meta_files:
                mf.unlink()
            log_ok(f"已清除 {len(meta_files)} 个旧 meta 缓存（将重新检查失败的番剧）")

    covers = fetch_all_covers(grouped, cache_dir, args.force, args.anime_dir)

    # 绘制大图
    log_step(4, 4, "绘制 Tier 大图")
    draw_tier_chart(
        grouped, covers, output_path,
        thumb_w=args.thumb_w,
        thumb_h=args.thumb_h,
        img_width=args.img_width,
        cols_override=args.cols
    )

    log("\n========================================", "bold")
    log_ok(f"完成！输出：{output_path}")
    log("========================================\n", "bold")


if __name__ == "__main__":
    main()
