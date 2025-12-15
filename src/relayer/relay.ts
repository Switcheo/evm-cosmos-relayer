import { mergeMap, Subject } from 'rxjs'
import { AxelarClient, DatabaseClient, EvmClient } from '../clients'
import { axelarChain, cosmosChains, evmChains } from '../config'
import { ContractCallSubmitted, ContractCallWithTokenSubmitted, EvmEvent, ExecuteRequest, IBCEvent, IBCPacketEvent, } from '../types'
import { AxelarCosmosContractCallEvent, AxelarCosmosContractCallWithTokenEvent, AxelarEVMEventCompletedEvent, AxelarIBCCompleteEvent, AxelarListener, EvmContractCallApprovedEvent, EvmContractCallEvent, EvmContractCallWithTokenApprovedEvent, EvmContractCallWithTokenEvent, EvmListener, } from '../listeners'
import { ContractCallApprovedEventObject, ContractCallApprovedWithMintEventObject, ContractCallEventObject, ContractCallWithTokenEventObject, } from '../types/contracts/IAxelarGateway'
import { handleAnyError, handleCosmosToEvmCallContractCompleteEvent, handleCosmosToEvmCallContractWithTokenCompleteEvent, handleCosmosToEvmEvent, handleEvmToCosmosCompleteEvent, handleEvmToCosmosConfirmEvent, handleEvmToCosmosEvent, prepareHandler, } from '../handler'
import { createCosmosEventSubject, createEvmEventSubject } from './subject'
import { filterCosmosDestination, filterDestinationCarbonToEvm, filterDestinationEvmToCarbon, filterSourceChainOnEvm, mapEventToEvmClient } from './rxOperators'

const sEvmCallContract = createEvmEventSubject<ContractCallEventObject>();
const sEvmCallContractWithToken = createEvmEventSubject<ContractCallWithTokenEventObject>();
const sEvmApproveContractCallWithToken =
  createEvmEventSubject<ContractCallApprovedWithMintEventObject>();
const sEvmApproveContractCall = createEvmEventSubject<ContractCallApprovedEventObject>();
const sCosmosContractCall = createCosmosEventSubject<ContractCallSubmitted>();
const sCosmosContractCallWithToken = createCosmosEventSubject<ContractCallWithTokenSubmitted>();

// Listening to the IBC packet event. This mean the any gmp flow (both contractCall and contractCallWithToken) from evm -> cosmos is completed.
const sEVMEventCompleted = new Subject<ExecuteRequest>();
const sCosmosApproveAny = new Subject<IBCPacketEvent>();

// Initialize DB client
const db = new DatabaseClient();
const cosmosChainNames = cosmosChains.map((chain) => chain.chainId);

