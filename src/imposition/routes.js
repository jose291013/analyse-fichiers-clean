const { findBestImposition } = require('./impositionCalculator');
const { DEFAULT_PAPER_SIZES } = require('./defaultPaperSizes');
const { createImpositionSvg } = require('./svgPreview');

function parsePaperSizes(value) {
  if (!value) return DEFAULT_PAPER_SIZES;
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return JSON.parse(value);
  return DEFAULT_PAPER_SIZES;
}

function registerImpositionRoutes(app) {
  app.get('/imposition/paper-sizes', (req, res) => {
    res.json({ paperSizes: DEFAULT_PAPER_SIZES });
  });

  app.post('/imposition/preview-from-dimensions', (req, res) => {
    try {
      const body = req.body || {};
      const dimensions = body.dimensions || body;
      const productWidthMm = dimensions.width_mm ?? dimensions.widthMm ?? dimensions.productWidthMm;
      const productHeightMm = dimensions.height_mm ?? dimensions.heightMm ?? dimensions.productHeightMm;

      const result = findBestImposition({
        productWidthMm,
        productHeightMm,
        paperSizes: parsePaperSizes(body.paperSizes),
        marginMm: body.marginMm,
        gutterMm: body.gutterMm,
        allowRotation: body.allowRotation,
        allowSheetRotation: body.allowSheetRotation,
        strategy: body.strategy,
      });

      if (!result.selected) {
        return res.status(422).json({
          success: false,
          error: 'Aucun format papier disponible ne permet de placer ce format avec les paramètres fournis.',
          strategy: result.strategy,
        });
      }

      const previewSvg = createImpositionSvg(result.selected, {
        addCropMarks: body.addCropMarks !== false,
        title: `${result.selected.paperName} — ${result.selected.totalPoses} poses`,
      });

      return res.json({
        success: true,
        file: {
          trimWidthMm: Number(productWidthMm),
          trimHeightMm: Number(productHeightMm),
        },
        strategy: result.strategy,
        selected: result.selected,
        candidates: result.summaries,
        previewSvg,
      });
    } catch (error) {
      console.error('Erreur preview imposition:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  });
}

module.exports = { registerImpositionRoutes };
