/**
 * Read options for Custos views. The template re-reads on every Hedera block (~2 s), which floods the public
 * RPC. Oracles move every few minutes and the keeper every 30, so polling every 30 s loses nothing.
 */
export const POLL = { watch: false, query: { refetchInterval: 30_000 } } as const;
