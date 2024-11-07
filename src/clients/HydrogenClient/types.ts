export interface RelayData {
  id: string,
  flow_type: string,
  bridge: string,
  source_tx_hash: string,
  bridging_tx_hash: string | null,
  destination_tx_hash: string | null,
  payload_type: string,
  created_at: string,
  updated_at: string,
  status: string,
  source_blockchain: string,
  destination_blockchain: string,
  source_event_index: number,
  bridging_event_index: number | null,
  destination_event_index: number | null,
  start_block_time: string,
  end_block_time: string,
  connection_id: string,
}

export type RelayDetail = {
  id: string
  flow_type: string
  source_blockchain: string
  source_tx_hash: string
  destination_blockchain: string
  destination_tx_hash: string
  bridge: string
  bridging_tx_hash: string
  payload_type: string
  created_at: string
  updated_at: string
  status: string
  source_transaction?: TransactionData
  bridging_transaction?: TransactionData
  destination_transaction?: TransactionData
  source_event?: EventData
  bridging_event?: EventData
  destination_event?: EventData
  transfer_payload: {
    from_asset: string
    from_asset_hash: string
    from_address: string
    from_address_hash: string
    to_asset: string
    to_asset_hash: string
    to_address: string
    to_address_hash: string
    fee_address: string
    fee_address_hash: string
    amount: string
    transfer_payload_type: string
    created_at: string
    updated_at: string
  } | null
  register_asset_payload: {
    native_asset: string
    native_asset_hash: string
    carbon_asset: string
    carbon_asset_hash: string
    created_at: string
    updated_at: string
  } | null
  payload: {
    id: string
    relay_id: string
    payload_type: string
    decoded_payload: any
    created_at: string
    updated_at: string
    flow_type: string
  }
  events: Array<EventData>
}

export type EventData = {
  id: string
  blockchain: string
  contract: string
  block_height: number //string or number
  tx_hash: string
  tx_fee: string
  sender: string
  sender_hash: string
  index: number
  name: string
  event_params: Record<string, string>
  processing_status: string
  confirmation_status: string
  confirmed_at: string
  created_at: string
  updated_at: string
  block_time: string
  link_status: string
  relay_id: string
  event_source: string
  tx_index: number
}

export interface TransactionData {
  blockchain: string
  tx_fee: string
  tx_hash: string
  block_height: number
  block_time: number
  created_at: string
  contract: string
  sender: string
}

// ** Carbon Bridge **

// carbon
export enum EventName {
  NewPendingActionEvent = 'Switcheo.carbon.bridge.NewPendingActionEvent', // Carbon -> External
  ExpiredPendingActionEvent = 'Switcheo.carbon.bridge.ExpiredPendingActionEvent', // Carbon -> External
  BridgeSentEvent = 'Switcheo.carbon.bridge.BridgeSentEvent', // Carbon -> External
  BridgeAcknowledgedEvent = 'Switcheo.carbon.bridge.BridgeAcknowledgedEvent', // Carbon -> External
  BridgeRevertedEvent = 'Switcheo.carbon.bridge.BridgeRevertedEvent', // Carbon -> External
  ModuleAxelarCallContractEvent = 'Switcheo.carbon.bridge.ModuleAxelarCallContractEvent', // Carbon -> External
  BridgeReceivedEvent = 'Switcheo.carbon.bridge.BridgeReceivedEvent', // External -> Carbon
  AxelarGeneralMessageReceivedEvent = 'Switcheo.carbon.bridge.AxelarGeneralMessageReceivedEvent', // External -> Carbon

  // axelar bridge
  ContractCallSubmitted = 'axelar.axelarnet.v1beta1.ContractCallSubmitted', // Carbon -> External
  EVMEventConfirmed = 'axelar.evm.v1beta1.EVMEventConfirmed', // External -> Carbon

  // evm
  ContractCallApproved = 'ContractCallApproved', // Carbon -> External
  ContractCallExecuted = 'ContractCallExecuted', // Carbon -> External
  ContractCall = 'ContractCall', // External -> Carbon
}
