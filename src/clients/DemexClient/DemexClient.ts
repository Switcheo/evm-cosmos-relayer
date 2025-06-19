import fetch from 'node-fetch'
import { PendingAction, PendingActionResponse, PendingNoncesData } from './types'

export class DemexClient {
  public baseUrl: string

  constructor(
    baseUrl: string,
  ) {
    this.baseUrl = baseUrl
  }

  async getPendingActionNonces(): Promise<Array<PendingNoncesData>> {
    const resJson = await fetchAsJson(`${this.baseUrl}/carbon/bridge/v1/pending_action_nonce?pagination.limit=9999999`)
    return resJson.data
  }

  async getPendingAction(nonce: string): Promise<PendingAction> {
    console.log(this.baseUrl)
    const resJson = await fetchAsJson(`${this.baseUrl}/carbon/bridge/v1/pending_action/${nonce}`) as PendingActionResponse
    const pendingAction: PendingAction = JSON.parse(resJson.action)

    return pendingAction
  }

}

async function fetchAsJson(url: string): Promise<any> {
  const res = await fetch(url)
  if (res.status !== 200) {
    throw new Error('response is not 200')
  }
  return await res.json()
}
