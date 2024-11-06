import cron from 'node-cron'
import { axelarChain, env } from '../config'
import { AxelarClient, DatabaseClient, EventName, HydrogenClient, RelayData } from '../clients'
import { logger } from '../logger'
import { getBatchCommandIdFromSignTx } from '../handler'
import { decodeBase64, removeQuote } from '../listeners/AxelarListener/parser'

export const startCron = async () => {
  // run every 15 minutes
  cron.schedule('*/3 * * * * *', async () => {
    console.debug('running minute cron')
    // filter for relays that are stuck for at least 3 hours
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000)
    await fixInTransitFromHydrogen(threeHoursAgo)
  })
}

export async function fixInTransitFromHydrogen(thresholdTime: Date) {
  const hydrogenClient = new HydrogenClient(env.HYDROGEN_URL)
  // if (env.CHAIN_ENV !== 'mainnet') return
  // find axelar, in_transit relays
  const inTransitRelays = await hydrogenClient.getInTransitRelays()
  if (inTransitRelays.length === 0) {
    console.debug('No events in transit')
    return
  }
  const stuckRelays = inTransitRelays.filter(relay => new Date(relay.created_at) < thresholdTime)

  console.log(`Found ${stuckRelays.length} stuck relays`)
  for (const relay of stuckRelays) {
    try {
      const db = new DatabaseClient()
      const axelarClient = await AxelarClient.init(db, axelarChain)
      await fixStuckRelay(db, axelarClient, hydrogenClient, relay)
    } catch (e) {
      console.error(`Could not fix stuck relay due to error: ${e}`)
      // TODO: alert chat?
    }
  }
}

export async function fixStuckRelay(db: DatabaseClient, axelarClient: AxelarClient, hydrogenClient: HydrogenClient, relay: RelayData) {
  const { chain_id } = getBridgeIdAndChainIdFromConnectionId(relay.connection_id)
  if (relay.flow_type === 'in') {
    // ** INBOUND ** //
    // Handle no bridging tx
    if (relay.bridging_tx_hash === null) {
      console.debug('No bridging_tx_hash found')
      /* Possible scenarios:
      1) Hydrogen didn't sync the EVMEventConfirmed on axelar
      2) tx not confirmed on axelar so did not emit EVMEventConfirmed
       */

      // TODO: Handle case 1
      // TODO: allow hydrogen to support syncing?

      // Handle case 2: tx not confirmed on axelar so did not emit EVMEventConfirmed
      // try to confirm tx
      const confirmTx = await axelarClient.confirmEvmTx(chain_id, relay.source_tx_hash)
      if (confirmTx) {
        console.log(`fixStuckRelay: confirmed: ${confirmTx.transactionHash}`)
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
      const bridgingEvent = await hydrogenClient.getEventByTxHashAndIndex(relay.bridging_tx_hash, relay.bridging_event_index!)
      const tx = await axelarClient.routeMessageRequest(Number(bridgingEvent.tx_index), bridgingEvent.tx_hash, bridgingEvent.event_params.payload)
      if (tx) {
        console.log(`Confirmed: ${tx.transactionHash}`)
      }
    }
  } else {
    // ** OUTBOUND ** //
    // find the relay details with its corresponding events/payloads first
    const relayWithDetails = await hydrogenClient.getRelayWithDetails(relay.id)

    // Handle no bridging tx
    if (relay.bridging_tx_hash === null) {
      console.debug('No bridging_tx_hash found')
      /* possible scenarios:
      1) Hydrogen didn't sync the axelar.axelarnet.v1beta1.ContractCallSubmitted on axelar
      2) PendingAction not sent and somehow also not expired by carbon_axelar_execute_relayer (PendingAction should expire within 10 minutes)
       */

      // TODO: Handle case 1
      // TODO: allow hydrogen to support syncing?

      // Handle case 2: PendingAction not sent and somehow also not expired by carbon_axelar_execute_relayer (PendingAction should expire within 10 minutes)
      // TODO: alert hydrogen chat
    }
    // Handle no destination tx
    else if (relay.destination_tx_hash === null) {
      console.debug('No destination_tx_hash found')
      /* possible scenarios:
      1) Hydrogen didn't sync the ContractCallExecuted on EVM
      2) tx wasn't routed or failed on Axelar
      3) evm command wasn't signed on Axelar
      4) evm command wasn't batched on Axelar
      5) tx was batched and but wasn't sent to EVM (no ContractCallApproved)
      6) tx wasn't executed on EVM (have ContractCallApproved but no ContractCallExecuted)
       */

      const events = relayWithDetails.events.map((relayEvent) => relayEvent.name)

      // TODO: Handle case 1
      // TODO: allow hydrogen to support syncing?

      // Handle case 6: tx wasn't executed on EVM (have ContractCallApproved but no ContractCallExecuted)
      if (events.includes('ContractCallApproved')) {
        // TODO: alert, ContractCall wasn't executed on EVM chain x. Either the carbon_axelar_execute_relayer ran out of funds or is not working properly.
        return
      }

      // Handle case 5: tx was batched and but wasn't sent to EVM (no ContractCallApproved)
      if (events.includes('ContractCallApproved')) {
        // TODO: alert, ContractCallApproved wasn't approved on EVM chain x. For some reason axelar did not send the batched tx. Please investigate.
      }



      // Handle case 4: evm command wasn't batched on Axelar
      // TODO: implement


      // Handle case 3: evm command wasn't signed on Axelar
      // - get pending commands
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

      // batch command
      const batchedCommandId = getBatchCommandIdFromSignTx(signCommand)
      logger.info(`[handleCosmosToEvmEvent] BatchCommandId: ${batchedCommandId}`)

      // execute command on evm
      const executeData = await axelarClient.getExecuteDataFromBatchCommands(
        chain_id,
        batchedCommandId
      )

      logger.info(`[handleCosmosToEvmEvent] BatchCommands: ${JSON.stringify(executeData)}`)


      // Handle case 2: tx wasn't routed or failed on Axelar
      // TODO: implement
      // how to check if it's routing issue?
      // - get ContractCallSubmitted event from hydrogen, which contains message id
      // - route message
      const contractCallSubmittedEvent = relayWithDetails.events.find((event) => event.name === EventName.ContractCallSubmitted)
      if (!contractCallSubmittedEvent) throw new Error("contractCallSubmittedEvent not found")
      const routeMessage = await axelarClient.routeMessageRequest(
        -1,
        removeQuote(contractCallSubmittedEvent.event_params.message_id),
        `0x${decodeBase64(removeQuote(contractCallSubmittedEvent.event_params.payload))}`,
      )

      if (routeMessage) {
        logger.info(`[handleCosmosToEvmEvent] RouteMessage: ${routeMessage.transactionHash}`)
      }


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
