/** Wire types shared by the server and the web client. */

export type Sex = 'male' | 'female' | 'unspecified';

export interface Member {
  id: string;
  name: string;
  color: string;
  /** Body weight in kilograms. Null when the member has not entered one. */
  weightKg: number | null;
  sex: Sex;
  /** When false, other members see this member's counts but not their BAC estimate. */
  shareBac: boolean;
  joinedAt: number;
}

export interface Drink {
  id: string;
  memberId: string;
  /** A key of DRINK_TYPES, or 'custom'. */
  kind: string;
  standardDrinks: number;
  volumeMl: number | null;
  abv: number | null;
  /** Epoch ms the drink was actually consumed (may be backdated by the user). */
  consumedAt: number;
  /** Echoed back so the client that logged it can retire its optimistic copy. */
  clientId: string | null;
}

export interface Match {
  id: string;
  /** A key of GAME_TYPES. */
  gameKey: string;
  /** 0+ members — empty for a free-for-all with no real "winner", just a loser. */
  winnerIds: string[];
  /** 1+ members — a match always has someone who lost, or there's no record to keep. */
  loserIds: string[];
  note: string | null;
  /** Epoch ms the game was played. */
  playedAt: number;
  /** Whoever reported it — not necessarily a participant, and the only one who can retract it. */
  reportedBy: string;
}

export interface RoomState {
  code: string;
  /** Monotonic revision. Clients ignore snapshots older than the one they hold. */
  rev: number;
  createdAt: number;
  members: Member[];
  drinks: Drink[];
  matches: Match[];
}

/** Fields a member is allowed to change about themselves. */
export interface ProfilePatch {
  name?: string;
  color?: string;
  weightKg?: number | null;
  sex?: Sex;
  shareBac?: boolean;
}

export interface NewDrink {
  kind: string;
  volumeMl?: number | null;
  abv?: number | null;
  /** Epoch ms; defaults to now. Used for "I had this 30 minutes ago". */
  consumedAt?: number;
  /** Client-generated id used to reconcile the optimistic copy. */
  clientId?: string;
}

export interface NewMatch {
  gameKey: string;
  winnerIds: string[];
  loserIds: string[];
  note?: string | null;
}

export type ClientMessage =
  | { t: 'join'; roomCode: string; memberId: string; name: string }
  | { t: 'add_drink'; drink: NewDrink }
  | { t: 'undo_drink'; drinkId: string }
  | { t: 'report_match'; match: NewMatch }
  | { t: 'retract_match'; matchId: string }
  | { t: 'update_profile'; patch: ProfilePatch }
  | { t: 'ping' };

export type ServerMessage =
  | { t: 'state'; room: RoomState; you: string }
  | { t: 'error'; code: ServerErrorCode; message: string }
  | { t: 'pong' };

export type ServerErrorCode =
  | 'room_not_found'
  | 'room_full'
  | 'not_joined'
  | 'bad_request'
  | 'rate_limited'
  | 'too_many_drinks'
  | 'too_many_matches';
