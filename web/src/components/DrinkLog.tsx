import { getDrinkType } from '@shared/drinks.js';
import type { Drink, Member } from '@shared/types.js';
import { formatClock, formatStandardDrinks } from '../lib/format.js';

interface DrinkLogProps {
  drinks: Drink[];
  members: Member[];
  meId: string;
  onUndo: (drinkId: string) => void;
  /** Once a room is closed, logging is frozen — nothing left to undo. */
  closed?: boolean;
}

export function DrinkLog({ drinks, members, meId, onUndo, closed = false }: DrinkLogProps) {
  if (drinks.length === 0) {
    return (
      <div className="card">
        <h2>Tonight</h2>
        <p className="tiny muted" style={{ margin: 0 }}>
          Nothing logged yet.
        </p>
      </div>
    );
  }

  const nameOf = (memberId: string) =>
    members.find((member) => member.id === memberId)?.name ?? 'Someone';

  const recent = [...drinks].sort((a, b) => b.consumedAt - a.consumedAt).slice(0, 25);

  return (
    <div className="card">
      <h2>Tonight</h2>
      {recent.map((drink) => {
        const type = getDrinkType(drink.kind);
        // An optimistic row has no server id yet; it is shown faded.
        const isPending = drink.id === drink.clientId;
        return (
          <div className={`log-row${isPending ? ' pending' : ''}`} key={drink.id}>
            <span>
              <span aria-hidden="true">{type?.emoji ?? '🥂'}</span> {nameOf(drink.memberId)} ·{' '}
              {type?.label ?? 'Custom'}{' '}
              <span className="muted">({formatStandardDrinks(drink.standardDrinks)} std)</span>
            </span>
            <span className="row" style={{ gap: '0.5rem' }}>
              <span className="muted tiny">{formatClock(drink.consumedAt)}</span>
              {drink.memberId === meId && !closed && (
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
  );
}
