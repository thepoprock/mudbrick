/**
 * Build a playable Game from a parsed save: the world (via worldFromSave) plus the game-level
 * state the engine's turn loop needs. Every field is read from the save's verified header fields.
 */
import { Game, Rng, type GameState, type World } from '@mudbrick/engine';
import type { Rules, SaveFile } from '@mudbrick/formats';
import { engineRules } from './worldFromSave.js';

export function gameFromSave(save: SaveFile, rules: Rules, world: World): Game {
  const state: GameState = {
    turn: save.parameters.turn,
    difficulty: save.parameters.difficulty,
    realisticCombat: !save.options.simplifiedCombat,
    barbarianActivity: save.parameters.barbarianActivity,
    firstDiscoveredBy: [...save.techs.firstDiscoveredBy],
    pollutionSquares: save.parameters.pollutionSquares,
    ...(save.options.raw[1] !== undefined && (save.options.raw[1] & 1) !== 0
      ? { noRestart: true }
      : {}),
    tribesPlayed: save.civs.reduce<number[]>((t, c, slot) => {
      if (slot !== 0 && typeof c.tribeId === 'number') t[c.tribeId] = (t[c.tribeId] ?? 0) + 1;
      return t;
    }, []),
    ...(save.scenario
      ? {
          scenario: {
            techParadigm: save.scenario.techParadigm,
            fixedCost: save.scenario.yearsPerTurn !== 0,
            endTurn: save.scenario.maxTurns,
            objectiveVictory: save.scenario.objectiveVictory,
            countWondersAsObjectives: save.scenario.countWondersAsObjectives,
            protagonist: save.scenario.protagonist,
            objectives: {
              decisiveVictory: save.scenario.objectivesDecisiveVictory,
              marginalVictory: save.scenario.objectivesMarginalVictory,
              marginalDefeat: save.scenario.objectivesMarginalDefeat,
              decisiveDefeat: save.scenario.objectivesDecisiveDefeat,
            },
          },
          forbidGovernmentChange: save.scenario.forbidGovernmentSwitching,
          eliminatePollution: save.scenario.eliminatePollution,
        }
      : {}),
    ...(save.options.raw[8] !== undefined && (save.options.raw[8] & 4) !== 0
      ? { researchDearer: true }
      : {}),
    ...(save.options.raw[8] !== undefined && (save.options.raw[8] & 8) !== 0
      ? { researchCheaper: true }
      : {}),
  };
  // The original seeds the C runtime's rand(); the save does not carry its state, so any seed is
  // as faithful as another. Derive one from the turn so reloads replay the same way.
  const rng = new Rng(0x9e3779b9 ^ (save.parameters.turn * 2654435761));
  return new Game(world, engineRules(rules), rng, state);
}
