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

/** The same sample in English (the default for browsers in other languages than Czech). */
export const SAMPLE_META_EN: OQSEMeta = { ...SAMPLE_META, id: id(100), language: 'en', title: 'Sample set (standalone)' };

export const SAMPLE_ITEMS_EN: OQSEAnyItem[] = [
  { id: id(1), type: 'mcq-single', question: 'What is the capital of **France**?', options: [{ id: 'lyon', text: 'Lyon' }, { id: 'paris', text: 'Paris' }, { id: 'nice', text: 'Nice' }, { id: 'lille', text: 'Lille' }], correctId: 'paris' },
  { id: id(2), type: 'mcq-single', question: 'What is $2^{10}$?', options: [{ id: 'a', text: '512' }, { id: 'b', text: '1000' }, { id: 'c', text: '1024' }, { id: 'd', text: '2048' }], correctId: 'c' },
  { id: id(3), type: 'mcq-single', question: 'Which planet is closest to the Sun?', options: [{ id: 'venus', text: 'Venus' }, { id: 'mercury', text: 'Mercury' }, { id: 'mars', text: 'Mars' }], correctId: 'mercury' },
  { id: id(4), type: 'mcq-single', question: 'What is the chemical formula of water?', options: [{ id: 'co2', text: 'CO₂' }, { id: 'h2o', text: 'H₂O' }, { id: 'nacl', text: 'NaCl' }, { id: 'o2', text: 'O₂' }], correctId: 'h2o' },
  { id: id(5), type: 'true-false', question: 'The Moon is a planet.', correctAnswer: false },
  { id: id(6), type: 'true-false', question: 'Water boils at 100 °C at normal pressure.', correctAnswer: true },
  { id: id(7), type: 'mcq-multi', question: 'Which numbers are prime?', options: [{ id: 'n2', text: '2' }, { id: 'n4', text: '4' }, { id: 'n7', text: '7' }, { id: 'n9', text: '9' }, { id: 'n11', text: '11' }], correctIds: ['n2', 'n7', 'n11'] },
  { id: id(8), type: 'short-answer', question: 'What is the highest mountain on Earth?', correctAnswers: ['Mount Everest', 'Everest'], ignoreDiacritics: true },
  { id: id(9), type: 'numeric-input', question: 'What is the gravitational acceleration on Earth (m/s²)?', correctAnswer: 9.81, tolerance: 0.05, unit: 'm/s²' },
  { id: id(10), type: 'sort-items', question: 'Sort from the smallest:', items: [{ id: 'i10', text: '10' }, { id: 'i1', text: '1' }, { id: 'i1000', text: '1000' }, { id: 'i100', text: '100' }], correctOrder: ['i1', 'i10', 'i100', 'i1000'] },
  { id: id(11), type: 'match-pairs', question: 'Match the capitals:', prompts: [{ id: 'cz', text: 'Czechia' }, { id: 'sk', text: 'Slovakia' }, { id: 'at', text: 'Austria' }], matches: [{ id: 'prague', text: 'Prague' }, { id: 'bratislava', text: 'Bratislava' }, { id: 'vienna', text: 'Vienna' }], pairs: { cz: 'prague', sk: 'bratislava', at: 'vienna' } },
  { id: id(12), type: 'flashcard', front: 'Photosynthesis', back: 'Plants turning light energy into chemical energy.' },
  {
    id: id(13),
    type: 'note',
    title: 'The first law of thermodynamics',
    content: 'The change of internal energy: $\\Delta U = Q - W$\n\n```mermaid\ngraph LR\n  Q["Heat"] --> U{"ΔU"} --> W["Work"]\n```',
    hiddenContent: 'Energy is neither created nor destroyed, only converted.',
  },
] as OQSEAnyItem[];

/** The built-in sample in the browser's language: Czech for Czech browsers, English otherwise. */
export function sampleSetFor(types: readonly string[] | null | undefined, locale: string): { meta: OQSEMeta; items: OQSEAnyItem[] } {
  const cs = locale.toLowerCase().startsWith('cs');
  return { meta: cs ? SAMPLE_META : SAMPLE_META_EN, items: itemsOfTypes(cs ? SAMPLE_ITEMS : SAMPLE_ITEMS_EN, types) };
}

/** Items of the given types (all when `types` is missing or contains `*`). */
export function itemsOfTypes(items: OQSEAnyItem[], types: readonly string[] | null | undefined): OQSEAnyItem[] {
  if (!types || types.includes('*')) return items;
  return items.filter((item) => types.includes(item.type));
}

/** Sample items of the given types (all samples when `types` contains `*`). */
export function sampleItemsFor(types: readonly string[] | null | undefined): OQSEAnyItem[] {
  return itemsOfTypes(SAMPLE_ITEMS, types);
}
