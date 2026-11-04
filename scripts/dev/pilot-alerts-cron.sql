-- Fase 98F: agenda a avaliação dos alertas do piloto a cada 5 minutos.
-- Dev (masterapp-dev): aplicado em 04/11/2026. Produção: SÓ com aprovação explícita, depois da migration
-- 20261104133000_phase98f_pilot_alerts. Pode rodar de novo: substitui o job.
select cron.unschedule(jobid) from cron.job where jobname = 'masterapp-pilot-alerts';
select cron.schedule('masterapp-pilot-alerts', '*/5 * * * *', $$select private.evaluate_pilot_alerts()$$);
