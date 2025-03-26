// analyzers/epsAnalyzer.js
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// Analyse les dimensions EPS
async function analyzeEPS(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const match = content.match(/%%BoundingBox: (\d+) (\d+) (\d+) (\d+)/);
  if (!match) throw new Error('BoundingBox introuvable');

  const [, x1, y1, x2, y2] = match.map(Number);
  const widthPt = x2 - x1;
  const heightPt = y2 - y1;
  const width_mm = (widthPt * 25.4) / 72;
  const height_mm = (heightPt * 25.4) / 72;

  return {
    type: 'EPS',
    width_mm: +width_mm.toFixed(2),
    height_mm: +height_mm.toFixed(2),
  };
}

// Modifie l'EPS si nécessaire (ajout de marge de 2mm)
async function modifyEPS(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  const match = content.match(/%%BoundingBox: (\d+) (\d+) (\d+) (\d+)/);
  if (!match) throw new Error('BoundingBox introuvable');

  let [, x1, y1, x2, y2] = match.map(Number);
  const widthPt = x2 - x1;
  const heightPt = y2 - y1;

  const width_mm = (widthPt * 25.4) / 72;
  const height_mm = (heightPt * 25.4) / 72;

  const artboardW = Math.round(width_mm);
  const artboardH = Math.round(height_mm);

  if (
    artboardW === Math.round(width_mm) &&
    artboardH === Math.round(height_mm)
  ) {
    const marginPt = (2 * 72) / 25.4;
    const newX1 = Math.round(x1 - marginPt);
    const newY1 = Math.round(y1 - marginPt);
    const newX2 = Math.round(x2 + marginPt);
    const newY2 = Math.round(y2 + marginPt);

    content = content.replace(
      /%%BoundingBox: (\d+) (\d+) (\d+) (\d+)/,
      `%%BoundingBox: ${newX1} ${newY1} ${newX2} ${newY2}`
    );

    const dir = path.join(__dirname, '../modified');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const outputPath = path.join(dir, `${Date.now()}_modified.eps`);
    fs.writeFileSync(outputPath, content, 'binary');
    return outputPath;
  }

  return null;
}

// Conversion EPS vers PDF avec Ghostscript
async function convertEPStoPDF(epsPath) {
  const pdfDir = path.join(__dirname, '../pdfs');
  if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });

  const pdfFilePath = path.join(pdfDir, `${Date.now()}_converted.pdf`);
  const command = `gswin64c -dNOPAUSE -dBATCH -sDEVICE=pdfwrite -sOutputFile="${pdfFilePath.replace(/\\/g, '/')}" "${epsPath.replace(/\\/g, '/')}"`;
  return new Promise((resolve, reject) => {
    exec(command, (error) => {
      if (error) reject(error);
      else resolve(pdfFilePath);
    });
  });
}

module.exports = {
  analyzeEPS,
  modifyEPS,
  convertEPStoPDF
};
