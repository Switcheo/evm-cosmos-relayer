import { AxelarClient, DatabaseClient, env, EvmClient } from '..'
import { logger } from '../logger';
import {
  ContractCallSubmitted,
  ContractCallWithTokenSubmitted,
  EvmEvent,
  ExecuteRequest,
  IBCEvent,
  IBCPacketEvent,
  Status,
} from '../types';
import {
  ContractCallApprovedWithMintEventObject,
  ContractCallWithTokenEventObject,
  ContractCallApprovedEventObject,
  ContractCallEventObject,
} from '../types/contracts/IAxelarGateway';
import { isEvmTxHeightFinalized } from '../cron/utils'
import { SignCommandsResponse } from '@axelar-network/axelarjs-types/axelar/evm/v1beta1/tx'
import { DeliverTxResponse } from '@cosmjs/stargate'

export const getBatchCommandIdFromSignTx = (signTx: DeliverTxResponse): string => {
  // Preferred: decode from msgResponses
  const anyResp = signTx.msgResponses?.find(
    (r: any) => r.typeUrl === '/axelar.evm.v1beta1.SignCommandsResponse'
  );

  if (anyResp) {
    const decoded = SignCommandsResponse.decode(anyResp.value);

    // ts-proto / protobufjs usually camelCase proto field `batched_commands_id`
    const idBytes =
      (decoded as any).batchedCommandsId ||
      (decoded as any).batched_commands_id ||
      (decoded as any).BatchedCommandsID;

    if (idBytes && idBytes.length) {
      return '0x' + Buffer.from(idBytes).toString('hex');
    }
  }

  throw new Error('Could not extract batched command ID from SignCommands tx');
};

export async function handleEvmToCosmosConfirmEvent(
  vxClient: AxelarClient,
  executeParams: ExecuteRequest
) {
  const { id, payload } = executeParams;
  const [hash, logIndex] = id.split('-');
  logger.info(
    `[handleEvmToCosmosConfirmEvent] Routing message ${id}`
  );

  const routeMessageTx = await vxClient.routeMessageRequest(parseInt(logIndex), hash, payload);

  if (!routeMessageTx) {
    return {
      status: Status.FAILED,
    };
  }

  const isAlreadyExecuted = routeMessageTx.rawLog?.includes('already executed');

  if (isAlreadyExecuted) {
    logger.info(
      `[handleEvmToCosmosConfirmEvent] Already sent an executed tx for ${id}. Marked it as success.`
    );
    return {
      status: Status.SUCCESS,
    };
  } else {
    logger.info(`[handleEvmToCosmosConfirmEvent] Executed: ${routeMessageTx.transactionHash}`);
    const packetSequence = getPacketSequenceFromExecuteTx(routeMessageTx);
    return {
      status: Status.SUCCESS,
      packetSequence,
    };
  }
}

export async function handleEvmToCosmosEvent(
  vxClient: AxelarClient,
  evmClient: EvmClient,
  event: EvmEvent<ContractCallWithTokenEventObject | ContractCallEventObject>
) {
  // check if finalized first
  const { blockNumber, sourceChain, hash } = event
  const isFinalized = await isEvmTxHeightFinalized(evmClient, blockNumber)
  if (!isFinalized) {
    logger.info(`[handleEvmToCosmosEvent] ${sourceChain} callContract tx ${hash} is not finalized and should not be sent to axelar for confirmation`)
    return
  }
  const confirmTx = await vxClient.confirmEvmTx(event.sourceChain, event.hash);
  if (confirmTx) {
    logger.info(`[handleEvmToCosmosEvent] Confirmed: ${confirmTx.transactionHash}`);
  }
}

export async function handleCosmosToEvmEvent<
  T extends ContractCallSubmitted | ContractCallWithTokenSubmitted
>(vxClient: AxelarClient, evmClient: EvmClient, event: IBCEvent<T>) {
  const routeMessage = await vxClient.routeMessageRequest(
    -1,
    event.args.messageId,
    event.args.payload
  );

  if (routeMessage) {
    logger.info(`[handleCosmosToEvmEvent] RouteMessage: ${routeMessage.transactionHash}`);
  }

  const pendingCommands = await vxClient.getPendingCommands(event.args.destinationChain);

  logger.info(`[handleCosmosToEvmEvent] PendingCommands: ${JSON.stringify(pendingCommands)}`);
  if (pendingCommands.length === 0) return;

  const signCommand = await vxClient.signCommands(event.args.destinationChain);
  logger.debug('[handleCosmosToEvmEvent] SignCommand', { signCommand });


  // If we actually got a response and it's a failure → hard error
  if (signCommand && signCommand.rawLog?.includes('failed')) {
    throw new Error(signCommand.rawLog);
  }
  if (!signCommand) {
    throw new Error('cannot sign command');
  }

  const batchedCommandId = getBatchCommandIdFromSignTx(signCommand);
  logger.info(`[handleCosmosToEvmEvent] BatchCommandId: ${batchedCommandId}`);

  const executeData = await vxClient.getExecuteDataFromBatchCommands(
    event.args.destinationChain,
    batchedCommandId
  );

  logger.info(`[handleCosmosToEvmEvent] BatchCommands: ${JSON.stringify(executeData)}`);

  if (env.CHAIN_ENV === 'mainnet') {
    logger.warn('[handleCosmosToEvmEvent] Skipping gatewayExecute for mainnet as axelar should do it');
    return
  }
  const tx = await evmClient.gatewayExecute(executeData);
  if (!tx) return;
  logger.info(`[handleCosmosToEvmEvent] Execute: ${tx.transactionHash}`);

  return tx;
}

