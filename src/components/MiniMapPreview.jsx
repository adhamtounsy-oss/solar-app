import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { C } from "../constants/index.js";

const PIN_ICON = L.divIcon({
  html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 28" width="20" height="28">
    <path d="M10 0C4.5 0 0 4.5 0 10c0 7.5 10 18 10 18S20 17.5 20 10C20 4.5 15.5 0 10 0z"
          fill="#22d3ee" stroke="white" stroke-width="2"/>
    <circle cx="10" cy="10" r="3.5" fill="white"/>
  </svg>`,
  iconSize: [20, 28],
  iconAnchor: [10, 28],
  className: "",
});

export default function MiniMapPreview({ lat, lon, locationName, elevationM, onOpen }) {
  const containerRef  = useRef(null);
  const mapRef        = useRef(null);
  const markerRef     = useRef(null);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [lat || 30.06, lon || 31.45],
      zoom: 11,
      zoomControl: false,
      dragging: false,
      touchZoom: false,
      doubleClickZoom: false,
      scrollWheelZoom: false,
      keyboard: false,
      attributionControl: false,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(map);
    const marker = L.marker([lat || 30.06, lon || 31.45], { icon: PIN_ICON }).addTo(map);
    mapRef.current    = map;
    markerRef.current = marker;
    return () => { map.remove(); mapRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync map view when lat/lon changes externally (typed inputs)
  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.setView([lat || 30.06, lon || 31.45], 11, { animate: false });
    markerRef.current?.setLatLng([lat || 30.06, lon || 31.45]);
  }, [lat, lon]);

  return (
    <div style={{ position: "relative", borderRadius: 10, overflow: "hidden",
      border: `1px solid ${hovered ? C.accent : C.border}`, cursor: "pointer",
      transition: "border-color 0.15s" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onOpen}>
      <div ref={containerRef} style={{ height: 130, width: "100%" }} />
      {/* Overlay: always-visible coordinate badge */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0,
        background: "rgba(15,23,42,0.85)", padding: "5px 10px",
        display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.accent,
            fontVariantNumeric: "tabular-nums" }}>
            {(lat||0).toFixed(4)}°N, {(lon||0).toFixed(4)}°E
            {elevationM != null && (
              <span style={{ color: C.muted, fontWeight: 400, marginLeft: 6 }}>
                · {Math.round(elevationM)} m
              </span>
            )}
          </div>
          {locationName && (
            <div style={{ fontSize: 9, color: C.muted,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              maxWidth: 220 }}>
              {locationName.split(",").slice(0, 2).join(",")}
            </div>
          )}
        </div>
        <div style={{ fontSize: 9, fontWeight: 700, color: hovered ? C.accent : C.muted,
          transition: "color 0.15s", whiteSpace: "nowrap", marginLeft: 8 }}>
          {hovered ? "Change ›" : "📍 Map"}
        </div>
      </div>
    </div>
  );
}
