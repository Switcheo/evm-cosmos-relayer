import { axelarChain } from '../src/config'
import { AxelarClient, DatabaseClient } from '../src/clients'

// usage example:
// ts-node scripts/test-axelar-confirm-evm-tx.ts [from-chain] [tx-hash]
// ts-node scripts/test-axelar-confirm-evm-tx.ts mantle 0xdbeb0fdbdcfb1e5a21e6b20605002af52532b04d8aee5efae0744b9ca90a9352
async function main() {
  const chain = process.argv[2]
  const tx_hash = process.argv[3]
  console.log('chain', chain)
  console.log('tx_hash', tx_hash)

  const db = new DatabaseClient();
  const axelarClient = await AxelarClient.init(db, axelarChain);
  const confirmTx = await axelarClient.confirmEvmTx(chain, tx_hash)

  if (confirmTx) {
    console.log(`Confirmed: ${confirmTx.transactionHash}`);
  }
}

(async () => {
  await main()
})()
