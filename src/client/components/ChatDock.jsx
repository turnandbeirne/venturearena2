// The chat window: your conversations with the people you are connected to,
// on every page. On a wide screen it is a window docked in the bottom right
// corner; on a phone it is a sheet opened from the button in the top bar.
// Either way it stays open, on the same conversation, while you move around
// the site (and comes back after a reload).
//
// It is not shown during a game: the table has its own chat there, and the
// game stage covers the page. A message that arrives meanwhile is counted on
// the button and announced with a toast.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { rpc } from '../api.js';
import { useEvent } from '../realtime.js';
import { Avatar, useToast } from './ui.jsx';
import { timeAgo } from '../../shared/profile.js';

const KEY = 'va.chat';
function remembered() {
  try { const v = JSON.parse(sessionStorage.getItem(KEY) || 'null'); return v && typeof v === 'object' ? { open: !!v.open, withId: typeof v.withId === 'string' ? v.withId : null } : { open: false, withId: null }; } catch { return { open: false, withId: null }; }
}

/** All of the chat window's state. One per signed-in layout; the button and the window both read it. */
export function useChat(user) {
  const loc = useLocation();
  const toast = useToast();
  const first = useMemo(remembered, []);
  const [open, setOpenState] = useState(first.open);
  const [withId, setWithIdState] = useState(first.withId);
  const [list, setList] = useState(null);
  const [thread, setThread] = useState(null);
  const [failed, setFailed] = useState('');
  const state = useRef({ open, withId });
  state.current = { open, withId };

  const remember = (next) => { try { sessionStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ } };
  const setOpen = useCallback((v) => { setOpenState(v); remember({ open: v, withId: state.current.withId }); }, []);
  const setWithId = useCallback((id) => { setWithIdState(id); setThread(null); setFailed(''); remember({ open: state.current.open, withId: id }); }, []);

  const listRef = useRef(null);
  const loadList = useCallback(() => rpc('chatList').then((l) => { listRef.current = l; setList(l); }).catch(() => {}), []);
  const loadThread = useCallback((id) => rpc('thread', { userId: id })
    .then((t) => { if (state.current.withId === id) setThread(t); })
    .catch((e) => { if (state.current.withId === id) setFailed(e.message); }), []);

  useEffect(() => { loadList(); }, [loadList, user.id]);
  // The conversation on screen is fetched (and so marked read) only while the window is open.
  useEffect(() => { if (open && withId) loadThread(withId).then(loadList); }, [open, withId, loadThread, loadList]);

  useEvent('inbox', (p) => {
    if (!p || !['message', 'read', 'connection', 'answered'].includes(p.kind)) return;
    const { open: isOpen, withId: current } = state.current;
    if (p.kind === 'message' && isOpen && current === p.fromId) { loadThread(current).then(loadList); return; }
    loadList().then(() => {
      // Not looking at that conversation: say who wrote. (The Inbox page shows its own thread.)
      if (p.kind !== 'message' || loc.pathname === `/inbox/${p.fromId}`) return;
      const who = listRef.current && listRef.current.people.find((x) => x.card.id === p.fromId);
      if (who) toast(`New message from ${who.card.displayName}`);
    });
  });

  const send = useCallback(async (body) => {
    const id = state.current.withId;
    const r = await rpc('sendMessage', { toId: id, body });
    if (state.current.withId === id) setThread((t) => (t ? { ...t, messages: [...t.messages, r.message] } : t));
    loadList();
  }, [loadList]);

  return { open, setOpen, withId, setWithId, list, thread, failed, send, unread: list ? list.unread : 0, me: user };
}

const ICON = <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />;

/** The button that opens the window. `variant="bar"` is the small one in the phone's top bar. */
export function ChatLauncher({ chat, variant = 'dock' }) {
  if (variant === 'dock' && chat.open) return null;
  return (
    <button type="button" className={`chatdock__launch chatdock__launch--${variant}`} onClick={() => chat.setOpen(!chat.open)} aria-expanded={chat.open}
      aria-label={chat.unread > 0 ? `Messages, ${chat.unread} unread` : 'Messages'}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICON}</svg>
      {variant === 'dock' && <span>Messages</span>}
      {chat.unread > 0 && <span className="chatdock__badge">{chat.unread > 99 ? '99+' : chat.unread}</span>}
    </button>
  );
}

