// Time invested: what a member has put into each game and into their own
// work, longest first. Games are measured by the table; everything else by
// the page saying "still here" while it is open and in use (arena/time.js).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { rpc } from '../api.js';
import { spanText } from '../../shared/time.js';

const KIND = { guide: 'With a guide', idea: 'Idea', project: 'Project', venture: 'Venture' };

export default function TimeCard() {
  const [t, setT] = useState(null);
  useEffect(() => { let alive = true; rpc('timeInvested', {}).then((r) => { if (alive) setT(r); }).catch(() => {}); return () => { alive = false; }; }, []);
  if (!t || t.total < 60000) return null;
  const rows = [
    ...t.games.filter((g) => g.ms > 0).map((g) => ({ id: `game:${g.gameId}`, icon: g.icon, label: g.gameName, note: `${g.played} game${g.played === 1 ? '' : 's'}`, ms: g.ms })),
    ...t.work.map((w) => ({ id: `${w.kind}:${w.ref}`, icon: '', label: w.label, note: KIND[w.kind] || w.kind, ms: w.ms })),
  ].sort((a, b) => b.ms - a.ms);
  const max = Math.max(1, ...rows.map((r) => r.ms));
  return (
    <section className="card stack" aria-labelledby="time-h" data-time-card>
      <div className="between"><h2 id="time-h">Time invested</h2><span className="chip">{spanText(t.total)}</span></div>
      <div className="hist__rows hist__rows--time" role="list">
        {rows.map((r) => (
          <div key={r.id} className="hist__row" role="listitem">
            <span className="hist__label">{r.icon ? <span aria-hidden="true">{r.icon} </span> : null}{r.label}<span className="tiny muted"> {r.note}</span></span>
            <span className="hist__track"><i className="hist__bar" style={{ width: `${(r.ms / max) * 100}%` }} /></span>
            <span className="hist__val">{spanText(r.ms)}</span>
          </div>
        ))}
      </div>
      <p className="tiny muted">Games count from the first move to the last. Time with a guide counts while the conversation is open and you are using it. <Link to="/history">Game history</Link></p>
    </section>
  );
}
