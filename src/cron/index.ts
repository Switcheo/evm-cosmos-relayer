import cron from 'node-cron'
import { axelarChain, env, evmChains } from '../config'
import { AxelarClient, DatabaseClient, EventName, EvmClient, HydrogenClient, RelayData } from '../clients'
import { logger } from '../logger'
import { decodeBase64, removeQuote } from '../listeners/AxelarListener/parser'

const db = new DatabaseClient()

export const startCron = async () => {
  const evmClients = Object.fromEntries(evmChains.map((chain) => [chain.id, new EvmClient(chain)]))
  // run every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    // console.debug('running cron')
    // filter for relays that are stuck for x time
    const inboundThresholdTime = new Date(Date.now() - 5 * 60 * 1000) // 5 minutes
    const outboundThresholdTime = new Date(Date.now() - 10 * 60 * 60 * 1000) // 10 minutes
    await fixInTransitFromHydrogen(evmClients, inboundThresholdTime, outboundThresholdTime)
  })
}

export async function fixInTransitFromHydrogen(evmClients: Record<string, EvmClient>, inboundThresholdTime: Date, outboundThresholdTime: Date) {
  const hydrogenClient = new HydrogenClient(env.HYDROGEN_URL)
  // find axelar, in_transit relays
  const inTransitRelays = await hydrogenClient.getInTransitRelays()
  if (inTransitRelays.length === 0) {
    // console.debug('No events in transit')
    return
  }
  const stuckRelays = inTransitRelays.filter(relay => (
    ((relay.flow_type === 'in') && new Date(relay.created_at) < inboundThresholdTime) ||
    ((relay.flow_type === 'out') && new Date(Number(relay.start_block_time) * 1000) < outboundThresholdTime)
  ))

  logger.info(`Found ${stuckRelays.length} stuck relays`)
  for (const relay of stuckRelays) {
    try {
      const axelarClient = await AxelarClient.init(db, axelarChain)
      await fixStuckRelay(db, axelarClient, hydrogenClient, evmClients, relay)
    } catch (e) {
      console.error(`Could not fix stuck relay due to error: ${e}`)
      // TODO: alert chat?
    }
  }
}

