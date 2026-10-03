// The key to a game, as a page of its own: every card or piece, what it does,
// the trait it stands for, the lesson, and (VentureBoom) the true story behind
// it. The same content the table's "Key" link opens during a game.
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useGames } from '../games.js';
import { loadGameInfo } from '../../games/boards.js';
import { GameKey, HowTo } from '../game/GameInfo.jsx';
import { Loading } from '../components/ui.jsx';

export default function GameKeyPage() {
  const { gameId } = useParams();
  const { hash } = useLocation();
  const nav = useNavigate();
  const games = useGames();
  const [mod, setMod] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { let alive = true; setMod(null); setFailed(false); loadGameInfo(gameId).then((m) => { if (alive) setMod(m); }).catch(() => { if (alive) setFailed(true); }); return () => { alive = false; }; }, [gameId]);

  const game = games ? games.games.find((g) => g.id === gameId) : null;
  if (failed || (games && !game)) return <div className="stack" style={{ maxWidth: 520 }}><div className="card stack" role="alert"><h2>No key here</h2><p className="muted">That game is not on VentureArena.</p></div><div><Link className="btn gold" to="/play">Back to the games</Link></div></div>;
  if (!mod || !game) return <Loading what="Opening the key" />;
  const art = mod.keyArt ? (item) => (item.art === null ? null : mod.keyArt(item.art || item.id)) : null;
  return (
    <div className="stack-lg" style={{ maxWidth: 760 }}>
      <button type="button" className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => nav('/play')}>{'←'} All games</button>
      <div>
        <div className="eyebrow">The key</div>
        <h1><span aria-hidden="true">{game.icon}</span> {game.brand || game.name}</h1>
        <p className="muted">{game.tagline}</p>
      </div>
      <section className="card stack" aria-labelledby="key-h">
        <h2 id="key-h">{gameId === 'ventureboom' || gameId === 'ventureflow' ? 'Every card and what it teaches' : 'The pieces and what they teach'}</h2>
        {mod.info.key ? <GameKey data={mod.info.key} art={art} focus={hash ? hash.slice(1).replace(/^key-/, '') : null} /> : <p className="muted">This game has no key yet.</p>}
      </section>
      <section className="card stack" aria-labelledby="key-how">
        <h2 id="key-how">How to play</h2>
        <HowTo game={game} />
      </section>
    </div>
  );
}
