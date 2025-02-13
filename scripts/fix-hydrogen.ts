import { env, evmChains } from '../src/config'
import { fixInTransitFromHydrogen } from '../src/cron'
import { EvmClient } from '../src/clients'

// usage example:
// ts-node scripts/fix-stuck-relays.ts
async function main() {
  console.log('running fix-stuck-relays with hydrogen URL: ', env.HYDROGEN_URL)

  const evmClients = Object.fromEntries(evmChains.map((chain) => [chain.id, new EvmClient(chain)]))
  await fixInTransitFromHydrogen(evmClients, new Date(), new Date())
}

(async () => {
  await main()
})()