export async function handleCosmosToEvmCallContractCompleteEvent(
  evmClient: EvmClient,
  event: EvmEvent<ContractCallApprovedEventObject>,
  relayDatas: { id: string; payload: string | undefined }[]
) {
  const { commandId, contractAddress, sourceAddress, sourceChain, payloadHash } = event.args;

  if (!relayDatas || relayDatas.length === 0) {
    logger.info(
      `[handleCosmosToEvmCallContractCompleteEvent]: Cannot find payload from given payloadHash: ${payloadHash}`
    );
    return undefined;
  }

  const result = [];
  for (const data of relayDatas) {
    const { payload, id } = data;
    if (!payload) continue;

    // check if already executed
    const isExecuted = await evmClient.isCallContractExecuted(
      commandId,
      sourceChain,
      sourceAddress,
      contractAddress,
      payloadHash
    );
    if (isExecuted) {
      result.push({
        id,
        status: Status.SUCCESS,
      });
      logger.info(
        `[handleCosmosToEvmCallContractCompleteEvent] Already executed txId ${data.id} with commandId ${commandId} for . Will mark the status in the DB as Success.`
      );
      continue;
    }

    if (process.env.CHAIN_ENV != 'devnet') {
      logger.warn(
        `[handleCosmosToEvmCallContractCompleteEvent]: Skipping mainnet broadcast payloadHash: ${payloadHash}`
      );
      return undefined
    }

    const skipContracts = (process.env.SKIP_CONTRACTS || '').split(',')
    for (const skipContract of skipContracts) {
      if (contractAddress.toLowerCase() === skipContract.toLowerCase()) {
        logger.info(
          `[handleCosmosToEvmCallContractCompleteEvent]: Skipping devnet contract ${skipContract} for testing, payloadHash: ${payloadHash}`
        );
        return undefined
      }
    }


    const tx = await evmClient.execute(
      contractAddress,
      commandId,
      sourceChain,
      sourceAddress,
      payload
    );

    if (!tx) {
      result.push({
        id,
        status: Status.FAILED,
      });
      logger.error(
        `[handleCosmosToEvmCallContractCompleteEvent] Execute failed: ${id}. Will mark the status in the DB as Failed.`
      );
      continue;
    }

    logger.info(`[handleCosmosToEvmCallContractCompleteEvent] execute: ${JSON.stringify(tx)}`);

    result.push({
      id,
      status: Status.SUCCESS,
    });
  }

  return result;
}

export async function handleCosmosToEvmCallContractWithTokenCompleteEvent(
  evmClient: EvmClient,
  event: EvmEvent<ContractCallApprovedWithMintEventObject>,
  relayDatas: { id: string; payload: string | undefined }[]
) {
  const { amount, commandId, contractAddress, sourceAddress, sourceChain, symbol, payloadHash } =
    event.args;

  if (!relayDatas || relayDatas.length === 0) {
    logger.info(
      `[handleCosmosToEvmCallContractWithTokenCompleteEvent]: Cannot find payload from given payloadHash: ${payloadHash}`
    );
    return undefined;
  }

  const result = [];
  for (const relayData of relayDatas) {
    const { payload, id } = relayData;
    if (!payload) continue;

    const isExecuted = await evmClient.isCallContractWithTokenExecuted(
      commandId,
      sourceChain,
      sourceAddress,
      contractAddress,
      payloadHash,
      symbol,
      amount.toString()
    );

    if (isExecuted) {
      result.push({
        id,
        status: Status.SUCCESS,
      });
      logger.info(
        `[handleCosmosToEvmCallContractWithTokenCompleteEvent] Already executed: ${commandId}. Will mark the status in the DB as Success.`
      );
      continue;
    }

    const tx = await evmClient.executeWithToken(
      contractAddress,
      commandId,
      sourceChain,
      sourceAddress,
      payload,
      symbol,
      amount.toString()
    );

    if (!tx) {
      logger.info([
        '[handleCosmosToEvmCallContractWithTokenCompleteEvent] Execute failed: ${id}. Will mark the status in the DB as Failed.',
        id,
      ]);

      result.push({
        id,
        status: Status.FAILED,
      });

      continue;
    }

    logger.info(
      `[handleCosmosToEvmCallContractWithTokenCompleteEvent] executeWithToken: ${JSON.stringify(
        tx
      )}`
    );

    result.push({
      id,
      status: Status.SUCCESS,
    });
  }

  return result;
}

export async function handleEvmToCosmosCompleteEvent(client: AxelarClient, event: IBCPacketEvent) {
  logger.info(`[handleEvmToCosmosCompleteEvent] Memo: ${event.memo}`);
}

export async function prepareHandler(event: any, db: DatabaseClient, label = '') {
  // reconnect prisma db
  await db.connect();

  // log event
  logger.info(`[${label}] EventReceived ${JSON.stringify(event)}`);
}

const getPacketSequenceFromExecuteTx = (executeTx: any) => {
  console.log(executeTx);
  const rawLog = JSON.parse(executeTx.rawLog || '{}');
  const events = rawLog[0].events;
  const sendPacketEvent = events.find((event: { type: string }) => event.type === 'send_packet');
  const seq = sendPacketEvent.attributes.find(
    (attr: { key: string }) => attr.key === 'packet_sequence'
  ).value;
  return parseInt(seq);
};
