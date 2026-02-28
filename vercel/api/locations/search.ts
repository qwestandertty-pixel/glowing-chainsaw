import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const clientId = process.env.AMADEUS_CLIENT_ID
  const clientSecret = process.env.AMADEUS_CLIENT_SECRET
  
  console.log('Env check:', { clientId: !!clientId, clientSecret: !!clientSecret })
  
  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: 'Missing API credentials', clientId: !!clientId, clientSecret: !!clientSecret })
  }

  const keyword = req.query.keyword as string
  if (!keyword) {
    return res.status(400).json({ error: 'Missing keyword parameter' })
  }

  try {
    // Get access token
    const tokenRes = await fetch('https://test.api.amadeus.com/v1/security/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials&client_id=' + encodeURIComponent(clientId) + '&client_secret=' + encodeURIComponent(clientSecret)
    })
    
    if (!tokenRes.ok) {
      const tokenErr = await tokenRes.text()
      console.error('Token error:', tokenErr)
      return res.status(500).json({ error: 'Failed to get access token', details: tokenErr })
    }
    
    const tokenData = await tokenRes.json()
    const accessToken = tokenData.access_token
    
    if (!accessToken) {
      return res.status(500).json({ error: 'No access token in response' })
    }

    // Search locations
    const searchUrl = 'https://test.api.amadeus.com/v1/reference-data/locations?keyword=' + encodeURIComponent(keyword) + '&subType=CITY,AIRPORT&page[limit]=8'
    const searchRes = await fetch(searchUrl, {
      headers: { 'Authorization': 'Bearer ' + accessToken }
    })
    
    if (!searchRes.ok) {
      const searchErr = await searchRes.text()
      console.error('Search error:', searchErr)
      return res.status(500).json({ error: 'Location search failed', details: searchErr })
    }
    
    const searchData = await searchRes.json()
    const results = (searchData.data || []).map((item: any) => ({
      name: item.name,
      iataCode: item.iataCode,
      type: item.subType,
      city: item.address?.cityName,
      country: item.address?.countryCode
    }))
    
    results.sort((a: any, b: any) => a.type === 'CITY' && b.type !== 'CITY' ? -1 : 1)
    
    return res.status(200).json(results)
  } catch (err: any) {
    console.error('Exception:', err)
    return res.status(500).json({ error: err.message || String(err) })
  }
}