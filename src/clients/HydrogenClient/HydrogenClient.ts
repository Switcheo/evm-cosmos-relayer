import fetch from 'node-fetch'
import { EventData, RelayData, RelayDetail } from './types'

export class HydrogenClient {
  public baseUrl: string

  constructor(
    baseUrl: string,
  ) {
    this.baseUrl = baseUrl
  }

  async getInTransitAxelarRelays(): Promise<Array<RelayData>> {
    const resJson = await fetchAsJson(`${this.baseUrl}/relays?bridge=axelar&status=in_transit`)
    return resJson.data
  }

  async getEventByTxHashAndIndex(txHash: string, index: number): Promise<EventData> {
    const resJson = await fetchAsJson(`${this.baseUrl}/events?tx_hash=${txHash}&index=${index}`)
    const events = resJson.data as Array<EventData>
    if (events.length === 0) {
      throw new Error('Could not find event by txHash and index')
    }
    return events[0]
  }

  async getRelayWithDetails(relayId: string): Promise<RelayDetail> {
    return await fetchAsJson(`${this.baseUrl}/relays/${relayId}`)
  }
}

async function fetchAsJson(url: string): Promise<any> {
  const res = await fetch(url)
  if (res.status !== 200) {
    throw new Error(`${url} response is not 200`)
  }
  return await res.json()
}
