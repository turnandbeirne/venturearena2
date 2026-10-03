// The one list of games. Rules, bot, housekeeping, telemetry and metadata for
// each. No React in here: the server and the tests import this file.
// Boards are registered separately in boards.js (browser only).
// Adding a game: follow the checklist in HOUSE-RULES.md, section 2.
import * as ventureflow from './ventureflow/rules.js';
import { bot as ventureflowBot } from './ventureflow/bot.js';
import ventureflowMeta from './ventureflow/meta.js';

import * as ventureboom from './ventureboom/rules.js';
import { bot as ventureboomBot } from './ventureboom/bot.js';
import ventureboomMeta from './ventureboom/meta.js';

import * as fourinarow from './fourinarow/rules.js';
import { bot as fourinarowBot } from './fourinarow/bot.js';
import fourinarowMeta from './fourinarow/meta.js';

import * as chess from './chess/rules.js';
import { bot as chessBot } from './chess/bot.js';
import chessMeta from './chess/meta.js';

import * as checkers from './checkers/rules.js';
import { bot as checkersBot } from './checkers/bot.js';
import checkersMeta from './checkers/meta.js';

import * as reversi from './reversi/rules.js';
import { bot as reversiBot } from './reversi/bot.js';
import reversiMeta from './reversi/meta.js';

import * as mancala from './mancala/rules.js';
import { bot as mancalaBot } from './mancala/bot.js';
import mancalaMeta from './mancala/meta.js';

/**
 * One entry per game. `rules` is the boardgame.io game; everything else the
 * arena may call is optional and comes straight from the game's rules module:
 *   housekeeping(G, ctx)        what the server's own seat should do, and when
 *   telemetry(G, seat)          metrics, skill tags and style signals at the end
 *   normalizeSettings(s)        validate the host's table settings
 *   botLineup(settings, count)  which robots fill the empty seats
 *   onLeave(G, seat, reason)    the move to make when a person leaves mid-game
 *   observations / playStyle    lines for the debrief and the player card
 */
function entry(mod, game, bot, meta) {
  return {
    rules: game, bot, meta,
    telemetry: mod.telemetry, housekeeping: mod.housekeeping, normalizeSettings: mod.normalizeSettings,
    botLineup: mod.botLineup, onLeave: mod.onLeave, observations: mod.observations, playStyle: mod.playStyle,
  };
}

export const GAMES = {
  ventureflow: entry(ventureflow, ventureflow.ventureFlow, ventureflowBot, ventureflowMeta),
  ventureboom: entry(ventureboom, ventureboom.ventureBoom, ventureboomBot, ventureboomMeta),
  fourinarow: entry(fourinarow, fourinarow.fourInARow, fourinarowBot, fourinarowMeta),
  chess: entry(chess, chess.chess, chessBot, chessMeta),
  checkers: entry(checkers, checkers.checkers, checkersBot, checkersMeta),
  reversi: entry(reversi, reversi.reversi, reversiBot, reversiMeta),
  mancala: entry(mancala, mancala.mancala, mancalaBot, mancalaMeta),
};

/** Lobby order. A game missing from this list is registered but hidden. */
export const GAME_ORDER = ['ventureflow', 'ventureboom', 'fourinarow', 'chess', 'checkers', 'reversi', 'mancala'];

export function getGame(id) {
  return Object.prototype.hasOwnProperty.call(GAMES, id) ? GAMES[id] : null;
}

export function listMeta() {
  return GAME_ORDER.map((id) => GAMES[id].meta);
}
