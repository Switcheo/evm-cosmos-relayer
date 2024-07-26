import { evmChains } from '../src/config'
import { EvmClient } from '../src/clients'
import { BigNumber, utils } from 'ethers'

// usage example:
// ts-node scripts/test-axelar-callContract.ts [from-chain] [to-chain] [to-address] [payload]
// ts-node scripts/test-axelar-callContract.ts bsc-testnet carbon-2 tswth1vkutcr2jarnezenf87p4l3grv6h5ra6e30l5gs 0x0123
async function main() {
  const fromChain = process.argv[2]
  const chainStr = process.argv[3]
  const addr = process.argv[4]
  const payload = process.argv[5]
  console.log('fromChain: ', fromChain)
  console.log('chainStr: ', chainStr)
  console.log('addr: ', addr)
  console.log('payload: ', payload)
  console.log('', )

  const chain = evmChains.filter((v) => v.id === fromChain)[0]
  const evmClient = new EvmClient(chain)

  // Get the current gas price from the network
  const gasPrice = await evmClient.wallet.getGasPrice();
  // const gasLimit = await evmClient.wallet.estimateGas(tx)

  const payloadWithVersion = utils.solidityPack(
    ['uint32', 'bytes'],
    [0, utils.arrayify(payload)]
  );

  // call gateway callContract
  const tx = await evmClient.gateway.callContract(chainStr, addr, payloadWithVersion,
    {
      gasPrice,
    });
  if (!tx) return;
  console.log(`callContract: ${tx.hash}`);
}

(async () => {
  await main()
})()
