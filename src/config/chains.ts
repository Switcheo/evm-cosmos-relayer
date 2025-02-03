import mainnetAxelar from '../../data/mainnet/axelar.json';
import mainnetCosmos from '../../data/mainnet/cosmos.json';
import mainnetEvm from '../../data/mainnet/evm.json';
import testnetAxelar from '../../data/testnet/axelar.json';
import testnetCosmos from '../../data/testnet/cosmos.json';
import testnetEvm from '../../data/testnet/evm.json';
import devnetAxelar from '../../data/devnet/axelar.json';
import devnetCosmos from '../../data/devnet/cosmos.json';
import devnetEvm from '../../data/devnet/evm.json';
import { env } from '.';
import { CosmosNetworkConfig, EvmNetworkConfig } from './types';

// Function to check if all required fields are filled
const isValidEvmEntry = (entry: any) => {
  const isValid = entry.id && entry.name && entry.finality && entry.rpcUrl && entry.gateway && entry.axelarCarbonGateway;
  console.warn(`${entry.name} config entry is invalid`)
  return isValid;
};

const cosmos = env.CHAIN_ENV === 'devnet' ? devnetCosmos :
  (env.CHAIN_ENV === 'mainnet' ? mainnetCosmos : testnetCosmos);
const axelar = env.CHAIN_ENV === 'devnet' ? devnetAxelar :
  (env.CHAIN_ENV === 'mainnet' ? mainnetAxelar : testnetAxelar);
const evm = env.CHAIN_ENV === 'devnet' ? devnetEvm :
  (env.CHAIN_ENV === 'mainnet' ? mainnetEvm : testnetEvm).filter(isValidEvmEntry);

export const cosmosChains: CosmosNetworkConfig[] = cosmos.map((chain) => ({
  ...chain,
  mnemonic: env.AXELAR_MNEMONIC,
}));

export const axelarChain: CosmosNetworkConfig = {
  ...axelar,
  mnemonic: env.AXELAR_MNEMONIC,
};

export const evmChains: EvmNetworkConfig[] = evm.map((chain) => ({
  ...chain,
  privateKey: env.EVM_PRIVATE_KEY,
}));
