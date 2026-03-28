import fetch from 'node-fetch'
import { AxelarClient, EvmClient } from 'clients'
import { logger } from '../logger'

export const LegacyChainIdMap: Record<string, string> = {
  ethereum: 'Ethereum',
  polygon: 'Polygon',
  avalanche: 'Avalanche',
  fantom: 'Fantom',
  moonbeam: 'Moonbeam',
}

export async function isEventFoundOnAxelar(axelarClient: AxelarClient, chain: string, eventId: string): Promise<boolean> {
  let eventOnAxelar
  try {
    eventOnAxelar = await axelarClient.signingClient.queryClient.evm.Event({ chain, eventId })
    return eventOnAxelar.event?.status === 2
  } catch (e: any) {
    if (e.toString().includes('no event with ID')) {
      return false
    } else {
      throw e
    }
  }

}

export function getBridgeIdAndChainIdFromConnectionId(connection_id: string): {
  bridge_id: number,
  chain_id: string
} {
  const Delimiter = '/'
  const split = connection_id.split(Delimiter)

  // certain older blockchains have capitalized chain_id on axelar
  let chainId = split[1]
  if (LegacyChainIdMap[chainId]) {
    chainId = LegacyChainIdMap[chainId]
  }

  return {
    bridge_id: Number(split[0]),
    chain_id: chainId,
  }
}

/**
 * Computes the payload_hash for a ContractCallSubmitted Tendermint query.
 * axelar stores PayloadHash = keccak256(payload), base64-encoded as the event attribute.
 * PendingAction.execution_bytes is the same payload (base64-encoded).
 */
export function computePayloadHashBase64(executionBytesBase64: string): string {
  const { keccak256 } = require('ethers/lib/utils')
  const payloadBytes = Buffer.from(executionBytesBase64, 'base64')
  const hashHex: string = keccak256(payloadBytes)           // "0xabc..."
  return Buffer.from(hashHex.slice(2), 'hex').toString('base64')
}

/**
 * Queries axelar's Tendermint RPC for a ContractCallSubmitted event matching
 * the given payload hash. Queries by source_chain='carbon' + destination_chain
 * and matches payload_hash in code (cannot filter by payload_hash directly
 * because base64 characters +, = cause Tendermint query parse errors).
 *
 * Returns the messageId string if found, or null if not found.
 */
export async function findContractCallSubmittedOnAxelar(
  axelarRpcUrl: string,
  destinationChain: string,
  payloadHashBase64: string,
): Promise<string | null> {
  const eventType = 'axelar.axelarnet.v1beta1.ContractCallSubmitted'
  // Hardcode the URL encoding: %22 = ", %20 = space, %27 = '
  // Tendermint requires the query param to be a JSON-encoded string (wrapped in %22),
  // with single-quote value delimiters encoded as %27.
  const query = `%22${eventType}.source_chain%20CONTAINS%20%27carbon%27%20AND%20${eventType}.destination_chain%20CONTAINS%20%27${destinationChain}%27%22`
  const perPage = 20

  for (let page = 1; ; page++) {
    const url = `${axelarRpcUrl}/tx_search?query=${query}`

    const res = await fetch(url)
    if (!res.ok) throw new Error(`Axelar tx_search failed with status ${res.status}`)
    const json: any = await res.json()

    const totalCount = Number(json.result?.total_count ?? 0)
    const txs: any[] = json.result?.txs ?? []

    for (const tx of txs) {
      for (const event of tx.tx_result?.events ?? []) {
        if (event.type !== eventType) continue
        const attrs: Record<string, string> = {}
        for (const attr of event.attributes ?? []) {
          attrs[attr.key] = (attr.value as string).replace(/^"|"$/g, '')
        }
        if (attrs['payload_hash'] === payloadHashBase64) {
          return attrs['message_id'] ?? ''
        }
      }
    }

    if (page * perPage >= totalCount) break
  }

  return null
}

export async function isEvmTxHeightFinalized(evmClient: EvmClient, txHeight: number): Promise<boolean> {
  const finalizedBlockHeight = await evmClient.getFinalizedBlockHeight()
  // Allow some buffer for axelar vals that are connected to lagging rpc nodes with finalityBlocks
  const targetBlockNumber = txHeight + evmClient.finalityBlocks;
  return finalizedBlockHeight >= targetBlockNumber
}
