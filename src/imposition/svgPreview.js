const { round } = require('./units');

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function svgCropMarks(placement, sheetHeightMm, options = {}) {
  const markLength = Number(options.markLengthMm ?? 4);
  const x = placement.x;
  const y = sheetHeightMm - placement.y - placement.height;
  const w = placement.width;
  const h = placement.height;

  return [
    `<line x1="${round(x - markLength)}" y1="${round(y)}" x2="${round(x)}" y2="${round(y)}" />`,
    `<line x1="${round(x)}" y1="${round(y - markLength)}" x2="${round(x)}" y2="${round(y)}" />`,
    `<line x1="${round(x + w)}" y1="${round(y)}" x2="${round(x + w + markLength)}" y2="${round(y)}" />`,
    `<line x1="${round(x + w)}" y1="${round(y - markLength)}" x2="${round(x + w)}" y2="${round(y)}" />`,
    `<line x1="${round(x - markLength)}" y1="${round(y + h)}" x2="${round(x)}" y2="${round(y + h)}" />`,
    `<line x1="${round(x)}" y1="${round(y + h)}" x2="${round(x)}" y2="${round(y + h + markLength)}" />`,
    `<line x1="${round(x + w)}" y1="${round(y + h)}" x2="${round(x + w + markLength)}" y2="${round(y + h)}" />`,
    `<line x1="${round(x + w)}" y1="${round(y + h)}" x2="${round(x + w)}" y2="${round(y + h + markLength)}" />`,
  ].join('');
}

function createImpositionSvg(layout, options = {}) {
  if (!layout) return '';

  const sheetWidth = layout.sheetWidthMm;
  const sheetHeight = layout.sheetHeightMm;
  const title = options.title || `${layout.paperName} — ${layout.totalPoses} poses`;
  const addCropMarks = options.addCropMarks !== false;
  const showMargin = options.showMargin !== false;

  const sheetLabel = `${layout.paperName} ${sheetWidth} × ${sheetHeight} mm`;
  const productLabel = `${layout.productWidthMm} × ${layout.productHeightMm} mm`;

  const placements = layout.placements.map((placement) => {
    const y = round(sheetHeight - placement.y - placement.height, 3);
    const labelX = round(placement.x + placement.width / 2, 3);
    const labelY = round(y + placement.height / 2, 3);
    const rotationLabel = placement.rotation ? ` r${placement.rotation}°` : '';

    return `
      <g class="placement" data-index="${placement.index}">
        <rect x="${placement.x}" y="${y}" width="${placement.width}" height="${placement.height}" rx="1.5" />
        <text x="${labelX}" y="${labelY}" text-anchor="middle" dominant-baseline="middle">Pose ${placement.index}${rotationLabel}</text>
        ${addCropMarks ? `<g class="crop-marks">${svgCropMarks(placement, sheetHeight)}</g>` : ''}
      </g>`;
  }).join('');

  const marginRect = showMargin && layout.marginMm > 0
    ? `<rect class="margin" x="${layout.marginMm}" y="${layout.marginMm}" width="${round(sheetWidth - 2 * layout.marginMm)}" height="${round(sheetHeight - 2 * layout.marginMm)}" />`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${sheetWidth} ${sheetHeight}" role="img" aria-label="${escapeXml(title)}">
  <title>${escapeXml(title)}</title>
  <style>
    .sheet { fill: #fff; stroke: #1f2937; stroke-width: 0.6; }
    .margin { fill: none; stroke: #9ca3af; stroke-width: 0.35; stroke-dasharray: 3 2; }
    .placement rect { fill: #dbeafe; stroke: #2563eb; stroke-width: 0.45; }
    .placement text { fill: #111827; font-family: Arial, sans-serif; font-size: 5px; }
    .crop-marks line { stroke: #111827; stroke-width: 0.25; vector-effect: non-scaling-stroke; }
    .legend { fill: #111827; font-family: Arial, sans-serif; font-size: 5px; }
  </style>
  <rect class="sheet" x="0" y="0" width="${sheetWidth}" height="${sheetHeight}" />
  ${marginRect}
  ${placements}
  <text class="legend" x="5" y="${round(sheetHeight - 5)}">${escapeXml(sheetLabel)} | ${layout.columns} × ${layout.rows} = ${layout.totalPoses} poses | Produit ${escapeXml(productLabel)}</text>
</svg>`;
}

module.exports = { createImpositionSvg };
