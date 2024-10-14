import { DatabaseClient } from '../../clients';
import {
  ContractCallSubmitted,
  ContractCallWithTokenSubmitted,
  ExecuteRequest,
  IBCEvent,
  IBCPacketEvent,
} from '../../types';
import { Parser } from './parser';
import { env } from '../../config'

export interface AxelarListenerEvent<T> {
  type: string;
  topicId: string;
  parseEvent: (event: any) => Promise<T | Array<T>>;
}

const parser = new Parser(new DatabaseClient());

export const AxelarEVMEventCompletedEvent: AxelarListenerEvent<ExecuteRequest> = {
  type: 'axelar.evm.v1beta1.EVMEventCompleted',
  topicId:
    env.CHAIN_ENV !== 'mainnet' ?
      "tm.event='NewBlock' AND axelar.evm.v1beta1.EVMEventCompleted.event_id EXISTS" :
      "tm.event='Tx' AND axelar.evm.v1beta1.EVMEventCompleted.event_id EXISTS",
  parseEvent: parser.parseEvmEventCompletedEvent,
};

export const AxelarCosmosContractCallEvent: AxelarListenerEvent<
  IBCEvent<ContractCallSubmitted>
> = {
  type: 'axelar.axelarnet.v1beta1.ContractCallSubmitted',
  topicId: `tm.event='Tx' AND axelar.axelarnet.v1beta1.ContractCallSubmitted.source_chain CONTAINS 'carbon'`,
  parseEvent: parser.parseContractCallSubmittedEvent,
};

export const AxelarCosmosContractCallWithTokenEvent: AxelarListenerEvent<
  IBCEvent<ContractCallWithTokenSubmitted>
> = {
  type: 'axelar.axelarnet.v1beta1.ContractCallWithTokenSubmitted',
  topicId: `tm.event='Tx' AND axelar.axelarnet.v1beta1.ContractCallWithTokenSubmitted.source_chain CONTAINS 'carbon'`,
  parseEvent: parser.parseContractCallWithTokenSubmittedEvent,
};

export const AxelarIBCCompleteEvent: AxelarListenerEvent<IBCPacketEvent> = {
  type: 'ExecuteMessage',
  topicId: `tm.event='Tx' AND message.action='ExecuteMessage'`,
  parseEvent: parser.parseIBCCompleteEvent,
};
