import 'dotenv/config';

export const env = {
  DEV: process.env.DEV,
  AXELAR_MNEMONIC: process.env.AXELAR_MNEMONIC || '',
  EVM_PRIVATE_KEY: process.env.EVM_PRIVATE_KEY || '',
  MAX_RETRY: parseInt(process.env.MAX_RETRY || '5'),
  RETRY_DELAY: parseInt(process.env.RETRY_DELAY || '3000'),
  HERMES_METRIC_URL: process.env.HERMES_METRIC_URL || 'http://localhost:3001/metrics',
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/relayer',
  PORT: process.env.PORT || 3000,
  DD_API_KEY: process.env.DD_API_KEY || '',
  CHAIN_ENV: process.env.CHAIN_ENV || 'testnet',
  LOG_LEVEL: process.env.LOG_LEVEL || "info",
  HYDROGEN_URL: process.env.HYDROGEN_URL || "https://hydrogen-api.carbon.network",
  DEMEX_URL: process.env.DEMEX_URL || "https://api.carbon.network",
  DELAY_AFTER_FINALITY: parseInt(process.env.DELAY_AFTER_FINALITY || '60000'),
};

export * from './chains';
export * from './types';
