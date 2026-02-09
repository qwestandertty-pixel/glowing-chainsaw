// vercel/shared/normalize.ts
export type UiOffer = {
  id: string;
  airline: string;
  from: string;
  to: string;
  departAt: string;
  arriveAt: string;
  duration: string;
  stops: number;
  price: number;
  currency: string;
};

function isoDurationToHuman(iso: string): string {
  // e.g. "PT11H35M"
  if (!iso || typeof iso !== "string") return "";
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?/.exec(iso);
  if (!m) return iso;
  const h = m[1] ? Number(m[1]) : 0;
  const min = m[2] ? Number(m[2]) : 0;
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (min || !parts.length) parts.push(`${min}m`);
  return parts.join(" ");
}

export function normalizeOffers(payload: any): UiOffer[] {
  const data: any[] = payload?.data ?? [];
  const carriers: Record<string, string> = payload?.dictionaries?.carriers ?? {};

  return data.map((offer: any, idx: number) => {
    const it0 = offer?.itineraries?.[0];
    const segs: any[] = it0?.segments ?? [];
    const first = segs[0];
    const last = segs[segs.length - 1];

    const carrierCode =
      first?.carrierCode ||
      first?.operating?.carrierCode ||
      segs?.[0]?.carrierCode ||
      "";

    const airline = carriers[carrierCode] || carrierCode || "Unknown";

    const from = first?.departure?.iataCode || "";
    const to = last?.arrival?.iataCode || "";
    const departAt = first?.departure?.at || "";
    const arriveAt = last?.arrival?.at || "";

    const duration = isoDurationToHuman(it0?.duration || "");
    const stops = Math.max(0, segs.length - 1);

    const currency = offer?.price?.currency || "";
    const price = Number(offer?.price?.total || 0);

    return {
      id: String(offer?.id ?? idx),
      airline,
      from,
      to,
      departAt,
      arriveAt,
      duration,
      stops,
      price,
      currency,
    };
  });
}

export default normalizeOffers;
