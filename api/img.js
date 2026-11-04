export const config = { runtime: 'edge' };

// Proxy image : TCGdex FR → EN → Scrydex → CDN officiel Pokémon TCG (30e anniversaire classique)
// Cache 1 an sur l'edge Vercel — plus aucune cascade d'erreurs côté client.
export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const base = searchParams.get('base') || '';
  const lid  = searchParams.get('lid')  || '';
  const hi   = searchParams.get('hi') === '1';
  const n    = String(parseInt(lid, 10) || lid);

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
    if (hi) {
      urls.push(base + '/high.webp', base + '/high.png');
      if (en !== base) urls.push(en + '/high.webp', en + '/high.png');
    }
    urls.push(base + '/low.webp', base + '/low.png');
    if (en !== base) urls.push(en + '/low.webp', en + '/low.png');
  }

  // Scrydex — fallback général : images.scrydex.com/pokemon/{setId}-{localId}/{size}
  // Le setId est extrait de la base URL (assets.tcgdex.net/{lang}/{setId}/{localId})
  if (base) {
    const parts = base.replace(/^https?:\/\/[^/]+/, '').split('/').filter(Boolean);
    if (parts.length >= 2) {
      const scardId = `${parts[parts.length - 2]}-${parts[parts.length - 1]}`;
      if (hi) urls.push(`https://images.scrydex.com/pokemon/${scardId}/large`);
      urls.push(`https://images.scrydex.com/pokemon/${scardId}/medium`);
    }
  }

  // CDN officiel Pokémon TCG — Collection Classique 30e Anniversaire uniquement (flag c=1)
  if (n && searchParams.get('c') === '1') {
    urls.push(
      `https://dz3we2x72f7ol.cloudfront.net/expansions/30th-celebration/fr-fr/2M6P_Classic_FR_${n}-2x.png`,
      `https://dz3we2x72f7ol.cloudfront.net/expansions/30th-celebration/en-us/2M6P_Classic_EN_${n}-2x.png`
    );
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
