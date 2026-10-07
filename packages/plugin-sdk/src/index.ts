/**
 * @memizy/plugin-sdk – build Memizy learning games in a single HTML file.
 * Guide: docs/ai-plugin-guide.md · Protocol: @memizy/protocol (SPEC.md)
 */

export { defineGame, SDK_VERSION, type GameHandle } from './game/defineGame';
export { checkAnswer } from './checkAnswer';
export type * from './types';
export { createScene3d, nearestTarget, webglAvailable, type Scene3d, type Scene3dFallbackKind, type Scene3dOptions, type ScreenTarget } from './three/scene3d';
