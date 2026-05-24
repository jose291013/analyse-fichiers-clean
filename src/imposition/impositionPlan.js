const { round } = require('./units');

function toInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function normalizePositiveInteger(value, fallback = 1) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeDuplexMode(value) {
  const mode = String(value || 'simplex').trim().toLowerCase();
  if (['simplex', 'simplex_all_pages', 'duplex', 'duplex_same_layout', 'work_and_turn', 'work_and_tumble', 'booklet'].includes(mode)) {
    return mode;
  }
  return 'simplex';
}

function normalizeBackPlacementMode({ duplexMode, turnMode, backPlacementMode }) {
  const explicit = String(backPlacementMode || '').trim().toLowerCase();
  if (['same_position', 'mirror_x', 'mirror_y', 'rotate_180'].includes(explicit)) return explicit;

  const turn = String(turnMode || '').trim().toLowerCase();
  if (['work_and_turn', 'mirror_x', 'long_edge'].includes(turn)) return 'mirror_x';
  if (['work_and_tumble', 'mirror_y', 'short_edge'].includes(turn)) return 'mirror_y';
  if (['rotate_180'].includes(turn)) return 'rotate_180';

  if (duplexMode === 'work_and_turn') return 'mirror_x';
  if (duplexMode === 'work_and_tumble') return 'mirror_y';

  return 'same_position';
}

function sanitizePageIndex(value, pageCount, fallback = 0) {
  const index = toInteger(value, fallback);
  if (index < 0) return 0;
  if (index >= pageCount) return Math.max(0, pageCount - 1);
  return index;
}

function transformPlacementForBack(layout, placement, mode) {
  const width = Number(placement.width || 0);
  const height = Number(placement.height || 0);
  const sheetWidth = Number(layout.sheetWidthMm || 0);
  const sheetHeight = Number(layout.sheetHeightMm || 0);
  const currentRotation = Number(placement.rotation || 0);

  if (mode === 'mirror_x') {
    return {
      ...placement,
      x: round(sheetWidth - Number(placement.x || 0) - width, 3),
    };
  }

  if (mode === 'mirror_y') {
    return {
      ...placement,
      y: round(sheetHeight - Number(placement.y || 0) - height, 3),
    };
  }

  if (mode === 'rotate_180') {
    return {
      ...placement,
      x: round(sheetWidth - Number(placement.x || 0) - width, 3),
      y: round(sheetHeight - Number(placement.y || 0) - height, 3),
      rotation: (currentRotation + 180) % 360,
    };
  }

  return { ...placement };
}

function cloneLayoutFace(baseLayout, { side, faceIndex, sourcePageIndex, pageLabel, backPlacementMode = 'same_position' }) {
  const placements = (baseLayout.placements || []).map((placement) => {
    const transformed = side === 'back'
      ? transformPlacementForBack(baseLayout, placement, backPlacementMode)
      : { ...placement };

    return {
      ...transformed,
      sourcePageIndex,
      sourcePageNumber: sourcePageIndex + 1,
      side,
      faceIndex,
      pageLabel: pageLabel || `Page ${sourcePageIndex + 1}`,
    };
  });

  return {
    ...baseLayout,
    id: `${baseLayout.id || 'layout'}_${side}_${faceIndex + 1}`,
    side,
    faceIndex,
    sourcePageIndex,
    sourcePageNumber: sourcePageIndex + 1,
    pageLabel: pageLabel || `Page ${sourcePageIndex + 1}`,
    backPlacementMode: side === 'back' ? backPlacementMode : null,
    placements,
  };
}

function createPageMapping(faces) {
  return faces.flatMap((face) => (face.placements || []).map((placement) => ({
    faceIndex: face.faceIndex,
    side: face.side,
    poseIndex: placement.index,
    row: placement.row,
    column: placement.column,
    sourcePageIndex: placement.sourcePageIndex,
    sourcePageNumber: placement.sourcePageNumber,
    x: placement.x,
    y: placement.y,
    width: placement.width,
    height: placement.height,
    rotation: placement.rotation,
  })));
}

function buildImpositionPlan(baseLayout, options = {}) {
  if (!baseLayout || !Array.isArray(baseLayout.placements) || !baseLayout.placements.length) {
    throw new Error('Un layout de base avec placements est requis pour construire le plan d’imposition.');
  }

  const pageCount = normalizePositiveInteger(options.pageCount ?? options.sourcePageCount, 1);
  const duplexMode = normalizeDuplexMode(options.duplexMode || options.duplex_mode);
  const frontPageIndex = sanitizePageIndex(options.frontPageIndex ?? options.front_page_index, pageCount, 0);
  const backPageIndex = sanitizePageIndex(options.backPageIndex ?? options.back_page_index, pageCount, Math.min(1, pageCount - 1));
  const backPlacementMode = normalizeBackPlacementMode({
    duplexMode,
    turnMode: options.turnMode || options.turn_mode,
    backPlacementMode: options.backPlacementMode || options.back_placement_mode,
  });

  const faces = [];

  if (duplexMode === 'simplex_all_pages') {
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      faces.push(cloneLayoutFace(baseLayout, {
        side: 'front',
        faceIndex: faces.length,
        sourcePageIndex: pageIndex,
        pageLabel: `Page ${pageIndex + 1}`,
      }));
    }
  } else if (['duplex', 'duplex_same_layout', 'work_and_turn', 'work_and_tumble'].includes(duplexMode)) {
    faces.push(cloneLayoutFace(baseLayout, {
      side: 'front',
      faceIndex: faces.length,
      sourcePageIndex: frontPageIndex,
      pageLabel: `Recto — page ${frontPageIndex + 1}`,
    }));

    if (pageCount >= 2) {
      faces.push(cloneLayoutFace(baseLayout, {
        side: 'back',
        faceIndex: faces.length,
        sourcePageIndex: backPageIndex,
        pageLabel: `Verso — page ${backPageIndex + 1}`,
        backPlacementMode,
      }));
    }
  } else {
    faces.push(cloneLayoutFace(baseLayout, {
      side: 'front',
      faceIndex: faces.length,
      sourcePageIndex: frontPageIndex,
      pageLabel: `Page ${frontPageIndex + 1}`,
    }));
  }

  return {
    type: 'imposition-plan',
    version: 3,
    duplexMode,
    pageCount,
    frontPageIndex,
    backPageIndex: faces.some((face) => face.side === 'back') ? backPageIndex : null,
    backPlacementMode,
    sheetWidthMm: baseLayout.sheetWidthMm,
    sheetHeightMm: baseLayout.sheetHeightMm,
    paperId: baseLayout.paperId,
    paperName: baseLayout.paperName,
    totalFaces: faces.length,
    totalSheets: faces.length,
    faces,
    front: faces.find((face) => face.side === 'front') || faces[0] || null,
    back: faces.find((face) => face.side === 'back') || null,
    pageMapping: createPageMapping(faces),
  };
}

function isImpositionPlan(value) {
  return Boolean(value && typeof value === 'object' && Array.isArray(value.faces) && value.faces.length);
}

module.exports = {
  buildImpositionPlan,
  isImpositionPlan,
};
