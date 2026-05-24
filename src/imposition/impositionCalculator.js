const { DEFAULT_PAPER_SIZES } = require('./defaultPaperSizes');
const { round, toNonNegativeNumber, toPositiveNumber } = require('./units');

function normalizeBoolean(value, fallback = true) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'oui'].includes(normalized)) return true;
    if (['false', '0', 'no', 'non'].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeStrategy(value) {
  const strategy = String(value || '').trim().toLowerCase();
  if (['lowest_cost_per_copy', 'max_poses_then_smallest_sheet', 'digital_click_optimized'].includes(strategy)) {
    return strategy;
  }
  return 'digital_click_optimized';
}

function normalizePaperSizes(paperSizes) {
  const source = Array.isArray(paperSizes) && paperSizes.length ? paperSizes : DEFAULT_PAPER_SIZES;

  return source
    .map((paper, index) => {
      const widthMm = toPositiveNumber(paper.widthMm ?? paper.width_mm ?? paper.width, 0);
      const heightMm = toPositiveNumber(paper.heightMm ?? paper.height_mm ?? paper.height, 0);
      if (!widthMm || !heightMm) return null;

      return {
        id: String(paper.id || paper.name || `paper_${index + 1}`),
        name: String(paper.name || paper.id || `Format ${index + 1}`),
        widthMm,
        heightMm,
        cost: Number.isFinite(Number(paper.cost)) ? Number(paper.cost) : null,
        priority: Number.isFinite(Number(paper.priority)) ? Number(paper.priority) : index,
        mediaKey: paper.mediaKey || paper.media_key || null,
      };
    })
    .filter(Boolean);
}

function getSheetOrientations(paper, allowSheetRotation) {
  const firstOrientation = paper.widthMm <= paper.heightMm ? 'portrait' : 'landscape';
  const orientations = [
    {
      orientation: firstOrientation,
      sheetWidthMm: paper.widthMm,
      sheetHeightMm: paper.heightMm,
    },
  ];

  if (allowSheetRotation && paper.widthMm !== paper.heightMm) {
    orientations.push({
      orientation: firstOrientation === 'portrait' ? 'landscape' : 'portrait',
      sheetWidthMm: paper.heightMm,
      sheetHeightMm: paper.widthMm,
    });
  }

  return orientations;
}

function sheetFitsMachine(sheet, constraints = {}) {
  const maxWidthMm = toPositiveNumber(constraints.maxSheetWidthMm ?? constraints.max_sheet_width_mm, 0);
  const maxHeightMm = toPositiveNumber(constraints.maxSheetHeightMm ?? constraints.max_sheet_height_mm, 0);

  if (!maxWidthMm || !maxHeightMm) return { fits: true };

  const direct = sheet.sheetWidthMm <= maxWidthMm && sheet.sheetHeightMm <= maxHeightMm;
  const rotated = sheet.sheetHeightMm <= maxWidthMm && sheet.sheetWidthMm <= maxHeightMm;
  if (direct || rotated) return { fits: true };

  return {
    fits: false,
    reason: `Format feuille ${sheet.sheetWidthMm} × ${sheet.sheetHeightMm} mm supérieur au maximum machine ${maxWidthMm} × ${maxHeightMm} mm.`,
  };
}

function buildPlacements({ columns, rows, cellWidthMm, cellHeightMm, sheetWidthMm, sheetHeightMm, gutterMm, productRotation }) {
  const gridWidthMm = columns * cellWidthMm + Math.max(0, columns - 1) * gutterMm;
  const gridHeightMm = rows * cellHeightMm + Math.max(0, rows - 1) * gutterMm;
  const originX = (sheetWidthMm - gridWidthMm) / 2;
  const originY = (sheetHeightMm - gridHeightMm) / 2;
  const placements = [];

  let index = 1;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = originX + column * (cellWidthMm + gutterMm);
      const y = originY + (rows - 1 - row) * (cellHeightMm + gutterMm);

      placements.push({
        index,
        row,
        column,
        sourcePageIndex: 0,
        x: round(x, 3),
        y: round(y, 3),
        width: round(cellWidthMm, 3),
        height: round(cellHeightMm, 3),
        rotation: productRotation,
      });
      index += 1;
    }
  }

  return { gridWidthMm: round(gridWidthMm, 3), gridHeightMm: round(gridHeightMm, 3), placements };
}

