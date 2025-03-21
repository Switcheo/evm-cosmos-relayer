import { Wallet, utils, ethers, BigNumber } from 'ethers'
import { EvmNetworkConfig } from 'config';
import {
  IAxelarGateway__factory,
  IAxelarGateway,
  IAxelarExecutable,
  IAxelarExecutable__factory,
} from '../types/contracts';
import { env } from '..';
import { sleep } from './sleep';
import { logger } from '../logger';
import { isFinalizedTagUnsupportedError } from '../listeners/EvmListener/parser'

export class EvmClient {
  public wallet: Wallet;
  public gateway: IAxelarGateway;
  private maxRetry: number;
  private retryDelay: number;
  public finalityBlocks: number;
  chainId: string;

  constructor(
    chain: EvmNetworkConfig,
    _maxRetry = env.MAX_RETRY,
    _retryDelay = env.RETRY_DELAY
  ) {
    this.wallet = new Wallet(
      chain.privateKey,
      new ethers.providers.JsonRpcProvider(chain.rpcUrl)
    );
    this.gateway = IAxelarGateway__factory.connect(chain.gateway, this.wallet);
    this.maxRetry = _maxRetry;
    this.retryDelay = _retryDelay;
    this.chainId = chain.id;
    this.finalityBlocks = chain.finality;
  }

  public getSenderAddress() {
    return this.wallet.address;
  }

  public async getFinalizedBlockHeight() {
    let finalizedHeight: number
    try {
      const finalizedBlock = await this.wallet.provider.getBlock("finalized");

      finalizedHeight = finalizedBlock.number
    } catch (error) {
      // If the chain doesn't support the finalized tag, it is a pre-Merge EVM chain,
      // so we just take the latest block - config's finalityBlocks
      if (isFinalizedTagUnsupportedError(error)) {
        logger.warn("Chain doesn't support finalized tag, getting normal block");
        const latestBlock = await this.wallet.provider.getBlock("latest");
        finalizedHeight = latestBlock.number
      } else {
        throw error
      }
    }

    return finalizedHeight
  }

  public waitForFinality(txHash: string) {
    return this.wallet.provider.waitForTransaction(txHash, this.finalityBlocks);
  }

  public gatewayExecute(executeData: string) {
    return this.submitTx({
      to: this.gateway.address,
      data: executeData,
    }).catch((e: any) => {
      logger.error(`[EvmClient.gatewayExecute] Failed ${e.message}`);
      return undefined;
    });
  }

  public isExecuted(commandId: string) {
    return this.gateway.isCommandExecuted(commandId);
  }

  // warning: this function should be called after the command is executed, otherwise it will always return false
  public isCallContractExecuted(
    commandId: string,
    sourceChain: string,
    sourceAddress: string,
    contractAddress: string,
    payloadHash: string
  ) {
    return this.gateway
      .isContractCallApproved(
        commandId,
        sourceChain,
        sourceAddress,
        contractAddress,
        payloadHash
      )
      .then((unexecuted) => !unexecuted);
  }

  // warning: this function should be called after the command is executed, otherwise it will always return false
  public isCallContractWithTokenExecuted(
    commandId: string,
    sourceChain: string,
    sourceAddress: string,
    contractAddress: string,
    payloadHash: string,
    symbol: string,
    amount: string
  ) {
    return this.gateway
      .isContractCallAndMintApproved(
        commandId,
        sourceChain,
        sourceAddress,
        contractAddress,
        payloadHash,
        symbol,
        amount
      )
      .then((unexecuted) => !unexecuted);
  }

  public execute(
    contractAddress: string,
    commandId: string,
    sourceChain: string,
    sourceAddress: string,
    payload: string
  ) {
    const executable: IAxelarExecutable = IAxelarExecutable__factory.connect(
      contractAddress,
      this.wallet
    );
    return executable.populateTransaction
      .execute(commandId, sourceChain, sourceAddress, payload)
      .then((tx) => this.submitTx(tx))
      .catch((e: any) => {
        logger.error(`[EvmClient.execute] Failed ${JSON.stringify(e)}`);
        return undefined;
      });
  }

  public executeWithToken(
    destContractAddress: string,
    commandId: string,
    sourceChain: string,
    sourceAddress: string,
    payload: string,
    tokenSymbol: string,
    amount: string
  ) {
    const executable: IAxelarExecutable = IAxelarExecutable__factory.connect(
      destContractAddress,
      this.wallet
    );
    return executable.populateTransaction
      .executeWithToken(
        commandId,
        sourceChain,
        sourceAddress,
        payload,
        tokenSymbol,
        amount
      )
      .then((tx) => this.submitTx(tx))
      .catch((e: any) => {
        logger.error(
          `[EvmClient.executeWithToken] Failed ${JSON.stringify(e)}`
        );
        return undefined;
      });
  }

  private async submitTx(
    tx: ethers.providers.TransactionRequest,
    retryAttempt = 0
  ): Promise<ethers.providers.TransactionReceipt> {
    // submit tx with retries
    if (retryAttempt >= this.maxRetry) throw new Error('Max retry exceeded');
    // Get the current gas price from the network
    const gasPrice = await this.wallet.getGasPrice();
    const gasLimit = await this.wallet.estimateGas(tx)

    const sendTxParams = {
      ...tx,
      gasPrice,
      gasLimit: utils.hexValue(gasLimit.mul(BigNumber.from('2'))),
    }
    return this.wallet
      .sendTransaction(sendTxParams)
      .then((t) => t.wait())
      .catch(async (e: any) => {
        logger.error(
          `[EvmClient.submitTx] Failed ${e} ${e.error} ${e.error.reason} to: ${tx.to} data: ${tx.data}`
        );
        await sleep(this.retryDelay);
        logger.debug(`Retrying tx: ${retryAttempt + 1}`);
        return this.submitTx(tx, retryAttempt + 1);
      });
  }
}
