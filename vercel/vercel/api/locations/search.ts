import type { VercelRequest, VercelResponse } from "@vercel/node";

const BASE_URL = process.env.AMADEUS_BASE_URL || "https://test.api.amadeus.com";
const CLIENT_ID = process.env.AMADEUS_CLIENT_ID || "";
const CLIENT_SECRET = process.env.AMADEUS_CLIENT_SECRET || "";

let tokenCache: { access_token: string; expires_at: number } | null = null;

function cors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expires_at > now) return tokenCache.access_token;

  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("Missing AMADEUS_CLIENT_ID / AMADEUS_CLIENT_SECRET env vars");
  }

  const body = new URLSearchParams();
  body.set("grant_type", "client_credentials");
  body.set("client_id", CLIENT_ID);
  body.set("client_secret", CLIENT_SECRET);

  const resp = await fetch(`${BASE_URL}/v1/security/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const json = await resp.json();
  if (!resp.ok) {
    throw new Error(`Token error: ${resp.status}\n${JSON.stringify(json, null, 2)}`);
  }

  const access_token = json.access_token as string;
  const expires_in = (json.expires_in as number) ?? 1800;
  // 提前 30 秒过期，避免“卡点失效”
  tokenCache = { access_token, expires_at: Date.now() + Math.max(0, expires_in - 30) * 1000 };
  return access_token;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const qRaw = (req.query.q ?? req.query.keyword ?? "").toString().trim();
    const q = qRaw.replace(/\s+/g, " ");
    if (q.length < 2) return res.status(200).json({ data: [] });

    const token = await getAccessToken();

    // Airport & City Search
    const url =
      `${BASE_URL}/v1/reference-data/locations` +
      `?subType=AIRPORT,CITY` +
      `&keyword=${encodeURIComponent(q)}` +
      `&page[limit]=10` +
      `&sort=analytics.travelers.score` +
      `&view=LIGHT`;

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const json = await resp.json();
    if (!resp.ok) {
      return res.status(resp.status).json({ error: json });
    }

    const data = (json?.data ?? []).map((it: any) => {
      const iata = it?.iataCode ?? "";
      const name = it?.name ?? "";
      const subType = it?.subType ?? "";
      const detailedName = it?.detailedName ?? "";
      const cityName = it?.address?.cityName ?? "";
      const countryCode = it?.address?.countryCode ?? "";
      return {
        iataCode: iata,
        name,
        subType, // AIRPORT / CITY
        cityName,
        countryCode,
        detailedName,
        // 给前端直接显示用
        label:
          detailedName ||
          [name, iata, cityName, countryCode].filter(Boolean).join(" · "),
      };
    });

    return res.status(200).json({ data });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}
