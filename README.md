# one4one

A drink tracker for a night out with friends. One person starts a room, shares
the six-character code, and everyone logs their own drinks from their own phone.
Counts, standard drinks, pace and a rough BAC estimate update live for the whole
room.

No accounts, no passwords: the room code is the invitation, and rooms delete
themselves after two days of inactivity.

> **one4one is a counter, not a breathalyser.** The BAC number is a Widmark
> estimate from your weight, the time and how much you have logged. It ignores
> food, tolerance, medication, absorption and individual variation, and it is
> never a measure of impairment or of whether it is legal or safe to drive.

## What it does

- **Live rooms.** Everyone on their own phone, updates in about a second.
- **Real drink types.** Beer, IPA, wine, shot, cocktail, seltzer, or a custom
  size and ABV — all converted to US standard drinks (14 g of alcohol) so a
  shot and a pint compare fairly.
- **Backdating.** "I had that one an hour ago" keeps the estimate honest.
- **BAC estimate, optional and private by choice.** Enter a weight to get one;
  turn off sharing and the room still sees your counts, but your weight never
  leaves your device's room record for anyone else's screen.
- **Comparison.** A leaderboard by standard drinks, plus a cumulative timeline
  chart (and a table view of the same numbers).
- **Survives a bad signal.** Drinks logged while offline queue up and flush when
  the connection comes back.

## Stack

| Piece | What |
|---|---|
| `shared/` | Drink and Widmark math, plus the wire types. Pure and unit-tested. |
| `server/` | Express + `ws` + SQLite (`better-sqlite3`). Serves the built client in production. |
| `web/` | Vite + React, mobile-first. |

The server broadcasts a full room snapshot on every change rather than patching
— rooms are small, and it removes a class of divergence bugs.

## Running it locally

```bash
npm install
npm run dev
```

`npm run dev` starts the API on `:8080` and Vite on `:5173` with a proxy for
`/api` and `/ws`. Open http://localhost:5173, start a round, then open the room
URL in a second browser (or a private window) to watch it sync.

```bash
npm test         # drink math, BAC model, room store
npm run typecheck
npm run build    # web/dist + server/dist
npm start        # production mode: one process, one port
```

## Deploying

See [`docs/DEPLOY.md`](docs/DEPLOY.md) — systemd or Docker Compose on a Droplet,
with the nginx config the WebSocket needs.

## Privacy

Everything lives in one SQLite file on your own server. Anyone with a room code
can see that room, so treat the code like the invitation it is. Body weight is
only stored if you enter one, is only used for your estimate, and is redacted
from what other people's devices receive when you turn sharing off.
