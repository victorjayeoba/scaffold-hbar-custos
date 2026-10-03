import {
  type Abi,
  BaseError,
  ContractFunctionRevertedError,
  type Hex,
  InsufficientFundsError,
  UserRejectedRequestError,
  decodeErrorResult,
} from "viem";
import { USDC_DECIMALS, fmt } from "~~/app/pool/_lib/format";
import deployedContracts from "~~/contracts/deployedContracts";

/**
 * Turns anything a pool transaction can throw into one sentence a liquidity provider can act on.
 * Covers every custom error in LiquidityPool's and HbarDepositZap's ABIs, the PriceGuard and SaucerSwap refusals a
 * deposit with HBAR can hit, the Hedera token-service failures behind them, and wallet errors.
 */

export type ErrorContext = {
  shareDecimals?: number;
  shareSymbol?: string;
  /** What LiquidityPool__ExceedsMax's `max` is counted in: withdraw caps USDC, redeem caps shares. */
  exitUnit?: "usdc" | "shares";
};

type Decoded = { name: string; args: readonly unknown[] };

// Every error any Custos contract can raise, so a revert bubbling up from a nested call still decodes.
const allErrors = [
  ...Object.values(deployedContracts as Record<number, Record<string, { abi: Abi }>>)
    .flatMap(chain => Object.values(chain))
    .flatMap(c => c.abi.filter(item => item.type === "error")),
] as Abi;

// Hedera response codes an HTS call can return inside LiquidityPool__HtsFailed (values from @hiero-ledger/sdk Status).
const htsCodes: Record<number, string> = {
  10: "Not enough HBAR to pay the network fee. Get testnet HBAR from the Hedera Portal faucet.",
  165: "Your account is frozen for the share token.",
  176: "The share token needs KYC approval for your account.",
  178: "You don't hold enough shares for that amount.",
  184: "Your account isn't associated with the cUSDC-LP share token, so it can't receive shares. Associate it first.",
  262: "Your account has no automatic association slots left. Associate the share token by hand first.",
  292: "The pool isn't approved to take your shares. Approve it on the share token first.",
  293: "The pool is approved for fewer shares than this needs. Approve it again.",
};

const decode = (error: unknown): Decoded | undefined => {
  if (!(error instanceof BaseError)) return undefined;
  const reverted = error.walk(e => e instanceof ContractFunctionRevertedError) as
    | ContractFunctionRevertedError
    | undefined;
  if (reverted?.data?.errorName) return { name: reverted.data.errorName, args: reverted.data.args ?? [] };
  // Hedera's relay sometimes returns the revert data on the RPC error instead of a decoded revert.
  const hasData = (e: unknown) => /^0x[0-9a-fA-F]{8}/.test(String((e as { data?: unknown }).data ?? ""));
  const raw = reverted?.raw ?? ((error.walk(hasData) as { data?: Hex } | null)?.data as Hex | undefined);
  if (raw && raw.length >= 10) {
    try {
      const r = decodeErrorResult({ abi: allErrors, data: raw });
      return { name: r.errorName, args: r.args ?? [] };
    } catch {
      // not one of ours
    }
  }
  return undefined;
};

const usdc = (v: unknown) => `${fmt(v as bigint, USDC_DECIMALS, 2)} USDC`;

const FREE_ASSETS_WHY =
  "Withdrawals stop at the pool's free USDC: the pool keeps twice the open interest so it can always pay winning traders. More frees up as positions close.";

