// app/api/fetch-news/route.js
// يُشغَّل كل 30 دقيقة عبر Vercel Cron
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const ND_KEY = process.env.NEWSDATA_KEY || 'pub_b052f1ec148241688b243f4017e9f0e4';

const RSS_FEEDS = [
  { n:'FXStreet',     u:'https://www.fxstreet.com/rss/news'                               },
  { n:'FXStreet',     u:'https://www.fxstreet.com/rss/analysis'                           },
  { n:'FXStreet',     u:'https://www.fxstreet.com/rss/crypto'                             },
  { n:'FXStreet',     u:'https://www.fxstreet.com/rss/stocks'                             },
  { n:'DailyFX',      u:'https://www.dailyfx.com/feeds/all'                               },
  { n:'Myfxbook',     u:'https://www.myfxbook.com/rss/latest-forex-news'                  },
  { n:'MarketWatch',  u:'https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines'},
  { n:'CNBC',         u:'https://www.cnbc.com/id/100003114/device/rss/rss.html'           },
  { n:'Reuters',      u:'https://feeds.reuters.com/reuters/businessNews'                  },
  { n:'Investing.com',u:'https://www.investing.com/rss/news_1.rss'                        },
];

// ── Helpers ──────────────────────────────────────────────────
function guessCategory(t) {
  const s = (t||'').toLowerCase();
  if (/gold|xau|silver/.test(s))                    return 'gold';
  if (/bitcoin|btc|crypto|ethereum|eth/.test(s))    return 'crypto';
  if (/oil|crude|brent|wti|opec/.test(s))           return 'oil';
  if (/stock|nasdaq|s&p|dow|equity|shares/.test(s)) return 'stocks';
  if (/fed|ecb|rate|inflation|gdp|cpi|fomc/.test(s))return 'macro';
  return 'forex';
}

function guessSentiment(t) {
  const s = (t||'').toLowerCase();
  if (/rises|gains|\bup\b|bullish|surge|rally|strong|beat/.test(s)) return 'pos';
  if (/falls|drops|\bdown\b|bearish|plunge|weak|miss|slump/.test(s)) return 'neg';
  return 'neu';
}

function parseXML(xml) {
  const items = [];
  const re = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const b = m[1];
    const get = tag => {
      const r = b.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return r ? (r[1]||r[2]||'').trim() : '';
    };
    const lm = b.match(/<link[^>]*>([^<]*)<\/link>/i);
    items.push({
      title:   get('title'),
      link:    lm ? lm[1].trim() : '',
      pubDate: get('pubDate'),
      desc:    get('description').replace(/<[^>]+>/g,'').slice(0,200),
    });
  }
  return items;
}

async function translateToAr(text) {
  if (!text || /[\u0600-\u06FF]/.test(text)) return text;
  try {
    const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0,400))}&langpair=en|ar`);
    const d = await r.json();
    return d?.responseData?.translatedText || text;
  } catch { return text; }
}

async function fetchRSS(feed) {
  try {
    const r = await fetch(feed.u, {
      headers: { 'User-Agent': 'ZA-News-Bot/1.0' },
      signal: AbortSignal.timeout(8000),
    });
    const xml = await r.text();
    return parseXML(xml).slice(0,20).map((item, i) => ({
      ext_id:    `${feed.n}-${i}-${item.pubDate}`,
      title_en:  item.title,
      title_ar:  '',
      link:      item.link,
      summary:   item.desc,
      source:    feed.n,
      category:  guessCategory(item.title),
      sentiment: guessSentiment(item.title),
      pub_date:  item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
    }));
  } catch (e) {
    console.error(`RSS fail: ${feed.n} - ${e.message}`);
    return [];
  }
}

async function fetchNewsData() {
  try {
    const url = `https://newsdata.io/api/1/latest?apikey=${ND_KEY}`
      + `&q=${encodeURIComponent('ذهب اسهم دولار عملات forex gold oil stocks')}`
      + `&language=ar,en`
      + `&excludecountry=ca,cn,jp`
      + `&excludecategory=politics,technology,entertainment,health,science,sports`
      + `&prioritydomain=medium&removeduplicate=1&sort=pubdate`;

    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const d = await r.json();
    if (!d.results) return [];

    return d.results.map((a, i) => {
      const isAr = /[\u0600-\u06FF]/.test(a.title||'');
      return {
        ext_id:    `nd-${a.article_id||i}-${a.pubDate}`,
        title_en:  isAr ? '' : (a.title||''),
        title_ar:  isAr ? (a.title||'') : '',
        link:      a.link || '#',
        summary:   (a.description||'').slice(0,200),
        source:    a.source_name || 'NewsData',
        category:  guessCategory(a.title),
        sentiment: guessSentiment(a.title),
        pub_date:  a.pubDate ? new Date(a.pubDate).toISOString() : new Date().toISOString(),
      };
    });
  } catch (e) {
    console.error('NewsData fail:', e.message);
    return [];
  }
}

function dedup(items) {
  items.sort((a,b) => new Date(b.pub_date) - new Date(a.pub_date));
  const seen = new Set();
  return items.filter(n => {
    const t = (n.title_en||n.title_ar||'');
    if (t.length < 8) return false;
    const k = t.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]/g,'').slice(0,45);
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

// ── Main Handler ─────────────────────────────────────────────
export async function GET(request) {
  // Check cron secret
  const auth = request.headers.get('authorization');
  const secret = process.env.CRON_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('🚀 fetch-news started:', new Date().toISOString());

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // 1. Fetch RSS
    console.log('📡 Fetching RSS...');
    const rssRes = await Promise.allSettled(RSS_FEEDS.map(fetchRSS));
    let items = [];
    rssRes.forEach(r => { if (r.status === 'fulfilled') items = items.concat(r.value); });
    console.log(`RSS: ${items.length}`);

    // 2. Fetch NewsData
    console.log('📡 Fetching NewsData...');
    const ndItems = await fetchNewsData();
    items = items.concat(ndItems);
    console.log(`NewsData: ${ndItems.length} | Total: ${items.length}`);

    // 3. Dedup
    items = dedup(items);
    console.log(`After dedup: ${items.length}`);

    // 4. Translate English titles
    console.log('🌐 Translating...');
    const toTr = items.filter(n => n.title_en && !n.title_ar);
    for (let i = 0; i < toTr.length; i += 8) {
      await Promise.all(toTr.slice(i, i+8).map(async n => {
        n.title_ar = await translateToAr(n.title_en);
      }));
    }
    console.log(`Translated: ${toTr.length}`);

    // 5. Save to Supabase
    const rows = items.map(n => ({
      ext_id:     n.ext_id,
      title_en:   n.title_en || '',
      title_ar:   n.title_ar || n.title_en || '',
      link:       n.link,
      summary:    n.summary || '',
      source:     n.source,
      category:   n.category,
      sentiment:  n.sentiment,
      pub_date:   n.pub_date,
      fetched_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from('news')
      .upsert(rows, { onConflict: 'ext_id', ignoreDuplicates: true });

    if (error) throw error;

    // 6. Delete news older than 7 days
    const weekAgo = new Date(Date.now() - 7*24*60*60*1000).toISOString();
    await supabase.from('news').delete().lt('pub_date', weekAgo);

    console.log(`✅ Done: ${rows.length} articles saved`);
    return NextResponse.json({ success: true, count: rows.length, timestamp: new Date().toISOString() });

  } catch (e) {
    console.error('❌', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
