/** A clock the archive sweep can replace in tests. The domain never reads one. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};
