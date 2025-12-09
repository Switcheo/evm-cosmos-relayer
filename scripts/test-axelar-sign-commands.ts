import { axelarChain } from '../src/config'
import { AxelarClient, DatabaseClient } from '../src/clients'

import { SignCommandsRequest } from '@axelar-network/axelarjs-types/axelar/evm/v1beta1/tx';
// usage example:
// ts-node scripts/test-axelar-sign-commands.ts [chain_id]
// ts-node scripts/test-axelar-sign-commands.ts bsc-testnet
async function main() {
  const chain_id = process.argv[2]
  console.log('chain_id', chain_id)

  const db = new DatabaseClient();
  const axelarClient = await AxelarClient.init(db, axelarChain);
  console.log('client addr: ', axelarClient.signingClient.getAddress())

  const origEncode = SignCommandsRequest.encode;

  (SignCommandsRequest as any).encode = (msg: any, writer: any) => {
    console.log('*** encode called from this SignCommandsRequest ***');
    return origEncode(msg, writer);
  };
  const tx = await axelarClient.signCommands(chain_id)

  if (tx) {
    console.log(`Confirmed: ${tx.transactionHash}`);
  }
}

(async () => {
  await main()
})()
