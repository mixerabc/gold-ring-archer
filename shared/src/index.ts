/**
 * GOLD RING — shared barrel.
 *
 * Importing from `@gold-ring/shared` brings the exact same rules and physics
 * into the client, the server and the test suite: the same numbers, the same
 * integrator, the same PRNG. A shot computed on the client is therefore
 * replayable on the server.
 */

export * from './types';
export * from './math/random';
export * from './physics/bow';
export * from './physics/wind';
export * from './physics/arrowFlight';
export * from './physics/shot';
export * from './rules/index';
export * from './rules/scoring';
export * from './rules/timing';
export * from './rules/formats';
export * from './rules/bracket';
export * from './data/gear';
export * from './ai/archerAI';
export * from './net/protocol';
