import type { VercelRequest, VercelResponse } from '@vercel/node'
import { normalizeOffers } from '../../shared/normalize.js'

const BASE_URL = process.env.AMADEUS_BASE_URL || 'https://test.api.amadeus.com'
const CLIENT_ID = process.env.AMADEUS_CLIENT_ID || ''
const CLIENT_SECRET = process.env.AMADEUS_CLIENT_SECRET || ''

let tokenCache: { accessToken: string; expiresAt: number } | null = null

async function getAccessToken(): Promise<string> {
  const now = Date.now()

  if (tokenCache && tokenCache.expiresAt > now + 30_000) {
    return tokenCache.accessToken
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('Missing AMADEUS_CLIENT_ID / AMADEUS_CLIENT_SECRET env vars')
  }

  const body =
    'grant_type=client_credentials' +
    '&client_id=' + encodeURIComponent(CLIENT_ID) +
    '&client_secret=' + encodeURIComponent(CLIENT_SECRET)

  const res = await fetch(`${BASE_URL}/v1/security/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })

  const text = await res.text()
  let json: any = {}
  try { json = JSON.parse(text) } catch {}

  if (!res.ok) {
    throw new Error(`Token error: ${res.status}\n${text}`)
  }

  if (!json.access_token) {
    throw new Error('No access token returned by Amadeus')
  }

  const expiresIn = Number(json.expires_in || 1799)
  tokenCache = {
    accessToken: json.access_token,
    expiresAt: now + expiresIn * 1000
  }

  return json.access_token
}

function isIata(v: string): boolean {
  return /^[A-Z]{3}$/i.test((v || '').trim())
}

async function resolveToIata(input: string, token: string): Promise<string> {
  const raw = (input || '').trim()
  if (!raw) throw new Error('Empty location input')

  if (isIata(raw)) return raw.toUpperCase()

  const url =
    `${BASE_URL}/v1/reference-data/locations` +
    `?keyword=${encodeURIComponent(raw)}` +
    `&subType=CITY,AIRPORT&page[limit]=1`

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  })

  const text = await res.text()
  let json: any = {}
  try { json = JSON.parse(text) } catch {}

  if (!res.ok) {
    throw new Error(`Location resolve failed: ${text}`)
  }

  const iata = json?.data?.[0]?.iataCode
  if (!iata) throw new Error(`Could not resolve location: ${raw}`)

  return String(iata).toUpperCase()
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const originInput = String(req.body?.origin || '').trim()
    const destinationInput = String(req.body?.destination || '').trim()
    const departDate = String(req.body?.departDate || '').trim()
    const adults = Number(req.body?.adults || 1)
    const travelClass = String(req.body?.travelClass || 'ECONOMY')

    if (!originInput || !destinationInput || !departDate) {
      return res.status(400).json({ error: 'origin, destination, departDate are required' })
    }

    const token = await getAccessToken()

    const origin = await resolveToIata(originInput, token)
    const destination = await resolveToIata(destinationInput, token)

    const url =
      `${BASE_URL}/v2/shopping/flight-offers` +
      `?originLocationCode=${encodeURIComponent(origin)}` +
      `&destinationLocationCode=${encodeURIComponent(destination)}` +
      `&departureDate=${encodeURIComponent(departDate)}` +
      `&adults=${encodeURIComponent(String(adults))}` +
      `&travelClass=${encodeURIComponent(travelClass)}` +
      `&currencyCode=EUR` +
      `&max=50`

    const searchRes = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json'
      }
    })

    const text = await searchRes.text()
    let json: any = {}
    try { json = JSON.parse(text) } catch {}

    if (!searchRes.ok) {
      return res.status(searchRes.status).json({
        error: json?.errors ? JSON.stringify(json.errors) : text
      })
    }

    const offers = normalizeOffers(json)

    return res.status(200).json({
      origin,
      destination,
      departDate,
      offers
    })
  } catch (err: any) {
    return res.status(500).json({
      error: err?.message || String(err)
    })
  }
}
