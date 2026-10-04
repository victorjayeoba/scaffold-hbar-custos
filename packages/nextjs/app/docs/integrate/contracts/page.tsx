import type { ReactNode } from "react";
import Link from "next/link";
import { Doc } from "~~/components/docs/Doc";
import { Callout, Code, H2, H3, HashScan, Prose, Table } from "~~/components/docs/content";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "Contract reference",
  description: "Every Custos contract's job, its key functions and events, and the units they use.",
});

/** One table row: a signature in code, and what it does. */
const fn = (signature: string, what: ReactNode): ReactNode[] => [<Code key="s">{signature}</Code>, what];

export default function ContractReference() {
  return (
    <Doc
      href="/docs/integrate/contracts"
      section="Build with Custos"
      title="Contract reference"
      lead="What each contract does, the external functions you will call, the events to index, and the units every number is in. The Solidity in packages/foundry/contracts is the source of truth; this page follows it."
    >
      <H2>Units</H2>
      <Prose>
        <p>Every amount in the contracts is an integer. Get these wrong and the numbers are off by powers of ten.</p>
      </Prose>
      <Table
        head={["Quantity", "Unit", "Note"]}
        rows={[
          ["Position size", "HBAR, 1e18; + long, − short", "For another market, that asset's units"],
          ["Price", "USD per HBAR, 1e18", "Chainlink (8 dp) and Supra (18 dp) are scaled to 1e18 by PriceGuard"],
          ["Money (collateral, PnL, fees, pool assets)", "USDC, 6 dp", <Code key="c">size × price / 1e30 = USDC</Code>],
          ["cUSDC-LP shares", "6 dp", "One share starts out worth one micro-USDC"],
          [
            "HBAR inside the EVM",
            "tinybars (1 HBAR = 1e8)",
            <>
              <Code key="v">msg.value</Code>, balances, <Code key="g">tx.gasprice</Code>,{" "}
              <Code key="r">runCostEstimate()</Code>
            </>,
          ],
          ["Rates and limits", "basis points (10,000 = 100%)", "Fees, deviation, open-interest cap"],
        ]}
      />
      <Callout type="warning" title="HBAR from the app is in weibars">
        <p>
          Inside a contract <Code>msg.value</Code> is in tinybars, but the JSON-RPC relay takes a transaction&apos;s{" "}
          <Code>value</Code> with 18 decimals. Send 1 HBAR as <Code>1e18</Code>, not <Code>1e8</Code>. See{" "}
          <Link href="/docs/integrate/frontend">Read and write from the app</Link>.
        </p>
      </Callout>

      <H2>PerpMarket</H2>
      <Prose>
        <p>
          The HBAR-USD perpetual, settled in USDC. It inherits <Code>MarginAccount</Code> (positions and risk math),{" "}
          <Code>ScheduledKeeper</Code> (the network tick), <Code>Ownable</Code> and <Code>ReentrancyGuard</Code>. Each
          tick accrues funding, liquidates up to 50 underwater positions at an <Code>Ok</Code> price, and refuels the
          keeper&apos;s HBAR reserve when it runs low.
        </p>
      </Prose>
      <H3>Trading</H3>
      <Table
        head={["Function", "What it does"]}
        rows={[
          fn(
            "open(bool isLong, uint256 collateral, uint256 leverage)",
            "Pulls collateral USDC (approve the market first) and opens collateral × leverage of notional. Needs an Ok price. Leverage 1 to 50.",
          ),
          fn(
            "openWithHbar(bool isLong, uint256 leverage, uint256 minCollateral_) payable",
            "SaucerSwap swaps msg.value HBAR to USDC collateral, then opens. minCollateral_ is the least USDC the swap may return.",
          ),
          fn(
            "close()",
            "Closes after the 300 s minimum hold and pays out USDC. Works in close-only mode at the worse fresh feed.",
          ),
          fn(
            "closeToHbar(uint256 minHbarOut) returns (uint256 hbarOut)",
            "Closes, then swaps the USDC payout to HBAR (tinybars) for the caller. Needs no USDC association.",
          ),
          fn("addCollateral(uint256 amount)", "Adds USDC to an open position, moving its liquidation price away."),
          fn(
            "liquidate(address trader)",
            "Anyone can liquidate an underwater position at an Ok price and earn 0.5% of its notional.",
          ),
          fn(
            "accrueFunding()",
            "Brings funding up to date. The pool calls it before every deposit and withdrawal; anyone may.",
          ),
        ]}
      />
      <H3>Views</H3>
      <Table
        head={["Function", "Returns"]}
        rows={[
          fn(
            "positionOf(address trader) returns (Position)",
            "size, collateral, entryPrice, entryNotional, fundingIndex, openedAt",
          ),
          fn(
            "liquidationPrice(address trader) returns (uint256)",
            "Price (1e18) at which the position becomes liquidatable; 0 if none",
          ),
          fn(
            "equity(address trader, uint256 price) returns (int256)",
            "Collateral + PnL − funding, gain capped at entry notional (USDC)",
          ),
          fn(
            "closePrice(address trader) returns (uint256)",
            "The price a close would settle at now; 0 means the close waits",
          ),
          fn("quoteHbarToUsdc(uint256 hbar) returns (uint256)", "USDC SaucerSwap gives for hbar tinybars"),
          fn("quoteUsdcToHbar(uint256 usdcAmount) returns (uint256)", "Tinybars SaucerSwap gives for usdcAmount"),
          fn("requiredLiquidity() returns (uint256)", "USDC the pool must keep: 2 × open notional"),
          fn("traderCount() / totalOpenNotional()", "Open positions, and long + short notional in USDC"),
          fn("minCollateral() / MAX_LEVERAGE() / MIN_HOLD_SECONDS()", "1 USDC on the testnet deploy / 50 / 300"),
        ]}
      />
      <H3>Events</H3>
      <Table
        head={["Event", "When"]}
        rows={[
          fn(
            "Opened(address indexed trader, bool isLong, int256 size, uint256 collateral, uint256 price, uint256 leverage, uint256 fee)",
            "A position opens",
          ),
          fn(
            "Closed(address indexed trader, uint256 price, int256 pnl, int256 funding, uint256 payout, uint256 fee)",
            "A position closes",
          ),
          fn(
            "Liquidated(address indexed trader, uint256 price, bool byNetwork, address indexed by, uint256 reward)",
            "byNetwork is true and by is zero when a tick did it",
          ),
          fn("Swept(uint256 from, uint256 to, uint256 liquidated)", "A tick checked one page of positions"),
          fn("SweepSkipped(PriceGuard.Status status)", "A tick skipped the sweep: price Stale (1) or Deviated (2)"),
          fn("Refueled(uint256 usdcIn, uint256 hbarOut, uint256 runsBefore)", "The keeper swapped pool USDC to HBAR"),
          fn("CollateralAdded(address indexed trader, uint256 amount)", "addCollateral"),
          fn("SwappedHbarForCollateral / SwappedPayoutForHbar", "The SaucerSwap legs of openWithHbar and closeToHbar"),
        ]}
      />

      <H2>LiquidityPool</H2>
      <Prose>
        <p>
          USDC in, cUSDC-LP out. The shares are a native Hedera token the pool creates and mints, and the pool is every
          trader&apos;s counterparty. Shares are priced at the pool&apos;s USDC minus what traders are up on open
          positions. To receive shares an account must be associated with the share token; to redeem or withdraw it must
          approve the pool on it.
        </p>
      </Prose>
      <Table
        head={["Function", "What it does"]}
        rows={[
          fn(
            "deposit(uint256 assets, address receiver) returns (uint256 shares)",
            "Pulls assets USDC (approve the pool first) and sends the minted shares to receiver",
          ),
          fn(
            "redeem(uint256 shares, address receiver) returns (uint256 assets)",
            "Burns the caller's shares and sends the USDC they are worth",
          ),
          fn(
            "withdraw(uint256 assets, address receiver) returns (uint256 shares)",
            "Sends exactly assets USDC, burning the shares that costs",
          ),
          fn("totalAssets() returns (uint256)", "What the pool is worth in USDC, net of traders' open gains"),
          fn("freeAssets() returns (uint256)", "USDC that can leave now (balance above requiredLiquidity())"),
          fn("maxWithdraw(address) / maxRedeem(address)", "The most an LP can take out right now"),
          fn("previewDeposit / previewRedeem / previewWithdraw", "What each action would give or burn now"),
          fn("convertToShares(uint256) / convertToAssets(uint256)", "Rounded-down conversions at the current price"),
          fn("shareToken() / asset() / market()", "cUSDC-LP address, USDC address, the linked market"),
          fn(
            "balanceOf(address) / totalSupply()",
            "Shares held, and shares in existence (including 1,000 dead shares)",
          ),
        ]}
      />
      <Prose>
        <p>
          Events: <Code>Deposit(sender, receiver, assets, shares)</Code>,{" "}
          <Code>Withdraw(sender, receiver, assets, shares)</Code>, <Code>TraderPaid(trader, amount)</Code>,{" "}
          <Code>KeeperPaid(amount)</Code>, <Code>ShareTokenCreated(token)</Code>. Setup functions <Code>setMarket</Code>
          , <Code>createShareToken</Code> and <Code>associate</Code> are called once by the deploy and start scripts;{" "}
          <Code>payTrader</Code> and <Code>payKeeper</Code> are market-only.
        </p>
      </Prose>

      <H2>PriceGuard</H2>
      <Prose>
        <p>
          The one place prices come from. Chainlink is the price, Supra is the cross-check: <Code>Stale</Code> (1) if
          either feed is older than <Code>maxStaleness</Code>, <Code>Deviated</Code> (2) if they differ by more than{" "}
          <Code>maxDeviationBps</Code>, otherwise <Code>Ok</Code> (0). Reading never reverts on a broken feed.
        </p>
      </Prose>
      <Table
        head={["Function", "What it does"]}
        rows={[
          fn(
            "price() returns (uint256)",
            "Chainlink's price (1e18). Reverts PriceGuard__NotOk unless the status is Ok",
          ),
          fn("status() returns (Status)", "Ok, Stale or Deviated right now"),
          fn(
            "read() returns (uint256 price_, Status status_, uint256 chainlinkAt, uint256 supraAt, uint256 deviationBps)",
            "Everything a UI shows, never reverts",
          ),
          fn(
            "prices() returns (uint256 chainlinkPrice, uint256 supraPrice, Status status_)",
            "Both feeds at 1e18; a stale or missing feed reads 0",
          ),
          fn(
            "setParams(uint256 maxStaleness_, uint256 maxDeviationBps_)",
            "Owner only, bounded by MAX_STALENESS_LIMIT (1 day) and MAX_DEVIATION_LIMIT_BPS (2,000)",
          ),
          fn("maxStaleness() / maxDeviationBps() / supraPair()", "43,200 s / 500 bps / 75 for HBAR-USD"),
        ]}
      />
      <Prose>
        <p>
          Event: <Code>ParamsSet(maxStaleness, maxDeviationBps)</Code>.
        </p>
      </Prose>

      <H2>ScheduledKeeper</H2>
      <Prose>
        <p>
          Abstract. Runs <Code>_work()</Code> every <Code>interval</Code> seconds with no bot: each tick books the next
          one on the Hedera Schedule Service and pays for it from the contract&apos;s own HBAR. Writing your own job is
          covered in <Link href="/docs/integrate/keeper-jobs">Write your own keeper job</Link>.
        </p>
      </Prose>
      <Table
        head={["Function", "What it does"]}
        rows={[
          fn(
            "tick()",
            "Called by the Schedule Service at nextRunAt, and by nothing else (msg.sender must be the contract)",
          ),
          fn("revive()", "Books the first tick, or restarts a chain more than 2 × interval overdue. Anyone can call"),
          fn("fund() payable", "Tops up the HBAR reserve that pays for runs (sending HBAR plainly works too)"),
          fn(
            "runCostEstimate() returns (uint256)",
            "gasLimit × gasPrice in tinybars: what Hedera holds before each run",
          ),
          fn("runsLeft() returns (uint256)", "Runs the reserve covers, each counted at the full hold"),
          fn("canPayNextRun() returns (bool)", "False when Hedera would refuse to start the next run"),
          fn(
            "nextRunAt() / lastRunAt() / runCount() / nextSchedule()",
            "The schedule: unix seconds, count, schedule address",
          ),
          fn(
            "interval() / gasLimit() / gasPrice()",
            "Immutable interval and gas limit; the last gas price a tick recorded",
          ),
        ]}
      />
      <Prose>
        <p>
          Events: <Code>Ticked(run, workOk, reason)</Code>, <Code>TickScheduled(schedule, at)</Code>,{" "}
          <Code>ScheduleFailed(responseCode, at)</Code>, <Code>Revived(by)</Code>, <Code>Funded(from, amount)</Code>,{" "}
          <Code>Stopped(runs)</Code>, <Code>GasPriceSet(tinybarsPerGas)</Code>.
        </p>
      </Prose>

      <H2>MarginAccount</H2>
      <Prose>
        <p>
          Abstract. The position book and risk math, with no tokens and no oracle: the child contract passes prices in.
          Running sums over all positions give the traders&apos; combined PnL and funding in O(1). Every view below is
          public on <Code>PerpMarket</Code>.
        </p>
      </Prose>
      <Table
        head={["Function", "Returns"]}
        rows={[
          fn(
            "pnl(address trader, uint256 price) returns (int256)",
            "Unrealised PnL in USDC, before funding and the gain cap",
          ),
          fn("fundingOwed(address trader) returns (int256)", "Funding owed (negative: owed to the trader), USDC"),
          fn("maintenanceMargin(address trader) returns (uint256)", "1% of entry notional, USDC"),
          fn("isLiquidatable(address trader, uint256 price) returns (bool)", "Equity below maintenance margin"),
          fn(
            "netTraderGain(uint256 price) returns (int256)",
            "All traders' PnL − funding, USDC; the pool books it against its assets",
          ),
          fn("currentFundingIndex() returns (int256)", "Funding index including accrual up to now (1e18)"),
          fn("traders(uint256) / longNotional() / shortNotional() / totalCollateral()", "The book"),
        ]}
      />
      <Prose>
        <p>
          Event: <Code>FundingAccrued(ratePerHour, index)</Code>.
        </p>
      </Prose>

      <H2>HbarDepositZap</H2>
      <Prose>
        <p>
          Periphery. LPs deposit with HBAR alone: SaucerSwap swaps it to USDC, and the zap deposits that USDC with the
          caller as receiver, in one transaction. It holds nothing between calls and needs no rights on the pool. The
          swap must fill within <Code>maxSwapDeviationBps</Code> of the oracle value. The caller must be associated with
          cUSDC-LP, as for any deposit.
        </p>
      </Prose>
      <Table
        head={["Function", "What it does"]}
        rows={[
          fn(
            "depositWithHbar(uint256 minUsdc) payable returns (uint256 shares)",
            "Swaps msg.value HBAR to USDC and deposits it for the caller. The oracle floor applies on top of minUsdc",
          ),
          fn("quote(uint256 hbar) returns (uint256)", "USDC SaucerSwap gives for hbar tinybars now"),
          fn(
            "oracleFloor(uint256 hbar) returns (uint256)",
            "The least USDC the swap may return. Reverts unless the price is Ok",
          ),
        ]}
      />
      <Prose>
        <p>
          Event: <Code>DepositedWithHbar(lp, hbarIn, usdcOut, shares)</Code>.
        </p>
      </Prose>

      <H2>Live testnet addresses</H2>
      <Table
        head={["Contract", "On HashScan"]}
        rows={[
          ["PerpMarket (keeper)", <HashScan key="m" kind="contract" id="0.0.10833087" />],
          ["LiquidityPool", <HashScan key="p" kind="contract" id="0.0.10833082" />],
          ["PriceGuard", <HashScan key="g" kind="contract" id="0.0.10833074" />],
          ["cUSDC-LP share token", <HashScan key="s" kind="token" id="0.0.10833090" />],
          ["HbarDepositZap", <HashScan key="z" kind="contract" id="0xdD40EBFf88aaDc52B31D9E698803e47B04Ef185C" />],
        ]}
      />
      <Prose>
        <p>
          A deploy of your own writes its addresses to <Code>packages/foundry/deployments/296.json</Code>. Every flow on
          the live deployment is linked from <Link href="/docs/testnet">Testnet proof</Link>.
        </p>
      </Prose>

      <H2>Errors</H2>
      <Prose>
        <p>
          Every contract reverts with named custom errors such as <Code>PerpMarket__HoldTime(closeableAt)</Code> or{" "}
          <Code>PriceGuard__NotOk(status)</Code>. Each one, what it means and what to do, is in{" "}
          <Link href="/docs/troubleshooting">Troubleshooting</Link>.
        </p>
      </Prose>
    </Doc>
  );
}
