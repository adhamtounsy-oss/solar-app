export const C = {
  bg:"#0f172a", card:"#1e293b", border:"#334155",
  text:"#e2e8f0", muted:"#94a3b8", accent:"#22d3ee",
  yellow:"#f59e0b", green:"#10b981", red:"#ef4444",
  purple:"#8b5cf6", blue:"#3b82f6", pink:"#f472b6", orange:"#fb923c", };

export const CAIRO_TMY_FALLBACK = [
  { m:"Jan", psh:5.28, tAmb:13.5, days:31 },
  { m:"Feb", psh:5.90, tAmb:15.0, days:28 },
  { m:"Mar", psh:6.83, tAmb:18.5, days:31 },
  { m:"Apr", psh:7.39, tAmb:22.5, days:30 },
  { m:"May", psh:7.50, tAmb:27.0, days:31 },
  { m:"Jun", psh:7.52, tAmb:29.5, days:30 },
  { m:"Jul", psh:7.50, tAmb:31.0, days:31 },
  { m:"Aug", psh:7.43, tAmb:31.5, days:31 },
  { m:"Sep", psh:7.05, tAmb:28.5, days:30 },
  { m:"Oct", psh:6.27, tAmb:24.0, days:31 },
  { m:"Nov", psh:5.43, tAmb:18.5, days:30 },
  { m:"Dec", psh:4.97, tAmb:14.5, days:31 },];

export const DESIGN_PSH = 4.57; // Dec P90 PSH — governs array sizing

export const CAIRO_SOILING = [0.02,0.02,0.09,0.11,0.08,0.02,0.02,0.02,0.02,0.03,0.02,0.02];

export const P90_FACTOR = 0.92;

export const SIGMA_IRR   = 0.050;
export const SIGMA_MODEL = 0.030;
export const SIGMA_TOT   = Math.sqrt(SIGMA_IRR*SIGMA_IRR + SIGMA_MODEL*SIGMA_MODEL); // ≈ 0.0583

export const WIN_HRS = [4, 7, 6];
export const WIN_START = [6, 10, 17];
export const WIN_END   = [10, 17, 23];
