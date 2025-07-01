export interface PendingNoncesData {
  pending_action_nonces: Array<string>;
}

export interface PendingActionResponse {
  action: string
}

/* example
{
  connection_id: '3/monad-testnet/0x508fba683a7b30a3222c356610776ea27d20ad98',
  sender: 'tswth1qg2c8zhuhhtgd3epjxq793nkf6msapa4pd82u7',
  execution_contract: '0x7cf6c023FDb9e438e486c5291Af907Bf500cDd63',
  coin: {
    denom: 'brdg/7a0f2f8da53f460c81c7f51fdae0f2f85881a20f3d9327959dc128b680fc1981',
    amount: '1359120000000198'
  },
  execution_bytes: 'AAAAAAAAAAAAAAAAoJMBfoaFQ4fDVi2GJjQNV2BmCnMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABNQcyM6gxg==',
  relay_details: {
    fee_sender_address: 'tswth1qg2c8zhuhhtgd3epjxq793nkf6msapa4pd82u7',
    fee: {
      denom: 'brdg/7a0f2f8da53f460c81c7f51fdae0f2f85881a20f3d9327959dc128b680fc1981',
      amount: '15600000000000000'
    },
    expiry_block_time: '2025-06-19T04:11:40.893338968Z',
    created_at: '2025-06-19T03:41:40.893338968Z'
  },
  method: 'withdraw_native'
}
*/
export interface PendingAction {
  connection_id: string
  sender: string
  execution_contract: string
  coin: {
    denom: string
    amount: string
  }
  execution_bytes: string
  relay_details: {
    fee_sender_address: string
    fee: {
      denom: string
      amount: string
    }
    expiry_block_time: string
    created_at: string
  }
  method: string
}

export interface NewPendingActionEventParams {
  nonce: string
  connection_id: string
  // and other irrelevant ones
  // {
  //   "nonce": "32",
  //   "msg_index": "0",
  //   "connection_id": "3/monad-testnet/0x508fba683a7b30a3222c356610776ea27d20ad98",
  //   "relay_details": "{\"fee_receiver_address\":\"\",\"fee_sender_address\":\"tswth1qg2c8zhuhhtgd3epjxq793nkf6msapa4pd82u7\",\"fee\":{\"denom\":\"brdg/7a0f2f8da53f460c81c7f51fdae0f2f85881a20f3d9327959dc128b680fc1981\",\"amount\":\"15600000000000000\"},\"expiry_block_time\":\"2025-06-19T04:11:40.893338968Z\",\"created_at\":\"2025-06-19T03:41:40.893338968Z\",\"sent_at\":null}",
  //   "pending_action_type": "3"
  // }
}
