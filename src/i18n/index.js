export const I18N = {
  en: {
    dashboard:"Dashboard", solar:"Solar Resource", sizing:"System Sizing",
    financial:"Financial", sld:"SLD", bom:"Bill of Materials",
    proposal:"Proposal", optimiser:"Optimiser", validation:"Validation",
    fetchPvgis:"Fetch PVGIS Data", systemSize:"System Size",
    annualYield:"Annual Yield", payback:"Payback Period", irr:"IRR",
    selfConsumption:"Self Consumption", batterySize:"Battery Size",
    panelCount:"Panel Count", warnings:"Warnings",
    p50Yield:"P50 Yield", p90Yield:"P90 Yield", yieldDist:"Yield Distribution",
    monteCarlo:"Monte Carlo", tiltSweep:"Tilt / Azimuth Sweep",
    optimalTilt:"Optimal Tilt", nasaCheck:"NASA POWER Cross-Check",
    spdSizing:"Lightning / SPD Sizing", optimizerAnalysis:"Optimizer NPV",
    netMetering:"Net Metering", exportRevenue:"Export Revenue",
    language:"Language", clientMode:"Client Mode", lang_ar:"عربي",
  },
  ar: {
    p50Yield:"إنتاج P50", p90Yield:"إنتاج P90", yieldDist:"توزيع الإنتاج",
    language:"اللغة", clientMode:"وضع العرض للعميل", lang_ar:"English",
  }
};
/** Translate key — falls back to English when key missing in target lang */export function T(lang, key) {
  return (I18N[lang] && I18N[lang][key]) || (I18N.en && I18N.en[key]) || key;
}
