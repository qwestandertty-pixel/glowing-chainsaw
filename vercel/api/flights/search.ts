import type { VercelRequest, VercelResponse } from "@vercel/node";
import { normalizeOffers } from "../../shared/normalize";

type SearchBody = {
  origin: string;
  destination: string;
  departDate: string;   // YYYY-MM-DD
  returnDate?: string;  // YYYY-MM-DD
  adults?: number;
  travelClass?: "ECONOMY" | "PREMIUM_ECONOMY" | "BUSINESS" | "FIRST";
  maxStops?: null | 0 | 1 | 2;
};

const BASE_URL = process.env.AMADEUS_BASE_URL || "https://test.api.amadeus.com";
const CLIENT_ID = process.env.AMADEUS_CLIENT_ID || "";
const CLIENT_SECRET = process.env.AMADEUS_CLIENT_SECRET || "";

let tokenCache: { access_token: string; expires_at: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("Missing AMADEUS_CLIENT_ID / AMADEUS_CLIENT_SECRET env vars");
  }
  const now = Date.now();
  if (tokenCache && tokenCache.expires_at > now + 15_000) return tokenCache.access_token;

  const form = new URLSearchParams();
  form.set("grant_type", "client_credentials");
  form.set("client_id", CLIENT_ID);
  form.set("client_secret", CLIENT_SECRET);

  const res = await fetch(`${BASE_URL}/v1/security/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  if (!res.ok) throw new Error(`Token error: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as any;

  const expiresIn = Number(json.expires_in || 900);
  tokenCache = { access_token: String(json.access_token), expires_at: now + expiresIn * 1000 };
  return tokenCache.access_token;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = req.body as SearchBody;
    const origin = (body.origin || "").toUpperCase().trim();
    const destination = (body.destination || "").toUpperCase().trim();
    const departDate = (body.departDate || "").trim();

    if (!origin || !destination || !departDate) {
      return res.status(400).json({ error: "origin, destination, departDate are required" });
    }

    const adults = Math.max(1, Math.min(9, Number(body.adults || 1)));
    const travelClass = body.travelClass || "ECONOMY";

    const token = await getAccessToken();

    const params = new URLSearchParams();
    params.set("originLocationCode", origin);
    params.set("destinationLocationCode", destination);
    params.set("departureDate", departDate);
    if (body.returnDate) params.set("returnDate", body.returnDate);
    params.set("adults", String(adults));
    params.set("travelClass", travelClass);
    params.set("currencyCode", "USD");
    params.set("max", "50");

    if (body.maxStops === 0) params.set("nonStop", "true");

    const url = `${BASE_URL}/v2/shopping/flight-offers?` + params.toString();
    const apiRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

    if (!apiRes.ok) return res.status(apiRes.status).json({ error: await apiRes.text() });

    const apiJson = (await apiRes.json()) as any;
    const normalized = normalizeOffers(apiJson);

    const maxStops = body.maxStops;
    let offers = normalized.offers;
    if (maxStops === 1) offers = offers.filter((o) => o.metrics.totalStops <= 1);
    if (maxStops === 2) offers = offers.filter((o) => o.metrics.totalStops >= 2);

    return res.status(200).json({ offers, meta: normalized.meta });
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
