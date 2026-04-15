import { axelarChain, env, evmChains } from '../src/config'
import {
  AxelarClient,
  DatabaseClient,
  DemexClient,
  EventName,
  EvmClient,
  HydrogenClient,
  NewPendingActionEventParams,
} from '../src/clients'
import {
  computePayloadHashBase64,
  findContractCallSubmittedOnAxelar,
  getBridgeIdAndChainIdFromConnectionId,
  isEventFoundOnAxelar,
  isEvmTxHeightFinalized,
} from '../src/cron/utils'

function printSection(title: string) {
  console.log(`\n=== ${title} ===`)
}

function printList(items: string[]) {
  for (const item of items) {
    console.log(`- ${item}`)
  }
}

function removeQuote(value: string | undefined) {
  if (!value) return ''
  return value.replace(/^"+|"+$/g, '')
}

function hasExpiredMoreThanOneHour(expiryIsoString: string): boolean {
  const expiryTime = new Date(expiryIsoString)
  const now = new Date()
  return now.getTime() - expiryTime.getTime() > 60 * 60 * 1000
}

async function main() {
  const relayId = process.argv[2]
  if (!relayId) {
    console.error('Usage: yarn ts-node scripts/inspect-relay.ts <relay_id>')
    process.exit(1)
  }

  const hydrogenClient = new HydrogenClient(env.HYDROGEN_URL)
  const demexClient = new DemexClient(env.DEMEX_URL)
  const relay = await hydrogenClient.getRelayWithDetails(relayId)
  const { chain_id } = getBridgeIdAndChainIdFromConnectionId(relay.connection_id)
  const chainConfig = evmChains.find((chain) => chain.id === chain_id)
  const eventNames = relay.events.map((event) => event.name)

  printSection('Relay Summary')
  printList([
    `relay_id: ${relay.id}`,
    `flow_type: ${relay.flow_type}`,
    `connection_id: ${relay.connection_id}`,
    `chain_id: ${chain_id}`,
    `source_tx_hash: ${relay.source_tx_hash}`,
    `bridging_tx_hash: ${relay.bridging_tx_hash ?? 'null'}`,
    `destination_tx_hash: ${relay.destination_tx_hash ?? 'null'}`,
  ])

  printSection('Events')
  printList(eventNames)

  const recommendations: string[] = []
  let diagnosis = 'Unable to classify with the current heuristics.'

  const getAxelarClient = async () => {
    const db = new DatabaseClient()
    return AxelarClient.init(db, axelarChain)
  }

  if (relay.flow_type === 'in') {
    if (relay.bridging_tx_hash === null) {
      diagnosis = 'Inbound relay is missing bridging_tx_hash.'
      const contractCallEvent = relay.events.find((event) => event.name === EventName.ContractCall)
      if (!contractCallEvent) {
        recommendations.push('Missing ContractCall event on the relay. Relay data may be incomplete.')
      } else {
        const eventId = `${contractCallEvent.tx_hash}-${contractCallEvent.tx_index}`
        recommendations.push(`Axelar event id to check: ${eventId}`)

        try {
          const axelarClient = await getAxelarClient()
          const eventFound = await isEventFoundOnAxelar(axelarClient, chain_id, eventId)
          if (eventFound) {
            diagnosis = 'Axelar already has the confirmed EVM event, so Hydrogen likely missed the sync.'
            recommendations.push('Do not re-confirm the EVM tx blindly.')
            recommendations.push('Escalate for Hydrogen resync and verify bridging_tx_hash updates afterward.')
          } else if (relay.source_event && chainConfig) {
            const evmClient = new EvmClient(chainConfig)
            const finalized = await isEvmTxHeightFinalized(evmClient, relay.source_event.block_height)
            if (finalized) {
              diagnosis = 'Source EVM tx looks finalized, but Axelar does not have the confirmed event yet.'
              recommendations.push(`Safe next action: yarn ts-node scripts/test-axelar-confirm-evm-tx.ts ${chain_id} ${relay.source_tx_hash}`)
            } else {
              diagnosis = 'Source EVM tx is not finalized enough for Axelar confirmation yet.'
              recommendations.push('Wait for finality and retry inspection later.')
            }
          } else {
            recommendations.push('Could not verify EVM finality because source_event or chain config is missing.')
          }
        } catch (error: any) {
          recommendations.push(`Could not verify Axelar/EVM state automatically: ${error.message}`)
        }
      }
    } else if (relay.destination_tx_hash === null) {
      diagnosis = 'Inbound relay is bridged but not completed on Carbon.'
      const contractCallEvent = relay.events.find((event) => event.name === EventName.ContractCall)
      recommendations.push('Recommended first action: yarn ts-node scripts/fix-hydrogen.ts')
      if (contractCallEvent?.event_params.payload) {
        recommendations.push(
          `Targeted route retry: yarn ts-node scripts/test-axelar-route-message.ts ${contractCallEvent.tx_hash} ${contractCallEvent.tx_index} ${contractCallEvent.event_params.payload}`
        )
      }
      recommendations.push('If Carbon already has the receive-side event, treat this as a Hydrogen indexing issue and escalate.')
    } else {
      diagnosis = 'Inbound relay already has both bridging and destination tx hashes.'
      recommendations.push('The relay does not look stuck in the states covered by this script.')
    }
  } else if (relay.flow_type === 'out') {
    if (relay.bridging_tx_hash === null) {
      const moduleAxelarCallEvent = relay.events.find((event) => event.name === EventName.ModuleAxelarCallContractEvent)
      const bridgeAcknowledgedEvent = relay.events.find((event) => event.name === EventName.BridgeAcknowledgedEvent)
      if (moduleAxelarCallEvent && bridgeAcknowledgedEvent) {
        const payload = moduleAxelarCallEvent.event_params.payload
        if (!payload) {
          diagnosis = 'Outbound relay has Carbon->Axelar handoff events, but payload is missing from ModuleAxelarCallContractEvent.'
          recommendations.push('Inspect Hydrogen event payloads for data completeness.')
        } else {
          try {
            const payloadHashBase64 = computePayloadHashBase64(payload)
            const messageId = await findContractCallSubmittedOnAxelar(
              axelarChain.rpcUrl,
              chain_id,
              payloadHashBase64,
            )
            if (messageId) {
              diagnosis = 'Axelar already has ContractCallSubmitted, so Hydrogen likely missed the sync.'
              recommendations.push(`Observed message_id on Axelar: ${messageId}`)
              recommendations.push('Stop retrying bridge actions and escalate for Hydrogen resync.')
            } else {
              diagnosis = 'Carbon emitted the outbound IBC handoff, but Axelar does not show ContractCallSubmitted.'
              recommendations.push('Escalate to the IBC relayer or chain-ops owner.')
              recommendations.push('Attach proof that Carbon emitted the packet and Axelar has no matching ContractCallSubmitted.')
            }
          } catch (error: any) {
            recommendations.push(`Could not query Axelar for ContractCallSubmitted: ${error.message}`)
          }
        }
      } else {
        const pendingActionEvent = relay.events.find((event) => event.name === EventName.NewPendingActionEvent)
        if (!pendingActionEvent) {
          diagnosis = 'Outbound relay has no bridging_tx_hash and no pending action event.'
          recommendations.push('Relay data is missing the expected first event. Manual inspection is required.')
        } else {
          try {
            const nonce = (pendingActionEvent.event_params as unknown as NewPendingActionEventParams).nonce
            const pendingAction = await demexClient.getPendingAction(nonce)
            const expired = hasExpiredMoreThanOneHour(pendingAction.relay_details.expiry_block_time)
            if (expired) {
              diagnosis = 'Pending action expired more than one hour ago but still was not cleared.'
              recommendations.push('Likely Carbon executor liveness or funding issue.')
              recommendations.push('Escalate to the Carbon-side operator instead of retrying Axelar actions.')
            } else {
              diagnosis = 'Pending action still exists and does not look fully expired yet.'
              recommendations.push('Wait or inspect the Carbon executor before retrying.')
            }
          } catch (error: any) {
            recommendations.push(`Could not load Carbon pending action details: ${error.message}`)
          }
        }
      }
    } else if (relay.destination_tx_hash === null) {
      const contractCallApproved = eventNames.includes(EventName.ContractCallApproved)
      if (contractCallApproved) {
        diagnosis = 'Axelar already approved the contract call, but EVM execution is still missing.'
        recommendations.push('Check the EVM executor wallet balance and chain gas conditions.')
        recommendations.push('Escalate to the EVM-side operator if execution does not resume.')
      } else {
        const contractCallSubmittedEvent = relay.events.find((event) => event.name === EventName.ContractCallSubmitted)
        recommendations.push('Recommended first action: yarn ts-node scripts/fix-hydrogen.ts')

        if (contractCallSubmittedEvent) {
          try {
            const axelarClient = await getAxelarClient()
            const messageId = removeQuote(contractCallSubmittedEvent.event_params.message_id)
            const message = await axelarClient.getMessage(messageId)
            if (message) {
              recommendations.push(`Axelar message status: ${message.status}`)
              if (message.status === 1) {
                diagnosis = 'Message is approved on Axelar but not yet fully processed.'
                recommendations.push(`If pending commands exist for ${chain_id}, you can trigger signing with: yarn ts-node scripts/test-axelar-sign-commands.ts ${chain_id}`)
              } else if (message.status === 3) {
                diagnosis = 'Message is already routed on Axelar. A signed batch may be stuck before EVM execution.'
                recommendations.push(`Inspect batches first: yarn ts-node scripts/test-scan-stuck-batches.ts ${chain_id} --dry-run`)
                recommendations.push(`If unexecuted batches are found: yarn ts-node scripts/test-scan-stuck-batches.ts ${chain_id}`)
              } else {
                diagnosis = `Axelar message status is ${message.status}.`
                recommendations.push('Manual investigation is required before retrying further actions.')
              }
            } else {
              recommendations.push(`Axelar could not find message_id ${messageId}.`)
            }
          } catch (error: any) {
            recommendations.push(`Could not inspect Axelar message state: ${error.message}`)
          }
        } else {
          recommendations.push('ContractCallSubmitted event is missing from the relay. Manual inspection is required.')
        }
      }
    } else {
      diagnosis = 'Outbound relay already has both bridging and destination tx hashes.'
      recommendations.push('The relay does not look stuck in the states covered by this script.')
    }
  }

  printSection('Diagnosis')
  console.log(diagnosis)

  printSection('Recommended Next Actions')
  printList(recommendations)
}

;(async () => {
  await main()
})()
