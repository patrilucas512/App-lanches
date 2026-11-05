-- Fases 98F/99G: agenda a avaliação dos alertas do piloto a cada 5 minutos, limpando os erros do app com mais
-- de 14 dias (private.evaluate_pilot_alerts_and_purge, da migration 20261105122000_phase99g_app_error_log).
-- Dev (masterapp-dev): aplicado em 05/11/2026. Produção: o job existe desde 05/11/2026 chamando
-- private.evaluate_pilot_alerts(); trocar para esta versão SÓ com aprovação, depois da migration da 99G.
-- Pode rodar de novo: substitui o job.
select cron.unschedule(jobid) from cron.job where jobname = 'masterapp-pilot-alerts';
select cron.schedule('masterapp-pilot-alerts', '*/5 * * * *', $$select private.evaluate_pilot_alerts_and_purge()$$);
