import { AxelarClient } from '../clients/AxelarClient'
import { EvmClient } from '../clients/EvmClient'
import { checkOrSetSnooze, getRetryCount, incrementAndGetRetryCount } from './memoryStore'
import { sendTelegramAlertWithPriority } from './telegram'
import { sha256, toUtf8Bytes } from 'ethers/lib/utils'
import { logger } from '../logger'

export const MAX_BATCH_SEND_RETRIES = 3
const BATCH_SEND_SNOOZE_SECONDS = 30 * 60 // 30 minutes

export async function sendStuckBatches(
  axelarClient: AxelarClient,
  evmClient: EvmClient,
  chain: string,
  maxLookback = 10
): Promise<boolean> {
  const batchesToSend: { id: string; executeData: string }[] = []
  let batchId = '' // empty string = latest batch per the API spec

  for (let i = 0; i < maxLookback; i++) {
    const batch = await axelarClient.queryBatchedCommands(chain, batchId)

    if (!batch || !batch.id) break // NonExistent

    if (batch.status === 3 /* BatchSigned */) {
      if (batch.commandIds.length > 0) {
        const firstId = batch.commandIds[0]
        const commandIdHex = firstId.startsWith('0x') ? firstId : '0x' + firstId
        const isExecuted = await evmClient.isExecuted(commandIdHex)

        if (!isExecuted) {
          batchesToSend.push({ id: batch.id, executeData: '0x' + batch.executeData })
        } else {
          // This batch was already sent to EVM — everything before it is too, stop scanning
          break
        }
      }
    } else if (batch.status === 1 /* BatchSigning */) {
      // Multisig still in progress — command may be in this batch but nothing to do yet.
      // Continue backwards in case there's an older stuck BatchSigned batch as well.
      logger.info(`sendStuckBatches: batch ${batch.id} still signing for chain ${chain}`)
    }
    // BatchAborted (status 2): skip, continue backwards

    if (!batch.prevBatchedCommandsId) break
    batchId = batch.prevBatchedCommandsId
  }

  if (batchesToSend.length === 0) return false

  // Send oldest-first so EVM state is consistent
  for (const { id, executeData } of batchesToSend.reverse()) {
    const retryKey = `sendStuckBatch:${chain}:${id}`

    if (getRetryCount(retryKey) >= MAX_BATCH_SEND_RETRIES) {
      const msg = `sendStuckBatches: batch ${id} on chain ${chain} has been attempted ${MAX_BATCH_SEND_RETRIES} times and is still unexecuted on EVM. Manual intervention required.`
      console.warn(msg)
      await sendTelegramAlertWithPriority(msg, 'critical', sha256(toUtf8Bytes(msg)))
      continue
    }

    if (checkOrSetSnooze(retryKey, BATCH_SEND_SNOOZE_SECONDS)) {
      logger.info(`sendStuckBatches: batch ${id} already attempted recently, skipping to avoid excess gas`)
      continue
    }

    incrementAndGetRetryCount(retryKey)
    logger.info(`sendStuckBatches: sending unexecuted batch ${id} to EVM chain ${chain} (attempt ${getRetryCount(retryKey)}/${MAX_BATCH_SEND_RETRIES})`)
    const tx = await evmClient.gatewayExecute(executeData)
    if (tx) logger.info(`sendStuckBatches: batch ${id} executed: ${tx.transactionHash}`)
  }

  return true
}
