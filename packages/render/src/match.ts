/**
 * Matched rows — cards that sit side by side (grid2, grid3) come out the same height.
 *
 * Nothing in email stretches a card to its neighbour's height, so within each row a card RESERVES whatever
 * its row-mates have and it lacks: the badge row, the brochure link row, and the extra lines of any text that
 * wraps further next door (measure.ts). The reservation is an empty cell or a min-height — table-only, so it
 * behaves the same in every client and survives Outlook's paste. A row of like-for-like cards reserves
 * nothing and renders exactly the v5 reference. Same idea as the matched stat tiles (viewmodel.ts).
 *
 * Only rows are matched, not the whole email: on a phone the cards are one column and heights do not matter,
 * so the less blank space reserved the better. (Matt, 21 Sept 2026: "even in preview the heights are not equal".)
 */
import { GRID2_CARD, GRID3_CARD } from './layout.js';
import { wrapLines } from './measure.js';
import type { CardVM } from './viewmodel.js';

/** Minimum heights in px, set only where this card is shorter than a row-mate. */
export interface Reserve {
  badge?: boolean;
  brochure?: boolean;
  model?: number;
  derivative?: number;
  spec?: number;
  smallPrint?: number;
}

interface TextSpec {
  font: number;
  lh: number;
  bold?: boolean;
}

/** The text column (card minus its border and cell padding) and the type each line is set in; mirrors cards.ts. */
const GEOMETRY = {
  grid2: { perRow: 2, width: GRID2_CARD - 2 - 32, model: { font: 20, lh: 26, bold: true }, derivative: { font: 13, lh: 18 }, spec: { font: 12, lh: 18 }, smallPrint: { font: 11, lh: 16 } },
  grid3: { perRow: 3, width: GRID3_CARD - 2 - 24, model: { font: 17, lh: 22, bold: true }, derivative: { font: 11, lh: 16 }, spec: { font: 11, lh: 16 }, smallPrint: undefined },
} satisfies Record<string, { perRow: number; width: number; model: TextSpec; derivative: TextSpec; spec: TextSpec; smallPrint: TextSpec | undefined }>;

/** The reference already holds the derivative to two lines in both grids. */
const DERIVATIVE_BASE_LINES = 2;

export function matchRows(cards: CardVM[], layout: 'grid2' | 'grid3'): Reserve[] {
  const g = GEOMETRY[layout];
  const out: Reserve[] = cards.map(() => ({}));
  const lines = (text: string, t: TextSpec) => wrapLines(text, t.font, g.width, t.bold);

  for (let start = 0; start < cards.length; start += g.perRow) {
    const row = cards.slice(start, start + g.perRow);
    if (row.length < 2) continue;
    const anyBadge = row.some((c) => !!c.hot || c.badges.length > 0);
    const anyBrochure = row.some((c) => !!c.brochure);
    const measured = row.map((c) => ({
      model: lines(c.model, g.model),
      derivative: Math.max(DERIVATIVE_BASE_LINES, lines(c.derivative, g.derivative)),
      spec: lines(layout === 'grid3' ? c.specShort : c.specLine, g.spec),
      smallPrint: g.smallPrint ? lines(c.smallPrint, g.smallPrint) : 0,
    }));
    const most = (k: keyof (typeof measured)[number]) => Math.max(...measured.map((m) => m[k]));

    row.forEach((c, i) => {
      const r = out[start + i];
      const own = measured[i];
      if (!r || !own) return;
      if (anyBadge && !c.hot && c.badges.length === 0) r.badge = true;
      if (anyBrochure && !c.brochure) r.brochure = true;
      if (own.model < most('model')) r.model = most('model') * g.model.lh;
      if (own.derivative < most('derivative')) r.derivative = most('derivative') * g.derivative.lh;
      if (own.spec < most('spec')) r.spec = most('spec') * g.spec.lh;
      if (g.smallPrint && own.smallPrint < most('smallPrint')) r.smallPrint = most('smallPrint') * g.smallPrint.lh;
    });
  }
  return out;
}