function People({ chat }) {
  const { list } = chat;
  if (!list) return <div className="chatdock__empty muted small">Opening your messages{'…'}</div>;
  if (list.guest) return <div className="chatdock__empty small"><p className="muted">Messages are for members. Create a free account and you can talk to the people you play with.</p><Link className="btn gold sm" to="/signin?mode=create" onClick={() => chat.setOpen(false)}>Create a free account</Link></div>;
  if (list.people.length === 0) return <div className="chatdock__empty small"><p className="muted">Nobody here yet. Connect with someone after a game and you can talk to them from any page.</p><Link className="btn sm" to="/people" onClick={() => chat.setOpen(false)}>Find people</Link></div>;
  return (
    <ul className="chatdock__people">
      {list.people.map((p) => (
        <li key={p.card.id}>
          <button type="button" className="chatdock__person" onClick={() => chat.setWithId(p.card.id)} aria-label={`${p.card.displayName}${p.card.online ? ', online' : ''}${p.unread ? `, ${p.unread} unread` : ''}`}>
            <Avatar p={p.card} size={36} dot={p.card.online} />
            <span className="grow">
              <span className="chatdock__name truncate">{p.card.displayName}</span>
              <span className={`chatdock__last truncate${p.unread ? ' chatdock__last--new' : ''}`}>{p.last ? `${p.last.mine ? 'You: ' : ''}${p.last.body}` : 'Say hello'}</span>
            </span>
            <span className="chatdock__meta">{p.last && <span className="tiny muted">{timeAgo(p.last.at).replace(' ago', '')}</span>}{p.unread > 0 && <span className="chatdock__badge chatdock__badge--inline">{p.unread}</span>}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Conversation({ chat }) {
  const { thread, failed, me } = chat;
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const logRef = useRef(null);
  const inputRef = useRef(null);
  const count = thread ? thread.messages.length : 0;
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [count]);
  useEffect(() => { if (thread && inputRef.current && window.matchMedia('(min-width: 900px)').matches) inputRef.current.focus({ preventScroll: true }); }, [thread && thread.with.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async (e) => {
    e.preventDefault();
    const body = text.trim(); if (!body) return;
    setText(''); setError('');
    try { await chat.send(body); } catch (err) { setError(err.message); setText(body); }
  };
  if (failed) return <div className="chatdock__empty small"><div className="error" role="alert">{failed}</div><button type="button" className="btn sm" onClick={() => chat.setWithId(null)}>Back to your messages</button></div>;
  return (
    <>
      <div className="chatdock__log" ref={logRef} role="log" aria-label={thread ? `Conversation with ${thread.with.displayName}` : 'Conversation'}>
        {!thread && <div className="tiny muted">Opening the conversation{'…'}</div>}
        {thread && thread.messages.length === 0 && <div className="tiny muted">No messages yet. A good opener: what did your last game teach you?</div>}
        {thread && thread.messages.map((m) => <div key={m.id} className={`bubble${m.fromId === me.id ? ' mine' : ''}`}><span className="sr-only">{m.fromId === me.id ? 'You: ' : `${thread.with.displayName}: `}</span>{m.body}</div>)}
      </div>
      {error && <div className="error small" role="alert">{error}</div>}
      {thread && !thread.canMessage
        ? <div className="chatdock__note small muted">You cannot send a message to this member right now.</div>
        : (
          <form className="chatdock__send" onSubmit={submit}>
            <input ref={inputRef} className="input" maxLength={2000} value={text} placeholder="Message" disabled={!thread} onChange={(e) => setText(e.target.value)} aria-label={thread ? `Message ${thread.with.displayName}` : 'Message'} />
            <button className="btn gold" disabled={!text.trim()}>Send</button>
          </form>
        )}
    </>
  );
}

export function ChatWindow({ chat }) {
  const ref = useRef(null);
  const { open, withId, thread, list } = chat;
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && ref.current && ref.current.contains(document.activeElement)) chat.setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, chat]);
  if (!open) return null;
  const who = withId ? (thread ? thread.with : list && list.people.find((p) => p.card.id === withId) ? list.people.find((p) => p.card.id === withId).card : null) : null;
  return (
    <section className="chatdock" ref={ref} aria-label="Messages">
      <header className="chatdock__head">
        {withId ? (
          <>
            <button type="button" className="btn sm" onClick={() => chat.setWithId(null)} aria-label="Back to all conversations">{'←'}</button>
            {who && <Avatar p={who} size={28} dot={who.online} />}
            {who ? <Link to={`/p/${who.username}`} className="grow truncate chatdock__title">{who.displayName}</Link> : <span className="grow chatdock__title">Conversation</span>}
          </>
        ) : <h2 className="grow chatdock__title">Messages</h2>}
        <button type="button" className="btn sm" onClick={() => chat.setOpen(false)} aria-label="Close messages">{'✕'}</button>
      </header>
      {withId ? <Conversation chat={chat} /> : <People chat={chat} />}
    </section>
  );
}
