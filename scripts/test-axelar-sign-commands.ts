import { axelarChain } from '../src/config'
import { AxelarClient, DatabaseClient } from '../src/clients'
// usage example:
// ts-node scripts/test-axelar-sign-commands.ts [chain_id]
// ts-node scripts/test-axelar-sign-commands.ts bsc-testnet
async function main() {
  const chain_id = process.argv[2]
  console.log('chain_id', chain_id)

  const db = new DatabaseClient();
  const axelarClient = await AxelarClient.init(db, axelarChain);
  const tx = await axelarClient.signCommands(chain_id)

  if (tx) {
    console.log(`Confirmed: ${tx.transactionHash}`);
  }
}

(async () => {
  await main()
})()
