import { keccak256 } from 'ethers/lib/utils'
import { axelarChain, env } from '../src/config'
import { EventName, HydrogenClient } from '../src/clients'
import { getBridgeIdAndChainIdFromConnectionId, findContractCallSubmittedOnAxelar, computePayloadHashBase64 } from '../src/cron/utils'

// Usage:
//   ts-node scripts/test-query-contract-call-submitted.ts <relay_id>
//
// Simulates what the cron should do for case 1 (missing ContractCallSubmitted):
//   - fetches the relay from Hydrogen
//   - finds the ModuleAxelarCallContractEvent in the relay's events
//   - extracts the payload from the event params
//   - computes payload_hash = keccak256(payload)
//   - runs tx_search on axelar to find the matching ContractCallSubmitted

async function main() {
  const relayId = process.argv[2]
  if (!relayId) {
    console.error('Usage: ts-node scripts/test-query-contract-call-submitted.ts <relay_id>')
    process.exit(1)
  }

  const hydrogenClient = new HydrogenClient(env.HYDROGEN_URL)

  console.log(`Fetching relay ${relayId} from Hydrogen...`)
  const relay = await hydrogenClient.getRelayWithDetails(relayId)
  console.log(`  flow_type:          ${relay.flow_type}`)
  console.log(`  bridging_tx_hash:   ${relay.bridging_tx_hash}`)
  console.log(`  connection_id:      ${relay.connection_id}`)

  const { chain_id } = getBridgeIdAndChainIdFromConnectionId(relay.connection_id)
  console.log(`  chain_id:           ${chain_id}`)

  // Find the ModuleAxelarCallContractEvent in the relay events
  const moduleAxelarCallEvent = relay.events.find(
    (event) => event.name === EventName.ModuleAxelarCallContractEvent
  )
  if (!moduleAxelarCallEvent) {
    console.error('\nNo ModuleAxelarCallContractEvent found in relay events.')
    console.log('Available events:')
    for (const event of relay.events) {
      console.log(`  - ${event.name}`)
    }
    process.exit(1)
  }

  console.log('\nModuleAxelarCallContractEvent event_params:')
  for (const [k, v] of Object.entries(moduleAxelarCallEvent.event_params)) {
    const display = String(v).length > 80 ? String(v).slice(0, 80) + '...' : String(v)
    console.log(`  ${k} = ${display}`)
  }

  // Extract payload from event_params
  const payload = moduleAxelarCallEvent.event_params['payload']
  if (!payload) {
    console.error('\nNo "payload" field found in ModuleAxelarCallContractEvent event_params.')
    console.error('Available fields:', Object.keys(moduleAxelarCallEvent.event_params).join(', '))
    process.exit(1)
  }

  // Compute payload_hash: keccak256 of the payload bytes
  const payloadHashBase64 = computePayloadHashBase64(payload)
  console.log(`\nComputed payload_hash (base64): ${payloadHashBase64}`)

  // Search for the ContractCallSubmitted on axelar using the same strategy as the cron
  console.log(`\nSearching for ContractCallSubmitted on axelar...`)
  const messageId = await findContractCallSubmittedOnAxelar(
    axelarChain.rpcUrl,
    chain_id,
    payloadHashBase64,
  )

  if (messageId !== null) {
    console.log(`\nFOUND! ContractCallSubmitted exists on axelar.`)
    console.log(`  message_id: ${messageId}`)
    console.log(`\nThis means Hydrogen didn't sync the event (case 1). Hydrogen may need resyncing.`)
  } else {
    console.log(`\nNOT FOUND. ContractCallSubmitted does not exist on axelar for this payload.`)
    console.log(`This means the IBC packet was not received by axelar (case 3). Check IBC relayer.`)
  }
}

;(async () => {
  await main()
})()