export async function fixStuckRelay(db: DatabaseClient, axelarClient: AxelarClient, hydrogenClient: HydrogenClient, evmClients: Record<string, EvmClient>, relayData: RelayData) {
  const { chain_id } = getBridgeIdAndChainIdFromConnectionId(relayData.connection_id)
  logger.info(`Fixing relay id: ${relayData.id} for ${relayData.connection_id}`)
  // find the relay details with its corresponding events/payloads first
  const relay = await hydrogenClient.getRelayWithDetails(relayData.id)
  if (relay.flow_type === 'in') {
    // ** INBOUND ** //
    // Handle no bridging tx
    if (relay.bridging_tx_hash === null) {
      console.debug('No bridging_tx_hash found')
      /* Possible scenarios:
      1) Hydrogen didn't sync the EVMEventConfirmed on axelar
      2) tx not confirmed on axelar so did not emit EVMEventConfirmed
       */

      const contractCallEvent = relay.events.find((event) => event.name === EventName.ContractCall)
      if (!contractCallEvent) throw new Error("contractCallEvent not found")
      const { tx_hash, tx_index} = contractCallEvent
      const eventId = `${tx_hash}-${tx_index}`
      const isFound = await isEventFoundOnAxelar(axelarClient, chain_id, eventId)
      if (isFound) {
        // TODO: Handle case 1
        // TODO: allow hydrogen to support syncing?
        logger.info(`fixStuckRelay: already sent to axelar with eventId: ${eventId}`)
      } else {
        // Handle case 2: tx not confirmed on axelar so did not emit EVMEventConfirmed
        // try to confirm tx

        // check if finalized first
        const evmClient = evmClients[chain_id]
        const isFinalized = await isEvmHeightFinalized(evmClient, relay.source_event!.block_height)
        if (!isFinalized) {
          logger.info(`fixStuckRelay: ${chain_id} callContract tx ${relay.source_tx_hash} is not finalized and should not be sent to axelar for confirmation`)
          return
        }

        const confirmTx = await axelarClient.confirmEvmTx(chain_id, relay.source_tx_hash)
        if (confirmTx) {
          logger.info(`fixStuckRelay: confirmed: ${confirmTx.transactionHash}`)
        }
      }
    }
    // Handle no destination tx
    else if (relay.destination_tx_hash === null) {
      console.debug('No destination_tx_hash found')
      /* possible scenarios:
      1) Hydrogen didn't sync the Switcheo.carbon.bridge.BridgeReceivedEvent on Carbon
      2) tx wasn't routed or failed (ibc timeout)
       */

      // TODO: Handle case 1
      // TODO: allow hydrogen to support syncing?

      // Handle case 2: tx wasn't routed or failed (ibc timeout)
      // try to route message
      const contractCallEvent = relay.events.find((event) => event.name === EventName.ContractCall)
      if (!contractCallEvent) throw new Error("contractCallEvent not found")
      const tx = await axelarClient.routeMessageRequest(Number(contractCallEvent.tx_index), contractCallEvent.tx_hash, contractCallEvent.event_params.payload)
      if (tx) {
        logger.info(`Confirmed: ${tx.transactionHash}`)
      }
    }
  } else {
    // ** OUTBOUND ** //

    // Handle no bridging tx
    if (relay.bridging_tx_hash === null) {
      console.debug('No bridging_tx_hash found')
      /* possible scenarios:
      1) Hydrogen didn't sync the axelar.axelarnet.v1beta1.ContractCallSubmitted on axelar
      2) PendingAction not sent and somehow also not expired by carbon_axelar_execute_relayer (PendingAction should expire within 10 minutes)
      3) PendingAction sent but not relayed by IBC (have BridgeSentEvent, ModuleAxelarCallContractEvent)
       */

      // TODO: Handle case 1
      // TODO: allow hydrogen to support syncing?

      // Handle case 2: PendingAction not sent and somehow also not expired by carbon_axelar_execute_relayer (PendingAction should expire within 10 minutes)
      // TODO: alert hydrogen chat

      // Handle case 3: PendingAction sent but not relayed by IBC (have BridgeSentEvent, ModuleAxelarCallContractEvent)
      // TODO: alert hydrogen chat
    }
    // Handle no destination tx
    else if (relay.destination_tx_hash === null) {
      console.debug('No destination_tx_hash found')
      /* possible scenarios:
      1) Hydrogen didn't sync the ContractCallExecuted on EVM
      2) tx wasn't routed or failed on Axelar
      3) evm command wasn't signed on Axelar  (message status: STATUS_APPROVED)
      4) evm command wasn't batched on Axelar
      5) tx was batched and but wasn't sent to EVM (no ContractCallApproved)
      6) tx wasn't executed on EVM (have ContractCallApproved but no ContractCallExecuted)
       */

      const eventNames = relay.events.map((relayEvent) => relayEvent.name)

      // TODO: Handle case 1
      // TODO: allow hydrogen to support syncing?

      // Handle case 6: tx wasn't executed on EVM (have ContractCallApproved but no ContractCallExecuted)
      if (eventNames.includes(EventName.ContractCallApproved)) {
        // TODO: alert, ContractCall wasn't executed on EVM chain x. Either the carbon_axelar_execute_relayer ran out of funds or is not working properly.
        return
      }

      const contractCallSubmittedEvent = relay.events.find((event) => event.name === EventName.ContractCallSubmitted)
      if (!contractCallSubmittedEvent) throw new Error("contractCallSubmittedEvent not found")
      const messageId = removeQuote(contractCallSubmittedEvent.event_params.message_id)

      if (!eventNames.includes(EventName.ContractCallApproved) &&
        eventNames.includes(EventName.ContractCallSubmitted)
      ) {
        const message = await axelarClient.getMessage(messageId)
        if (!message) throw new Error("message was not found on axelar")
        // reference: export declare enum GeneralMessage_Status {
        //     STATUS_UNSPECIFIED = 0,
        //     STATUS_APPROVED = 1,
        //     STATUS_PROCESSING = 2,
        //     STATUS_EXECUTED = 3,
        //     STATUS_FAILED = 4,
        //     UNRECOGNIZED = -1
        // }

        if (message.status === 1) {
          // Handle case 2: tx wasn't routed
          logger.info('Handle case 2: tx wasn\'t routed or failed on Axelar (message status: STATUS_APPROVED)')
          // route message first
          const routeMessage = await axelarClient.routeMessageRequest(
            -1,
            messageId,
            `0x${decodeBase64(removeQuote(contractCallSubmittedEvent.event_params.payload))}`,
          )

          if (routeMessage) {
            logger.info(`[handleCosmosToEvmEvent] RouteMessage: ${routeMessage.transactionHash}`)
          }

          const pendingCommands = await axelarClient.getPendingCommands(chain_id)

          logger.info(`[handleCosmosToEvmEvent] PendingCommands: ${JSON.stringify(pendingCommands)}`)
          if (pendingCommands.length === 0) return

          // - sign command
          const signCommand = await axelarClient.signCommands(chain_id)
          logger.debug(`[handleCosmosToEvmEvent] SignCommand: ${JSON.stringify(signCommand)}`)

          if (signCommand && signCommand.rawLog?.includes('failed')) {
            throw new Error(signCommand.rawLog)
          }
          if (!signCommand) {
            throw new Error('cannot sign command')
          }
        } else if (message.status === 3) {
          // already routed
          // check if it's in pending
          const pendingCommands = await axelarClient.getPendingCommands(chain_id)

          const [hash, logIndex] = messageId.split('-');
          const pendingCommand = pendingCommands.find((command) => command.params.sourceTxHash === hash && command.params.sourceEventIndex === logIndex)
          if (pendingCommand) {
            // Handle case 3: evm command wasn't signed on Axelar
            logger.info('Handle case 3: evm command wasn\'t signed on Axelar (already routed, in pending command)')
            // - sign command
            const signCommand = await axelarClient.signCommands(chain_id)
            logger.info(`[handleCosmosToEvmEvent] SignCommand: ${JSON.stringify(signCommand)}`)

            if (signCommand && signCommand.rawLog?.includes('failed')) {
              throw new Error(signCommand.rawLog)
            }
            if (!signCommand) {
              throw new Error('cannot sign command')
            }
          } else {
            // TODO: either batched already or batched but didn't send
            // Handle case 4: evm command wasn't batched on Axelar
            logger.info('Handle case 4: evm command wasn\'t batched on Axelar (signed but not approved on evm)')
            // Handle case 5: tx was batched but wasn't sent to EVM (no ContractCallApproved)
            logger.info('Handle case 5: tx was batched but wasn\'t sent to EVM (signed but not approved on evm)')
            // TODO: alert, ContractCallApproved wasn't approved on EVM chain x. For some reason axelar did not send the batched tx. Please investigate.
          }

        } else {
          throw new Error(`messageId: ${messageId} message status is ${message.status} and cannot be handled`)
        }
      }

      // TODO: implement






    }
  }
}

async function isEventFoundOnAxelar(axelarClient: AxelarClient, chain: string, eventId: string): Promise<boolean> {
  let eventOnAxelar
  try {
    eventOnAxelar = await axelarClient.signingClient.queryClient.evm.Event({ chain, eventId })
    if (eventOnAxelar.event?.status === 2) {
      // if completed return true
      return true
    } else {
      return false
    }
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
  return {
    bridge_id: Number(split[0]),
    chain_id: split[1],
  }
}

export async function isEvmHeightFinalized(evmClient: EvmClient, targetBlockNumber: number): Promise<boolean> {
  const finalizedBlockHeight = await evmClient.getFinalizedBlockHeight()
  return finalizedBlockHeight >= targetBlockNumber
}
