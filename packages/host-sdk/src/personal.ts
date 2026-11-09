/**
 * Personal sets (SPEC 3.4, protocol 1.1): in a game where every player learns their own set,
 * the player's set never leaves their device. This wraps the host API of a player's game
 * instance on that device: `hello` gives the game the player's own set (with answers) and
 * progress, and learning – answers, stars, which item next, media – happens here, with the
 * device's storage. Everything else goes to the real host (the teacher's app).
 */

import { resolveAsset, type OQSEAnyItem, type OQSEFile } from '@memizy/oqse';
import { ProtocolError, type AnswerRecord, type HostApi, type InitPayload } from '@memizy/protocol';
import { isNew, leitner, pickItems, type LearningAlgorithm, type PickHistoryEntry, type StudyMode } from './learning';
import type { HostStorage } from './storage';
import type { PreparedSet } from './plugin';

/** The player's own set and where their progress is kept (their device). */
export interface PersonalSet {
  /** The set, already cut down to what the player practises. */
  file: OQSEFile;
  /** Where the player's progress is kept on this device. */
  storage: HostStorage;
  /** The player's key in `storage`. */
  userKey: string;
  /** How the player studies this set (for choosing the next items). */
  mode?: StudyMode;
  algorithm?: LearningAlgorithm;
  /** Media of the set that are not URLs (a package). */
  loadAsset?: (key: string, itemId: string | undefined) => Promise<Blob>;
}

/** What `Player.set` says about a personal set. */
export const personalSetInfo = (file: OQSEFile) => ({ id: file.meta.id, title: String(file.meta.title ?? '').slice(0, 200), ...(file.meta.language && { language: String(file.meta.language).slice(0, 35) }) });

/** A personal host API that can take another set while the game runs (`switchTo`). */
export interface PersonalHostApi extends HostApi {
  /** The features the game listed in its handshake (e.g. `set-changes`). */
  readonly gameFeatures: string[];
  /**
   * Switches the player's set (edits reloaded, another set or choice): returns what the game
   * gets in `setChanged`. Items of the earlier set stay known (a question shown keeps working).
   */
  switchTo(personal: PersonalSet, prepared: PreparedSet): Promise<{ set: { meta: OQSEFile['meta']; items: OQSEAnyItem[] }; progress: Record<string, import('@memizy/oqse').ProgressRecord> }>;
}

/**
 * The host API of a player's instance with their own set. `prepared` is the personal set
 * prepared for the plugin (`prepareSetForPlugin`); `self` is the player's ID once known.
 */
export function personalHostApi(remote: HostApi, firstPersonal: PersonalSet, firstPrepared: PreparedSet, self: () => string | null): PersonalHostApi {
  let personal = firstPersonal;
  let prepared = firstPrepared;
  let items = prepared.set.items as OQSEAnyItem[];
  const byId = new Map(items.map((i) => [i.id, i]));
  let setId = prepared.set.meta.id;
  const algorithm = () => personal.algorithm ?? leitner;
  const history: PickHistoryEntry[] = [];
  const progress = () => personal.storage.loadProgress(personal.userKey, setId);
  let features: string[] = [];

  return {
    get gameFeatures() {
      return features;
    },
    async switchTo(next, nextPrepared) {
      personal = next;
      prepared = nextPrepared;
      items = prepared.set.items as OQSEAnyItem[];
      for (const item of items) byId.set(item.id, item); // the earlier ones stay known
      setId = prepared.set.meta.id;
      return { set: { meta: structuredClone(prepared.set.meta), items: structuredClone(items) }, progress: await progress() };
    },
    ...remote,
    async hello(handshake) {
      features = [...handshake.features];
      const init = (await remote.hello(handshake)) as InitPayload;
      return {
        ...init,
        session: { ...init.session, sets: 'personal' as const },
        set: { meta: structuredClone(prepared.set.meta), items: structuredClone(items) },
        progress: await progress(),
      };
    },
    async recordAnswer(answer: AnswerRecord) {
      // Another player's answer (this instance is the authority of a host who plays): theirs to keep.
      const owner = self();
      if (answer.playerId && owner && answer.playerId !== owner) return remote.recordAnswer(answer);
      const known = byId.get(answer.itemId);
      if (!known) return; // not of the player's set (a generated item): nothing to keep here
      if (known.type === 'open-ended') return; // not checked automatically (SPEC 5.1)
      const records = await progress();
      history.push({ itemId: answer.itemId, correct: answer.isCorrect && !answer.isSkipped, wasNew: isNew(records[answer.itemId]) });
      const { item: _attached, playerId: _player, ...stored } = answer;
      const record = algorithm().apply(records[answer.itemId], stored, new Date(), structuredClone(known));
      await personal.storage.saveProgress(personal.userKey, setId, { [answer.itemId]: record });
    },
    async markItem(itemId, mark) {
      if (!byId.has(itemId)) return remote.markItem?.(itemId, mark);
      const current = (await progress())[itemId];
      const record = current ? { ...current, starred: mark.starred } : { bucket: 0 as const, stats: { attempts: 0, incorrect: 0, streak: 0 }, starred: mark.starred };
      await personal.storage.saveProgress(personal.userKey, setId, { [itemId]: record });
    },
    async pickItems(request) {
      if (request.playerId !== self()) {
        if (!remote.pickItems) throw new ProtocolError('UNKNOWN_METHOD', 'pickItems is not available here.');
        return remote.pickItems(request);
      }
      return pickItems(items, await progress(), { count: request.count, now: new Date(), random: Math.random, weights: request.weights, types: request.types, exclude: request.exclude, mode: personal.mode, history });
    },
    async getAsset(key, itemId) {
      const media = resolveAsset(key, itemId ? byId.get(itemId) : undefined, prepared.set.meta);
      if (media && personal.loadAsset) return personal.loadAsset(key, itemId);
      return remote.getAsset(key, itemId);
    },
  };
}
