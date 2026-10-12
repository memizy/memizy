/**
 * `checkAnswer(item, answer)` for games: the OQSE rules (`checkAnswer` from
 * `@memizy/oqse`, "Answer Formats" in the OQSE specification), but it refuses a public
 * copy of an item (`answerHidden`, SPEC 4.4), which a player's device has instead of the answer.
 */

import { checkAnswer as checkOQSEAnswer, type OQSEAnyItem } from '@memizy/oqse';

export function checkAnswer(item: OQSEAnyItem, answer: unknown): boolean {
  if (item && typeof item === 'object' && (item as { answerHidden?: boolean }).answerHidden) {
    throw new Error(`checkAnswer: this device has item "${item.id}" without its answer. Check answers in actions (they run on the authority), or show them after ctx.reveal().`);
  }
  return checkOQSEAnswer(item, answer);
}
