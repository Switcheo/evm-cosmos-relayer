import { evmChains } from '../src/config'
import { EvmClient } from '../src/clients'

// usage example:
// ts-node scripts/test-axelar-execute.ts bsc-testnet 0x0000
async function main() {
  const chainStr = process.argv[2]
  const executeData = process.argv[3]
  console.log('chainStr: ', chainStr)
  console.log('executeData: ', executeData)
  const chain = evmChains.filter((v) => v.id === chainStr)[0]
  const evmClient = new EvmClient(chain)

  const tx = await evmClient.gatewayExecute(executeData);
  if (!tx) return;
  console.log(`gatewayExecute: ${tx.transactionHash}`);
}

(async () => {
  await main()
})()
