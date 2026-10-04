import Link from "next/link";
import { Doc } from "~~/components/docs/Doc";
import { Callout, Code, CodeBlock, Figure, H2, HashScan, Prose, Step, Steps, Table } from "~~/components/docs/content";
import { getMetadata } from "~~/utils/scaffold-hbar/getMetadata";

export const metadata = getMetadata({
  title: "Provide liquidity",
  description: "Deposit USDC or HBAR into the Custos pool for cUSDC-LP, a native Hedera token, and redeem it for USDC.",
});

export default function LiquidityGuide() {
  return (
    <Doc
      href="/docs/guides/liquidity"
      section="Using the app"
      title="Provide liquidity"
      lead="The pool is the house: it takes the other side of every trade. Deposit USDC on the /pool page and the pool mints you cUSDC-LP, a native Hedera token. Redeem it later for your share of the pool."
    >
      <Figure
        src="/docs/shot-pool.png"
        alt="The pool page: pool value, share price, free to withdraw, backing open positions, and the deposit and withdraw forms"
        caption="/pool on the live testnet deployment"
        width={1280}
        height={800}
      />

      <H2>The share token</H2>
      <Prose>
        <p>
          cUSDC-LP (<HashScan kind="token" id="0.0.10833090" /> on testnet) is a Hedera Token Service token with 6
          decimals. The pool contract created it with <Code>createShareToken()</Code> and is its treasury and only
          supply key, so only the pool can mint or burn it. It shows up in any Hedera wallet and on HashScan like any
          other token.
        </p>
        <p>
          The top of the page shows <strong>Pool value</strong> (what all shares are worth together),{" "}
          <strong>Share price</strong> (what one cUSDC-LP redeems for), <strong>Free to withdraw</strong> and{" "}
          <strong>Backing open positions</strong>.
        </p>
      </Prose>

      <H2>Deposit USDC</H2>
      <Prose>
        <p>
          The deposit form lists the steps your account still needs and runs them in order. Steps you have already done
          are skipped.
        </p>
      </Prose>
      <Steps>
        <Step title="Associate your account with USDC">
          <p>
            A Hedera account must be associated with a token before it can hold it. The app calls the token&apos;s
            HIP-719 <Code>associate()</Code>.
          </p>
        </Step>
        <Step title="Associate with cUSDC-LP so you can receive shares">
          <p>
            The same call on the share token. Without it the pool&apos;s transfer fails with{" "}
            <Code>LiquidityPool__HtsFailed(184)</Code> (<Code>TOKEN_NOT_ASSOCIATED_TO_ACCOUNT</Code>).
          </p>
        </Step>
        <Step title="Approve USDC">
          <p>Lets the pool take the amount you entered.</p>
        </Step>
        <Step title="Deposit">
          <p>
            <Code>deposit(assets, receiver)</Code> pulls your USDC, mints shares and sends them to you. The form shows{" "}
            <strong>You get about</strong> from <Code>previewDeposit</Code> before you sign.
          </p>
        </Step>
      </Steps>
      <Prose>
        <p>
          On chain: a 361.79 USDC deposit and its mint (
          <HashScan kind="transaction" id="0x55d081b26535e7c9ef68664a080f0609a7caacab03becc115ee7180e1154d722" />
          ). The very first deposit into an empty pool also mints 1,000 shares (0.001 USDC) to the pool that can never
          be redeemed, so the share price can&apos;t be inflated by a donation.
        </p>
      </Prose>

      <H2>Deposit with HBAR</H2>
      <Prose>
        <p>
          <Code>HbarDepositZap</Code> (
          <HashScan kind="contract" id="0xdD40EBFf88aaDc52B31D9E698803e47B04Ef185C" /> on testnet) lets an LP deposit
          with HBAR alone. One call swaps the HBAR to USDC on SaucerSwap and deposits it with you as the receiver, so
          the shares land in your account in the same transaction. The zap holds nothing between calls and needs no
          rights on the pool.
        </p>
        <ul>
          <li>
            <strong>Oracle floor.</strong> The swap must return at least the HBAR&apos;s oracle value less 3% (and at
            least your own <Code>minUsdc</Code>), so a pushed or thin SaucerSwap pool can&apos;t short-change you. It
            needs an <Code>Ok</Code> price.
          </li>
          <li>
            <strong>Association.</strong> You must be associated with cUSDC-LP, as for any deposit.
          </li>
        </ul>
        <p>
          On <Link href="/pool">/pool</Link>, set <strong>Pay with</strong> to <strong>HBAR via SaucerSwap</strong>,
          enter the <strong>HBAR to swap and deposit</strong>, and confirm: the app quotes the swap, applies your
          slippage, and calls the zap. From your own code, call it directly:
        </p>
      </Prose>
      <CodeBlock
        lang="solidity"
        title="HbarDepositZap"
        code={`function quote(uint256 hbar) external view returns (uint256);       // USDC SaucerSwap gives now
function oracleFloor(uint256 hbar) public view returns (uint256);  // least USDC the swap may return
function depositWithHbar(uint256 minUsdc) external payable returns (uint256 shares);`}
      />
      <Prose>
        <p>
          On chain: 0.5 ℏ swapped to 1.12 USDC and deposited, 1,114,696 cUSDC-LP minted to the caller (
          <HashScan kind="transaction" id="0x3c23d3b3cdf4058d5843f06be3d66af91e35c886af53370437cb5d21636ca098" />
          ). <Code>yarn custos:deploy:testnet</Code> creates a zap next to your HBAR-USD pool, and{" "}
          <Code>yarn custos:start:testnet</Code> associates it with USDC. To add one to an existing deployment, run{" "}
          <Code>yarn workspace @sh/foundry custos zap</Code>.
        </p>
      </Prose>

      <H2>Withdraw</H2>
      <Prose>
        <p>
          Pick <strong>Withdraw by</strong> <strong>USDC amount</strong> (calls <Code>withdraw(assets, receiver)</Code>)
          or <strong>Shares</strong> (calls <Code>redeem(shares, receiver)</Code>). Either way you first approve the
          pool on cUSDC-LP; the pool pulls the shares and burns them, then sends you USDC. You must be associated with
          USDC to receive it.
        </p>
        <p>
          On chain: 10 cUSDC-LP redeemed and burned (
          <HashScan kind="transaction" id="0x9048724259694f86a20fa69aa069a89d3e85045703b0a6f1a9b302d66c2d7422" />
          ).
        </p>
      </Prose>
      <Table
        head={["Limit", "Why", "Error"]}
        rows={[
          [
            "Withdrawals stop at twice the open interest",
            "The pool keeps 2 × open interest so winners always get paid. What's left is Free to withdraw.",
            <Code key="m">LiquidityPool__ExceedsMax</Code>,
          ],
          [
            "Deposits and withdrawals pause while positions are open and the price isn't Ok",
            "Shares are never priced at a bad price. They reopen when the feeds check out.",
            <Code key="p">LiquidityPool__NoPrice</Code>,
          ],
        ]}
      />
      <Prose>
        <p>
          <Code>maxWithdraw(owner)</Code> and <Code>maxRedeem(owner)</Code> give the most you can take out right now;
          the form&apos;s <strong>Max</strong> uses them.
        </p>
      </Prose>

      <H2>How shares are priced</H2>
      <Prose>
        <p>
          The pool is worth its USDC minus what traders are up on open positions, or plus what they are down, net of
          funding. Funding is brought up to date before every deposit and withdrawal. Without this, anyone could deposit
          just before a loss or liquidation lands in the pool and withdraw just after, taking most of it.
        </p>
      </Prose>

      <H2>Where the pool&apos;s money comes from</H2>
      <Prose>
        <p>
          The <strong>Where the pool&apos;s money comes from</strong> card on /pool rebuilds the pool&apos;s history
          from every PerpMarket and LiquidityPool event on the mirror node:
        </p>
      </Prose>
      <Table
        head={["Line", "What it is"]}
        rows={[
          ["Trading fees", "0.1% of notional on every open and every close"],
          ["Liquidations", "All collateral of positions that fell under margin (less 0.5% if a person liquidated)"],
          ["Settled trades", "Trader losses minus trader profits, funding included"],
          ["Keeper fees", "Spare USDC swapped to HBAR so Hedera keeps running the checks (refuel)"],
        ]}
      />

      <H2>Risks</H2>
      <Prose>
        <ul>
          <li>
            <strong>Traders can win.</strong> The pool pays every profit. Each gain is capped at the position&apos;s
            entry notional and open interest at 50% of the pool, which bounds it, but LPs can lose money.
          </li>
          <li>
            <strong>Oracle lag.</strong> Chainlink and Supra push on deviation or heartbeat, so the market can trade on
            a price minutes old. The 300 s minimum hold and the 0.1% fees blunt this; they don&apos;t remove it.
          </li>
          <li>
            <strong>Locked while prices are bad.</strong> With positions open and a stale or deviated price, you
            can&apos;t deposit or withdraw until the feeds recover.
          </li>
          <li>
            <strong>Part of your share can be tied up.</strong> Withdrawals stop at twice the open interest; it frees up
            as traders close.
          </li>
          <li>
            <strong>The pool pays the keeper.</strong> Where SaucerSwap tracks the oracle, refuels spend up to 50 USDC
            of free pool USDC at a time. On testnet they fail closed and the keeper is funded by hand.
          </li>
          <li>
            <strong>Valuation is approximate past the caps.</strong> The pool&apos;s value ignores the per-position gain
            cap and loss floor; it is exact until a position passes +100% or zero equity.
          </li>
        </ul>
      </Prose>
      <Callout type="tip" title="Nobody can take the pool's USDC">
        <p>
          Only the market can draw on the pool, and only to pay a trader or the keeper from USDC no position needs. The
          pool&apos;s owner can link the market and create the share token, once each, and nothing else.
        </p>
      </Callout>
    </Doc>
  );
}
