import { AppError } from './errors';

export type StateTransitions<State extends string> = Readonly<Record<State, readonly State[]>>;

export type StateMachine<State extends string> = {
  readonly states: readonly State[];
  can(from: State, to: State): boolean;
  /** States a row may hold when a guarded UPDATE moves it to `to`. */
  sourcesOf(to: State): State[];
  assertCan(from: State, to: State): void;
};

/** One table of allowed moves. A state with an empty list is terminal. */
export function defineStateMachine<const State extends string>(
  name: string,
  transitions: StateTransitions<State>,
): StateMachine<State> {
  const states = Object.keys(transitions).filter((state): state is State => state in transitions);
  const can = (from: State, to: State) => transitions[from].includes(to);
  return {
    states,
    can,
    sourcesOf: (to) => states.filter((from) => can(from, to)),
    assertCan(from, to) {
      if (!can(from, to)) {
        throw new AppError('CONFLICT', `${name} cannot move from ${from} to ${to}`, { from, to });
      }
    },
  };
}
