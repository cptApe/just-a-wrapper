import 'server-only';

export type AccrualResult = {
  billed: boolean;
  credits: number;
  balance: number | null;
  paused: boolean;
};

export const NOT_BILLED: AccrualResult = {
  billed: false,
  credits: 0,
  balance: null,
  paused: false,
};
