import { axelarChain, evmChains } from '../src/config'
import { AxelarClient, DatabaseClient, EvmClient } from '../src/clients'

// usage example:
// ts-node scripts/test-scan-stuck-batches.ts [chain_id] [--dry-run]
// ts-node scripts/test-scan-stuck-batches.ts bsc-testnet
// ts-node scripts/test-scan-stuck-batches.ts bsc-testnet --dry-run

const MAX_LOOKBACK = 10

async function main() {
  const chain = process.argv[2]
  const dryRun = process.argv.includes('--dry-run')

  if (!chain) {
    console.error('Usage: ts-node scripts/test-scan-stuck-batches.ts [chain_id] [--dry-run]')
    process.exit(1)
  }

  console.log(`chain: ${chain}`)
  console.log(`dry-run: ${dryRun}`)
  console.log(`max lookback: ${MAX_LOOKBACK}`)
  console.log('---')

  const db = new DatabaseClient()
  const axelarClient = await AxelarClient.init(db, axelarChain)

  const evmChain = evmChains.find((c) => c.id === chain)
  if (!evmChain) {
    console.error(`No EVM chain config found for id: ${chain}`)
    process.exit(1)
  }
  const evmClient = new EvmClient(evmChain)

  const batchesToSend: { id: string; executeData: string }[] = []
  let batchId = '' // empty = latest

  for (let i = 0; i < MAX_LOOKBACK; i++) {
    const batch = await axelarClient.queryBatchedCommands(chain, batchId)

    if (!batch || !batch.id) {
      console.log(`[${i}] No batch found (NonExistent), stopping scan`)
      break
    }

    const statusLabel = ['NonExistent', 'BatchSigning', 'BatchAborted', 'BatchSigned'][batch.status] ?? `Unknown(${batch.status})`
    console.log(`[${i}] Batch ${batch.id} | status: ${statusLabel} | commands: ${batch.commandIds.length} | prevBatch: ${batch.prevBatchedCommandsId || '(none)'}`)

    if (batch.status === 3 /* BatchSigned */) {
      if (batch.commandIds.length === 0) {
        console.log(`    -> empty batch, skipping`)
      } else {
        const firstId = batch.commandIds[0]
        const commandIdHex = firstId.startsWith('0x') ? firstId : '0x' + firstId
        const isExecuted = await evmClient.isExecuted(commandIdHex)

        console.log(`    -> commandIds: ${batch.commandIds.join(', ')}`)
        console.log(`    -> first command ${commandIdHex} executed on EVM: ${isExecuted}`)

        if (!isExecuted) {
          console.log(`    -> UNEXECUTED — will send`)
          batchesToSend.push({ id: batch.id, executeData: '0x' + batch.executeData })
        } else {
          console.log(`    -> already executed on EVM, stopping scan`)
          break
        }
      }
    } else if (batch.status === 1 /* BatchSigning */) {
      console.log(`    -> still signing, continuing backwards`)
    } else if (batch.status === 2 /* BatchAborted */) {
      console.log(`    -> aborted, skipping`)
    }

    if (!batch.prevBatchedCommandsId) {
      console.log(`    -> no previous batch, stopping scan`)
      break
    }
    batchId = batch.prevBatchedCommandsId
  }

  console.log('---')
  console.log(`Found ${batchesToSend.length} unexecuted batch(es)`)

  if (batchesToSend.length === 0) {
    console.log('Nothing to send.')
    return
  }

  // Oldest-first
  batchesToSend.reverse()

  for (const { id, executeData } of batchesToSend) {
    console.log(`\nBatch ${id}:`)
    console.log(`  executeData (first 80 chars): ${executeData.slice(0, 80)}...`)

    if (dryRun) {
      console.log(`  [dry-run] skipping gatewayExecute`)
      continue
    }

    console.log(`  Sending to EVM gateway...`)
    const tx = await evmClient.gatewayExecute(executeData)
    if (tx) {
      console.log(`  gatewayExecute tx: ${tx.transactionHash}`)
    } else {
      console.error(`  gatewayExecute failed for batch ${id}`)
    }
  }
}

;(async () => {
  await main()
})()
