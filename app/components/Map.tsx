"use client";
import { useEffect, useState, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, Circle } from 'react-leaflet';
// @ts-ignore
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { Search, Navigation, MapPin, Loader2, AlertCircle, X } from 'lucide-react';

// --- 1. Custom Icons ---
const createIcon = (color: string) => L.divIcon({
  className: "custom-pin",
  html: `<div style="background-color: ${color}; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7]
});

const userIcon = createIcon('#3b82f6'); // Blue (You)
const boothIcon = createIcon('#ef4444'); // Red (Booth)

// --- 2. Camera Helper ---
function RecenterMap({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo([lat, lng], 14, { duration: 1.5 });
  }, [lat, lng, map]);
  return null;
}

export default function MapComponent() {
  const [mapId, setMapId] = useState("map-init");
  const [isMounted, setIsMounted] = useState(false);
  
  const [position, setPosition] = useState<[number, number]>([28.6139, 77.2090]); 
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [loadingBooths, setLoadingBooths] = useState(false);
  const [usingSimulation, setUsingSimulation] = useState(false);
  const [booths, setBooths] = useState<any[]>([]);

  useEffect(() => {
    setIsMounted(true);
    setMapId(`map-${Date.now()}`);
  }, []);

  // --- 3. DYNAMIC SIMULATOR (Fallback) ---
  const generateRandomBooths = (centerLat: number, centerLng: number) => {
    const newBooths = [];
    const names = ["Govt. Primary School", "St. Xavier's College", "Community Centre Hall", "Municipal Corporation Office", "Public Library", "City High School"];
    const count = Math.floor(Math.random() * 3) + 4; 

    for (let i = 0; i < count; i++) {
      const latOffset = (Math.random() * 0.014) - 0.007; 
      const lngOffset = (Math.random() * 0.014) - 0.007;
      newBooths.push({
        id: `sim-${Date.now()}-${i}`,
        lat: centerLat + latOffset,
        lng: centerLng + lngOffset,
        name: names[Math.floor(Math.random() * names.length)],
        type: "POLLING STATION",
        wait: Math.random() > 0.6 ? "High" : Math.random() > 0.3 ? "Medium" : "Low"
      });
    }
    return newBooths;
  };

  // --- 4. DATA FETCHER (Relaxed Timeout & Polygon Support) ---
  const fetchNearbyBooths = async (lat: number, lon: number) => {
    setLoadingBooths(true);
    setUsingSimulation(false);
    setBooths([]); 

    // 10s timeout, targeting nodes and ways, using 'out center' for accurate building pins
    const query = `[out:json][timeout:10];(node["amenity"~"school|college|community_centre"](around:3000,${lat},${lon});way["amenity"~"school|college|community_centre"](around:3000,${lat},${lon}););out center 12;`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); 
      
      const res = await fetch(`/api/booths?lat=${lat}&lon=${lon}`, {
        signal: controller.signal,
        headers: {
            'Accept': 'application/json'
        }
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
         throw new Error(`API responded with status: ${res.status}`);
      }

      const data = await res.json();
      
      if (data.elements && data.elements.length > 0) {
        const realBooths = data.elements.map((place: any, index: number) => {
          // Extract coordinates whether it's a single point (node) or a large building (way center)
          const itemLat = place.lat || (place.center && place.center.lat);
          const itemLng = place.lon || (place.center && place.center.lon);
          
          if (!itemLat || !itemLng) return null;

          return {
            id: place.id,
            lat: itemLat,
            lng: itemLng,
            name: place.tags?.name || "Govt. Polling Booth (Public Facility)", 
            type: "OFFICIAL BOOTH",
            wait: index % 3 === 0 ? "High" : index % 3 === 1 ? "Medium" : "Low"
          };
        }).filter(Boolean);

        if (realBooths.length > 0) {
          setBooths(realBooths);
        } else {
          throw new Error("Found places but no valid coordinates.");
        }
      } else {
        throw new Error("No real data found in this radius.");
      }
    } catch (error: any) {
      console.error("OVERPASS API ERROR:", error.message || error);
      setUsingSimulation(true);
      setBooths(generateRandomBooths(lat, lon));
    } finally {
      setLoadingBooths(false);
    }
  };

  // --- 5. SEARCH LOGIC ---
  const handleSearchInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    if (query.length > 2) {
      searchTimeoutRef.current = setTimeout(async () => {
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&addressdetails=1&limit=5`);
          const data = await res.json();
          setSuggestions(data);
          setShowSuggestions(true);
        } catch (err) {
          console.error("Autosuggest error", err);
        }
      }, 300);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  };

  const selectSuggestion = (suggestion: any) => {
    setSearchQuery(suggestion.display_name.split(',')[0]); 
    setShowSuggestions(false);
    const lat = parseFloat(suggestion.lat);
    const lon = parseFloat(suggestion.lon);
    
    setPosition([lat, lon]);
    // The useEffect will automatically catch this position change and trigger the fetch
  };

  const handleManualSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suggestions.length) return;
    selectSuggestion(suggestions[0]); 
  };

  // Trigger search on mount AND whenever position changes (via GPS or Search)
  useEffect(() => {
    if (isMounted) {
      fetchNearbyBooths(position[0], position[1]);
    }
  }, [isMounted, position]);

  if (!isMounted) {
    return (
      <div className="h-full w-full bg-slate-100 flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-blue-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      
      {/* Search Bar */}
      <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-[400] w-[90%] max-w-md">
        <form onSubmit={handleManualSearch} className="relative flex shadow-xl rounded-lg bg-white border border-gray-200">
          <input 
            type="text" 
            placeholder="Search City or Area..." 
            className="flex-1 px-5 py-3 text-sm text-gray-700 outline-none rounded-l-lg"
            value={searchQuery}
            onChange={handleSearchInput}
            onFocus={() => { if(suggestions.length) setShowSuggestions(true); }}
          />
          {searchQuery && (
            <button 
              type="button" 
              onClick={() => { setSearchQuery(''); setSuggestions([]); }}
              className="px-2 text-gray-400 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-5 rounded-r-lg flex items-center justify-center">
            <Search className="h-5 w-5" />
          </button>

          {showSuggestions && suggestions.length > 0 && (
            <ul className="absolute top-full left-0 right-0 mt-1 bg-white rounded-lg shadow-xl border border-gray-100 max-h-60 overflow-y-auto divide-y divide-gray-100">
              {suggestions.map((s: any) => (
                <li key={s.place_id} onClick={() => selectSuggestion(s)} className="px-4 py-3 text-xs text-gray-700 hover:bg-blue-50 cursor-pointer flex items-center transition">
                  <MapPin className="h-3 w-3 mr-2 text-gray-400" />
                  <span className="truncate">{s.display_name}</span>
                </li>
              ))}
            </ul>
          )}
        </form>
      </div>

      {/* Locate Button */}
      <button 
        className="absolute bottom-6 right-4 z-[400] bg-white p-3 rounded-full shadow-lg border border-gray-200 hover:bg-gray-50 text-blue-600"
        onClick={() => {
          navigator.geolocation.getCurrentPosition((pos) => {
             const { latitude, longitude } = pos.coords;
             setPosition([latitude, longitude]);
          }, (err) => {
             console.error("Geolocation failed, executing search for current center position fallback.", err);
             // Manually trigger if GPS fails, otherwise useEffect handles it
             fetchNearbyBooths(position[0], position[1]);
          }, { enableHighAccuracy: true });
        }}
        title="Find My Location"
      >
        <Navigation className="h-6 w-6" />
      </button>

      {/* Loading Badge */}
      {loadingBooths && (
        <div className="absolute top-4 right-4 z-[400] bg-white px-3 py-1 rounded-full shadow text-xs font-bold text-blue-600 flex items-center animate-pulse border border-blue-100">
          <Loader2 className="h-3 w-3 mr-2 animate-spin" />
          Scanning...
        </div>
      )}
      
      {/* Demo Mode Badge */}
      {usingSimulation && !loadingBooths && (
        <div className="absolute top-4 right-4 z-[400] bg-yellow-50 px-3 py-1 rounded-full shadow text-[10px] font-bold text-yellow-700 flex items-center border border-yellow-200">
          <AlertCircle className="h-3 w-3 mr-1" />
          Demo Mode
        </div>
      )}

      <MapContainer 
        key={mapId}
        center={position} 
        zoom={14} 
        scrollWheelZoom={true} 
        style={{ height: '100%', width: '100%', zIndex: 0 }}
      >
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <RecenterMap lat={position[0]} lng={position[1]} />
        <Circle center={position} radius={600} pathOptions={{ color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.1 }} />
        <Marker position={position} icon={userIcon}>
          <Popup>Center of Search</Popup>
        </Marker>
        {booths.map((booth) => (
          <Marker key={booth.id} position={[booth.lat, booth.lng]} icon={boothIcon}>
            <Popup>
              <div className="p-1 min-w-[160px]">
                <div className="flex items-center gap-2 mb-1">
                  <MapPin className="h-4 w-4 text-red-500" />
                  <h3 className="font-bold text-gray-800 text-sm leading-tight">{booth.name}</h3>
                </div>
                <p className="text-[10px] text-gray-500 font-bold bg-gray-100 px-1 rounded w-fit mb-2">{booth.type}</p>
                <div className="flex justify-between items-center bg-slate-50 p-2 rounded border">
                  <span className="text-xs text-gray-500">Wait Time:</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded text-white ${booth.wait === 'Low' ? 'bg-green-500' : booth.wait === 'High' ? 'bg-red-500' : 'bg-yellow-500'}`}>{booth.wait}</span>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}