export async function startRelayer() {
  const axelarListener = new AxelarListener(axelarChain.ws);
  const evmListeners = await Promise.all(evmChains.map(async (evm) => await EvmListener.create(evm, cosmosChainNames)));
  const axelarClient = await AxelarClient.init(db, axelarChain);
  const evmClients = Object.fromEntries(evmChains.map((chain) => [chain.id, new EvmClient(chain)]))
  //   const cosmosClients = cosmosChains.map((cosmos) => AxelarClient.init(cosmos));

  /** ######## Handle events ########## */
  // Subscribe to the ContractCallWithToken event at the gateway contract (EVM -> Cosmos direction)
  sEvmCallContractWithToken
    // Filter the event by the supported cosmos chains. This is to avoid conflict with existing relayers that relay to evm chains.
    .pipe(filterCosmosDestination(cosmosChains))
    .subscribe((event) => {
      const ev = event as EvmEvent<ContractCallWithTokenEventObject>;
      prepareHandler(ev, db, 'handleEvmToCosmosEvent')
        // Create the event in the database
        .then(() => db.createEvmCallContractWithTokenEvent(ev))
        // Wait for the event to be finalized
        .then(() => event.waitForFinality())
        //  Handle the event by sending the confirm tx to the axelar network
        .then(() => handleEvmToCosmosEvent(axelarClient, evmClients[event.sourceChain], ev))
        // catch any error
        .catch((e) => handleAnyError(db, 'handleEvmToCosmosEvent', e));
    });

  // Subscribe to the ContractCall event at the gateway contract (EVM -> Cosmos direction)
  sEvmCallContract
    // Filter the event by the supported cosmos chains. This is to avoid conflict with existing relayers that relay to evm chains.
    .pipe(filterCosmosDestination(cosmosChains))
    .subscribe((event) => {
      const ev = event as EvmEvent<ContractCallEventObject>;
      prepareHandler(event, db, 'handleEvmToCosmosEvent')
        // Create the event in the database
        .then(() => db.createEvmCallContractEvent(ev))
        // Wait for the event to be finalized
        .then(() => ev.waitForFinality())
        // Handle the event by sending the confirm tx to the axelar network
        .then(() => handleEvmToCosmosEvent(axelarClient, evmClients[event.sourceChain], ev))
        // catch any error
        .catch((e) => handleAnyError(db, 'handleEvmToCosmosEvent', e));
    });

  // Subscribe to the EvmToCosmosConfirm event at the gateway contract (EVM -> Cosmos direction)
  sEVMEventCompleted
    .pipe(filterDestinationEvmToCarbon(cosmosChains))
    .subscribe((executeParams) => {
      prepareHandler(executeParams, db, 'handleEvmToCosmosConfirmEvent')
        // Send the execute tx to the axelar network
        .then(() => handleEvmToCosmosConfirmEvent(axelarClient, executeParams))
        // Update the event status in the database
        .then(({ status, packetSequence }) =>
          db.updateEventStatusWithPacketSequence(executeParams.id, status, packetSequence)
        )
        // catch any error
        .catch((e) => handleAnyError(db, 'handleEvmToCosmosConfirmEvent', e));
  });

  // Subscribe to the IBCComplete event at the axelar network. (EVM -> Cosmos direction)
  sCosmosApproveAny
    .subscribe((event) => {
    prepareHandler(event, db, 'handleEvmToCosmosCompleteEvent')
      // Just logging the event for now
      .then(() => handleEvmToCosmosCompleteEvent(axelarClient, event))
      // catch any error
      .catch((e) => handleAnyError(db, 'handleEvmToCosmosCompleteEvent', e));
  });

  // Subscribe to the ContractCall event at the axelar network. (Cosmos -> EVM direction)
  sCosmosContractCall
    .pipe(filterDestinationCarbonToEvm(evmChains))
    .subscribe((event) => {
    prepareHandler(event, db, 'handleContractCallFromCosmosToEvmEvent')
      // Create the event in the database
      .then(() => db.createCosmosContractCallEvent(event))
      // Handle the event by sending a bunch of txs to axelar network
      .then(() => handleCosmosToEvmEvent(axelarClient, evmClients[event.args.destinationChain.toLowerCase()], event))
      // Update the event status in the database
      .then((tx) => db.updateCosmosToEvmEvent(event, tx))
      // catch any error
      .catch((e) => handleAnyError(db, 'handleCosmosToEvmEvent', e));
  });

  // Subscribe to the ContractCallWithToken event at the axelar network. (Cosmos -> EVM direction)
  sCosmosContractCallWithToken
    .pipe(filterDestinationCarbonToEvm(evmChains))
    .subscribe((event) => {
    prepareHandler(event, db, 'handleContractCallWithTokenFromCosmosToEvmEvent')
      // Create the event in the database
      .then(() => db.createCosmosContractCallWithTokenEvent(event as IBCEvent<ContractCallWithTokenSubmitted>))
      // Handle the event by sending a bunch of txs to axelar network
      .then(() => handleCosmosToEvmEvent(axelarClient, evmClients[event.args.destinationChain.toLowerCase()], event))
      // Update the event status in the database
      .then((tx) => db.updateCosmosToEvmEvent(event, tx))
      // catch any error
      .catch((e) => handleAnyError(db, 'handleCosmosToEvmEvent', e));
  });

  // Subscribe to the ContractCallApprovedWithMint event at the gateway contract. (Cosmos -> EVM direction)
  sEvmApproveContractCallWithToken
    .pipe(filterSourceChainOnEvm(cosmosChains))
    // Select the evm client that matches the event's chain
    .pipe(mergeMap((event) => mapEventToEvmClient(event, Object.values(evmClients))))
    .subscribe(({ evmClient, event }) => {
      const ev = event as EvmEvent<ContractCallApprovedWithMintEventObject>;
      prepareHandler(event, db, 'handleCosmosToEvmCallContractWithTokenCompleteEvent')
        // Find the array of relay data associated with the event from the database
        .then(() => db.findCosmosToEvmCallContractWithTokenApproved(ev))
        // Handle the event by calling executeWithToken function at the destination contract.
        .then((relayDatas) =>
          handleCosmosToEvmCallContractWithTokenCompleteEvent(evmClient, ev, relayDatas)
        )
        // Update the event status in the database
        .then((results) =>
          results?.forEach((result) => db.updateEventStatus(result.id, result.status))
        )
        // catch any error
        .catch((e) => handleAnyError(db, 'handleCosmosToEvmCallContractWithTokenCompleteEvent', e));
    });

  // Subscribe to the ContractCallApproved event at the gateway contract. (Cosmos -> EVM direction)
  sEvmApproveContractCall
    .pipe(filterSourceChainOnEvm(cosmosChains))
    // Select the evm client that matches the event's chain
    .pipe(mergeMap((event) => mapEventToEvmClient(event, Object.values(evmClients))))
    .subscribe(({ event, evmClient }) => {
      prepareHandler(event, db, 'handleCosmosToEvmCallContractCompleteEvent')
        // Find the array of relay data associated with the event from the database
        .then(() => db.findCosmosToEvmCallContractApproved(event))
        // Handle the event by calling execute function at the destination contract.
        .then((relayDatas) =>
          handleCosmosToEvmCallContractCompleteEvent(evmClient, event, relayDatas)
        )
        // Update the event status in the database
        .then((results) =>
          results?.forEach((result) => db.updateEventStatus(result.id, result.status))
        )
        .catch((e) => handleAnyError(db, 'handleCosmosToEvmCallContractCompleteEvent', e));
    });

  // Listening for evm events
  for (const evmListener of evmListeners) {
    evmListener.listen(EvmContractCallEvent, sEvmCallContract);
    evmListener.listen(EvmContractCallWithTokenEvent, sEvmCallContractWithToken);
    evmListener.listen(EvmContractCallApprovedEvent, sEvmApproveContractCall);
    evmListener.listen(EvmContractCallWithTokenApprovedEvent, sEvmApproveContractCallWithToken);
  }

  // Listening for axelar events
  axelarListener.listen(AxelarCosmosContractCallEvent, sCosmosContractCall);
  axelarListener.listen(AxelarCosmosContractCallWithTokenEvent, sCosmosContractCallWithToken);
  axelarListener.listen(AxelarIBCCompleteEvent, sCosmosApproveAny);
  axelarListener.listen(AxelarEVMEventCompletedEvent, sEVMEventCompleted);
}
