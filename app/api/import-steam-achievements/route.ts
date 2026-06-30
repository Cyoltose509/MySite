import { NextRequest, NextResponse } from 'next/server';

/**
 * Import Steam achievements for a game.
 * Only sets achievements if the game doesn't already have them in metrics.
 */
export async function POST(req: NextRequest) {
  try {
    const { appid, gameId } = await req.json();
    if (!appid || !gameId) {
      return NextResponse.json({ ok: false, error: 'Missing appid or gameId' }, { status: 400 });
    }

    // Check existing metrics first
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
    );

    const { data: game } = await supabase.from('steam_games').select('metrics').eq('id', gameId).single();
    const existing = game?.metrics || {};

    // Don't overwrite if already has achievements
    if (existing.achievements !== undefined) {
      return NextResponse.json({ ok: true, achievements: existing.achievements, note: '已存在，未覆盖' });
    }

    // Fetch from Steam
    const STEAM_KEY = process.env.STEAM_API_KEY;
    const STEAM_ID = process.env.STEAM_ID;
    if (!STEAM_KEY || !STEAM_ID) {
      return NextResponse.json({ ok: false, error: 'config' }, { status: 400 });
    }

    const url = `https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v0001/?key=${STEAM_KEY}&steamid=${STEAM_ID}&appid=${appid}&l=schinese`;
    const resp = await fetch(url);
    const text = await resp.text();
    const json = JSON.parse(text);

    const stats = json?.playerstats;
    if (!stats || !stats.achievements) {
      return NextResponse.json({ ok: false, error: stats?.error || '该游戏无成就数据' });
    }
    const achievements = stats.achievements;
    const total = achievements.length;
    const achieved = achievements.filter((a: any) => a.achieved === 1).length;

    if (total === 0) {
      return NextResponse.json({ ok: true, achievements: 0, note: '该游戏无成就' });
    }

    // Save
    const newMetrics = { ...existing, achievements: `${achieved}/${total}` };
    await supabase.from('steam_games').update({ metrics: newMetrics }).eq('id', gameId);

    return NextResponse.json({ ok: true, achievements: `${achieved}/${total}` });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
