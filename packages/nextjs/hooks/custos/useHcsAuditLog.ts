import { useQuery } from "@tanstack/react-query";
import { POLL } from "~~/hooks/custos/poll";
import { useHederaLinks } from "~~/hooks/custos/useKeeperActivity";

/**
 * The keeper's audit log on the Hedera Consensus Service. `yarn custos:hcs-log:testnet` copies every keeper event
 * from the mirror node into this topic; the keeper never depends on it. Source of truth:
 * packages/foundry/deployments/296.json ("hcsTopic"). Replace it when you deploy your own copy.
 */
export const HCS_TOPIC = "0.0.10839050";

/** One message as `hcsLog.js` writes it (v1): an event of PerpMarket plus its fields. */
export type AuditMessage = {
  v: number;
  e: "Ticked" | "Swept" | "SweepSkipped" | "Liquidated" | "Refueled";
  ts: string;
  tx: string;
  run?: number;
  trader?: string;
  price?: string | number;
  byNetwork?: boolean;
  reward?: string | number;
  status?: string | number;
  ok?: boolean;
  [field: string]: unknown;
};

export type AuditEntry = { sequence: number; consensusTimestamp: string; message?: AuditMessage };

type MirrorMessage = { sequence_number: number; consensus_timestamp: string; message: string };

const decode = (base64: string): AuditMessage | undefined => {
  try {
    return JSON.parse(atob(base64));
  } catch {
    return undefined; // not ours, or not v1 JSON: shown as an undecodable row
  }
};

/** The newest `limit` messages in the audit topic, newest first. */
export const useHcsAuditLog = (limit = 25) => {
  const { mirror } = useHederaLinks();
  return useQuery({
    queryKey: ["hcs-audit-log", mirror, HCS_TOPIC, limit],
    queryFn: async (): Promise<AuditEntry[]> => {
      const res = await fetch(`${mirror}/topics/${HCS_TOPIC}/messages?order=desc&limit=${limit}`);
      if (!res.ok) throw new Error(`The mirror node answered ${res.status}`);
      const { messages } = (await res.json()) as { messages: MirrorMessage[] };
      return messages.map(m => ({
        sequence: m.sequence_number,
        consensusTimestamp: m.consensus_timestamp,
        message: decode(m.message),
      }));
    },
    refetchInterval: POLL.query.refetchInterval,
  });
};
