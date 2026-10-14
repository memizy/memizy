import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import type { SettingDefinition } from '@memizy/protocol';
import { applyLinkSettings, findSetKey, readLinkParams } from './linkParams';
import { persisted, setUnsaved } from './persisted';
import { BUILTIN_SETS } from './sets';
import { AWAY_NOTICE_MS, useKeepAwake } from './keepAwake';

describe('link parameters', () => {
  it('reads the game, the set and the settings; reports what it does not understand', () => {
    expect(readLinkParams({ plugin: 'pirates', set: 'spanish-verb-tenses', settings: '{"rounds":10}' })).toEqual({
      plugin: { kind: 'example', key: 'pirates' },
      set: { name: 'spanish-verb-tenses' },
      settings: { rounds: 10 },
      problems: [],
    });
    expect(readLinkParams({ pluginUrl: 'https://example.com/g.html', setUrl: 'https://example.com/s.json', plugin: 'kobliha' })).toMatchObject({
      plugin: { kind: 'url', url: 'https://example.com/g.html' }, // the URL wins over a key
      set: { url: 'https://example.com/s.json' },
    });
    expect(readLinkParams({ plugin: 'lab' }).plugin).toEqual({ kind: 'lab' });
    expect(readLinkParams({ plugin: 'quiz-race', pluginUrl: undefined, settings: '[1]', setUrl: 'javascript:alert(1)' }).problems).toEqual([
      { kind: 'game', value: 'quiz-race' },
      { kind: 'set', value: 'javascript:alert(1)' },
      { kind: 'settings', value: '[1]' },
    ]);
    expect(readLinkParams({ pluginUrl: 'file:///etc/passwd' })).toMatchObject({ plugin: null, problems: [{ kind: 'game' }] });
    expect(readLinkParams({})).toEqual({ plugin: null, set: null, settings: null, problems: [] });
  });

  it('finds built-in sets by their file name, sets by key or ID', () => {
    const spanish = BUILTIN_SETS.find((s) => s.slug === 'spanish-verb-tenses')!;
    expect(findSetKey('spanish-verb-tenses', BUILTIN_SETS)).toBe(spanish.key);
    expect(findSetKey('Spanish-Verb-Tenses', BUILTIN_SETS)).toBe(spanish.key);
    expect(findSetKey(spanish.key, BUILTIN_SETS)).toBe(spanish.key);
    expect(findSetKey(spanish.file.meta.id, BUILTIN_SETS)).toBe(spanish.key);
    expect(findSetKey('none', BUILTIN_SETS)).toBe('none');
    expect(findSetKey('None', BUILTIN_SETS)).toBe('none');
    expect(findSetKey('nope', BUILTIN_SETS)).toBeNull();
  });

  it('applies valid settings one by one and reports the others', () => {
    const defs = [
      { id: 'rounds', type: 'number', label: 'Rounds', default: 5, min: 1, max: 20 },
      { id: 'lang', type: 'select', label: 'Language', default: 'auto', options: [{ value: 'auto', label: 'Auto' }, { value: 'es', label: 'ES' }] },
    ] as unknown as SettingDefinition[];
    const result = applyLinkSettings(defs, { rounds: 5, lang: 'auto' }, { rounds: 10, lang: 'xx', colour: 'red' });
    expect(result.values).toEqual({ rounds: 10, lang: 'auto' });
    expect(result.rejected).toEqual(['lang', 'colour']);
  });
});

describe('a choice from a link is for this visit only', () => {
  afterEach(() => localStorage.clear());

  it('starts with the override and keeps the stored value until the user changes it', async () => {
    vi.useFakeTimers();
    localStorage.setItem('memizy-play:t-set', JSON.stringify('stored'));
    const state = persisted('t-set', 'default', 'from-link');
    expect(state.value).toBe('from-link');
    setUnsaved(state, 'loaded-later');
    await nextTick();
    vi.advanceTimersByTime(500);
    expect(JSON.parse(localStorage.getItem('memizy-play:t-set')!)).toBe('stored');
    state.value = 'chosen-by-user';
    await nextTick();
    vi.advanceTimersByTime(500);
    expect(JSON.parse(localStorage.getItem('memizy-play:t-set')!)).toBe('chosen-by-user');
    vi.useRealTimers();
  });
});

describe('keeping the host awake', () => {
  it('holds a wake lock while the game runs, again after the tab was hidden, and tells about a longer absence', async () => {
    const releases: string[] = [];
    let n = 0;
    const request = vi.fn(async () => {
      const id = `lock${++n}`;
      return { release: async () => void releases.push(id) };
    });
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
    let visibility: 'visible' | 'hidden' = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    const active = ref(false);
    let cameBack!: ReturnType<typeof useKeepAwake>['cameBack'];
    const wrapper = mount(defineComponent({ setup: () => ((cameBack = useKeepAwake(active).cameBack), () => h('div')) }));

    active.value = true;
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    clock.mockReturnValue(now + AWAY_NOTICE_MS + 1000);
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    clock.mockRestore();
    expect(cameBack.value).toBe(true);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2)); // the browser released it while hidden (simulated: the old one is replaced)

    active.value = false;
    await vi.waitFor(() => expect(releases.length).toBeGreaterThan(0));
    wrapper.unmount();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  });
});