function evaluateCandidate({ paper, sheet, product, params, productRotation, machineConstraints }) {
  const machineFit = sheetFitsMachine(sheet, machineConstraints);
  if (!machineFit.fits) {
    return { compatible: false, reason: machineFit.reason };
  }

  const cellWidthMm = productRotation === 90 ? product.heightMm : product.widthMm;
  const cellHeightMm = productRotation === 90 ? product.widthMm : product.heightMm;
  const usableWidthMm = sheet.sheetWidthMm - 2 * params.marginMm;
  const usableHeightMm = sheet.sheetHeightMm - 2 * params.marginMm;

  if (usableWidthMm <= 0 || usableHeightMm <= 0) {
    return {
      compatible: false,
      reason: `Marge ${params.marginMm} mm trop grande pour la feuille ${sheet.sheetWidthMm} × ${sheet.sheetHeightMm} mm.`,
    };
  }

  const columns = Math.floor((usableWidthMm + params.gutterMm) / (cellWidthMm + params.gutterMm));
  const rows = Math.floor((usableHeightMm + params.gutterMm) / (cellHeightMm + params.gutterMm));

  if (columns <= 0 || rows <= 0) {
    return {
      compatible: false,
      reason: `Le produit ${cellWidthMm} × ${cellHeightMm} mm ne rentre pas dans la zone utile ${round(usableWidthMm, 2)} × ${round(usableHeightMm, 2)} mm.`,
    };
  }

  const totalPoses = columns * rows;
  const sheetAreaMm2 = sheet.sheetWidthMm * sheet.sheetHeightMm;
  const productAreaMm2 = product.widthMm * product.heightMm;
  const usedAreaMm2 = totalPoses * productAreaMm2;
  const wasteAreaMm2 = Math.max(0, sheetAreaMm2 - usedAreaMm2);
  const estimatedSheets = params.quantity ? Math.ceil(params.quantity / totalPoses) : null;
  const grid = buildPlacements({ columns, rows, cellWidthMm, cellHeightMm, sheetWidthMm: sheet.sheetWidthMm, sheetHeightMm: sheet.sheetHeightMm, gutterMm: params.gutterMm, productRotation });

  return {
    compatible: true,
    candidate: {
      id: `${paper.id}_${sheet.orientation}_r${productRotation}_${columns}x${rows}`,
      paperId: paper.id,
      paperName: paper.name,
      mediaKey: paper.mediaKey,
      sheetWidthMm: round(sheet.sheetWidthMm, 3),
      sheetHeightMm: round(sheet.sheetHeightMm, 3),
      sheetAreaMm2: round(sheetAreaMm2, 3),
      orientation: sheet.orientation,
      productWidthMm: round(product.widthMm, 3),
      productHeightMm: round(product.heightMm, 3),
      productRotation,
      cellWidthMm: round(cellWidthMm, 3),
      cellHeightMm: round(cellHeightMm, 3),
      columns,
      rows,
      totalPoses,
      marginMm: round(params.marginMm, 3),
      gutterMm: round(params.gutterMm, 3),
      gridWidthMm: grid.gridWidthMm,
      gridHeightMm: grid.gridHeightMm,
      usedAreaPercent: round((usedAreaMm2 / sheetAreaMm2) * 100, 2),
      wasteAreaPercent: round((wasteAreaMm2 / sheetAreaMm2) * 100, 2),
      cost: paper.cost,
      costPerPose: paper.cost ? round(paper.cost / totalPoses, 6) : null,
      paperPriority: paper.priority,
      quantity: params.quantity || null,
      estimatedSheets,
      estimatedClicks: estimatedSheets,
      placements: grid.placements,
    }
  };
}

function compareCandidates(strategy) {
  return (a, b) => {
    if (strategy === 'lowest_cost_per_copy') {
      const aCost = a.costPerPose ?? a.sheetAreaMm2 / a.totalPoses;
      const bCost = b.costPerPose ?? b.sheetAreaMm2 / b.totalPoses;
      if (aCost !== bCost) return aCost - bCost;
      if (b.totalPoses !== a.totalPoses) return b.totalPoses - a.totalPoses;
    } else {
      const aClicks = Number.isFinite(Number(a.estimatedClicks)) ? Number(a.estimatedClicks) : null;
      const bClicks = Number.isFinite(Number(b.estimatedClicks)) ? Number(b.estimatedClicks) : null;
      if (aClicks !== null && bClicks !== null && aClicks !== bClicks) return aClicks - bClicks;
      if (b.totalPoses !== a.totalPoses) return b.totalPoses - a.totalPoses;
      if (a.sheetAreaMm2 !== b.sheetAreaMm2) return a.sheetAreaMm2 - b.sheetAreaMm2;
    }

    if (a.wasteAreaPercent !== b.wasteAreaPercent) return a.wasteAreaPercent - b.wasteAreaPercent;
    if (a.paperPriority !== b.paperPriority) return a.paperPriority - b.paperPriority;
    if (a.productRotation !== b.productRotation) return a.productRotation - b.productRotation;
    return a.id.localeCompare(b.id);
  };
}

