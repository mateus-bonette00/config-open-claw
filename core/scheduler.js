import { CronJob } from 'cron';
import { createLogger } from './logger.js';

const log = createLogger('scheduler');

const jobs = new Map();

/**
 * Agenda tarefas recorrentes usando cron expressions.
 * Timezone padrão: America/Sao_Paulo
 */
export function schedule(name, cronExpression, callback, timezone = 'America/Sao_Paulo') {
  if (jobs.has(name)) {
    log.warn(`Job "${name}" já existe. Substituindo.`);
    jobs.get(name).stop();
  }

  const job = new CronJob(
    cronExpression,
    async () => {
      log.info(`Executando job: ${name}`);
      try {
        await callback();
        log.info(`Job "${name}" concluído.`);
      } catch (err) {
        log.error(`Erro no job "${name}":`, err);
      }
    },
    null,
    true,
    timezone
  );

  jobs.set(name, job);
  log.info(`Job "${name}" agendado: ${cronExpression} (${timezone})`);
  return job;
}

export function stopJob(name) {
  if (jobs.has(name)) {
    jobs.get(name).stop();
    jobs.delete(name);
    log.info(`Job "${name}" parado.`);
  }
}

export function listJobs() {
  return [...jobs.keys()];
}
