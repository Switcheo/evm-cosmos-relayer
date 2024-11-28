import { env } from '../src/config'
import { fixInTransitFromHydrogen } from '../src/cron'

// usage example:
// ts-node scripts/fix-stuck-relays.ts
async function main() {
  console.log('running fix-stuck-relays with hydrogen URL: ', env.HYDROGEN_URL)

  await fixInTransitFromHydrogen(new Date(), new Date())
}

(async () => {
  await main()
})()
