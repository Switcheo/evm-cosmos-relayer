import { axelarChain, env } from '../src/config'
import { AxelarClient, DatabaseClient, DemexClient, HydrogenClient } from '../src/clients'
import { sendTelegramAlertWithPriority } from '../src/cron/telegram'

// usage example:
// ts-node scripts/fix-stuck-relays.ts
async function main() {
  console.log('running test')

  // const db = new DatabaseClient()
  // const axelarClient = await AxelarClient.init(db, axelarChain)
  // const tx_hash = '0xa8f865fdaf72a78c04cf4e732b87536e7210707815bce16893e9c2e731174adf'
  // const tx_index = '3'
  // const chain_id = 'mantle'
  // const eventId = `${tx_hash}-${tx_index}`
  // let eventOnAxelar
  // try {
  //   eventOnAxelar = await axelarClient.signingClient.queryClient.evm.Event({ chain: chain_id, eventId })
  // } catch (e: any) {
  //   if (e.toString().includes('no event with ID')) {
  //
  //   }
  // }
  // console.log('eventOnAxelar', eventOnAxelar)

  // await sendTelegramAlertWithPriority('hello', 'critical')

  const demexClient = new DemexClient(process.env.DEMEX_URL!)
  const pendingaction = await demexClient.getPendingAction('32')
  console.log('pendingaction', pendingaction)
}

(async () => {
  await main()
})()
