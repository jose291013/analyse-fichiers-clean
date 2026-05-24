const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { PDFDocument, rgb, degrees } = require('pdf-lib');
const { mmToPt } = require('./units');
const { isImpositionPlan } = require('./impositionPlan');

const IMPOSED_DIR = path.join(process.cwd(), 'imposed');

function safeFileName(value, fallback = 'imposed.pdf') {
  const raw = String(value || fallback).trim() || fallback;
  const cleaned = raw
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 180);

  return cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned}.pdf`;
}

function uniqueOutputPath(preferredName) {
  fs.mkdirSync(IMPOSED_DIR, { recursive: true });

  const safeName = safeFileName(preferredName, `imposed_${Date.now()}.pdf`);
  const parsed = path.parse(safeName);
  let candidate = path.join(IMPOSED_DIR, safeName);
  let counter = 2;

  while (fs.existsSync(candidate)) {
    candidate = path.join(IMPOSED_DIR, `${parsed.name}_${counter}${parsed.ext}`);
    counter += 1;
  }

  return candidate;
}

async function readSourcePdfBytes({ sourcePdfUrl, sourcePdfPath }) {
  if (sourcePdfUrl) {
    if (typeof fetch !== 'function') {
      throw new Error('fetch n’est pas disponible dans cette version de Node.js. Utilisez Node 18+ ou fournissez sourcePdfPath.');
    }

    const response = await fetch(sourcePdfUrl);
    if (!response.ok) {
      throw new Error(`Impossible de télécharger le PDF source: HTTP ${response.status}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  if (sourcePdfPath) {
    return fsp.readFile(sourcePdfPath);
  }

  throw new Error('sourcePdfUrl ou sourcePdfPath est requis pour générer l’imposition.');
}

function drawCropMarks(page, placement, options = {}) {
  const markLengthPt = mmToPt(options.markLengthMm ?? 4);
  const strokeWidth = options.strokeWidth ?? 0.35;
  const color = rgb(0, 0, 0);
  const x = mmToPt(placement.x);
  const y = mmToPt(placement.y);
  const w = mmToPt(placement.width);
  const h = mmToPt(placement.height);

  const lines = [
    [x - markLengthPt, y, x, y],
    [x, y - markLengthPt, x, y],
    [x + w, y, x + w + markLengthPt, y],
    [x + w, y - markLengthPt, x + w, y],
    [x - markLengthPt, y + h, x, y + h],
    [x, y + h, x, y + h + markLengthPt],
    [x + w, y + h, x + w + markLengthPt, y + h],
    [x + w, y + h, x + w, y + h + markLengthPt],
  ];

  for (const [x1, y1, x2, y2] of lines) {
    page.drawLine({
      start: { x: x1, y: y1 },
      end: { x: x2, y: y2 },
      thickness: strokeWidth,
      color,
    });
  }
}

function drawEmbeddedPage(targetPage, embeddedPage, placement) {
  const rotation = Number(placement.rotation || 0) % 360;
  const x = mmToPt(placement.x);
  const y = mmToPt(placement.y);
  const w = mmToPt(placement.width);
  const h = mmToPt(placement.height);

  if (rotation === 90) {
    targetPage.drawPage(embeddedPage, {
      x: x + w,
      y,
      width: h,
      height: w,
      rotate: degrees(90),
    });
    return;
  }

  if (rotation === 180 || rotation === -180) {
    targetPage.drawPage(embeddedPage, {
      x: x + w,
      y: y + h,
      width: w,
      height: h,
      rotate: degrees(180),
    });
    return;
  }

  if (rotation === 270 || rotation === -90) {
    targetPage.drawPage(embeddedPage, {
      x,
      y: y + h,
      width: h,
      height: w,
      rotate: degrees(270),
    });
    return;
  }

  targetPage.drawPage(embeddedPage, {
    x,
    y,
    width: w,
    height: h,
  });
}

function validateLayout(layout) {
  if (!layout || typeof layout !== 'object') {
    throw new Error('layout est requis.');
  }

  if (!Number(layout.sheetWidthMm) || !Number(layout.sheetHeightMm)) {
    throw new Error('layout.sheetWidthMm et layout.sheetHeightMm sont requis.');
  }

  if (!Array.isArray(layout.placements) || !layout.placements.length) {
    throw new Error('layout.placements doit contenir au moins une pose.');
  }
}

async function drawLayoutOnOutputPage({ outputPdf, targetPage, sourceBytes, sourcePdf, layout, embeddedPageCache, addCropMarks }) {
  validateLayout(layout);

  for (const placement of layout.placements) {
    const sourcePageIndex = Number.isInteger(placement.sourcePageIndex) ? placement.sourcePageIndex : 0;
    if (sourcePageIndex < 0 || sourcePageIndex >= sourcePdf.getPageCount()) {
      throw new Error(`sourcePageIndex invalide: ${sourcePageIndex}`);
    }

    if (!embeddedPageCache.has(sourcePageIndex)) {
      const [embeddedPage] = await outputPdf.embedPdf(sourceBytes, [sourcePageIndex]);
      embeddedPageCache.set(sourcePageIndex, embeddedPage);
    }

    drawEmbeddedPage(targetPage, embeddedPageCache.get(sourcePageIndex), placement);
    if (addCropMarks) drawCropMarks(targetPage, placement);
  }
}

async function generateImposedPdf({ sourcePdfUrl, sourcePdfPath, layout, outputFileName, addCropMarks = true }) {
  const sourceBytes = await readSourcePdfBytes({ sourcePdfUrl, sourcePdfPath });
  const sourcePdf = await PDFDocument.load(sourceBytes, { ignoreEncryption: true });
  const outputPdf = await PDFDocument.create();
  const embeddedPageCache = new Map();

  const layouts = isImpositionPlan(layout) ? layout.faces : [layout];
  if (!layouts.length) throw new Error('Aucun layout à générer.');

  for (const faceLayout of layouts) {
    validateLayout(faceLayout);
    const sheetWidthPt = mmToPt(faceLayout.sheetWidthMm);
    const sheetHeightPt = mmToPt(faceLayout.sheetHeightMm);
    const targetPage = outputPdf.addPage([sheetWidthPt, sheetHeightPt]);

    await drawLayoutOnOutputPage({
      outputPdf,
      targetPage,
      sourceBytes,
      sourcePdf,
      layout: faceLayout,
      embeddedPageCache,
      addCropMarks,
    });
  }

  const pdfBytes = await outputPdf.save({ useObjectStreams: false });
  const outputPath = uniqueOutputPath(outputFileName);
  await fsp.writeFile(outputPath, pdfBytes);

  return {
    outputPath,
    fileName: path.basename(outputPath),
    fileSizeBytes: pdfBytes.length,
    pageCount: outputPdf.getPageCount(),
    sourcePageCount: sourcePdf.getPageCount(),
    generatedFaces: layouts.length,
  };
}

module.exports = {
  IMPOSED_DIR,
  generateImposedPdf,
  safeFileName,
};
