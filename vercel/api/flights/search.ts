// vercel/api/flights/search.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { normalizeOffers } from "../../shared/normalize.js";

type SearchBody = {
  origin: string;        // can be IATA or city keyword
  destination: string;   // can be IATA or city keyword
  departDate: string;    // YYYY-MM-DD
  returnDate?: string;   // YYYY-MM-DD
  adults?: number;
  travelClass?: "ECONOMY" | "PREMIUM_ECONOMY" | "BUSINESS" | "FIRST";
  maxStops?: null | 0 | 1 | 2;
};

const BASE_URL = process.env.AMADEUS_BASE_URL || "https://test.api.amadeus.com";
const CLIENT_ID = process.env.AMADEUS_CLIENT_ID || "";
const CLIENT_SECRET = process.env.AMADEUS_CLIENT_SECRET || "";

let tokenCache: { access_token: string; expires_at: number } | null = null;

function isIata(s: string): boolean {
  return /^[A-Z]{3}$/.test((s || "").toUpperCase().trim());
}

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

  const json: any = await res.json();
  const expiresIn = Number(json.expires_in || 900);
  tokenCache = { access_token: String(json.access_token), expires_at: now + expiresIn * 1000 };
  return tokenCache.access_token;
}

async function resolveToIata(input: string): Promise<string> {
  const raw = (input || "").trim();
  const up = raw.toUpperCase();
  if (isIata(up)) return up;

  // Use Amadeus "Airport & City Search" to resolve keyword -> IATA
  // Prefer CITY if available, else first result.
  const token = await getAccessToken();
  const keyword = raw.slice(0, 40);

  if (keyword.length < 2) return up; // too short to resolve; let downstream error handle

  const url =
    `${BASE_URL}/v1/reference-data/locations` +
    `?keyword=${encodeURIComponent(keyword)}` +
    `&subType=CITY,AIRPORT` +
    `&view=LIGHT`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    // If resolve fails, return original; flight search will likely fail and show useful error
    return up;
  }

  const json: any = await res.json();
  const list: any[] = json?.data ?? [];
  if (!list.length) return up;

  const city = list.find((x) => x?.subType === "CITY" && x?.iataCode);
  const pick = city || list.find((x) => x?.iataCode) || list[0];
  return String(pick?.iataCode || up).toUpperCase();
}

function isFutureDate(yyyy_mm_dd: string): boolean {
  // treat today as allowed? Amadeus often requires >= today in local; safer: >= tomorrow
  const d = new Date(`${yyyy_mm_dd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return d.getTime() >= todayUTC.getTime();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = (req.body || {}) as Partial<SearchBody>;

    let origin = String(body.origin || "").trim();
    let destination = String(body.destination || "").trim();
    const departDate = String(body.departDate || "").trim();
    const returnDate = body.returnDate ? String(body.returnDate).trim() : undefined;

    if (!origin || !destination || !departDate) {
      return res.status(400).json({ error: "origin, destination, departDate are required" });
    }
    if (!isFutureDate(departDate)) {
      return res.status(400).json({ error: "departDate must be today or in the future" });
    }

    // Allow city keywords; resolve them to IATA
    origin = await resolveToIata(origin);
    destination = await resolveToIata(destination);

    const adults = Math.max(1, Math.min(9, Number(body.adults || 1)));
    const travelClass = (body.travelClass || "ECONOMY") as SearchBody["travelClass"];
    const maxStops = body.maxStops ?? null;

    const token = await getAccessToken();

    const params = new URLSearchParams();
    params.set("originLocationCode", origin);
    params.set("destinationLocationCode", destination);
    params.set("departureDate", departDate);
    params.set("adults", String(adults));
    params.set("travelClass", travelClass);
    params.set("max", "50");
    if (returnDate) params.set("returnDate", returnDate);
    if (maxStops !== null && maxStops !== undefined) {
      params.set("maxNumberOfStops", String(maxStops));
    }

    const url = `${BASE_URL}/v2/shopping/flight-offers?${params.toString()}`;
    const apiRes = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const jsonText = await apiRes.text();
    let json: any = null;
    try {
      json = JSON.parse(jsonText);
    } catch {
      json = { error: jsonText };
    }

    if (!apiRes.ok) {
      return res.status(apiRes.status).json({ error: JSON.stringify(json) });
    }

    const offers = normalizeOffers(json);

    return res.status(200).json({
      offers,
      resolved: { origin, destination },
      rawMeta: json?.meta,
    });
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
