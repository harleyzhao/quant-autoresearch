import type { PhenologyParams, PhenologyState, AutumnPigment } from '../types.js';

/**
 * Simple climate model: daily mean temperature as a cosine of day-of-year, amplitude and
 * mean from latitude. Northern hemisphere peaks ~day 200; southern is phase-shifted.
 */
export function dailyTemperature(day: number, latitude: number): number {
  const lat = Math.abs(latitude);
  const mean = 27 - lat * 0.33; // ~27°C equator, ~11°C at 48°, ~7°C at 60°
  const amp = 1 + lat * 0.22; // seasonal swing grows with latitude (±11.6°C at 48°)
  const phase = latitude >= 0 ? 200 : 200 - 182.5;
  return mean + amp * Math.cos(((day - phase) / 365) * Math.PI * 2);
}

/** Growing degree days accumulated from Jan 1 to `day` (base 5°C). */
export function gddToDay(day: number, latitude: number): number {
  let g = 0;
  for (let d = 1; d <= day; d++) g += Math.max(0, dailyTemperature(d, latitude) - 5);
  return g;
}

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Canopy-level phenology state for a day of year. Per-leaf jitter is applied in leaves.ts. */
export function phenologyAt(p: PhenologyParams, dayOfYear: number, latitude: number): PhenologyState {
  const day = ((Math.round(dayOfYear) - 1) % 365 + 365) % 365 + 1;
  // southern hemisphere: shift calendar so that the species' day-based thresholds still mean "late in the season"
  const seasonDay = latitude >= 0 ? day : ((day + 182) % 365) + 1;
  const gdd = gddToDay(seasonDay, Math.abs(latitude));

  if (p.evergreen) {
    // evergreens: new flush expands after budburst, old foliage persists; slight winter bronzing
    const flush = gdd >= p.budburstGDD ? smooth((gdd - p.budburstGDD) / (p.budburstGDD * 0.6 + 1)) : 0;
    const winter = smooth((seasonDay - p.senescenceDay) / 60) * (1 - smooth((seasonDay - 330) / 40));
    return {
      expansion: 1, chlorophyll: 1 - 0.25 * winter, carotenoid: 0.3 * winter, anthocyanin: 0.1 * winter, browning: 0,
      shed: 0, stage: flush > 0 && flush < 1 ? 'expanding' : 'mature', gdd,
    };
  }

  let expansion = 0, chlorophyll = 0, carotenoid = 0, anthocyanin = 0, browning = 0, shed = 0;
  let stage: PhenologyState['stage'] = 'dormant';

  // Budburst is driven by heat sum; senescence and abscission by calendar (photoperiod proxy).
  if (gdd >= p.budburstGDD) {
    // find approximate budburst day to time expansion
    let bbDay = seasonDay;
    for (let d = 1; d <= seasonDay; d++) { if (gddToDay(d, Math.abs(latitude)) >= p.budburstGDD) { bbDay = d; break; } }
    const e = (seasonDay - bbDay) / Math.max(1, p.leafExpandDays);
    expansion = smooth(e);
    stage = e < 0.05 ? 'budburst' : e < 1 ? 'expanding' : 'mature';
    chlorophyll = expansion;
  }
  if (seasonDay >= p.senescenceDay && expansion > 0) {
    const s = smooth((seasonDay - p.senescenceDay) / Math.max(1, p.senescenceDays));
    chlorophyll = expansion * (1 - s);
    carotenoid = s;
    anthocyanin = s * s; // reds come later than yellows
    browning = smooth((seasonDay - p.senescenceDay - p.senescenceDays) / 30);
    stage = 'senescing';
  }
  if (seasonDay >= p.abscissionDay && expansion > 0) {
    shed = smooth((seasonDay - p.abscissionDay) / Math.max(1, p.abscissionDays));
    stage = shed >= 0.999 ? 'dormant' : 'shedding';
  }
  return { expansion, chlorophyll, carotenoid, anthocyanin, browning, shed, stage, gdd };
}

/** Mix leaf colour from pigment channels. Linear RGB. */
export function leafColor(
  base: [number, number, number], pigment: AutumnPigment,
  chlorophyll: number, carotenoid: number, anthocyanin: number, browning: number,
  out: Float32Array, o: number,
): void {
  const yellow: [number, number, number] = [0.85, 0.65, 0.08];
  const orange: [number, number, number] = [0.85, 0.32, 0.04];
  const red: [number, number, number] = [0.6, 0.05, 0.03];
  const brown: [number, number, number] = [0.28, 0.16, 0.06];
  let ar = yellow[0], ag = yellow[1], ab = yellow[2];
  if (pigment === 'orange') { ar = orange[0]; ag = orange[1]; ab = orange[2]; }
  else if (pigment === 'red') {
    const t = anthocyanin;
    ar = yellow[0] * (1 - t) + red[0] * t; ag = yellow[1] * (1 - t) + red[1] * t; ab = yellow[2] * (1 - t) + red[2] * t;
  } else if (pigment === 'brown') { ar = brown[0]; ag = brown[1]; ab = brown[2]; }
  else if (pigment === 'none') { ar = base[0]; ag = base[1]; ab = base[2]; }
  const c = Math.max(0, Math.min(1, chlorophyll));
  const k = Math.max(0, Math.min(1, carotenoid)) * (1 - c);
  const w = 1 - c - k;
  let r = base[0] * c + ar * k + ar * w * 0.6;
  let g = base[1] * c + ag * k + ag * w * 0.6;
  let b = base[2] * c + ab * k + ab * w * 0.6;
  const bw = Math.max(0, Math.min(1, browning));
  r = r * (1 - bw) + brown[0] * bw; g = g * (1 - bw) + brown[1] * bw; b = b * (1 - bw) + brown[2] * bw;
  out[o] = r; out[o + 1] = g; out[o + 2] = b;
}
