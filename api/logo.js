export const config = { runtime: 'edge' };

// Proxy logo d'extension : TCGdex FR → EN → pokemontcg.io → CDN officiel Pokémon (30e anniversaire)
// Cache 1 an sur l'edge Vercel.
export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const base = searchParams.get('base') || '';
  const sid  = searchParams.get('sid')  || '';

  const tryFetch = async (src) => {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 5000);
    try {
      const r = await fetch(src, { signal: ctrl.signal });
      if (r.ok) return r;
    } catch {}
    finally { clearTimeout(tid); }
    return null;
  };

  const urls = [];

  if (base) {
    const en = base.replace('/fr/', '/en/');
    urls.push(base + '.webp', base + '.png');
    if (en !== base) urls.push(en + '.webp', en + '.png');
  }

  if (sid) {
    urls.push(`https://images.pokemontcg.io/${sid}/logo.png`);
  }

  // CDN officiel Pokémon — 30e Anniversaire & Collection Classique (flag a30=1)
  if (searchParams.get('a30') === '1') {
    urls.push('https://d1i787aglh9bmb.cloudfront.net/assets/img/me-expansions/thirty/logo/fr-fr/Logo-30th-2x.png');
  }

  for (const url of urls) {
    const r = await tryFetch(url);
    if (r) {
      const ct = r.headers.get('content-type') || 'image/png';
      const buf = await r.arrayBuffer();
      return new Response(buf, {
        headers: {
          'Content-Type': ct,
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    }
  }

  return new Response(null, { status: 404 });
}
