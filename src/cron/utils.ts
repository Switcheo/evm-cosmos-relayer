import { AxelarClient, EvmClient } from 'clients'

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

export async function isEvmTxHeightFinalized(evmClient: EvmClient, txHeight: number): Promise<boolean> {
  const finalizedBlockHeight = await evmClient.getFinalizedBlockHeight()
  // Allow some buffer for axelar vals that are connected to lagging rpc nodes with finalityBlocks
  const targetBlockNumber = txHeight + evmClient.finalityBlocks;
  return finalizedBlockHeight >= targetBlockNumber
}
