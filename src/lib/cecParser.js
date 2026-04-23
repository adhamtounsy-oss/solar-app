/**
 * NREL SAM CEC Modules.csv parser — maps SAM column names to app panel schema.
 * CEC source: github.com/NREL/SAM/blob/develop/deploy/libraries/CEC%20Modules.csv
 *
 * Key field notes:
 *   alpha_sc   — Isc temperature coefficient in A/°C (absolute)
 *   beta_oc    — Voc temperature coefficient in V/°C (absolute, negative)
 *   gamma_pmp  — Pmax temperature coefficient in %/°C (negative)
 *   a_ref      — n × Ns × Vth at 25°C (V); Vth = kT/q = 0.025693 V
 *   I_L_ref    — photocurrent at STC (A)
 *   I_o_ref    — dark saturation current at STC (A), typically ~1e-10 to 1e-12
 *   R_s        — series resistance (Ω)
 *   R_sh_ref   — shunt resistance at STC (Ω)
 */

const _COLS = {
  name:    'Name', mfr: 'Manufacturer', tech: 'Technology', bif: 'Bifacial',
  stc:     'STC',  ns:  'N_s',
  isc:     'I_sc_ref', voc: 'V_oc_ref', imp: 'I_mp_ref', vmp: 'V_mp_ref',
  alpha:   'alpha_sc', beta: 'beta_oc', noct: 'T_NOCT',
  gamma:   'gamma_pmp', // SAM header — some older versions use 'gamma_r'
  a_ref:   'a_ref', il:  'I_L_ref', io: 'I_o_ref', rs: 'R_s', rsh: 'R_sh_ref',
};

const _BRAND_MAP = [
  "JA Solar","Jinko Solar","LONGi","Trina Solar","Canadian Solar",
  "REC","Hanwha Q CELLS","Meyer Burger","SunPower","Panasonic",
  "Risen Energy","Astronergy","Seraphim","DAH Solar","Aiko Solar",
];

function _detectBrand(name, mfr) {
  for (const b of _BRAND_MAP) {
    if (name.toLowerCase().includes(b.toLowerCase())) return b;
    if (mfr.toLowerCase().includes(b.toLowerCase())) return b;
  }
  return mfr.split(/[\s,]/)[0] || 'Unknown';
}

function _extractModel(name, brand) {
  let s = name.replace(/\s*\[\d{4}\].*$/, '').trim();
  const idx = s.toLowerCase().indexOf(brand.toLowerCase());
  if (idx >= 0) s = s.slice(idx + brand.length).trim();
  return s || name;
}

function _safeId(name) {
  return 'CEC_' + name.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 50);
}

/**
 * Convert a single parsed SAM CSV row (object with SAM column names) to app panel schema.
 * Returns null if required CEC params are missing or invalid.
 */
export function cecToPanelSchema(row) {
  const get = (col) => parseFloat(row[col] || row[_COLS[col]] || 0) || 0;
  const name  = (row['Name'] || row.name || '').trim();
  const mfr   = (row['Manufacturer'] || row.mfr || '').trim();
  const stc   = get('STC')  || get('stc');
  const a     = get('a_ref');
  const il    = get('I_L_ref');
  const io    = get('I_o_ref');
  const rs    = get('R_s');
  const rsh   = get('R_sh_ref');
  const isc   = get('I_sc_ref');
  const voc   = get('V_oc_ref');
  const imp   = get('I_mp_ref');
  const vmp   = get('V_mp_ref');
  const alpha = get('alpha_sc');          // A/°C absolute
  const beta  = get('beta_oc');           // V/°C absolute (negative)
  const gamma = get('gamma_pmp') || get('gamma_r');  // %/°C (negative)
  const noct  = get('T_NOCT') || 45;
  const ns    = Math.round(get('N_s') || 72);
  const bif   = (row['Bifacial'] || '0').trim() === '1';
  const tech  = (row['Technology'] || '').trim();

  if (!name || stc < 100) return null;
  if (a <= 0 || il <= 0 || io <= 0 || rs <= 0 || rsh <= 0) return null;
  if (isc <= 0 || voc <= 0) return null;
  if (gamma >= 0) return null;  // must be negative for Si

  const brand = _detectBrand(name, mfr);
  return {
    id:              _safeId(name),
    name,
    brand,
    model:           _extractModel(name, brand),
    wp:              Math.round(stc * 10) / 10,
    voc:             Math.round(voc * 100) / 100,
    vmp:             Math.round(vmp * 100) / 100,
    isc:             Math.round(isc * 1000) / 1000,
    imp:             Math.round(imp * 1000) / 1000,
    alphaIsc_AperK:  Math.round(alpha * 100000) / 100000,
    betaVoc_VperK:   Math.round(beta  * 10000)  / 10000,
    gammaPmax:       Math.round(gamma * 1000)   / 1000,
    noct:            Math.round(noct * 10) / 10,
    ns,
    cecA:            Math.round(a   * 10000) / 10000,
    cecIl:           Math.round(il  * 10000) / 10000,
    cecIo:           io,
    cecRs:           Math.round(rs  * 10000) / 10000,
    cecRsh:          Math.round(rsh * 100)   / 100,
    bifacial:        bif,
    technology:      tech,
    costUSD:         0,
    warranty25:      true,
  };
}

/**
 * Parse NREL SAM CEC Modules.csv text into app panel schema array.
 * Skips 'Units' row, invalid rows, and non-silicon technologies.
 */
export function parseSAMCecCSV(csvText) {
  const lines = csvText.split('\n');
  if (lines.length < 3) return [];
  const header = lines[0].split(',').map(h => h.trim());
  const results = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('Units')) continue;
    const vals = line.split(',');
    const row = {};
    header.forEach((h, j) => { row[h] = (vals[j] || '').trim(); });
    const tech = (row['Technology'] || '').toLowerCase();
    if (['thin','cdte','cigs','amorphous'].some(x => tech.includes(x))) continue;
    const panel = cecToPanelSchema(row);
    if (panel) results.push(panel);
  }
  return results;
}
