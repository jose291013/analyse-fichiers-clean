const PT_PER_INCH = 72;
const MM_PER_INCH = 25.4;

function mmToPt(valueMm) {
  return (Number(valueMm) * PT_PER_INCH) / MM_PER_INCH;
}

function ptToMm(valuePt) {
  return (Number(valuePt) * MM_PER_INCH) / PT_PER_INCH;
}

function round(value, decimals = 3) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function toPositiveNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toNonNegativeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

module.exports = {
  PT_PER_INCH,
  MM_PER_INCH,
  mmToPt,
  ptToMm,
  round,
  toPositiveNumber,
  toNonNegativeNumber,
};
