import { logger } from "./logger";
import { startAPIServer } from "./api";
import { startRelayer } from "./relayer";
import { startCron } from "./cron";

logger.info('Starting relayer api server...');
startAPIServer();
// startRelayer();
// startCron();
