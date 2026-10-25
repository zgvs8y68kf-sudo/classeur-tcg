// Fonction Vercel : envoie la photo à Claude et renvoie les cartes lues en JSON.
// Nécessite la variable d'environnement ANTHROPIC_API_KEY (Vercel > Settings > Environment Variables).

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({ ready: Boolean(process.env.ANTHROPIC_API_KEY) });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "method" });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(501).json({ error: "no_key" });

  const { image, mediaType = "image/jpeg", prompt } = req.body || {};
  if (!image || typeof image !== "string" || image.length > 6_000_000) {
    return res.status(400).json({ error: "bad_image" });
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(mediaType)) {
    return res.status(400).json({ error: "bad_type" });
  }

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.SCAN_MODEL || "claude-sonnet-5-5",
        max_tokens: 1500,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
            { type: "text", text: String(prompt || "").slice(0, 4000) },
          ],
        }],
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status === 429 ? 429 : 502).json({ error: data?.error?.type || "upstream" });

    const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    const match = text.match(/\{[\s\S]*\}/);
    let parsed = { cards: [] };
    try { if (match) parsed = JSON.parse(match[0]); } catch {}
    return res.status(200).json({ cards: Array.isArray(parsed.cards) ? parsed.cards : [] });
  } catch (e) {
    return res.status(502).json({ error: "network" });
  }
}
