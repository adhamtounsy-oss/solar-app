export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const { lat, lon, tilt, azimuth } = req.query;
  if (!lat || !lon) {
    return res.status(400).json({ error: "lat and lon are required" });
  }

  const aspect = azimuth || 0;
  const angle  = tilt    || 25;

  const url =
    `https://re.jrc.ec.europa.eu/api/v5_2/seriescalc?` +
    `lat=${lat}&lon=${lon}&startyear=2020&endyear=2020` +
    `&pvcalculation=1&peakpower=1&loss=0&angle=${angle}&aspect=${aspect}` +
    `&outputformat=json&browser=0&components=1`;

  try {
    const upstream = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(55000),
    });
    const body = await upstream.text();
    res.status(upstream.status)
       .setHeader("Content-Type", "application/json")
       .send(body);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
