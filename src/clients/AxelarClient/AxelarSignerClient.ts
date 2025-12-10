import { CosmosNetworkConfig, axelarChain, env } from '../../config';
import { AxelarSigningClient, Environment } from '@axelar-network/axelarjs-sdk';
import { EncodeObject } from '@cosmjs/proto-signing';
import { StdFee } from '@cosmjs/stargate';
import { GasPrice } from '@cosmjs/stargate';
import { DeliverTxResponse } from '@cosmjs/stargate';
import {
  AxelarQueryClient,
  AxelarQueryClientType,
} from '@axelar-network/axelarjs-sdk/dist/src/libs/AxelarQueryClient';
import { sleep } from '../sleep';
import { Registry } from '@cosmjs/proto-signing';
import {
  RouteMessageRequest,
  protobufPackage as AxelarProtobufPackage,
} from '@axelar-network/axelarjs-types/axelar/axelarnet/v1beta1/tx';
import { logger } from '../../logger';

//
export class SignerClient {
  public config: CosmosNetworkConfig;
  public sdk: AxelarSigningClient;
  public queryClient: AxelarQueryClientType;
  public fee: StdFee | 'auto';
  public maxRetries: number;
  public retryDelay: number;

  constructor(
    sdk: AxelarSigningClient,
    client: AxelarQueryClientType,
    config: CosmosNetworkConfig,
    _maxRetries = env.MAX_RETRY,
    _retryDelay = env.RETRY_DELAY
  ) {
    this.config = config || axelarChain;
    this.sdk = sdk;
    this.queryClient = client;
    this.maxRetries = _maxRetries;
    this.retryDelay = _retryDelay;
    this.fee = 'auto';
    sdk.registry.register(`/${AxelarProtobufPackage}.RouteMessageRequest`, RouteMessageRequest);
    // this.fee = {
    //   gas: '20000000', // 20M
    //   amount: [{ denom: config.denom, amount: config.gasPrice }],
    // };
  }

  static async init(_config?: CosmosNetworkConfig) {
    const config = _config || axelarChain;
    const environment = env.CHAIN_ENV === 'testnet' ? Environment.TESTNET :
      (env.CHAIN_ENV === 'mainnet' ? Environment.MAINNET : Environment.DEVNET)
    const _queryClient = await AxelarQueryClient.initOrGetAxelarQueryClient({
      environment,
      axelarRpcUrl: config.rpcUrl,
    });
    const registry = new Registry();
    const sdk = await AxelarSigningClient.initOrGetAxelarSigningClient({
      environment,
      axelarRpcUrl: config.rpcUrl,
      cosmosBasedWalletDetails: {
        mnemonic: config.mnemonic,
      },
      options: {
        registry,
        gasPrice: GasPrice.fromString(`${config.gasPrice}${config.denom}`),
      },
    });

    return new SignerClient(sdk, _queryClient, config);
  }

  public getAddress() {
    return this.sdk.signerAddress;
  }

  public async getBalance(address: string, denom?: string) {
    return this.sdk.getBalance(address, denom || 'uvx');
  }

  public async broadcast<T extends EncodeObject[]>(
    payload: T,
    memo?: string,
    retries = 0,
  ): Promise<DeliverTxResponse | undefined> {
    if (retries >= this.maxRetries) throw new Error('Max retries exceeded');

    try {
      return await this.sdk.signThenBroadcast(payload, this.fee, memo);
    } catch (e: any) {
      const msg = e?.message || String(e);

      // Axelar + SDK 0.50 event decoding failure
      if (msg.includes('Invalid string. Length must be a multiple of 4')) {
        logger.warn(
          '[SignerClient.broadcast] Tx likely broadcast but CosmJS failed to decode events (SDK 0.50 / CometBFT mismatch). ' +
          'If you don’t need events, proceed as success, otherwise re-query via REST/GRPC.',
        );
        // IMPORTANT: treat as "fire-and-forget"
        return undefined;
      }

      if (msg.includes('account sequence mismatch')) {
        logger.info(
          `Account sequence mismatch, retrying in ${this.retryDelay / 1000} seconds...`,
        );
        await sleep(this.retryDelay);
        return this.broadcast(payload, memo, retries + 1);
      }

      throw e;
    }
  }
}
