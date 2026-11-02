// Endpoint de diagnostic — liste les modèles Gemini disponibles avec la clé configurée.
export default async function handler(req, res) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) { res.json({ error: "no_key" }); return; }

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=50`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      res.json({ status: r.status, error: body.slice(0, 500) });
      return;
    }
    const data = await r.json();
    const names = (data.models || []).map(m => m.name);
    res.json({ count: names.length, models: names });
  } catch(e) {
    res.json({ error: e.message || String(e) });
  }
}
