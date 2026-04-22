import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { C } from "../constants/index.js";

// Custom SVG pin — avoids Vite/Leaflet asset-path issues with default images
const PIN_ICON = L.divIcon({
  html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 40" width="28" height="40">
    <path d="M14 0C6.3 0 0 6.3 0 14c0 10.5 14 26 14 26S28 24.5 28 14C28 6.3 21.7 0 14 0z"
          fill="#22d3ee" stroke="white" stroke-width="2"/>
    <circle cx="14" cy="14" r="5" fill="white"/>
  </svg>`,
  iconSize: [28, 40],
  iconAnchor: [14, 40],
  className: "",
});

const NOMINATIM = "https://nominatim.openstreetmap.org";
const OPEN_ELEV = "https://api.open-elevation.com/api/v1/lookup";

async function reverseGeocode(lat, lon) {
  try {
    const r = await fetch(`${NOMINATIM}/reverse?lat=${lat}&lon=${lon}&format=json`, {
      headers: { "Accept-Language": "en" },
    });
    const d = await r.json();
    return d.display_name || "";
  } catch { return ""; }
}

async function fetchElevation(lat, lon) {
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(`${OPEN_ELEV}?locations=${lat},${lon}`, { signal: ctrl.signal });
    const d = await r.json();
    return d.results?.[0]?.elevation ?? null;
  } catch { return null; }
}

export default function LocationPickerModal({ initialLat, initialLon, onConfirm, onCancel }) {
  const containerRef = useRef(null);
  const mapRef       = useRef(null);
  const markerRef    = useRef(null);
  const pinCbRef     = useRef(null);   // stable ref to latest handlePin

  const [lat,          setLat]          = useState(initialLat || 30.06);
  const [lon,          setLon]          = useState(initialLon || 31.45);
  const [locationName, setLocationName] = useState("");
  const [elevationM,   setElevationM]   = useState(null);
  const [elevLoading,  setElevLoading]  = useState(false);
  const [query,        setQuery]        = useState("");
  const [results,      setResults]      = useState([]);
  const [searching,    setSearching]    = useState(false);
  const searchTimer = useRef(null);

  // Keep pinCbRef in sync with latest handlePin without re-creating map listeners
  const handlePin = useCallback(async (newLat, newLon) => {
    const roundedLat = Math.round(newLat * 1e6) / 1e6;
    const roundedLon = Math.round(newLon * 1e6) / 1e6;
    setLat(roundedLat);
    setLon(roundedLon);
    markerRef.current?.setLatLng([roundedLat, roundedLon]);
    setLocationName("Fetching address…");
    setElevationM(null);
    setElevLoading(true);
    const [name, elev] = await Promise.all([
      reverseGeocode(roundedLat, roundedLon),
      fetchElevation(roundedLat, roundedLon),
    ]);
    setLocationName(name);
    setElevationM(elev);
    setElevLoading(false);
  }, []);

  useEffect(() => { pinCbRef.current = handlePin; }, [handlePin]);

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { center: [initialLat || 30.06, initialLon || 31.45], zoom: 13 });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    const marker = L.marker([initialLat || 30.06, initialLon || 31.45], {
      icon: PIN_ICON,
      draggable: true,
    }).addTo(map);

    marker.on("dragend", () => {
      const pos = marker.getLatLng();
      pinCbRef.current(pos.lat, pos.lng);
    });
    map.on("click", e => pinCbRef.current(e.latlng.lat, e.latlng.lng));

    mapRef.current   = map;
    markerRef.current = marker;

    // Seed initial reverse geocode + elevation
    pinCbRef.current(initialLat || 30.06, initialLon || 31.45);

    return () => {
      map.remove();
      mapRef.current    = null;
      markerRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Nominatim search with 400 ms debounce
  useEffect(() => {
    if (!query.trim() || query.length < 3) { setResults([]); return; }
    clearTimeout(searchTimer.current);
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const r = await fetch(
          `${NOMINATIM}/search?q=${encodeURIComponent(query)}&format=json&limit=5`,
          { headers: { "Accept-Language": "en" } }
        );
        setResults(await r.json());
      } catch { setResults([]); }
      setSearching(false);
    }, 400);
    return () => clearTimeout(searchTimer.current);
  }, [query]);

  const flyTo = useCallback((result) => {
    const nLat = parseFloat(result.lat);
    const nLon = parseFloat(result.lon);
    mapRef.current?.flyTo([nLat, nLon], 15);
    pinCbRef.current(nLat, nLon);
    setQuery(result.display_name);
    setResults([]);
  }, []);

  const overlay = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)",
    zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center",
    padding: 16,
  };
  const modal = {
    background: C.card, border: `1px solid ${C.border}`, borderRadius: 16,
    width: "min(720px,100%)", height: "min(640px,90vh)",
    display: "flex", flexDirection: "column", overflow: "hidden",
    boxShadow: "0 24px 64px #000a",
  };

  return (
    <div style={overlay} onClick={e => e.target === e.currentTarget && onCancel()}>
      <div style={modal}>

        {/* Header */}
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: C.text }}>
            📍 Pick Site Location
          </div>
          <button onClick={onCancel} style={{ background: "none", border: "none",
            color: C.muted, fontSize: 18, cursor: "pointer", lineHeight: 1 }}>✕</button>
        </div>

        {/* Search */}
        <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.border}`, position: "relative" }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search city, address or landmark…"
            style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px",
              background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8,
              color: C.text, fontSize: 13, outline: "none" }}
          />
          {searching && (
            <div style={{ position: "absolute", right: 26, top: 18,
              fontSize: 11, color: C.muted }}>searching…</div>
          )}
          {results.length > 0 && (
            <div style={{ position: "absolute", left: 16, right: 16, top: "100%",
              background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
              zIndex: 9999, maxHeight: 220, overflowY: "auto",
              boxShadow: "0 8px 24px #000a" }}>
              {results.map((res, i) => (
                <div key={i} onClick={() => flyTo(res)}
                  style={{ padding: "9px 14px", cursor: "pointer", fontSize: 12,
                    color: C.text, borderBottom: i < results.length - 1 ? `1px solid ${C.border}` : "none" }}
                  onMouseEnter={e => e.currentTarget.style.background = C.bg}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <div style={{ fontWeight: 600 }}>{res.name || res.display_name.split(",")[0]}</div>
                  <div style={{ color: C.muted, fontSize: 10, marginTop: 2 }}>
                    {res.display_name}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Map */}
        <div ref={containerRef} style={{ flex: 1, minHeight: 0 }} />

        {/* Footer */}
        <div style={{ padding: "12px 20px", borderTop: `1px solid ${C.border}`,
          background: C.bg, display: "flex", alignItems: "center",
          justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.accent,
              fontVariantNumeric: "tabular-nums" }}>
              {lat.toFixed(5)}°N, {lon.toFixed(5)}°E
              {elevationM != null && !elevLoading && (
                <span style={{ color: C.muted, fontWeight: 400, marginLeft: 10 }}>
                  · {Math.round(elevationM)} m elev.
                </span>
              )}
              {elevLoading && (
                <span style={{ color: C.muted, fontWeight: 400, marginLeft: 10 }}>
                  · fetching elevation…
                </span>
              )}
            </div>
            {locationName && locationName !== "Fetching address…" && (
              <div style={{ fontSize: 10, color: C.muted, marginTop: 3,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {locationName}
              </div>
            )}
            {locationName === "Fetching address…" && (
              <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>
                Fetching address…
              </div>
            )}
            <div style={{ fontSize: 9, color: "#475569", marginTop: 3 }}>
              Click map or drag pin to adjust · Drag to fine-tune position
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button onClick={onCancel}
              style={{ padding: "9px 18px", background: C.border, border: "none",
                borderRadius: 8, color: C.text, fontWeight: 700, fontSize: 12,
                cursor: "pointer" }}>
              Cancel
            </button>
            <button
              onClick={() => onConfirm(lat, lon, locationName, elevationM)}
              style={{ padding: "9px 20px", background: C.accent, border: "none",
                borderRadius: 8, color: C.bg, fontWeight: 800, fontSize: 12,
                cursor: "pointer" }}>
              Use this location
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
