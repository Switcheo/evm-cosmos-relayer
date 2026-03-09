import { jest, describe, it, expect, beforeEach } from '@jest/globals'

jest.mock('../../cron/memoryStore')
jest.mock('../../cron/telegram')
jest.mock('../../logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }))

import { sendStuckBatches, MAX_BATCH_SEND_RETRIES } from '../../cron/sendStuckBatches'
import { checkOrSetSnooze, getRetryCount, incrementAndGetRetryCount } from '../../cron/memoryStore'
import { sendTelegramAlertWithPriority } from '../../cron/telegram'

const mockCheckOrSetSnooze = checkOrSetSnooze as jest.MockedFunction<typeof checkOrSetSnooze>
const mockGetRetryCount = getRetryCount as jest.MockedFunction<typeof getRetryCount>
const mockIncrementAndGetRetryCount = incrementAndGetRetryCount as jest.MockedFunction<typeof incrementAndGetRetryCount>
const mockSendTelegramAlert = sendTelegramAlertWithPriority as jest.MockedFunction<typeof sendTelegramAlertWithPriority>

const CHAIN = 'bsc-testnet'

// Minimal batch shape — only the fields sendStuckBatches actually reads
function makeBatch(overrides: {
  id: string
  status: number // 1=Signing, 2=Aborted, 3=Signed
  commandIds?: string[]
  executeData?: string
  prevBatchedCommandsId?: string
}) {
  return {
    id: overrides.id,
    status: overrides.status,
    commandIds: overrides.commandIds ?? ['aabbcc'],
    executeData: overrides.executeData ?? 'deadbeef',
    prevBatchedCommandsId: overrides.prevBatchedCommandsId ?? '',
    data: '',
    keyId: '',
  }
}

function makeAxelarClient(batches: ReturnType<typeof makeBatch>[]) {
  // The function queries with '' first (latest), then follows prevBatchedCommandsId
  const batchMap = Object.fromEntries(batches.map((b) => [b.id, b]))
  const latest = batches[0]

  return {
    queryBatchedCommands: jest.fn(async (_chain: string, id: string) => {
      if (id === '') return latest ?? null
      return batchMap[id] ?? null
    }),
  } as any
}

function makeEvmClient(executedCommandIds: Set<string> = new Set()) {
  return {
    isExecuted: jest.fn(async (commandId: string) => executedCommandIds.has(commandId)),
    gatewayExecute: jest.fn(async (_data: string) => ({ transactionHash: '0xtxhash' })),
  } as any
}

beforeEach(() => {
  jest.clearAllMocks()
  // Default: not snoozed, 0 retries
  mockCheckOrSetSnooze.mockReturnValue(false)
  mockGetRetryCount.mockReturnValue(0)
  mockIncrementAndGetRetryCount.mockReturnValue(1)
  mockSendTelegramAlert.mockResolvedValue(undefined as any)
})

describe('sendStuckBatches', () => {
  it('returns false when no batch exists', async () => {
    const axelarClient = { queryBatchedCommands: jest.fn(async () => null) } as any
    const evmClient = makeEvmClient()

    const result = await sendStuckBatches(axelarClient, evmClient, CHAIN)

    expect(result).toBe(false)
    expect(evmClient.gatewayExecute).not.toHaveBeenCalled()
  })

  it('returns false when no batch id returned', async () => {
    const axelarClient = { queryBatchedCommands: jest.fn(async () => ({ id: '' })) } as any
    const evmClient = makeEvmClient()

    const result = await sendStuckBatches(axelarClient, evmClient, CHAIN)

    expect(result).toBe(false)
    expect(evmClient.gatewayExecute).not.toHaveBeenCalled()
  })

  it('sends latest batch when it is BatchSigned and not executed on EVM', async () => {
    const batch = makeBatch({ id: 'batch1', status: 3, commandIds: ['aabb'], executeData: 'deadbeef' })
    const axelarClient = makeAxelarClient([batch])
    const evmClient = makeEvmClient() // nothing executed

    const result = await sendStuckBatches(axelarClient, evmClient, CHAIN)

    expect(result).toBe(true)
    expect(evmClient.isExecuted).toHaveBeenCalledWith('0xaabb')
    expect(evmClient.gatewayExecute).toHaveBeenCalledWith('0xdeadbeef')
    expect(evmClient.gatewayExecute).toHaveBeenCalledTimes(1)
  })

  it('returns false when latest batch is already executed on EVM', async () => {
    const batch = makeBatch({ id: 'batch1', status: 3, commandIds: ['0xaabb'] })
    const axelarClient = makeAxelarClient([batch])
    const evmClient = makeEvmClient(new Set(['0xaabb']))

    const result = await sendStuckBatches(axelarClient, evmClient, CHAIN)

    expect(result).toBe(false)
    expect(evmClient.gatewayExecute).not.toHaveBeenCalled()
  })

  it('skips BatchSigning batch and continues backwards to find older unexecuted batch', async () => {
    const signingBatch = makeBatch({ id: 'batch2', status: 1, prevBatchedCommandsId: 'batch1' })
    const olderBatch = makeBatch({ id: 'batch1', status: 3, commandIds: ['aabb'], executeData: 'deadbeef' })
    const axelarClient = makeAxelarClient([signingBatch, olderBatch])
    const evmClient = makeEvmClient()

    const result = await sendStuckBatches(axelarClient, evmClient, CHAIN)

    expect(result).toBe(true)
    expect(evmClient.gatewayExecute).toHaveBeenCalledWith('0xdeadbeef')
    expect(evmClient.gatewayExecute).toHaveBeenCalledTimes(1)
  })

  it('skips BatchAborted batch and continues backwards', async () => {
    const abortedBatch = makeBatch({ id: 'batch2', status: 2, prevBatchedCommandsId: 'batch1' })
    const olderBatch = makeBatch({ id: 'batch1', status: 3, commandIds: ['aabb'], executeData: 'deadbeef' })
    const axelarClient = makeAxelarClient([abortedBatch, olderBatch])
    const evmClient = makeEvmClient()

    const result = await sendStuckBatches(axelarClient, evmClient, CHAIN)

    expect(result).toBe(true)
    expect(evmClient.gatewayExecute).toHaveBeenCalledWith('0xdeadbeef')
  })

  it('sends multiple unexecuted batches oldest-first', async () => {
    // batch3 (latest) → batch2 → batch1 (oldest), all unexecuted
    const batch3 = makeBatch({ id: 'batch3', status: 3, commandIds: ['cc'], executeData: 'cc', prevBatchedCommandsId: 'batch2' })
    const batch2 = makeBatch({ id: 'batch2', status: 3, commandIds: ['bb'], executeData: 'bb', prevBatchedCommandsId: 'batch1' })
    const batch1 = makeBatch({ id: 'batch1', status: 3, commandIds: ['aa'], executeData: 'aa' })
    const axelarClient = makeAxelarClient([batch3, batch2, batch1])
    const evmClient = makeEvmClient()

    await sendStuckBatches(axelarClient, evmClient, CHAIN)

    const calls = evmClient.gatewayExecute.mock.calls.map((c: any[]) => c[0])
    expect(calls).toEqual(['0xaa', '0xbb', '0xcc']) // oldest-first
  })

  it('stops scanning when it hits a batch already executed on EVM', async () => {
    // batch2 (latest) unexecuted, batch1 already executed → don't look further back
    const batch2 = makeBatch({ id: 'batch2', status: 3, commandIds: ['bb'], executeData: 'bb', prevBatchedCommandsId: 'batch1' })
    const batch1 = makeBatch({ id: 'batch1', status: 3, commandIds: ['0xaa'], executeData: 'aa' })
    const axelarClient = makeAxelarClient([batch2, batch1])
    const evmClient = makeEvmClient(new Set(['0xaa'])) // batch1 first command executed

    await sendStuckBatches(axelarClient, evmClient, CHAIN)

    // only batch2 should be sent
    expect(evmClient.gatewayExecute).toHaveBeenCalledWith('0xbb')
    expect(evmClient.gatewayExecute).toHaveBeenCalledTimes(1)
  })

  it('skips sending when snooze is active (recently attempted)', async () => {
    mockCheckOrSetSnooze.mockReturnValue(true) // snoozed
    const batch = makeBatch({ id: 'batch1', status: 3 })
    const axelarClient = makeAxelarClient([batch])
    const evmClient = makeEvmClient()

    const result = await sendStuckBatches(axelarClient, evmClient, CHAIN)

    expect(result).toBe(true) // batches were found
    expect(evmClient.gatewayExecute).not.toHaveBeenCalled()
  })

  it('sends critical alert and skips when max retries exceeded', async () => {
    mockGetRetryCount.mockReturnValue(MAX_BATCH_SEND_RETRIES)
    const batch = makeBatch({ id: 'batch1', status: 3 })
    const axelarClient = makeAxelarClient([batch])
    const evmClient = makeEvmClient()

    const result = await sendStuckBatches(axelarClient, evmClient, CHAIN)

    expect(result).toBe(true) // batches were found
    expect(evmClient.gatewayExecute).not.toHaveBeenCalled()
    expect(mockSendTelegramAlert).toHaveBeenCalledWith(
      expect.stringContaining('Manual intervention required'),
      'critical',
      expect.any(String)
    )
  })

  it('increments retry count on each send attempt', async () => {
    const batch = makeBatch({ id: 'batch1', status: 3 })
    const axelarClient = makeAxelarClient([batch])
    const evmClient = makeEvmClient()

    await sendStuckBatches(axelarClient, evmClient, CHAIN)

    expect(mockIncrementAndGetRetryCount).toHaveBeenCalledWith(`sendStuckBatch:${CHAIN}:batch1`)
  })

  it('prefixes commandId with 0x when missing', async () => {
    const batch = makeBatch({ id: 'batch1', status: 3, commandIds: ['aabbccdd'] }) // no 0x prefix
    const axelarClient = makeAxelarClient([batch])
    const evmClient = makeEvmClient()

    await sendStuckBatches(axelarClient, evmClient, CHAIN)

    expect(evmClient.isExecuted).toHaveBeenCalledWith('0xaabbccdd')
  })

  it('does not double-prefix commandId that already has 0x', async () => {
    const batch = makeBatch({ id: 'batch1', status: 3, commandIds: ['0xaabbccdd'] })
    const axelarClient = makeAxelarClient([batch])
    const evmClient = makeEvmClient()

    await sendStuckBatches(axelarClient, evmClient, CHAIN)

    expect(evmClient.isExecuted).toHaveBeenCalledWith('0xaabbccdd')
  })

  it('respects maxLookback limit', async () => {
    // Create a chain of 5 unexecuted BatchSigned batches
    const batches = Array.from({ length: 5 }, (_, i) => {
      const id = `batch${5 - i}`
      const prev = i < 4 ? `batch${4 - i}` : ''
      return makeBatch({ id, status: 3, commandIds: [`cmd${i}`], executeData: `data${i}`, prevBatchedCommandsId: prev })
    })
    const axelarClient = makeAxelarClient(batches)
    const evmClient = makeEvmClient()

    await sendStuckBatches(axelarClient, evmClient, CHAIN, 2 /* maxLookback=2 */)

    // Should only query 2 batches max
    expect(axelarClient.queryBatchedCommands).toHaveBeenCalledTimes(2)
  })
})
