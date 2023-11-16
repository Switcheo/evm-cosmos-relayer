import { evmChains } from '../src/config'
import { EvmClient } from '../src/clients'
import { Contract } from 'ethers'

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)"
];

// usage example:
// ts-node scripts/test-axelar-sendToken.ts [from-chain] [from-asset-erc20] [to-chain] [to-address] [symbol] [amount]
// ts-node scripts/test-axelar-sendToken.ts bsc-testnet 0xd2b6Fca9AA2aaA84D3e68FFE59cCccb7F1fba395 carbon-localhost tswth1vkutcr2jarnezenf87p4l3grv6h5ra6e30l5gs euaxl 23
async function main() {
  const fromChain = process.argv[2]
  const fromAssetErc20 = process.argv[3]
  const chainStr = process.argv[4]
  const addr = process.argv[5]
  const tokenSymbol = process.argv[6]
  const amount = process.argv[7]
  console.log('fromChain: ', fromChain)
  console.log('fromAssetErc20: ', fromAssetErc20)
  console.log('chainStr: ', chainStr)
  console.log('addr: ', addr)
  console.log('tokenSymbol: ', tokenSymbol)
  console.log('amount: ', amount)
  const chain = evmChains.filter((v) => v.id === fromChain)[0]
  const evmClient = new EvmClient(chain)

  // Get the current gas price from the network
  const gasPrice = await evmClient.wallet.getGasPrice();

  // send approve tx
  const erc20 = new Contract(fromAssetErc20, ERC20_ABI, evmClient.wallet);
  const approveTx = await erc20.approve(
    evmClient.gateway.address,
    amount,
    {
      gasPrice,
    }
  );
  const txRes = await approveTx.wait();

  console.log(`sent approval tx hash ${txRes.transactionHash}`);

  // call gateway send
  const tx = await evmClient.gateway.sendToken(chainStr, addr, tokenSymbol, amount,
    {
      gasPrice,
    });
  if (!tx) return;
  console.log(`sendToken: ${tx.hash}`);
}

(async () => {
  await main()
})()
