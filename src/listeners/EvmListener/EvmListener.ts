import { ethers } from 'ethers';
import { EvmNetworkConfig } from '../../config/types';
import { IAxelarGateway, IAxelarGateway__factory } from '../../types/contracts';
import { EvmListenerEvent } from './eventTypes';
import { TypedEvent } from '../../types/contracts/common';
import { EvmEvent } from '../../types';
import { Subject } from 'rxjs';
import { logger } from '../../logger';

export class EvmListener {
  private gatewayContract?: IAxelarGateway;
  private provider?: ethers.providers.JsonRpcProvider | ethers.providers.WebSocketProvider;
  private currentBlock = 0;
  public chainId: string;
  public finalityBlocks: number;
  public cosmosChainNames: string[];
  public axelarCarbonGateway: string;
  private evmConfig: EvmNetworkConfig;

  // Private constructor; use the async create() method below.
  private constructor(evm: EvmNetworkConfig, cosmosChainNames: string[]) {
    this.evmConfig = evm;
    this.chainId = evm.id;
    this.finalityBlocks = evm.finality;
    this.cosmosChainNames = cosmosChainNames;
    this.axelarCarbonGateway = evm.axelarCarbonGateway;
  }

  /**
   * Factory method to create an instance of EvmListener.
   * If a wsUrl exists, it will first try to connect via WebSocket.
   * On failure, it will fall back to using the rpcUrl.
   */
  public static async create(evm: EvmNetworkConfig, cosmosChainNames: string[]): Promise<EvmListener> {
    const listener = new EvmListener(evm, cosmosChainNames);

    if (evm.wsUrl) {
      try {
        const wsProvider = new ethers.providers.WebSocketProvider(evm.wsUrl);
        // Test WS connection by getting the latest block number.
        await wsProvider.getBlockNumber();
        listener.provider = wsProvider;
        listener.gatewayContract = IAxelarGateway__factory.connect(evm.gateway, wsProvider);
        logger.info(`[EVMListener] [${listener.chainId}] Connected via WS.`);
        // Set up reconnection logic for WS.
        (wsProvider as any)._websocket.on("close", (code: number, reason: string) => {
          logger.error(
            `[EVMListener] [${listener.chainId}] WebSocket closed. Code: ${code}, Reason: ${reason}`
          );
          listener.handleWsReconnection(evm.wsUrl);
        });
        (wsProvider as any)._websocket.on("error", (error: Error) => {
          logger.error(`[EVMListener] [${listener.chainId}] WebSocket error: ${error.message}`);
        });
      } catch (error) {
        logger.error(
          `[EVMListener] [${listener.chainId}] WS connection failed, falling back to RPC. Error: ${error}`
        );
        const rpcProvider = new ethers.providers.JsonRpcProvider(evm.rpcUrl);
        listener.provider = rpcProvider;
        listener.gatewayContract = IAxelarGateway__factory.connect(evm.gateway, rpcProvider);
      }
    } else {
      logger.info(`[EVMListener] [${listener.chainId}] Connected via RPC.`);
      const rpcProvider = new ethers.providers.JsonRpcProvider(evm.rpcUrl);
      listener.provider = rpcProvider;
      listener.gatewayContract = IAxelarGateway__factory.connect(evm.gateway, rpcProvider);
    }

    return listener;
  }

  /**
   * Reconnection logic: attempts to reconnect to the WS endpoint.
   */
  private handleWsReconnection(wsUrl: string) {
    // Remove all listeners from the current contract.
    this.gatewayContract!.removeAllListeners();

    // Attempt to reconnect after a delay.
    setTimeout(async () => {
      logger.info(`[EVMListener] [${this.chainId}] Attempting WS reconnection...`);
      try {
        const newWsProvider = new ethers.providers.WebSocketProvider(wsUrl);
        await newWsProvider.getBlockNumber();
        this.provider = newWsProvider;
        this.gatewayContract = IAxelarGateway__factory.connect(this.evmConfig.gateway, newWsProvider);
        logger.info(`[EVMListener] [${this.chainId}] Reconnected via WS.`);
        // Re-register reconnection listeners.
        (newWsProvider as any)._websocket.on("close", (code: number, reason: string) => {
          logger.error(
            `[EVMListener] [${this.chainId}] WebSocket closed. Code: ${code}, Reason: ${reason}`
          );
          this.handleWsReconnection(wsUrl);
        });
        (newWsProvider as any)._websocket.on("error", (error: Error) => {
          logger.error(`[EVMListener] [${this.chainId}] WebSocket error: ${error.message}`);
        });
      } catch (err) {
        logger.error(
          `[EVMListener] [${this.chainId}] WS reconnection failed, falling back to RPC. Error: ${err}`
        );
        // Optional: Fall back to RPC if reconnection fails.
        const rpcProvider = new ethers.providers.JsonRpcProvider(this.evmConfig.rpcUrl);
        this.provider = rpcProvider;
        this.gatewayContract = IAxelarGateway__factory.connect(this.evmConfig.gateway, rpcProvider);
      }
    }, 1000); // Adjust delay as needed.
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public async listen<EventObject, Event extends TypedEvent<any, EventObject>>(
    event: EvmListenerEvent<EventObject, Event>,
    subject: Subject<EvmEvent<EventObject>>
  ) {
    logger.info(`[EVMListener] [${this.chainId}] Listening to "${event.name}" event`);

    if (!this.gatewayContract) {
      throw new Error("[EVMListener] gateway contract not set")
    }

    // Clear all listeners before subscribing.
    this.gatewayContract.removeAllListeners();

    // Update current block number.
    this.currentBlock = await this.gatewayContract.provider.getBlockNumber();

    const eventFilter = event.getEventFilter(this.gatewayContract, this.axelarCarbonGateway);
    this.gatewayContract.on(eventFilter, async (...args) => {
      if (!this.gatewayContract) {
        throw new Error("[EVMListener eventFilter] gateway contract not set")
      }
      const ev: Event = args[args.length - 1];

      if (ev.blockNumber <= this.currentBlock) return;
      if (!event.isAcceptedChain(this.cosmosChainNames, ev.args)) {
        logger.silly(
          `Not accepted chain: ${ev.args}, this.cosmosChainNames: ${this.cosmosChainNames}`
        );
        return;
      }

      const evmEvent = await event.parseEvent(
        this.chainId,
        this.gatewayContract.provider,
        ev,
        this.finalityBlocks
      );

      subject.next(evmEvent);
    });
  }
}
