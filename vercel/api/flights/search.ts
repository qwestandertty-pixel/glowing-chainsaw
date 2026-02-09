// vercel/api/flights/search.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { normalizeOffers } from "../../shared/normalize.js";

type SearchBody = {
  origin: string;        // can be IATA (DEL) or city text (Delhi)
  destination: string;   // can be IATA (LON) or city text (London)
  departDate: string;    // YYYY-MM-DD
  returnDate?: string;   // YYYY-MM-DD
  adults?: number;
  travelClass?: "ECONOMY" | "PREMIUM_ECONOMY" | "BUSINESS" | "FIRST";
  max?: number;          // max offers
};

const BASE_URL = process.env.AMADEUS_BASE_URL || "https://test.api.amadeus.com";
const CLIENT_ID = process.env.AMADEUS_CLIENT_ID || "";
const CLIENT_SECRET = process.env.AMADEUS_CLIENT_SECRET || "";

let tokenCache: { access_token: string; expires_at: number } | null = null;

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expires_at > now + 15_000) return tokenCache.access_token;

  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("Missing AMADEUS_CLIENT_ID / AMADEUS_CLIENT_SECRET env vars");
  }

  const form = new URLSearchParams();
  form.set("grant_type", "client_credentials");
  form.set("client_id", CLIENT_ID);
  form.set("client_secret", CLIENT_SECRET);

  const res = await fetch(`${BASE_URL}/v1/security/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  if (!res.ok) {
    throw new Error(`Token error: ${res.status}\n${await res.text()}`);
  }

  const json = (await res.json()) as any;
  const expiresIn = Number(json.expires_in || 900);
  tokenCache = {
    access_token: String(json.access_token),
    expires_at: now + expiresIn * 1000,
  };
  return tokenCache.access_token;
}

function looksLikeIata(s: string): boolean {
  return /^[A-Z]{3}$/.test(s);
}

async function resolveToIata(keyword: string): Promise<string> {
  // If user typed a city name, use Amadeus Locations API to find best IATA code.
  const token = await getAccessToken();

  const url = new URL(`${BASE_URL}/v1/reference-data/locations`);
  url.searchParams.set("keyword", keyword);
  url.searchParams.set("subType", "CITY,AIRPORT");
  url.searchParams.set("page[limit]", "1");
  url.searchParams.set("view", "LIGHT");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`Location resolve error: ${res.status}\n${await res.text()}`);
  }

  const json = (await res.json()) as any;
  const code = json?.data?.[0]?.iataCode;
  if (!code) throw new Error(`No IATA match for "${keyword}"`);
  return String(code).toUpperCase();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = (req.body || {}) as SearchBody;

    const originRaw = String(body.origin || "").trim();
    const destRaw = String(body.destination || "").trim();
    const departDate = String(body.departDate || "").trim();

    if (!originRaw || !destRaw || !departDate) {
      return res.status(400).json({ error: "origin, destination, departDate are required" });
    }

    const adults = Math.max(1, Math.min(9, Number(body.adults || 1)));
    const travelClass = (body.travelClass || "ECONOMY").toString();
    const max = Math.max(1, Math.min(50, Number(body.max || 50)));

    // Accept IATA codes OR city names
    const origin = looksLikeIata(originRaw.toUpperCase())
      ? originRaw.toUpperCase()
      : await resolveToIata(originRaw);

    const destination = looksLikeIata(destRaw.toUpperCase())
      ? destRaw.toUpperCase()
      : await resolveToIata(destRaw);

    const token = await getAccessToken();

    const url = new URL(`${BASE_URL}/v2/shopping/flight-offers`);
    url.searchParams.set("originLocationCode", origin);
    url.searchParams.set("destinationLocationCode", destination);
    url.searchParams.set("departureDate", departDate);
    url.searchParams.set("adults", String(adults));
    url.searchParams.set("travelClass", travelClass);
    url.searchParams.set("max", String(max));

    if (body.returnDate) url.searchParams.set("returnDate", String(body.returnDate).trim());

    const upstream = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    const jsonText = await upstream.text();
    let json: any = null;
    try {
      json = JSON.parse(jsonText);
    } catch {
      // keep raw text
    }

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: typeof json === "object" && json ? JSON.stringify(json) : jsonText,
      });
    }

    const offers = normalizeOffers(json);
    return res.status(200).json({
      query: { origin, destination, departDate, adults, travelClass, max },
      offers,
    });
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
