import { evmChains } from '../src/config'
import { EvmClient } from '../src/clients'

// usage example:
// ts-node scripts/test-axelar-sendToken.ts carbon-localhost tswth1vkutcr2jarnezenf87p4l3grv6h5ra6e30l5gs euaxl 23
async function main() {
  const chainStr = process.argv[2]
  const addr = process.argv[3]
  const tokenSymbol = process.argv[4]
  const amount = process.argv[5]
  console.log('chainStr: ', chainStr)
  console.log('addr: ', addr)
  console.log('tokenSymbol: ', tokenSymbol)
  console.log('amount: ', amount)
  const chain = evmChains.filter((v) => v.id === chainStr)[0]
  const evmClient = new EvmClient(chain)

  const tx = await evmClient.gateway.sendToken(chainStr, addr, tokenSymbol, amount);
  if (!tx) return;
  console.log(`sendToken: ${tx.hash}`);
}

(async () => {
  await main()
})()
