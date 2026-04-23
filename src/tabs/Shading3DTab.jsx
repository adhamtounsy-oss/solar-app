import { useState, useMemo, Suspense } from 'react';
import { C } from '../constants/index.js';
import { cardS } from '../components/ui/primitives.jsx';
import { computeShadingMatrix, recommendedSpacing } from '../lib/shading3d.js';
import RoofScene3D from '../components/RoofScene3D.jsx';

const MONTHS  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function KpiCard({ label, value, color, unit }) {
  return (
    <div style={{ background: C.card, borderRadius: 10, padding: '12px 14px',
      borderLeft: `4px solid ${color || C.accent}` }}>
      <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase',
        letterSpacing: 1, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: color || C.accent }}>
        {value}<span style={{ fontSize: 11, fontWeight: 400, marginLeft: 4 }}>{unit}</span>
      </div>
    </div>
  );
}

function ShadingBarChart({ monthlyLoss }) {
  if (!monthlyLoss || monthlyLoss.length < 12) return null;
  const max = Math.max(...monthlyLoss, 0.01);
  return (
    <div style={{ background: C.card, borderRadius: 10, padding: '14px 16px',
      border: `1px solid ${C.border}` }}>
      <div style={{ fontSize: 11, color: C.yellow, textTransform: 'uppercase',
        letterSpacing: 1, fontWeight: 700, marginBottom: 12 }}>
        Monthly Inter-Row Shading Loss
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 80 }}>
        {MONTHS.map((m, i) => {
          const pct = monthlyLoss[i] * 100;
          const h   = Math.round((monthlyLoss[i] / max) * 72);
          const clr = pct < 2 ? C.green : pct < 5 ? C.yellow : '#ef4444';
          return (
            <div key={m} style={{ flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: 2 }}>
              <div style={{ fontSize: 8, color: C.muted }}>{pct.toFixed(1)}%</div>
              <div style={{ width: '100%', height: h, background: clr,
                borderRadius: '2px 2px 0 0', minHeight: 2 }} />
              <div style={{ fontSize: 8, color: C.muted }}>{m}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Shading3DTab({ r, inp, upd, onShadingMatrixChange }) {
  const [month, setMonth] = useState(11);      // December — worst case
  const [hour,  setHour]  = useState(12);      // solar noon
  const [panelH, setPanelH] = useState(2.10);  // standard 72-cell panel length (m)
  const [manualSpacing, setManualSpacing] = useState(null); // null = use recommended

  const lat       = inp?.lat     || 30.06;
  const tiltDeg   = inp?.tiltDeg || 22;
  const azDeg     = inp?.azimuth || 0;
  const roofArea  = inp?.roofAreaM2 || 100;
  const roofD     = inp?.roofDepthM || Math.sqrt(roofArea);
  const roofW     = roofArea / roofD;

  const recommended = useMemo(() =>
    recommendedSpacing(panelH, tiltDeg, lat),
    [panelH, tiltDeg, lat]
  );
  const spacing = manualSpacing ?? recommended;

  // How many rows fit in the roof depth
  const nRows       = Math.max(1, Math.floor(roofD / spacing));
  const panelsPerRow = Math.max(1, Math.floor(roofW / 1.10));  // 1.05m + 5cm gap
  const totalPanels = nRows * panelsPerRow;

  const shadingResult = useMemo(() =>
    computeShadingMatrix(lat, tiltDeg, azDeg, panelH, spacing, nRows),
    [lat, tiltDeg, azDeg, panelH, spacing, nRows]
  );

  const { matrix, monthlyLoss, annualLossFrac, optSpacing } = shadingResult;
  const annualLossPct = (annualLossFrac * 100).toFixed(1);
  const monthLossPct  = (monthlyLoss[month] * 100).toFixed(1);

  function handleApply() {
    if (onShadingMatrixChange) onShadingMatrixChange(matrix);
  }

  return (
    <div>
      {/* Header card */}
      <div style={cardS(C.yellow)}>
        <div style={{ padding: '10px 16px', color: 'white', fontWeight: 800, fontSize: 13,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <span>3D Shading Analysis</span>
          <button onClick={handleApply}
            style={{ padding: '6px 16px', background: C.green, color: 'white', border: 'none',
              borderRadius: 8, fontWeight: 800, fontSize: 12, cursor: 'pointer' }}>
            Apply to Simulation
          </button>
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))',
        gap: 10, margin: '12px 0' }}>
        <KpiCard label="Annual Shading Loss" value={annualLossPct} unit="%" color="#ef4444" />
        <KpiCard label={`${MONTHS[month]} Loss`} value={monthLossPct} unit="%" color={C.yellow} />
        <KpiCard label="Recommended Pitch" value={recommended.toFixed(2)} unit="m" color={C.blue} />
        <KpiCard label="Rows × Cols" value={`${nRows} × ${panelsPerRow}`} color={C.accent} />
        <KpiCard label="Total Panels" value={totalPanels} color={C.green} />
      </div>

      {/* Geometry inputs */}
      <div style={{ background: C.card, borderRadius: 10, padding: '14px 16px',
        border: `1px solid ${C.border}`, marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: C.accent, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: 1, marginBottom: 10 }}>Array Geometry</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}>
          {[
            { label: 'Panel height along slope (m)', val: panelH,
              set: v => setPanelH(v), min: 0.5, max: 3.0, step: 0.05 },
            { label: 'Row spacing / pitch (m)', val: +(spacing.toFixed(2)),
              set: v => setManualSpacing(v), min: panelH, max: panelH * 6, step: 0.1,
              hint: `Recommended: ${recommended.toFixed(2)} m · Optimal (<2% loss): ${optSpacing.toFixed(2)} m` },
          ].map(f => (
            <div key={f.label}>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>{f.label}</div>
              <input type="number" min={f.min} max={f.max} step={f.step} value={f.val}
                onChange={e => f.set(parseFloat(e.target.value) || f.val)}
                style={{ width: '100%', background: '#0f172a', border: `1px solid ${C.border}`,
                  borderRadius: 4, color: C.text, fontSize: 13, padding: '5px 8px' }} />
              {f.hint && <div style={{ fontSize: 9, color: C.muted, marginTop: 3 }}>{f.hint}</div>}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 8 }}>
          <button onClick={() => setManualSpacing(null)}
            style={{ padding: '4px 12px', background: '#1e293b', border: `1px solid ${C.border}`,
              borderRadius: 6, color: C.muted, cursor: 'pointer', fontSize: 11 }}>
            Reset to Recommended
          </button>
        </div>
      </div>

      {/* Time controls */}
      <div style={{ background: C.card, borderRadius: 10, padding: '14px 16px',
        border: `1px solid ${C.border}`, marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: C.accent, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: 1, marginBottom: 10 }}>Sun Position</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>Month</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {MONTHS.map((m, i) => (
                <button key={m} onClick={() => setMonth(i)}
                  style={{ padding: '3px 7px', fontSize: 10, borderRadius: 4, cursor: 'pointer',
                    background: month === i ? C.yellow : '#1e293b',
                    color: month === i ? 'white' : C.muted,
                    border: `1px solid ${month === i ? C.yellow : C.border}`,
                    fontWeight: month === i ? 700 : 400 }}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>
              Hour (solar time): {hour}:00
            </div>
            <input type="range" min={6} max={18} step={1} value={hour}
              onChange={e => setHour(parseInt(e.target.value))}
              style={{ width: '100%', accentColor: C.yellow }} />
            <div style={{ display: 'flex', justifyContent: 'space-between',
              fontSize: 9, color: C.muted, marginTop: 2 }}>
              <span>6 AM</span><span>Noon</span><span>6 PM</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3D Canvas */}
      <div style={{ borderRadius: 10, overflow: 'hidden', marginBottom: 12,
        border: `1px solid ${C.border}`, height: 420 }}>
        <Suspense fallback={
          <div style={{ height: 420, background: '#0f172a', display: 'flex',
            alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 13 }}>
            Loading 3D scene…
          </div>
        }>
          <RoofScene3D
            inp={inp}
            month={month}
            hour={hour}
            shadingMatrix={matrix}
            rowSpacingM={spacing}
            panelsPerRow={panelsPerRow}
            nRows={nRows}
          />
        </Suspense>
      </div>
      <div style={{ fontSize: 10, color: C.muted, textAlign: 'center', marginBottom: 12 }}>
        Drag to orbit · Scroll to zoom · Blue = no shade · Orange/red = shaded
      </div>

      {/* Monthly loss chart */}
      <ShadingBarChart monthlyLoss={monthlyLoss} />

      {/* Shading matrix detail */}
      <div style={{ background: C.card, borderRadius: 10, padding: '14px 16px',
        border: `1px solid ${C.border}`, marginTop: 12 }}>
        <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: 1, marginBottom: 10 }}>
          Hourly Shading Matrix — {MONTHS[month]}
          <span style={{ fontWeight: 400, marginLeft: 8 }}>(fraction of array shaded)</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: `40px repeat(24,1fr)`, gap: 1,
            minWidth: 500, fontSize: 8 }}>
            <div style={{ color: C.muted, padding: '2px 4px' }}>Hour</div>
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} style={{ color: C.muted, textAlign: 'center', padding: '2px 0' }}>
                {h}
              </div>
            ))}
            <div style={{ color: C.muted, padding: '2px 4px', fontSize: 9 }}>Loss%</div>
            {Array.from({ length: 24 }, (_, h) => {
              const v = matrix[month]?.[h] || 0;
              const pct = v * 100;
              const bg = v === 0 ? '#0f172a'
                : v < 0.05 ? '#14532d'
                : v < 0.15 ? '#854d0e'
                : '#7f1d1d';
              return (
                <div key={h} style={{ background: bg, textAlign: 'center',
                  padding: '4px 0', color: v > 0 ? 'white' : C.border, borderRadius: 2 }}>
                  {v > 0 ? pct.toFixed(0) : '·'}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
