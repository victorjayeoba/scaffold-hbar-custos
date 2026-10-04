/**
 * The routes the smoke test opens. To cover a new page, add one line.
 *
 * - `heading`: the page's main heading (a level-1 heading) must be visible, and
 *   match this when given. Leave it out to accept any level-1 heading, which
 *   keeps the test stable while a page's copy is still changing.
 * - `text`: for a page with no level-1 heading, a piece of text that must be visible instead.
 */
export type SmokeRoute = {
  path: string;
  heading?: RegExp;
  text?: RegExp;
};

export const ROUTES: SmokeRoute[] = [
  { path: "/", heading: /margin kept by the network/i },
  { path: "/trade", heading: /trade hbar-usd/i },
  { path: "/pool", heading: /be the house/i },
  { path: "/keeper", heading: /hedera keeps the books/i },
  { path: "/docs", heading: /custos documentation/i },
  { path: "/docs/quickstart", heading: /^quickstart$/i },
  { path: "/docs/testnet", heading: /testnet proof/i },
  { path: "/debug", heading: /debug contracts/i },
  // On testnet the block explorer shows a notice instead of a heading.
  { path: "/blockexplorer", text: /block explorer is only for/i },
];
