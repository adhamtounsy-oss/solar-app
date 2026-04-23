export const EGYPT_TARIFF_TIERS = [
  { limit:50,       rate:0.68,  label:"Tier 1 (0–50 kWh)"    },
  { limit:100,      rate:0.78,  label:"Tier 2 (51–100 kWh)"  },
  { limit:200,      rate:0.95,  label:"Tier 3 (101–200 kWh)" },
  { limit:350,      rate:1.55,  label:"Tier 4 (201–350 kWh)" },
  { limit:650,      rate:1.95,  label:"Tier 5 (351–650 kWh)" },
  { limit:1000,     rate:2.10,  label:"Tier 6 (651–1000 kWh)"},
  { limit:Infinity, rate:2.23,  label:"Tier 7 (>1000 kWh)"  },  // EgyptERA Sep 2024
];

/**
 * Tiered monthly saving — generic, works with any tariff tier array.
 * Displaced kWh are valued top-down (highest tier first).
 * @param {number}   consumedKwh  Monthly grid consumption
 * @param {number}   savedKwh     kWh displaced by solar this month
 * @param {number}   escFactor    Cumulative tariff escalation multiplier
 * @param {Array}    tiers        Tariff tier array (defaults to Egypt tiers)
 */
export function tieredMonthlySaving(consumedKwh, savedKwh, escFactor, tiers) {
  const esc  = escFactor || 1;
  const tArr = (tiers && tiers.length) ? tiers : EGYPT_TARIFF_TIERS;
  let saving   = 0;
  let remaining = Math.min(savedKwh, consumedKwh);
  let bracket   = consumedKwh;
  for (let i = tArr.length - 1; i >= 0 && remaining > 0; i--) {
    const lower   = i > 0 ? tArr[i-1].limit : 0;
    const inBlock = Math.max(0, Math.min(bracket, tArr[i].limit) - lower);
    const take    = Math.min(inBlock, remaining);
    saving   += take * tArr[i].rate * esc;
    remaining -= take;
    bracket   = lower;
  }
  return saving;
}
