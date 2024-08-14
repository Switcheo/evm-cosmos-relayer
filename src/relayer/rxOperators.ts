import { filter, of, throwError } from 'rxjs';
import { ContractCallSubmitted, ContractCallWithTokenSubmitted, EvmEvent, ExecuteRequest, IBCEvent, IBCPacketEvent } from '../types'
import {
  ContractCallApprovedEvent,
  ContractCallApprovedEventObject,
  ContractCallApprovedWithMintEventObject,
  ContractCallEventObject,
  ContractCallWithTokenEventObject,
} from '../types/contracts/IAxelarGateway'
import { CosmosNetworkConfig, EvmNetworkConfig } from '../config/types'
import { EvmClient } from '../clients';
import { env } from '../config'

export function filterCosmosDestination(cosmosChains: CosmosNetworkConfig[]) {
  if (env.CHAIN_ENV === 'devnet')
    return filter<EvmEvent<ContractCallWithTokenEventObject | ContractCallEventObject>>(() => true);

  return filter((event: EvmEvent<ContractCallWithTokenEventObject | ContractCallEventObject>) =>
    cosmosChains.map((chain) => chain.chainId).includes(event.args.destinationChain)
  );
}

export function filterDestinationEvmToCarbon(cosmosChains: CosmosNetworkConfig[]) {
  if (env.CHAIN_ENV === 'devnet')
    return filter<ExecuteRequest>(() => true);

  return filter((event: ExecuteRequest) =>
    cosmosChains.map((chain) => chain.chainId).includes(event.destinationChain)
  );
}

export function filterDestinationCarbonToEvm(evmChains: EvmNetworkConfig[]) {
  if (env.CHAIN_ENV === 'devnet')
    return filter<IBCEvent<ContractCallSubmitted | ContractCallWithTokenSubmitted>>(() => true);

  return filter((event: IBCEvent<ContractCallSubmitted | ContractCallWithTokenSubmitted>) =>
    evmChains.some((chain) => chain.id === event.args.destinationChain && chain.axelarCarbonGateway === event.args.contractAddress)
  );
}

export function filterSourceChainOnEvm(cosmosChains: CosmosNetworkConfig[]) {
  if (env.CHAIN_ENV === 'devnet')
    return filter<EvmEvent<ContractCallApprovedEventObject | ContractCallApprovedWithMintEventObject>>(() => true);

  return filter((event: EvmEvent<ContractCallApprovedEventObject | ContractCallApprovedWithMintEventObject>) =>
    cosmosChains.some((chain) => chain.chainId === event.args.sourceChain)
  );
}

export function mapEventToEvmClient(
  event: EvmEvent<ContractCallApprovedEventObject | ContractCallApprovedWithMintEventObject>,
  evmClients: EvmClient[]
) {
  // Find the evm client associated with event's destination chain
  const evmClient = evmClients.find(
    (client) => client.chainId.toLowerCase() === event.destinationChain.toLowerCase()
  );

  // If no evm client found, return
  if (!evmClient)
    return throwError(
      () => `No evm client found for event's destination chain ${event.destinationChain}`
    );

  return of({
    evmClient,
    event,
  });
}
