import axios, { AxiosRequestConfig } from 'axios'
import { sha256, toUtf8Bytes } from 'ethers/lib/utils'
import { checkOrSetSnooze } from './memoryStore'
import 'dotenv/config';

export type AlertGroup = 'critical' | 'notify' | 'info'

export interface TelegramConfig {
  snoozeTimeSeconds: number
  messageHash?: string | undefined | null
  alertOpts: TelegramAlertOptions
}

export interface TelegramAlertOptions {
  botToken: string,
  channelId: string,
  notifyUsers?: string
}

const config: Record<AlertGroup, any> = {
  critical: {
    botToken: process.env.TG_CRITICAL_BOT_TOKEN,
    channelId: process.env.TG_CRITICAL_CHANNEL_ID,
    notifyUsers: process.env.TG_CRITICAL_USERS
  },
  notify: {
    botToken: process.env.TG_NOTIFY_BOT_TOKEN,
    channelId: process.env.TG_NOTIFY_CHANNEL_ID,
    notifyUsers: process.env.TG_NOTIFY_USERS
  },
  info: {
    botToken: process.env.TG_INFO_BOT_TOKEN,
    channelId: process.env.TG_INFO_CHANNEL_ID,
    notifyUsers: process.env.TG_INFO_USERS
  },
}

export async function sendTelegramAlertWithPriority(message: string, alertGroup: AlertGroup = 'info', messageHash: string | undefined = undefined) {
  if (!config[alertGroup].botToken) {
    console.warn('No config for telegram, skipping alert')
    return
  }
  let snoozeTimeSeconds: number
  switch (alertGroup) {
    case 'critical':
      snoozeTimeSeconds = 2 * 60 * 60 // 2 hours
      break
    case 'notify':
      snoozeTimeSeconds = 6 * 60 * 60 // 6 hours
      break
    case 'info':
      snoozeTimeSeconds = 24 * 60 * 60 // 24 hours
      break
    default:
      snoozeTimeSeconds = 24 * 60 * 60 // 24 hours
  }

  return sendTelegramAlert(message, {
    snoozeTimeSeconds,
    messageHash,
    alertOpts: config[alertGroup]
  })
}

// Send Telegram Message POST Request
export async function sendTelegramAlert(message: string, conf: TelegramConfig) {
  if (!message) {
    console.error('No message input for telegram')
    return
  }

  // check if snoozed first
  let messageHash = sha256(toUtf8Bytes(message))
  if (conf.messageHash) {
    messageHash = conf.messageHash
  }

  const key = `alertSnooze:${messageHash}`
  const isCurrentlySnoozed = checkOrSetSnooze(key, conf.snoozeTimeSeconds)
  if (isCurrentlySnoozed) {
    console.warn(`message snoozed: ${messageHash}`)
    return
  }

  const { botToken, channelId, notifyUsers } = conf.alertOpts
  if (!botToken || !channelId) {
    console.warn('No config for telegram, skipping alert')
    return
  }

  let sendMessage = '<b>[evm-cosmos-relayer]</b>\n' + message
  if (notifyUsers && notifyUsers !== '') {
    sendMessage = sendMessage + `\ncc: ${notifyUsers}`
  }

  const options: AxiosRequestConfig = {
    method: 'POST',
    url: `https://api.telegram.org/bot${botToken}/sendMessage`,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json'
    },
    data: {
      chat_id: channelId,
      text: sendMessage,
      parse_mode: 'HTML'
    }
  }
  await axios
    .request(options)
    .catch(function (error) {
      console.error(error)
    })
}
