// app/api/news/route.js
// GET /api/news?source=FXStreet&category=gold&q=dollar
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const source   = searchParams.get('source');
  const category = searchParams.get('category');
  const q        = searchParams.get('q');
  const page     = parseInt(searchParams.get('page') || '1');
  const limit    = parseInt(searchParams.get('limit') || '100');

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    let query = supabase
      .from('news')
      .select('id, title_ar, title_en, link, summary, source, category, sentiment, pub_date')
      .order('pub_date', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (source && source !== 'all') query = query.eq('source', source);
    if (category && category !== 'all') query = query.eq('category', category);
    if (q) query = query.or(`title_ar.ilike.%${q}%,title_en.ilike.%${q}%`);

    const { data, error } = await query;
    if (error) throw error;

    // Count per source
    const { data: srcData } = await supabase.from('news').select('source');
    const sourceCounts = {};
    (srcData || []).forEach(r => {
      sourceCounts[r.source] = (sourceCounts[r.source] || 0) + 1;
    });

    return NextResponse.json({
      success: true,
      total: data?.length || 0,
      articles: data || [],
      sourceCounts,
      timestamp: new Date().toISOString(),
    }, { headers });

  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500, headers });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    },
  });
}