function explainCandidate(candidate, selected, manualPaperId, strategy) {
  if (candidate.id === selected?.id && manualPaperId) return 'Format sélectionné manuellement.';
  if (candidate.id === selected?.id && strategy === 'digital_click_optimized') return 'Format sélectionné pour réduire les clics machine, puis limiter la gâche à poses équivalentes.';
  if (candidate.id === selected?.id) return 'Format sélectionné automatiquement.';
  if (!selected) return 'Compatible, mais non sélectionné.';
  if (candidate.estimatedClicks !== null && selected.estimatedClicks !== null && candidate.estimatedClicks > selected.estimatedClicks) return `Plus de clics machine estimés que le format sélectionné (${candidate.estimatedClicks} contre ${selected.estimatedClicks}).`;
  if (candidate.totalPoses < selected.totalPoses) return `Moins de poses que le format sélectionné (${candidate.totalPoses} contre ${selected.totalPoses}), donc plus de passages machine.`;
  if (candidate.totalPoses === selected.totalPoses && candidate.sheetAreaMm2 > selected.sheetAreaMm2) return 'Même nombre de poses, mais feuille plus grande donc plus de gâche papier.';
  if (candidate.costPerPose !== null && selected.costPerPose !== null && candidate.costPerPose > selected.costPerPose) return 'Même logique de pose, mais coût estimé par pose supérieur.';
  return 'Compatible, mais non sélectionné après application des règles de tri.';
}

function summarizeCandidate(candidate, selected, manualPaperId, strategy) {
  const summary = { ...candidate };
  delete summary.placements;
  summary.selected = candidate.id === selected?.id;
  summary.reason = explainCandidate(candidate, selected, manualPaperId, strategy);
  return summary;
}

function bestPerPaper(candidates, strategy) {
  const map = new Map();
  for (const candidate of candidates) {
    const current = map.get(candidate.paperId);
    if (!current) {
      map.set(candidate.paperId, candidate);
      continue;
    }
    if (compareCandidates(strategy || 'digital_click_optimized')(candidate, current) < 0) {
      map.set(candidate.paperId, candidate);
    }
  }
  return Array.from(map.values());
}

function normalizeManualPaperId(options = {}) {
  return options.paperId || options.paper_id || options.selectedPaperId || options.selected_paper_id || null;
}

function findBestImposition(options) {
  const productWidthMm = toPositiveNumber(options.productWidthMm, 0);
  const productHeightMm = toPositiveNumber(options.productHeightMm, 0);
  if (!productWidthMm || !productHeightMm) throw new Error('Les dimensions du produit sont invalides pour le calcul d’imposition.');

  const params = {
    marginMm: toNonNegativeNumber(options.marginMm, 10),
    gutterMm: toNonNegativeNumber(options.gutterMm, 5),
    quantity: toPositiveNumber(options.quantity ?? options.qty ?? options.runQuantity ?? options.run_quantity, 0),
  };

  const strategy = normalizeStrategy(options.strategy);
  const allowRotation = normalizeBoolean(options.allowRotation, true);
  const allowSheetRotation = normalizeBoolean(options.allowSheetRotation, true);
  const product = { widthMm: productWidthMm, heightMm: productHeightMm };
  const allPapers = normalizePaperSizes(options.paperSizes);
  const manualPaperId = normalizeManualPaperId(options);
  const papers = manualPaperId
    ? allPapers.filter((paper) => paper.id === manualPaperId || paper.name === manualPaperId)
    : allPapers;
  const productRotations = allowRotation && productWidthMm !== productHeightMm ? [0, 90] : [0];
  const candidates = [];
  const notCompatible = [];

  for (const paper of papers) {
    const paperCandidates = [];
    const paperReasons = [];

    for (const sheet of getSheetOrientations(paper, allowSheetRotation)) {
      for (const productRotation of productRotations) {
        const result = evaluateCandidate({ paper, sheet, product, params, productRotation, machineConstraints: options.machineConstraints || options });
        if (result.compatible) {
          paperCandidates.push(result.candidate);
          candidates.push(result.candidate);
        } else if (result.reason) {
          paperReasons.push(`${sheet.orientation}, rotation ${productRotation}° : ${result.reason}`);
        }
      }
    }

    if (!paperCandidates.length) {
      notCompatible.push({
        paperId: paper.id,
        paperName: paper.name,
        sheetWidthMm: paper.widthMm,
        sheetHeightMm: paper.heightMm,
        mediaKey: paper.mediaKey,
        reason: paperReasons[0] || 'Aucune orientation compatible.',
        reasons: paperReasons,
      });
    }
  }

  candidates.sort(compareCandidates(strategy));
  const selected = candidates.length ? candidates[0] : null;
  const compatiblePaperCandidates = bestPerPaper(candidates, strategy).sort(compareCandidates(strategy));

  return {
    selected,
    candidates,
    summaries: candidates.map((candidate) => summarizeCandidate(candidate, selected, manualPaperId, strategy)),
    compatiblePapers: compatiblePaperCandidates.map((candidate) => summarizeCandidate(candidate, selected, manualPaperId, strategy)),
    notCompatible,
    strategy,
    paperSelectionMode: manualPaperId ? 'manual' : 'auto',
    paperId: manualPaperId,
  };
}

module.exports = { findBestImposition, normalizePaperSizes, summarizeCandidate };
