import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get('lat');
  const lon = searchParams.get('lon');

  if (!lat || !lon) {
    return NextResponse.json({ error: "Missing coordinates" }, { status: 400 });
  }

  const query = `[out:json][timeout:10];(node["amenity"~"school|college|community_centre"](around:3000,${lat},${lon});way["amenity"~"school|college|community_centre"](around:3000,${lat},${lon}););out center 12;`;

  try {
    const res = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`, {
        headers: { 
          'Accept': 'application/json',
          // CRITICAL FIX: Adding a clean User-Agent tells Overpass who is asking, preventing the 406 security block
          'User-Agent': 'SmartVoterPortalEducationalProject/1.0 (Contact: student-developer)'
        },
        cache: 'no-store' 
    });

    if (!res.ok) {
      throw new Error(`Overpass API returned status: ${res.status}`);
    }

    const data = await res.json();
    return NextResponse.json(data);
    
  } catch (error: any) {
    console.error("Backend Proxy Failed:", error.message || error);
    return NextResponse.json({ error: "Failed to fetch from Overpass server" }, { status: 500 });
  }
}