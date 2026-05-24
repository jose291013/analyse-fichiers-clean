const { ptToMm, round } = require('./units');

function normalizeBox(rawBox) {
  if (!Array.isArray(rawBox) || rawBox.length !== 4) return null;

  const values = rawBox.map(Number);
  if (values.some((value) => !Number.isFinite(value))) return null;

  const [x1, y1, x2, y2] = values;
  if (x2 <= x1 || y2 <= y1) return null;

  return {
    x1,
    y1,
    x2,
    y2,
    width: x2 - x1,
    height: y2 - y1,
  };
}

function boxToMm(box) {
  if (!box) return null;

  return {
    x1Mm: round(ptToMm(box.x1), 3),
    y1Mm: round(ptToMm(box.y1), 3),
    x2Mm: round(ptToMm(box.x2), 3),
    y2Mm: round(ptToMm(box.y2), 3),
    widthMm: round(ptToMm(box.width), 3),
    heightMm: round(ptToMm(box.height), 3),
  };
}

function findPrimaryBox(pageData) {
  const trimBox = normalizeBox(pageData['/TrimBox']);
  const mediaBox = normalizeBox(pageData['/MediaBox']);

  if (trimBox) return { usedBox: 'TrimBox', box: trimBox };
  if (mediaBox) return { usedBox: 'MediaBox', box: mediaBox };

  return null;
}

function calculateBleed(trimBox, bleedBox) {
  const safeTrimBox = trimBox || null;
  const safeBleedBox = bleedBox || null;

  if (!safeTrimBox || !safeBleedBox) {
    return {
      hasBleedBox: Boolean(safeBleedBox),
      hasBleed: false,
      topMm: 0,
      rightMm: 0,
      bottomMm: 0,
      leftMm: 0,
      minBleedMm: 0,
      maxBleedMm: 0,
      isSymmetric: false,
      note: safeBleedBox ? 'TrimBox introuvable.' : 'BleedBox introuvable.',
    };
  }

  const leftMm = Math.max(0, round(ptToMm(safeTrimBox.x1 - safeBleedBox.x1), 3));
  const bottomMm = Math.max(0, round(ptToMm(safeTrimBox.y1 - safeBleedBox.y1), 3));
  const rightMm = Math.max(0, round(ptToMm(safeBleedBox.x2 - safeTrimBox.x2), 3));
  const topMm = Math.max(0, round(ptToMm(safeBleedBox.y2 - safeTrimBox.y2), 3));
  const values = [topMm, rightMm, bottomMm, leftMm];
  const minBleedMm = round(Math.min(...values), 3);
  const maxBleedMm = round(Math.max(...values), 3);
  const hasBleed = minBleedMm > 0;
  const isSymmetric = values.every((value) => Math.abs(value - minBleedMm) < 0.01);

  return {
    hasBleedBox: true,
    hasBleed,
    topMm,
    rightMm,
    bottomMm,
    leftMm,
    minBleedMm,
    maxBleedMm,
    isSymmetric,
    note: hasBleed ? null : 'BleedBox identique ou inférieure à la TrimBox.',
  };
}

function summarizePdfPageBoxes(pageData) {
  const mediaBox = normalizeBox(pageData['/MediaBox']);
  const cropBox = normalizeBox(pageData['/CropBox']);
  const bleedBox = normalizeBox(pageData['/BleedBox']);
  const trimBox = normalizeBox(pageData['/TrimBox']);
  const artBox = normalizeBox(pageData['/ArtBox']);
  const primary = findPrimaryBox(pageData);

  if (!primary) {
    throw new Error('Aucune box valide trouvée dans le PDF');
  }

  const dimensions = {
    width_mm: round(ptToMm(primary.box.width), 3),
    height_mm: round(ptToMm(primary.box.height), 3),
  };

  return {
    usedBox: primary.usedBox,
    dimensions,
    boxes: {
      mediaBox: boxToMm(mediaBox),
      cropBox: boxToMm(cropBox),
      bleedBox: boxToMm(bleedBox),
      trimBox: boxToMm(trimBox),
      artBox: boxToMm(artBox),
    },
    bleed: calculateBleed(trimBox, bleedBox),
  };
}

module.exports = {
  normalizeBox,
  summarizePdfPageBoxes,
};
