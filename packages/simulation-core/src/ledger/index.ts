import type {
  LedgerAccountId,
  LedgerAccountRole,
  LedgerAccountState,
  LedgerWorld
} from "./types.js";

export type {
  LedgerAccountId,
  LedgerAccountRole,
  LedgerAccountState,
  LedgerWorld
} from "./types.js";

export function createLedgerWorld(): LedgerWorld {
  return { accounts: new Map() };
}

export function createAccount(
  ledger: LedgerWorld,
  id: LedgerAccountId,
  openingBalanceCents = 0,
  role: LedgerAccountRole = "asset"
): LedgerAccountState {
  if (ledger.accounts.has(id)) {
    throw new Error(`Ledger account already exists: ${id}.`);
  }
  if (!Number.isSafeInteger(openingBalanceCents)) {
    throw new Error("Opening balance must be a safe integer.");
  }
  const account: LedgerAccountState = { id, role, balanceCents: openingBalanceCents };
  ledger.accounts.set(id, account);
  return account;
}

export function getBalance(ledger: LedgerWorld, id: LedgerAccountId): number {
  const account = ledger.accounts.get(id);
  if (account === undefined) {
    throw new Error(`Unknown ledger account: ${id}.`);
  }
  return account.balanceCents;
}

export function requireAccount(ledger: LedgerWorld, id: LedgerAccountId): LedgerAccountState {
  const account = ledger.accounts.get(id);
  if (account === undefined) {
    throw new Error(`Unknown ledger account: ${id}.`);
  }
  return account;
}

/** Credits an account (e.g. seeding an external shareholder cash pool). */
export function credit(ledger: LedgerWorld, id: LedgerAccountId, amountCents: number): void {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
    throw new Error("Credit amount must be a non-negative safe integer.");
  }
  requireAccount(ledger, id).balanceCents += amountCents;
}

export function debit(ledger: LedgerWorld, id: LedgerAccountId, amountCents: number): void {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
    throw new Error("Debit amount must be a non-negative safe integer.");
  }
  const account = requireAccount(ledger, id);
  if (account.balanceCents < amountCents) {
    throw new Error(`Insufficient funds on account ${id}.`);
  }
  account.balanceCents -= amountCents;
}

export function transfer(
  ledger: LedgerWorld,
  fromId: LedgerAccountId,
  toId: LedgerAccountId,
  amountCents: number
): void {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
    throw new Error("Transfer amount must be a non-negative safe integer.");
  }
  if (amountCents === 0) {
    return;
  }
  if (fromId === toId) {
    throw new Error("Cannot transfer to the same account.");
  }
  debit(ledger, fromId, amountCents);
  credit(ledger, toId, amountCents);
}

export function totalBalanceCents(ledger: LedgerWorld): number {
  let total = 0;
  for (const account of ledger.accounts.values()) {
    total += account.balanceCents;
  }
  return total;
}

/** Sum of asset-role balances (cash, investments, etc.). Equity accounts are excluded. */
export function totalAssetBalanceCents(ledger: LedgerWorld): number {
  let total = 0;
  for (const account of ledger.accounts.values()) {
    if (account.role === "asset") {
      total += account.balanceCents;
    }
  }
  return total;
}

export interface LedgerCheckpoint {
  readonly accountIds: ReadonlySet<LedgerAccountId>;
  readonly balances: ReadonlyMap<LedgerAccountId, number>;
}

/** Snapshot account set and balances so a failed batch can restore the ledger. */
export function captureLedgerCheckpoint(ledger: LedgerWorld): LedgerCheckpoint {
  const accountIds = new Set<LedgerAccountId>();
  const balances = new Map<LedgerAccountId, number>();
  for (const account of ledger.accounts.values()) {
    accountIds.add(account.id);
    balances.set(account.id, account.balanceCents);
  }
  return { accountIds, balances };
}

/**
 * Deletes accounts created after the checkpoint and restores prior balances.
 * Accounts that existed at checkpoint time are kept (even if zero).
 */
export function restoreLedgerCheckpoint(ledger: LedgerWorld, checkpoint: LedgerCheckpoint): void {
  for (const id of [...ledger.accounts.keys()]) {
    if (!checkpoint.accountIds.has(id)) {
      ledger.accounts.delete(id);
    }
  }
  for (const [id, balanceCents] of checkpoint.balances) {
    const account = ledger.accounts.get(id);
    if (account === undefined) {
      throw new Error(`Checkpoint account missing during restore: ${id}.`);
    }
    account.balanceCents = balanceCents;
  }
}