const messages = (ctx: ErrorContext): Record<string, (args: readonly unknown[]) => string> => {
  const shares = (v: unknown) => `${fmt(v as bigint, ctx.shareDecimals ?? 6, 4)} ${ctx.shareSymbol ?? "cUSDC-LP"}`;
  return {
    // LiquidityPool
    LiquidityPool__ExceedsFreeAssets: ([free]) => `The pool has only ${usdc(free)} free right now. ${FREE_ASSETS_WHY}`,
    LiquidityPool__OnlyMarket: () => "Only the PerpMarket contract can pay out of the pool.",
    LiquidityPool__MarketAlreadySet: () => "This pool is already linked to its market.",
    LiquidityPool__InvalidAddress: () => "That address can't be used (it's the zero address).",
    LiquidityPool__NoShareToken: () =>
      "The pool's share token hasn't been created yet, so it can't take deposits. The pool owner creates it once.",
    LiquidityPool__ShareTokenExists: () => "The share token already exists.",
    LiquidityPool__NoPrice: () =>
      "Chainlink and Supra are stale or disagree while positions are open, so the pool can't price its shares. Deposits and withdrawals reopen as soon as the price checks out again.",
    LiquidityPool__ZeroAmount: () => "That amount is too small: it's worth zero after rounding. Enter a larger amount.",
    LiquidityPool__TooFewShares: () =>
      "That deposit is too small. The first deposit into an empty pool locks 1,000 micro-shares forever (to stop share-price games), so it must buy more than that.",
    LiquidityPool__ExceedsMax: ([max]) =>
      `You can take out at most ${ctx.exitUnit === "shares" ? shares(max) : usdc(max)} right now. ${FREE_ASSETS_WHY}`,
    LiquidityPool__HtsFailed: ([rc]) =>
      htsCodes[Number(rc)] ?? `Hedera's token service refused the share transfer (response code ${rc}).`,
    LiquidityPool__RefundFailed: () => "The pool couldn't refund the unused HBAR of the token-creation fee.",
    // HbarDepositZap, and what it calls: PriceGuard for the oracle floor, SaucerSwap for the swap
    HbarDepositZap__ZeroAmount: () => "Enter an amount of HBAR above zero.",
    HbarDepositZap__InvalidAddress: () => "The zap was set up with a missing address. This is a deployment problem.",
    HbarDepositZap__InvalidConfig: () => "The zap was set up with an invalid swap band. This is a deployment problem.",
    PriceGuard__NotOk: ([status]) =>
      `Chainlink and Supra are ${Number(status) === 2 ? "too far apart" : "out of date"}, so there's no oracle value to check the swap against and the zap won't deposit. Deposit with USDC, or try again once the prices check out.`,
    ReentrancyGuardReentrantCall: () => "Another call to the zap is still running. Try again in a moment.",
    // Token transfers through Hedera's token service
    SafeERC20FailedOperation: () =>
      "The USDC transfer was refused by Hedera's token service. Check that your account is associated with USDC, holds enough of it, and has approved the pool for this amount.",
    // Ownable
    OwnableUnauthorizedAccount: () => "Only the pool's owner can do that.",
    OwnableInvalidOwner: () => "That owner address isn't valid.",
  };
};

// Hedera response codes, and SaucerSwap's revert strings (a Uniswap V2 fork), that reach the app as text.
const hederaCodes: [RegExp, string][] = [
  [
    /INSUFFICIENT_OUTPUT_AMOUNT/,
    "SaucerSwap would return less than your minimum, or more than 3% below the Chainlink value of your HBAR, so nothing was swapped. Get a fresh quote, allow more slippage, or deposit with USDC.",
  ],
  [/INSUFFICIENT_LIQUIDITY/, "SaucerSwap's HBAR/USDC pool doesn't have enough liquidity for this amount."],
  [
    /TOKEN_NOT_ASSOCIATED_TO_ACCOUNT/,
    "Your account isn't associated with this token yet. Associate it first (one transaction).",
  ],
  [
    /TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT/,
    "Your account is already associated with this token. Carry on with the next step.",
  ],
  [/INSUFFICIENT_TOKEN_BALANCE/, "You don't hold enough of this token for that amount."],
  [
    /SPENDER_DOES_NOT_HAVE_ALLOWANCE|AMOUNT_EXCEEDS_ALLOWANCE/,
    "The pool isn't approved for this amount yet. Approve it first.",
  ],
  [
    /INSUFFICIENT_PAYER_BALANCE|INSUFFICIENT_ACCOUNT_BALANCE/,
    "Not enough HBAR to pay the network fee. Get testnet HBAR from the Hedera Portal faucet.",
  ],
  [/ACCOUNT_FROZEN_FOR_TOKEN/, "Your account is frozen for this token."],
  [/ACCOUNT_KYC_NOT_GRANTED_FOR_TOKEN/, "This token needs KYC approval for your account."],
  [
    /NO_REMAINING_AUTOMATIC_ASSOCIATIONS/,
    "Your account has no automatic association slots left. Associate the token by hand first.",
  ],
];

export const poolErrorMessage = (error: unknown, ctx: ErrorContext = {}): string => {
  if (error instanceof BaseError) {
    if (error.walk(e => e instanceof UserRejectedRequestError) || /user (rejected|denied)/i.test(error.message))
      return "You cancelled the transaction in your wallet. Nothing was sent.";
    if (error.walk(e => e instanceof InsufficientFundsError))
      return "Not enough HBAR to pay the network fee. Get testnet HBAR from the Hedera Portal faucet.";
  }

  const decoded = decode(error);
  if (decoded) {
    const toText = messages(ctx)[decoded.name];
    return toText ? toText(decoded.args) : `The contract refused this (${decoded.name}).`;
  }

  const text =
    error instanceof BaseError ? `${error.shortMessage} ${error.details ?? ""} ${error.message}` : String(error);
  for (const [pattern, message] of hederaCodes) if (pattern.test(text)) return message;
  if (/chain mismatch|does not match the target chain/i.test(text))
    return "Your wallet is on another network. Switch it to Hedera Testnet.";
  if (/reverted/i.test(text))
    return "The transaction would fail on chain and wasn't sent. Check the amount, your token association and approval, then try again.";
  return error instanceof BaseError ? error.shortMessage : "Something went wrong. Try again in a moment.";
};
