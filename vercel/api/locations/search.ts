import type { VercelRequest, VercelResponse } from '@vercel/node'

const AMADEUS_CLIENT_ID = process.env.AMADEUS_CLIENT_ID
const AMADEUS_CLIENT_SECRET = process.env.AMADEUS_CLIENT_SECRET

async function getAccessToken(): Promise<string> {
  const url = 'https://test.api.amadeus.com/v1/security/oauth2/token'
  const params = 'grant_type=client_credentials&client_id=' + AMADEUS_CLIENT_ID + '&client_secret=' + AMADEUS_CLIENT_SECRET
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  })
  const data = await res.json()
  return data.access_token
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  try {
    if (!AMADEUS_CLIENT_ID || !AMADEUS_CLIENT_SECRET) {
      return res.status(500).json({
        error: 'Missing AMADEUS_CLIENT_ID / AMADEUS_CLIENT_SECRET',
      })
    }

    const keyword = req.query.keyword as string
    if (!keyword) {
      return res.status(400).json({ error: 'Missing keyword' })
    }

    const token = await getAccessToken()
    const apiUrl = 'https://test.api.amadeus.com/v1/reference-data/locations?keyword=' + keyword + '&subType=CITY,AIRPORT&page[limit]=8'
    const response = await fetch(apiUrl, {
      headers: { Authorization: 'Bearer ' + token },
    })
    const data = await response.json()
    const results =
      data?.data?.map((item: any) => ({
        name: item.name,
        iataCode: item.iataCode,
        type: item.subType,
        city: item.address?.cityName,
        country: item.address?.countryCode,
      })) || []

    results.sort((a: any, b: any) =>
      a.type === 'CITY' && b.type !== 'CITY' ? -1 : 1
    )

    return res.status(200).json(results)
  } catch (err: any) {
    return res.status(500).json({ error: err.message })
  }
}