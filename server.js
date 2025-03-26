const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { getDocument } = require('pdfjs-dist');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());

const modifiedDir = path.join(__dirname, 'modified');
const pdfDir = path.join(__dirname, 'pdfs');
[modifiedDir, pdfDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const upload = multer({ dest: 'uploads/' });

// Analyse dimensions EPS
function analyzeEPS(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const match = content.match(/%%BoundingBox: (\d+) (\d+) (\d+) (\d+)/);
  if (!match) throw new Error('BoundingBox introuvable');

  const [, x1, y1, x2, y2] = match.map(Number);
  const widthPt = x2 - x1;
  const heightPt = y2 - y1;

  return {
    width_mm: +((widthPt * 25.4) / 72).toFixed(2),
    height_mm: +((heightPt * 25.4) / 72).toFixed(2)
  };
}

// Modifier EPS si besoin
function modifyEPS(filePath) {
  const buffer = fs.readFileSync(filePath);
  let content = buffer.toString('binary');

  const match = content.match(/%%BoundingBox: (\d+) (\d+) (\d+) (\d+)/);
  if (!match) return null;

  let [, x1, y1, x2, y2] = match.map(Number);
  const widthPt = x2 - x1;
  const heightPt = y2 - y1;

  const widthMM = (widthPt * 25.4) / 72;
  const heightMM = (heightPt * 25.4) / 72;

  if (
    Math.round(widthMM) === Math.round(widthMM) &&
    Math.round(heightMM) === Math.round(heightMM)
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

    const outputPath = path.join(modifiedDir, `${Date.now()}_modified.eps`);
    fs.writeFileSync(outputPath, content, 'binary');
    return outputPath;
  }

  return null;
}

// Convertir EPS vers PDF avec Ghostscript
function convertEPStoPDF(inputEPS) {
  return new Promise((resolve, reject) => {
    const outputPDF = path.join(pdfDir, `${Date.now()}_converted.pdf`);
    const command = `gs -dNOPAUSE -dBATCH -dEPSCrop -sDEVICE=pdfwrite -sOutputFile="${outputPDF}" "${inputEPS}"`;
    exec(command, (error) => {
      if (error) return reject(error);
      resolve(outputPDF);
    });
  });
}

// Analyse d'un fichier PDF
app.post('/analyze-pdf', upload.single('FILE'), async (req, res) => {
  try {
    const fileBuffer = fs.readFileSync(req.file.path);
    const loadingTask = getDocument({ data: fileBuffer });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);

    let width, height;

    if (page.trimBox) {
      const [x1, y1, x2, y2] = page.trimBox;
      width = Math.abs(x2 - x1);
      height = Math.abs(y2 - y1);
    } else {
      const viewport = page.getViewport({ scale: 1 });
      width = viewport.width;
      height = viewport.height;
    }

    const width_mm = +(width * 25.4 / 72).toFixed(2);
    const height_mm = +(height * 25.4 / 72).toFixed(2);

    res.json({ dimensions: { width_mm, height_mm } });
    fs.unlinkSync(req.file.path);
  } catch (err) {
    console.error('Erreur analyse PDF :', err.message);
    res.status(500).json({ error: 'Erreur lors de l’analyse du PDF' });
  }
});
// Route principale
app.post('/analyze-eps', upload.single('FILE'), async (req, res) => {
  try {
    const file = req.file;
    const dimensions = analyzeEPS(file.path);
    const modifiedFilePath = modifyEPS(file.path);

    let pdfFilePath = null;
    if (modifiedFilePath) {
      pdfFilePath = await convertEPStoPDF(modifiedFilePath);
    }

    res.json({
      dimensions,
      modified: modifiedFilePath !== null,
      downloadLink: modifiedFilePath ? `/download/eps/${path.basename(modifiedFilePath)}` : null,
      pdfLink: pdfFilePath ? `/download/pdf/${path.basename(pdfFilePath)}` : null
    });

    fs.unlinkSync(file.path);
  } catch (err) {
    console.error('Erreur Ghostscript :', err.message);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

// Routes de téléchargement
app.get('/download/eps/:fileName', (req, res) => {
  const filePath = path.join(modifiedDir, req.params.fileName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'EPS introuvable.' });
  }
  res.download(filePath);
});

app.get('/download/pdf/:fileName', (req, res) => {
  const filePath = path.join(pdfDir, req.params.fileName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'PDF introuvable.' });
  }
  res.download(filePath);
});

app.listen(port, () => {
  console.log(`✨ Serveur en ligne sur le port ${port}`);
});
