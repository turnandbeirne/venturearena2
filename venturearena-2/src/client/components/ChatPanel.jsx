import { useEffect, useRef, useState } from 'react';

export default function ChatPanel({ chat, me, onSend, canChat = true, placeholder = 'Message the table', empty = 'Say hello. Or answer the question of the table.' }) {
  const [text, setText] = useState('');
  const logRef = useRef(null);
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [chat.length]);
  const send = () => { const body = text.trim(); if (!body) return; setText(''); onSend(body); };
  return (
    <div className="chat grow">
      <div className="chat__log" ref={logRef}>
        {chat.length === 0 && <div className="tiny muted">{empty}</div>}
        {chat.map((m) => (m.system
          ? <div key={m.id} className="chat__sys small">{m.body}</div>
          : <div key={m.id}><b style={{ opacity: m.fromId === me.id ? 1 : 0.85 }}>{m.fromId === me.id ? 'You' : m.name}</b> <span>{m.body}</span></div>))}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <input className="input" maxLength={500} placeholder={canChat ? placeholder : 'Take a seat or watch to chat'} disabled={!canChat} value={text}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} aria-label="Chat message" />
        <button className="btn gold" onClick={send} disabled={!canChat || !text.trim()}>Send</button>
      </div>
    </div>
  );
}
