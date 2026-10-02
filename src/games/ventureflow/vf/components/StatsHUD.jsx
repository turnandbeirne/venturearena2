import { netWorth, passiveIncome } from '../game/players';
import { playSound } from '../audio/soundEngine';

/** $12,345 -> "$12.3k" once it's wide enough to threaten the single-line
 * layout on a phone — the full number is always one tap away in the
 * portfolio modal, so nothing is actually hidden, just abbreviated. */
function compact(amount) {
  const n = Math.round(amount);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs < 10000) return `${sign}$${abs.toLocaleString()}`;
  if (abs < 1000000) return `${sign}$${(abs / 1000).toFixed(abs < 100000 ? 1 : 0)}k`;
  return `${sign}$${(abs / 1000000).toFixed(1)}m`;
}

/**
 * A slim, always-visible strip of "your" core numbers — cash, net worth,
 * passive income, idea tokens, and how many businesses you're running —
 * plus a one-tap link into the same portfolio view the player card opens.
 *
 * Why this exists: the board is tall (shop, action bar, event log), and on
 * a phone especially, scrolling down to consider a purchase means your own
 * cash/net-worth numbers scroll off the top with it. This sits at the very
 * top of the board and goes `position: sticky` (see game.css's
 * .vf-stats-hud), so once you've scrolled past its natural spot it pins to
 * the top of the viewport and stays there — same idiom already used for
 * .vf-board-sidebar, just for the numbers you need to make your NEXT move
 * rather than the numbers you need for the sidebar's history.
 *
 * `player` is resolved by the caller (GameBoard) to "whoever you are right
 * now" — the active player if it's a human's turn, otherwise the first
 * human in the roster — so this always reads as "you," not "whoever's
 * turn it is." See GameBoard.jsx's `hudPlayer`.
 *
 * The sticky positioning lives on an OUTER wrapper (.vf-stats-hud-wrap),
 * separate from the INNER button that actually scrolls horizontally on a
 * cramped phone (.vf-stats-hud, overflow-x: auto). They can't be the same
 * element: Safari/WebKit (so every browser on iOS, not just Safari itself)
 * drops `position: sticky` entirely on an element that's ALSO its own
 * `overflow: auto` scroll container — a long-standing WebKit bug, not a
 * spec ambiguity. Desktop/Chrome-on-desktop is more forgiving, which is
 * exactly why an earlier version of this (sticky + overflow-x on one
 * button) worked everywhere except real phones.
 */
export default function StatsHUD({ player, prices, allPlayers, month, weatherIncomeAmounts, onOpenPortfolio }) {
  if (!player) return null;
  const worth = netWorth(player, prices);
  const passive = passiveIncome(player, { allPlayers, prices, month, weatherIncomeAmounts });
  const companies = player.businesses.length;

  return (
    <div className="vf-stats-hud-wrap">
      <button
        type="button"
        className="vf-stats-hud"
        title="Tap for your full portfolio"
        onClick={() => {
          playSound('click');
          onOpenPortfolio(player.id);
        }}
      >
        <span className="vf-stats-hud__item vf-stats-hud__item--worth">
          <span className="vf-stats-hud__icon" aria-hidden="true">
            📈
          </span>
          {compact(worth)}
        </span>
        <span className="vf-stats-hud__item">
          <span className="vf-stats-hud__icon" aria-hidden="true">
            💵
          </span>
          {compact(player.cash)}
        </span>
        <span className="vf-stats-hud__item">
          <span className="vf-stats-hud__icon" aria-hidden="true">
            🌱
          </span>
          {compact(passive)}/mo
        </span>
        <span className="vf-stats-hud__item">
          <span className="vf-stats-hud__icon" aria-hidden="true">
            💡
          </span>
          {player.skillTokens}
        </span>
        <span className="vf-stats-hud__item">
          <span className="vf-stats-hud__icon" aria-hidden="true">
            🏢
          </span>
          {companies}
        </span>
        <span className="vf-stats-hud__portfolio-hint">🔍 Portfolio</span>
      </button>
    </div>
  );
}
