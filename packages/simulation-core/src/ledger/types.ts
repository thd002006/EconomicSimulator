export type LedgerAccountId = string;

/** Assets participate in cash/asset conservation; equity is credit-side bookkeeping. */
export type LedgerAccountRole = "asset" | "equity";

export interface LedgerAccountState {
  readonly id: LedgerAccountId;
  readonly role: LedgerAccountRole;
  balanceCents: number;
}

export interface LedgerWorld {
  readonly accounts: Map<LedgerAccountId, LedgerAccountState>;
}
