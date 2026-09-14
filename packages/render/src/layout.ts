/**
 * Geometry, from the markup source of truth `dreamlease-offer-mailer` v5 (14 Sept 2026): a 600px
 * wrapper, 24px gutters, and card sizes that put the vehicle image at exactly the rendered widths the
 * reference fixes (hero 550×413, stack 218×164, grid2 262×197, grid3 166×125, headshot 56×56).
 * Everything else derives from EMAIL_WIDTH so the arithmetic stays visible.
 */
export const EMAIL_WIDTH = 600;
/** Gutter for full-width sections (header, intro, hero, stack, signature, footer). */
export const SIDE = 24;
export const CONTENT = EMAIL_WIDTH - 2 * SIDE; // 552

/** Hero image sits inside the card's 1px border. */
export const HERO_IMG = CONTENT - 2; // 550
export const HERO_IMG_H = 413;

/** Stack card: ghost table 550 wide inside the border, image column 250 + content column 300. */
export const STACK_INNER = CONTENT - 2; // 550
export const STACK_IMG_COL = 250;
export const STACK_CONTENT_COL = STACK_INNER - STACK_IMG_COL; // 300
export const STACK_IMG = STACK_IMG_COL - 2 * 16; // 218
export const STACK_IMG_H = 164;

/** Grids use a 12px outer padding (576 wide) and 12px inside each cell. */
export const GRID_PAD = 12;
export const GRID_WIDTH = EMAIL_WIDTH - 2 * GRID_PAD; // 576
export const CELL_PAD = 12;

export const GRID2_CELL = GRID_WIDTH / 2; // 288
export const GRID2_CARD = GRID2_CELL - 2 * CELL_PAD; // 264
export const GRID2_IMG = GRID2_CARD - 2; // 262
export const GRID2_IMG_H = 197;

export const GRID3_CELL = GRID_WIDTH / 3; // 192
export const GRID3_CARD = GRID3_CELL - 2 * CELL_PAD; // 168
export const GRID3_IMG = GRID3_CARD - 2; // 166
export const GRID3_IMG_H = 125;

export const HEADSHOT = 56;
export const ICON = 14;
export const LOGO_W = 98;
export const LOGO_H = 32;

/** Fixed pill content widths (the td is content-box: outer width minus horizontal padding). */
export const PILL_HERO = 126; // 150 outer, 12px padding each side
export const PILL_SMALL = 100; // 120 outer, 10px padding each side
