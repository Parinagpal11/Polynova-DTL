export const SAFETY_BOUNDS = {
  temp_f: { low: 35, high: 95 },
  rh_pct: { low: 30, high: 95 },
  soil_moisture_pct: { low: 20, high: 60 }
};

export function clamp(val, low, high) {
  return Math.max(low, Math.min(high, val));
}

export function blendStep(previous, next, maxStep = 3) {
  if (previous === null || previous === undefined) return next;
  if (Math.abs(next - previous) <= maxStep) return next;
  return previous + Math.sign(next - previous) * maxStep;
}
