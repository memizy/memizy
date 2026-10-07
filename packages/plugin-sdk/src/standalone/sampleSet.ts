/**
 * Sample study set used when a plugin runs standalone (opened directly in a
 * browser, without Memizy). Only items of the types the plugin declares are used.
 */

import type { OQSEAnyItem, OQSEMeta } from '@memizy/oqse';

const id = (n: number) => `0192f0c4-0000-7000-8000-${String(n).padStart(12, '0')}`;

export const SAMPLE_META: OQSEMeta = {
  id: id(0),
  language: 'cs',
  title: 'Ukázková sada (standalone)',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  requirements: { features: ['markdown', 'latex', 'mermaid'] },
};

export const SAMPLE_ITEMS: OQSEAnyItem[] = [
  { id: id(1), type: 'mcq-single', question: 'Jaké je hlavní město **Česka**?', options: [{ id: 'brno', text: 'Brno' }, { id: 'praha', text: 'Praha' }, { id: 'ostrava', text: 'Ostrava' }, { id: 'plzen', text: 'Plzeň' }], correctId: 'praha' },
  { id: id(2), type: 'mcq-single', question: 'Kolik je $2^{10}$?', options: [{ id: 'a', text: '512' }, { id: 'b', text: '1000' }, { id: 'c', text: '1024' }, { id: 'd', text: '2048' }], correctId: 'c' },
  { id: id(3), type: 'mcq-single', question: 'Která planeta je nejblíže Slunci?', options: [{ id: 'venuse', text: 'Venuše' }, { id: 'merkur', text: 'Merkur' }, { id: 'mars', text: 'Mars' }], correctId: 'merkur' },
  { id: id(4), type: 'mcq-single', question: 'Jaký chemický vzorec má voda?', options: [{ id: 'co2', text: 'CO₂' }, { id: 'h2o', text: 'H₂O' }, { id: 'nacl', text: 'NaCl' }, { id: 'o2', text: 'O₂' }], correctId: 'h2o' },
  { id: id(5), type: 'true-false', question: 'Měsíc je planeta.', correctAnswer: false },
  { id: id(6), type: 'true-false', question: 'Voda vře při 100 °C za normálního tlaku.', correctAnswer: true },
  { id: id(7), type: 'mcq-multi', question: 'Která čísla jsou prvočísla?', options: [{ id: 'n2', text: '2' }, { id: 'n4', text: '4' }, { id: 'n7', text: '7' }, { id: 'n9', text: '9' }, { id: 'n11', text: '11' }], correctIds: ['n2', 'n7', 'n11'] },
  { id: id(8), type: 'short-answer', question: 'Jak se jmenuje nejvyšší hora Česka?', correctAnswers: ['Sněžka'], ignoreDiacritics: true },
  { id: id(9), type: 'numeric-input', question: 'Kolik je tíhové zrychlení na Zemi (m/s²)?', correctAnswer: 9.81, tolerance: 0.05, unit: 'm/s²' },
  { id: id(10), type: 'sort-items', question: 'Seřaď od nejmenšího:', items: [{ id: 'i10', text: '10' }, { id: 'i1', text: '1' }, { id: 'i1000', text: '1000' }, { id: 'i100', text: '100' }], correctOrder: ['i1', 'i10', 'i100', 'i1000'] },
  { id: id(11), type: 'match-pairs', question: 'Přiřaď hlavní města:', prompts: [{ id: 'cz', text: 'Česko' }, { id: 'sk', text: 'Slovensko' }, { id: 'at', text: 'Rakousko' }], matches: [{ id: 'praha', text: 'Praha' }, { id: 'bratislava', text: 'Bratislava' }, { id: 'viden', text: 'Vídeň' }], pairs: { cz: 'praha', sk: 'bratislava', at: 'viden' } },
  { id: id(12), type: 'flashcard', front: 'Fotosyntéza', back: 'Přeměna světelné energie na chemickou v rostlinách.' },
  {
    id: id(13),
    type: 'note',
    title: 'První termodynamický zákon',
    content: 'Změna vnitřní energie: $\\Delta U = Q - W$\n\n```mermaid\ngraph LR\n  Q["Teplo"] --> U{"ΔU"} --> W["Práce"]\n```',
    hiddenContent: 'Energie nevzniká ani nezaniká, jen se přeměňuje.',
  },
] as OQSEAnyItem[];

/** Sample items of the given types (all samples when `types` contains `*`). */
export function sampleItemsFor(types: readonly string[] | null | undefined): OQSEAnyItem[] {
  if (!types || types.includes('*')) return SAMPLE_ITEMS;
  return SAMPLE_ITEMS.filter((item) => types.includes(item.type));
}
