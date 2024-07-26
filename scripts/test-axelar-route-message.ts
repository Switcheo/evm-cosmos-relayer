import { axelarChain } from '../src/config'
import { AxelarClient, DatabaseClient } from '../src/clients'

// usage example:
// ts-node scripts/test-axelar-route-message.ts [tx_hash] [log_index] [payload]
// ts-node scripts/test-axelar-route-message.ts mantle 0xdbeb0fdbdcfb1e5a21e6b20605002af52532b04d8aee5efae0744b9ca90a9352 0 0x0123
async function main() {
  const tx_hash = process.argv[2]
  const log_index = process.argv[3]
  const payload = process.argv[4]
  console.log('tx_hash', tx_hash)
  console.log('log_index', log_index)
  console.log('payload', payload)

  const db = new DatabaseClient();
  const axelarClient = await AxelarClient.init(db, axelarChain);
  const tx = await axelarClient.routeMessageRequest(Number(log_index), tx_hash, payload)

  if (tx) {
    console.log(`Confirmed: ${tx.transactionHash}`);
  }
}

(async () => {
  await main()
})()
