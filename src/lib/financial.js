export const EGYPT_TARIFF_TIERS = [
  { limit:50,       rate:0.68,  label:"Tier 1 (0–50 kWh)"    },
  { limit:100,      rate:0.78,  label:"Tier 2 (51–100 kWh)"  },
  { limit:200,      rate:0.95,  label:"Tier 3 (101–200 kWh)" },
  { limit:350,      rate:1.55,  label:"Tier 4 (201–350 kWh)" },










  { limit:650,      rate:1.95,  label:"Tier 5 (351–650 kWh)" },
  { limit:1000,     rate:2.10,  label:"Tier 6 (651–1000 kWh)"},
  { limit:Infinity, rate:2.58,  label:"Tier 7 (>1000 kWh)"  }, ];

export function tieredMonthlySaving(consumedKwh, savedKwh, escFactor) {
  const esc = escFactor || 1;
  let saving = 0;
  let remaining = Math.min(savedKwh, consumedKwh);
  let bracket = consumedKwh;
  for (let i = EGYPT_TARIFF_TIERS.length - 1; i >= 0 && remaining > 0; i--) {
    const lower   = i > 0 ? EGYPT_TARIFF_TIERS[i-1].limit : 0;
    const inBlock = Math.max(0, Math.min(bracket, EGYPT_TARIFF_TIERS[i].limit) - lower);
    const take    = Math.min(inBlock, remaining);
    saving   += take * EGYPT_TARIFF_TIERS[i].rate * esc;
    remaining -= take;
    bracket   = lower;
  }
  return saving;
}
