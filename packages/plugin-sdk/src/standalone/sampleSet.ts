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
  { id: id(1), type: 'mcq-single', question: 'Jaké je hlavní město **Česka**?', options: ['Brno', 'Praha', 'Ostrava', 'Plzeň'], correctIndex: 1 },
  { id: id(2), type: 'mcq-single', question: 'Kolik je $2^{10}$?', options: ['512', '1000', '1024', '2048'], correctIndex: 2 },
  { id: id(3), type: 'mcq-single', question: 'Která planeta je nejblíže Slunci?', options: ['Venuše', 'Merkur', 'Mars'], correctIndex: 1 },
  { id: id(4), type: 'mcq-single', question: 'Jaký chemický vzorec má voda?', options: ['CO₂', 'H₂O', 'NaCl', 'O₂'], correctIndex: 1 },
  { id: id(5), type: 'true-false', question: 'Měsíc je planeta.', correctAnswer: false },
  { id: id(6), type: 'true-false', question: 'Voda vře při 100 °C za normálního tlaku.', correctAnswer: true },
  { id: id(7), type: 'mcq-multi', question: 'Která čísla jsou prvočísla?', options: ['2', '4', '7', '9', '11'], correctIndices: [0, 2, 4] },
  { id: id(8), type: 'short-answer', question: 'Jak se jmenuje nejvyšší hora Česka?', correctAnswers: ['Sněžka'], ignoreDiacritics: true },
  { id: id(9), type: 'numeric-input', question: 'Kolik je tíhové zrychlení na Zemi (m/s²)?', correctAnswer: 9.81, tolerance: 0.05, unit: 'm/s²' },
  { id: id(10), type: 'sort-items', question: 'Seřaď od nejmenšího:', items: ['1', '10', '100', '1000'] },
  { id: id(11), type: 'match-pairs', question: 'Přiřaď hlavní města:', prompts: ['Česko', 'Slovensko', 'Rakousko'], matches: ['Praha', 'Bratislava', 'Vídeň'] },
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
