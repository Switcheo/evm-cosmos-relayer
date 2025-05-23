import { ethers } from 'ethers'
import { TypedEvent } from '../../types/contracts/common'
import { logger } from '../../logger'

export const parseAnyEvent = async (
  currentChainName: string,
  provider: ethers.providers.Provider,
  event: TypedEvent,
  finalityBlocks = 1
) => {
  const receipt = await event.getTransactionReceipt();
  const eventIndex = receipt.logs.findIndex(
    (log) => log.logIndex === event.logIndex
  );

  return {
    hash: event.transactionHash,
    blockNumber: event.blockNumber,
    logIndex: eventIndex,
    sourceChain: event.args.sourceChain || currentChainName,
    destinationChain: event.args.destinationChain || currentChainName,
    waitForFinality: () => waitForFinality(provider, event.transactionHash, finalityBlocks),
    args: filterEventArgs(event),
  };
};

const waitForFinality = async (provider: ethers.providers.Provider, hash: string, bufferBlocks: number) => {
  const tx = await provider.waitForTransaction(hash);
  // Allow some buffer for axelar vals that are connected to lagging rpc nodes.
  const targetBlockNumber = tx.blockNumber + bufferBlocks;
  logger.info(`Waiting for ${hash} to be finalized at block ${targetBlockNumber} (buffered by ${bufferBlocks} blocks)...`);

  /* eslint-disable-next-line no-constant-condition */
  while (true) {
    try {
      const finalizedBlock = await provider.getBlock("finalized");
      if (finalizedBlock.number >= targetBlockNumber) {
        return tx
      }
      logger.info(`Waiting for ${hash} to be finalized at block ${targetBlockNumber}. Current finalized block: ${finalizedBlock.number}`);
    } catch (error) {
      // If the chain doesn't support the finalized tag, it is a pre-Merge EVM chain,
      // so we just assume finalityBlocks is sufficient.
      if (isFinalizedTagUnsupportedError(error)) {
        logger.warn("Chain doesn't support finalized tag");
        return tx
      }
      logger.error("Error fetching finalized block:", error);
    }
    await new Promise((resolve) => setTimeout(resolve, 20000));
  }
}

export const isFinalizedTagUnsupportedError = (error: any) => {
  return (
      error.message.includes("invalid block tag finalized") || // Common error message
      error.message.includes("unsupported block tag") ||       // Alternative error message
      error.code === -32602                                    // JSON-RPC invalid params error code
  );
}

const filterEventArgs = (event: TypedEvent) => {
  return Object.entries(event.args).reduce((acc, [key, value]) => {
    if (!isNaN(Number(key))) return acc;
    acc[key] = value;
    return acc;
  }, {} as any);
};

const delay = (ms: number): Promise<void> => {
  logger.info(`Waiting ${ms / 1000} seconds...`);
  return new Promise((resolve) => setTimeout(resolve, ms));
}
