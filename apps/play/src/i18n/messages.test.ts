import { describe, expect, it } from 'vitest';
import { createI18n } from 'vue-i18n';
import cs from './cs';
import en from './en';

/** All message keys (a.b.c) of a locale. */
function keys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]));
}

describe('i18n messages', () => {
  // A stray "{" (e.g. JSON in a text) only fails when the message is first rendered.
  it.each([['cs', cs], ['en', en]] as const)('every %s message compiles', (locale, messages) => {
    const i18n = createI18n({ legacy: false, locale, messages: { [locale]: messages }, missingWarn: false, fallbackWarn: false });
    for (const key of keys(messages)) expect(() => i18n.global.t(key, {}), key).not.toThrow();
  });

  it('cs and en have the same keys', () => {
    expect(keys(cs).sort()).toEqual(keys(en).sort());
  });
});
