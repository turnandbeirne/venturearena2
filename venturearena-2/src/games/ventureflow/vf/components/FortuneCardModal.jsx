import { playSound } from '../audio/soundEngine';
import LessonTip from './LessonTip';

export default function FortuneCardModal({ entry, onContinue }) {
  if (!entry) return null;
  const { playerName, avatar, deckId, card, description } = entry;
  const good = deckId === 'opportunity';

  function handleContinue() {
    playSound('click');
    onContinue();
  }

  return (
    <div className="vf-modal-overlay">
      <div className={`vf-modal ${good ? 'vf-modal--good' : 'vf-modal--bad'}`}>
        <div className="vf-modal__who">
          {avatar} {playerName}'s Fortune Card
        </div>
        <div className="vf-modal__icon">{card.icon}</div>
        <div className="vf-modal__title">{card.title}</div>
        <p className="vf-modal__flavor">{card.flavor}</p>
        <div className={`vf-modal__effect ${good ? 'vf-modal__effect--good' : 'vf-modal__effect--bad'}`}>
          {description}
        </div>
        <div className="vf-modal__why">
          <strong>Why?</strong>
          {card.why}
          <LessonTip conceptId={good ? 'opportunity' : 'emergencyFund'} />
        </div>
        <button type="button" className="vf-btn vf-btn--primary vf-btn--lg" onClick={handleContinue}>
          Got it!
        </button>
      </div>
    </div>
  );
}
