import { NextRequest, NextResponse } from 'next/server';

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
  // Steam 标签同步已禁用
  return NextResponse.json({ ok: true, tags: 0 });
}
