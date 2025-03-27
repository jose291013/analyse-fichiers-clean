// server.js - Version complète et corrigée
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { PDFDocument } = require('pdf-lib');

const app = express();
const port = process.env.PORT || 3000;

// Configuration CORS améliorée
const corsOptions = {
  origin: [
    'https://decoration.ams.v6.pressero.com',
    'https://votre-domaine.pressero.com'
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Configuration des répertoires
const directories = [
  path.join(__dirname, 'modified'),
  path.join(__dirname, 'pdfs'),
  path.join(__dirname, 'uploads')
];

directories.forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Configuration Multer
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// Analyse EPS (inchangée)
const analyzeEPS = (filePath) => {
  const content = fs.readFileSync(filePath, 'utf8');
  const match = content.match(/%%BoundingBox: (\d+) (\d+) (\d+) (\d+)/);
  if (!match) throw new Error('BoundingBox introuvable');

  const [, x1, y1, x2, y2] = match.map(Number);
  return {
    width_mm: +((x2 - x1) * 25.4 / 72).toFixed(2),
    height_mm: +((y2 - y1) * 25.4 / 72).toFixed(2)
  };
};

// Analyse PDF avec pdf-lib
app.post('/analyze-pdf', upload.single('FILE'), async (req, res) => {
  try {
    const pdfBytes = fs.readFileSync(req.file.path);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const page = pdfDoc.getPage(0);
    
    const box = page.getTrimBox() || page.getMediaBox();
    const [x1, y1, x2, y2] = box;
    
    res.json({
      dimensions: {
        width_mm: +((x2 - x1) * 25.4 / 72).toFixed(2),
        height_mm: +((y2 - y1) * 25.4 / 72).toFixed(2)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (req.file?.path) fs.unlinkSync(req.file.path);
  }
});

// Analyse EPS existante
app.post('/analyze-eps', upload.single('FILE'), (req, res) => {
  try {
    const dimensions = analyzeEPS(req.file.path);
    res.json({ dimensions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (req.file?.path) fs.unlinkSync(req.file.path);
  }
});

app.listen(port, () => {
  console.log(`Serveur démarré sur le port ${port}`);
});
