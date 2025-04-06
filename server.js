// server.js - Version complète et corrigée
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');


const app = express();
const port = process.env.PORT || 3000;

app.use(cors());

// Base URL de votre service Render
const baseUrl = process.env.BASE_URL || "https://analyse-fichiers-clean.onrender.com";

// Configuration des répertoires
const directories = [
  path.join(__dirname, 'modified'),
  path.join(__dirname, 'pdfs'),
  path.join(__dirname, 'uploads')
];

directories.forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const upload = multer({ 
  dest: 'uploads/',
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB max
});

// 1. Analyse EPS (inchangée mais optimisée)
const analyzeEPS = (filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const match = content.match(/%%BoundingBox: (\d+) (\d+) (\d+) (\d+)/);
    if (!match) throw new Error('BoundingBox introuvable');

    const [, x1, y1, x2, y2] = match.map(Number);
    const toMM = (pt) => +((pt * 25.4 / 72).toFixed(2));

    return {
      width_mm: toMM(x2 - x1),
      height_mm: toMM(y2 - y1)
    };
  } catch (err) {
    console.error('Erreur analyse EPS:', err);
    throw new Error('Fichier EPS invalide');
  }
};

// 2. Modification EPS (ajout de logs)
const modifyEPS = (filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'binary');
    const match = content.match(/%%BoundingBox: (\d+) (\d+) (\d+) (\d+)/);
    if (!match) return null;

    let [, x1, y1, x2, y2] = match.map(Number);
    const marginPt = (2 * 72) / 25.4;

    const newContent = content.replace(
      /%%BoundingBox: (\d+) (\d+) (\d+) (\d+)/,
      `%%BoundingBox: ${Math.round(x1 - marginPt)} ${Math.round(y1 - marginPt)} ${Math.round(x2 + marginPt)} ${Math.round(y2 + marginPt)}`
    );

    const outputPath = path.join(__dirname, 'modified', `${Date.now()}_modified.eps`);
    fs.writeFileSync(outputPath, newContent, 'binary');
    return outputPath;
  } catch (err) {
    console.error('Erreur modification EPS:', err);
    return null;
  }
};

// 3. Conversion EPS → PDF (avec gestion d'erreur améliorée)
const convertEPStoPDF = (inputEPS) => new Promise((resolve, reject) => {
  const outputPDF = path.join(__dirname, 'pdfs', `${Date.now()}.pdf`);
  const command = `gs -dNOPAUSE -dBATCH -dEPSCrop -sDEVICE=pdfwrite -sOutputFile="${outputPDF}" "${inputEPS}"`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`Erreur Ghostscript: ${stderr}`);
      return reject(new Error('Échec conversion PDF'));
    }
    resolve(outputPDF);
  });
});

// 4. Analyse PDF avec qpdf pour lire le TrimBox ou MediaBox
app.post('/analyze-pdf', upload.single('FILE'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });

  const filePath = req.file.path;
  const command = `qpdf --json "${filePath}"`;

  exec(command, (err, stdout, stderr) => {
    fs.unlinkSync(filePath); // Nettoyage du fichier temporaire

    if (err) {
      console.error('Erreur qpdf :', stderr);
      return res.status(500).json({ error: 'Erreur lors de l’analyse PDF avec qpdf' });
    }

    try {
      const json = JSON.parse(stdout);
      console.log("🧩 JSON brut qpdf:", JSON.stringify(json, null, 2));
      const page = json.pages?.[0];
      if (!page) return res.status(500).json({ error: 'Aucune page trouvée' });

      let box, usedBox;

      if (Array.isArray(page.trim_box)) {
        box = page.trim_box;
        usedBox = 'TrimBox';
      } else if (Array.isArray(page.media_box)) {
        box = page.media_box;
        usedBox = 'MediaBox';
      } else {
        return res.status(500).json({ error: 'Aucune box valide trouvée dans le PDF' });
      }

      const [x1, y1, x2, y2] = box;
      const toMM = pt => +(pt * 25.4 / 72).toFixed(2);

      const dimensions = {
        width_mm: toMM(x2 - x1),
        height_mm: toMM(y2 - y1)
      };

      res.json({ dimensions, usedBox });

    } catch (parseErr) {
      console.error('Erreur parsing JSON qpdf:', parseErr);
      res.status(500).json({ error: 'Erreur parsing JSON qpdf' });
    }
  });
});



// 5. Route EPS existante (optimisée)
app.post('/analyze-eps', upload.single('FILE'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });

  try {
    const dimensions = analyzeEPS(req.file.path);
    const modifiedPath = modifyEPS(req.file.path);
    let pdfPath = null;

    if (modifiedPath) {
      pdfPath = await convertEPStoPDF(modifiedPath).catch(console.error);
    }

    res.json({
      dimensions,
      modified: !!modifiedPath,
      downloadLink: modifiedPath ? `${baseUrl}/download/eps/${path.basename(modifiedPath)}` : null,
      pdfLink: pdfPath ? `${baseUrl}/download/pdf/${path.basename(pdfPath)}` : null
    });
  } catch (err) {
    console.error('Erreur analyse EPS:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (req.file?.path) fs.unlinkSync(req.file.path);
  }
});

// Routes de téléchargement
app.get('/download/eps/:fileName', (req, res) => {
  const filePath = path.join(__dirname, 'modified', req.params.fileName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Fichier introuvable' });
  res.download(filePath);
});

app.get('/download/pdf/:fileName', (req, res) => {
  const filePath = path.join(__dirname, 'pdfs', req.params.fileName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Fichier introuvable' });
  res.download(filePath);
});

// Middleware d'erreur global
app.use((err, req, res, next) => {
  console.error('Erreur globale:', err);
  res.status(500).json({ error: 'Erreur interne du serveur' });
});


app.get('/test-qpdf', (req, res) => {
  exec('qpdf --version', (err, stdout) => {
    if (err) {
      console.error('❌ qpdf non trouvé');
      return res.status(500).json({ error: 'qpdf non installé' });
    }
    res.json({ version: stdout.trim() });
  });
});


app.listen(port, () => {
  console.log(`🛠️ Serveur prêt sur le port ${port}`);
  console.log(`📁 Répertoires vérifiés: ${directories.join(', ')}`);
});
