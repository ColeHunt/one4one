import { getDrinkType, totalStandardDrinks } from '@shared/drinks.js';
import type { Drink, Member } from '@shared/types.js';
import { formatClock, formatStandardDrinks } from '../lib/format.js';

interface MemberDrinksSheetProps {
  member: Member;
  /** Already filtered to this member — the sheet doesn't know about anyone else's. */
  drinks: Drink[];
  meId: string;
  onUndo: (drinkId: string) => void;
  onClose: () => void;
  /** Once a room is closed, logging is frozen — nothing left to undo. */
  closed?: boolean;
}

export function MemberDrinksSheet({
  member,
  drinks,
  meId,
  onUndo,
  onClose,
  closed = false,
}: MemberDrinksSheetProps) {
  const isMe = member.id === meId;
  const sorted = [...drinks].sort((a, b) => b.consumedAt - a.consumedAt);

  return (
    <div
      className="sheet-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${member.name}'s drinks`}
    >
      <div className="sheet stack" onClick={(event) => event.stopPropagation()}>
        <div className="row between">
          <div className="row" style={{ gap: '0.6rem' }}>
            <span
              className="swatch"
              style={{ background: member.color, height: 24 }}
              aria-hidden="true"
            />
            <strong>
              {member.name}
              {isMe && <span className="muted"> (you)</span>}
            </strong>
          </div>
          <button className="btn btn-ghost" style={{ minHeight: 36 }} onClick={onClose}>
            Close
          </button>
        </div>

        {sorted.length === 0 ? (
          <p className="tiny muted" style={{ margin: 0 }}>
            Nothing logged yet.
          </p>
        ) : (
          <>
            <p className="tiny muted" style={{ margin: 0 }}>
              {sorted.length} drink{sorted.length === 1 ? '' : 's'} ·{' '}
              {formatStandardDrinks(totalStandardDrinks(sorted))} standard
            </p>
            <div>
              {sorted.map((drink) => {
                const type = getDrinkType(drink.kind);
                // An optimistic row has no server id yet; it is shown faded.
                const isPending = drink.id === drink.clientId;
                return (
                  <div className={`log-row${isPending ? ' pending' : ''}`} key={drink.id}>
                    <span>
                      <span aria-hidden="true">{type?.emoji ?? '🥂'}</span>{' '}
                      {type?.label ?? 'Custom'}{' '}
                      <span className="muted">({formatStandardDrinks(drink.standardDrinks)} std)</span>
                    </span>
                    <span className="row" style={{ gap: '0.5rem' }}>
                      <span className="muted tiny">{formatClock(drink.consumedAt)}</span>
                      {isMe && !closed && (
                        <button
                          className="btn btn-ghost tiny"
                          style={{ minHeight: 32, padding: '0.2rem 0.55rem' }}
                          onClick={() => onUndo(drink.id)}
                          aria-label={`Remove ${type?.label ?? 'drink'} at ${formatClock(drink.consumedAt)}`}
                        >
                          Undo
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
