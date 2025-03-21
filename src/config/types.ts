export interface CosmosNetworkConfig {
  chainId: string;
  rpcUrl: string;
  lcdUrl: string;
  ws: string;
  denom: string;
  mnemonic: string;
  gasPrice: string;
}

export interface EvmNetworkConfig {
  id: string;
  name: string,
  rpcUrl: string,
  wsUrl: string,
  gateway: string,
  axelarCarbonGateway: string,
  finality: number,
  privateKey: string
}
