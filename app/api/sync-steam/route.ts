import { NextRequest, NextResponse } from 'next/server';
import https from 'https';
import { execSync } from 'child_process';

function steamTags(appid: number): Promise<{ genres: string[]; userTags: string[] }> {
  return new Promise((resolve) => {
    const req = https.get(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=schinese`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    }, (res) => {
      let data = '';
      res.on('data', (chunk: string) => data += chunk);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          const d = j[String(appid)];
          const genres = (d?.data?.genres || []).map((g: any) => g.description);

          // Try store page via curl (works when Node https doesn't)
          let userTags: string[] = [];
          try {
            const html = execSync(
              `curl -sL --max-time 8 "https://store.steampowered.com/app/${appid}/?l=schinese"`,
              { encoding: 'utf-8', timeout: 10000, windowsHide: true }
            );
            const m = html.match(/InitAppTagModal\s*\(\s*\d+\s*,\s*(\[[\s\S]*?\])\s*\)/);
            if (m) {
              const tags = JSON.parse(m[1]);
              userTags = tags.filter((t: any) => t.name).slice(0, 5).map((t: any) => t.name.trim());
            }
          } catch { /* curl/store page unavailable */ }

          resolve({ genres, userTags });
        } catch { resolve({ genres: [], userTags: [] }); }
      });
    });
    req.on('error', () => resolve({ genres: [], userTags: [] }));
    req.setTimeout(6000, () => { req.destroy(); resolve({ genres: [], userTags: [] }); });
  });
}

export async function GET() {
  const API_KEY = process.env.STEAM_API_KEY;
  const STEAM_ID = process.env.STEAM_ID;
  if (!API_KEY || !STEAM_ID) return NextResponse.json({ ok: false, error: 'config' }, { status: 400 });

  try {
    const resp = await fetch(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${API_KEY}&steamid=${STEAM_ID}&include_appinfo=true&include_played_free_games=true`);
    const json = await resp.json();
    if (!json.response?.games) return NextResponse.json({ ok: false, error: 'empty' });

    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
    );

    const games = json.response.games;
    let count = 0;
    const { data: bl } = await supabase.from('steam_blacklist').select('steam_app_id');
    const blacklisted = new Set((bl || []).map((b: any) => b.steam_app_id));
    const gameList: { appid: number; name: string }[] = [];
    for (const g of games) {
      if (blacklisted.has(g.appid)) continue;
      const { error } = await supabase.rpc('fn_sync_steam_game', {
        p_steam_app_id: g.appid, p_title: g.name,
        p_playtime_forever: g.playtime_forever || 0, p_playtime_2weeks: g.playtime_2weeks || 0,
        p_img_icon_url: g.img_icon_url || '', p_img_logo_url: g.img_logo_url || '',
      });
      if (!error) { count++; gameList.push({ appid: g.appid, name: g.name }); }
    }
    return NextResponse.json({ ok: true, count, games: gameList });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { appid, name } = await req.json();
    if (!appid) return NextResponse.json({ ok: false, error: 'missing appid' }, { status: 400 });

    const { genres, userTags } = await steamTags(appid);
    const allTags = [...new Set([...genres, ...userTags])];
    if (allTags.length === 0) return NextResponse.json({ ok: true, name, tags: 0 });

    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
    );

    const { data: rows } = await supabase.from('steam_games').select('id').eq('steam_app_id', appid).single();
    if (!rows) return NextResponse.json({ ok: true, name, tags: 0 });

    let count = 0;
    for (const tag of allTags) {
      await supabase.rpc('fn_insert_steam_tag', { p_game_id: rows.id, p_tag: tag });
      count++;
    }

    return NextResponse.json({ ok: true, name, tags: count });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
