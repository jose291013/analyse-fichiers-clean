const path = require('path');
const { findBestImposition } = require('./impositionCalculator');
const { DEFAULT_PAPER_SIZES } = require('./defaultPaperSizes');
const { createImpositionSvg } = require('./svgPreview');
const { generateImposedPdf, IMPOSED_DIR } = require('./pdfGenerator');
const { buildImpositionPlan } = require('./impositionPlan');

function parsePaperSizes(value) {
  if (!value) return DEFAULT_PAPER_SIZES;
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return JSON.parse(value);
  return DEFAULT_PAPER_SIZES;
}

function toPositiveInteger(value, fallback = 1) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function publicBaseUrl(req) {
  const configured = process.env.BASE_URL;
  if (configured) return configured.replace(/\/+$/, '');
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${protocol}://${host}`.replace(/\/+$/, '');
}

function planOptionsFromBody(body, dimensions) {
  const pageCount = toPositiveInteger(body.pageCount ?? body.page_count ?? body.sourcePageCount ?? dimensions.pageCount ?? dimensions.page_count, 1);
  return {
    pageCount,
    duplexMode: body.duplexMode || body.duplex_mode || 'simplex',
    turnMode: body.turnMode || body.turn_mode,
    backPlacementMode: body.backPlacementMode || body.back_placement_mode,
    frontPageIndex: body.frontPageIndex ?? body.front_page_index ?? 0,
    backPageIndex: body.backPageIndex ?? body.back_page_index ?? Math.min(1, pageCount - 1),
  };
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
        quantity: body.quantity ?? body.qty ?? body.runQuantity ?? body.run_quantity,
        allowRotation: body.allowRotation,
        allowSheetRotation: body.allowSheetRotation,
        strategy: body.strategy,
        paperId: body.paperId || body.paper_id || body.selectedPaperId,
        machineConstraints: body.machineConstraints || body.machine_constraints || {
          maxSheetWidthMm: body.maxSheetWidthMm || body.max_sheet_width_mm,
          maxSheetHeightMm: body.maxSheetHeightMm || body.max_sheet_height_mm,
        },
      });
      if (!result.selected) {
        return res.status(422).json({
          success: false,
          error: 'Aucun format papier disponible ne permet de placer ce format avec les parametres fournis.',
          strategy: result.strategy,
          paperSelectionMode: result.paperSelectionMode,
          paperId: result.paperId,
          compatiblePapers: result.compatiblePapers,
          notCompatible: result.notCompatible,
        });
      }
      const planOptions = planOptionsFromBody(body, dimensions);
      const impositionPlan = buildImpositionPlan(result.selected, planOptions);
      const previewSvg = createImpositionSvg(result.selected, {
        addCropMarks: body.addCropMarks !== false,
        title: `${result.selected.paperName} - ${result.selected.totalPoses} poses`,
      });
      const previewSvgFront = impositionPlan.front ? createImpositionSvg(impositionPlan.front, {
        addCropMarks: body.addCropMarks !== false,
        title: `${result.selected.paperName} - recto`,
      }) : null;
      const previewSvgBack = impositionPlan.back ? createImpositionSvg(impositionPlan.back, {
        addCropMarks: body.addCropMarks !== false,
        title: `${result.selected.paperName} - verso`,
      }) : null;
      return res.json({
        success: true,
        file: {
          trimWidthMm: Number(productWidthMm),
          trimHeightMm: Number(productHeightMm),
          pageCount: planOptions.pageCount,
        },
        strategy: result.strategy,
        paperSelectionMode: result.paperSelectionMode,
        paperId: result.paperId,
        selected: result.selected,
        selectedPlan: impositionPlan,
        impositionPlan,
        pageMapping: impositionPlan.pageMapping,
        duplexMode: impositionPlan.duplexMode,
        candidates: result.summaries,
        compatiblePapers: result.compatiblePapers,
        notCompatible: result.notCompatible,
        previewSvg,
        previewSvgFront,
        previewSvgBack,
      });
    } catch (error) {
      console.error('Erreur preview imposition:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/imposition/generate', async (req, res) => {
    try {
      const body = req.body || {};
      const generated = await generateImposedPdf({
        sourcePdfUrl: body.sourcePdfUrl || body.fileUrl || body.url,
        sourcePdfPath: body.sourcePdfPath,
        layout: body.layout || body.selectedLayout || body.impositionPlan || body.selectedPlan,
        outputFileName: body.outputFileName || body.fileName,
        addCropMarks: body.addCropMarks !== false,
      });
      const downloadLink = `${publicBaseUrl(req)}/download/imposed/${encodeURIComponent(generated.fileName)}`;
      return res.json({
        success: true,
        fileName: generated.fileName,
        fileSizeBytes: generated.fileSizeBytes,
        pageCount: generated.pageCount,
        sourcePageCount: generated.sourcePageCount,
        generatedFaces: generated.generatedFaces,
        downloadLink,
        productionPdfUrl: downloadLink,
      });
    } catch (error) {
      console.error('Erreur generation imposition:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/download/imposed/:fileName', (req, res) => {
    const filePath = path.join(IMPOSED_DIR, req.params.fileName);
    res.download(filePath, req.params.fileName, (error) => {
      if (error && !res.headersSent) {
        res.status(404).json({ error: 'Fichier impose introuvable' });
      }
    });
  });
}

module.exports = { registerImpositionRoutes };
