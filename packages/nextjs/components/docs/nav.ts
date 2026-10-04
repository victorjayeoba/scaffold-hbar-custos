/**
 * The docs' table of contents: the sidebar, search and the previous/next links all read from here, so adding a page
 * is one entry in this list plus its `app/docs/.../page.tsx`.
 */
export type DocsPage = {
  title: string;
  href: string;
  /** One line shown in search results and link cards. */
  description: string;
  /** Extra words search should match on. */
  keywords?: string[];
};

export type DocsSection = {
  title: string;
  pages: DocsPage[];
};

export const docsNav: DocsSection[] = [
  {
    title: "Getting started",
    pages: [
      {
        title: "Introduction",
        href: "/docs",
        description: "What Custos is, and why the Hedera network keeps it instead of a bot.",
        keywords: ["overview", "what", "why", "hip-1215"],
      },
      {
        title: "Quickstart",
        href: "/docs/quickstart",
        description: "Scaffold the template, run the app, and deploy your own market to Hedera testnet.",
        keywords: ["install", "setup", "scaffold", "create", "deploy", "testnet", "yarn"],
      },
      {
        title: "How it works",
        href: "/docs/architecture",
        description: "The contracts, how they fit, and a liquidation from start to finish.",
        keywords: ["architecture", "design", "contracts", "flow", "liquidation"],
      },
    ],
  },
  {
    title: "Using the app",
    pages: [
      {
        title: "Trade",
        href: "/docs/guides/trading",
        description: "Open a long or short with USDC or HBAR, watch your liquidation price, close to USDC or HBAR.",
        keywords: ["open", "close", "leverage", "long", "short", "saucerswap", "hbar"],
      },
      {
        title: "Provide liquidity",
        href: "/docs/guides/liquidity",
        description: "Deposit USDC or HBAR into the pool for cUSDC-LP, a native Hedera token, and redeem it.",
        keywords: ["lp", "pool", "deposit", "redeem", "withdraw", "zap", "shares", "associate"],
      },
      {
        title: "The keeper",
        href: "/docs/guides/keeper",
        description: "How the network ticks the market, what a run costs, and how to fund or revive it.",
        keywords: ["schedule", "tick", "revive", "fund", "reserve", "gas", "hcs", "audit"],
      },
    ],
  },
  {
    title: "Build with Custos",
    pages: [
      {
        title: "Contract reference",
        href: "/docs/integrate/contracts",
        description: "Every contract's job, its key functions and events, and the units they use.",
        keywords: ["api", "abi", "functions", "events", "perpmarket", "liquiditypool", "priceguard"],
      },
      {
        title: "Read and write from the app",
        href: "/docs/integrate/frontend",
        description: "Call the contracts from React with the scaffold-hbar hooks and the generated ABIs.",
        keywords: ["react", "hooks", "wagmi", "viem", "useScaffoldReadContract", "deployedContracts"],
      },
      {
        title: "Add a market",
        href: "/docs/integrate/add-market",
        description: "Add ETH-USD (or any asset) as configuration: markets.json, a test, a testnet check.",
        keywords: ["markets.json", "eth", "chainlink", "supra", "check-market"],
      },
      {
        title: "Write your own keeper job",
        href: "/docs/integrate/keeper-jobs",
        description: "Reuse ScheduledKeeper for anything on a timer, from interest to expiries, or a lending market.",
        keywords: ["scheduledkeeper", "heartbeat", "_work", "lending", "interval", "reuse"],
      },
    ],
  },
  {
    title: "Reference",
    pages: [
      {
        title: "Learned on Hedera",
        href: "/docs/hedera-notes",
        description: "What testnet taught us about the Schedule Service, gas, oracles and SaucerSwap.",
        keywords: ["gotchas", "gas hold", "msg.sender", "timestamp", "supra", "chainlink"],
      },
      {
        title: "Troubleshooting",
        href: "/docs/troubleshooting",
        description: "Every custom error, what it means, and what to do about it.",
        keywords: ["errors", "revert", "fix", "faq"],
      },
      {
        title: "Testnet proof",
        href: "/docs/testnet",
        description: "The live deployment and a HashScan link for every flow, including liquidations nobody signed.",
        keywords: ["hashscan", "proof", "addresses", "deployment", "transactions"],
      },
      {
        title: "Hedera Harness",
        href: "/docs/harness",
        description: "The AI-agent recipe that adds a market, and how it was verified.",
        keywords: ["harness", "agent", "validate", "recipe", "ci"],
      },
    ],
  },
];

export const docsPages: DocsPage[] = docsNav.flatMap(section => section.pages);

export function neighbours(href: string): { prev?: DocsPage; next?: DocsPage } {
  const i = docsPages.findIndex(page => page.href === href);
  if (i < 0) return {};
  return { prev: docsPages[i - 1], next: docsPages[i + 1] };
}
