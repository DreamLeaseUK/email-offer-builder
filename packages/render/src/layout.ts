/**
 * Geometry. One place to change the email width; everything else derives from it.
 * 14 Sept 2026: widened from the design file's 600 to 640 after the first Outlook review found the
 * template small in the reading pane. Every modern client handles 640 without horizontal scroll.
 */
export const EMAIL_WIDTH = 640;
/** Outer left/right padding for full-width sections. */
export const SIDE = 24;
export const CONTENT = EMAIL_WIDTH - 2 * SIDE; // 592

/** Grids use a narrower outer padding and 12px inside each cell. */
export const GRID_PAD = 12;
export const GRID_WIDTH = EMAIL_WIDTH - 2 * GRID_PAD; // 616
export const CELL_PAD = 12;

export const HALF_CELL = GRID_WIDTH / 2; // 308
export const HALF_CARD = HALF_CELL - 2 * CELL_PAD; // 284
export const COMPACT_CELL = Math.floor(GRID_WIDTH / 3); // 205
export const COMPACT_CARD = COMPACT_CELL - 2 * CELL_PAD; // 181

/** Stack row: image column + content column = CONTENT minus the card's two 1px borders. */
export const ROW_IMG_COL = 250;
export const ROW_IMG = 220;
export const ROW_CONTENT_COL = CONTENT - 2 - ROW_IMG_COL; // 340

/** 4:3 image height for a given width. */
export const h43 = (w: number): number => Math.round((w * 3) / 4);

export const HERO_IMG = CONTENT; // 592 × 444
