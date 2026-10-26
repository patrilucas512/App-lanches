# Fase 66 — Gestão geográfica, territórios e cobertura

## 1. Diagnóstico

O MasterApp já possuía lojas, regiões, zonas comerciais de delivery, endereços de clientes, rotas, capacidade, franquias e expansão. A Fase 66 coordena essas fontes sem duplicá-las.

## 2. Arquitetura

O domínio `geo_management` separa localizações, normalização, provedores, territórios, áreas de serviço, franquias, consultas, analytics e governança.

## 3. Arquivos criados

Foram criados o core geográfico, migration, API, tela Rede · Mapa, estilos, 30 testes e este relatório.

## 4. Arquivos modificados

Menu/entitlements, Copiloto, automações e scripts de teste receberam integrações da Fase 66.

## 5. Migrations

A migration cria o modelo multitenant, índices, RLS, privilégios de serviço, funções transacionais, flags, datasets, métricas, widgets, busca e automações. PostGIS não foi habilitado sem validação do ambiente; geometria permanece em JSONB portável.

## 6. GeoProvider

A interface abstrai geocodificação, reversa, validação, normalização, distância, rota e saúde. `FallbackGeoProvider` mantém distância Haversine claramente rotulada como estimativa.

## 7. Normalização

Endereços usam rua, número, complemento, bairro, cidade, estado, código postal e país. CEP é suportado sem impedir formatos internacionais. Estados são `valid`, `partial`, `ambiguous`, `invalid` e `unverified`.

## 8. Geocoding e cache

Resultados guardam provedor, qualidade e expiração. A chave inclui organização, provedor, hash e versão, impedindo vazamento entre tenants. Endereço ambíguo exige confirmação humana.

## 9. Modelo territorial

Territórios suportam polygon, multipolygon, radius e conjuntos de CEP, bairro ou cidade, com escopo de organização, marca, região ou loja.

## 10. Versionamento

Cada alteração preserva snapshot em `geo_territory_versions`; o histórico nunca é sobrescrito.

## 11. Áreas de serviço

`service_areas` liga loja, serviço e território. A resolução prioriza polígono, regra postal, raio e revisão manual. Taxa e prazo continuam no delivery.

## 12. Integração com delivery

`delivery_zones` recebe somente o vínculo territorial. Rotas, paradas, motoristas, taxa e ETA permanecem no domínio logístico oficial.

## 13. Store serviceability

O serviço considera loja ativa, capacidade e política de seleção. Suporta nearest, assigned territory, load balanced, customer choice e prioridade manual sem trocar silenciosamente a loja do carrinho.

## 14. Sobreposição

O analisador identifica sobreposição estimada, severidade e política. Sobreposição de delivery pode ser permitida; exclusividade de franquia requer revisão e aprovação.

## 15. Territórios de franquia

Assignments referenciam território, perfil financeiro, loja, contrato e aprovação. O sistema registra governança operacional, não interpretação jurídica.

## 16. Changesets

Criação, mudança de limite, atribuição e área de serviço passam por draft, review, approved, published ou rolled_back. Publicar exige preview, aprovação ActionEngine e confirmação humana.

## 17. Interface de mapa

Rede · Mapa oferece camadas, busca, marcadores agrupáveis, representação leve e tabela acessível. Camadas são carregadas sob demanda e nenhuma localização individual de cliente é exibida.

## 18. Analytics

Catchments usam grade, bairro, prefixo postal, hex ou zona. Pedidos, receita, ticket, tempo, clientes e reclamações são agregados e suprimidos abaixo do limiar de privacidade.

## 19. Expansão

`site_candidates` complementa a Fase 65 com lojas próximas, cobertura, território e componentes transparentes de score. Canibalização é sempre uma estimativa, nunca promessa financeira.

## 20. Capacidade

Capacidade pode retirar uma loja das sugestões ou apoiar load balancing, sem redefinir promessa, slots ou política do módulo oficial.

## 21. Marketing e clientes

Marketing pode usar agregados territoriais consentidos. Customer 360 e checkout recebem apenas serviceability e loja candidata; não há inferência sensível ou rastreamento individual.

## 22. Reporting e Workspace

Seis datasets certificados, nove métricas e cinco widgets foram registrados para cobertura, conflitos, qualidade, expansão e saúde dos provedores.

## 23. Data Platform

Foram criadas facts de serviceability, densidade, performance de entrega, mudanças e overlaps, além de dimensões de território, área, região e qualidade.

## 24. Privacidade

Pontos de clientes não são retornados no painel. Analytics exige agregação mínima e a plataforma não cria segmentos discriminatórios, inferências sensíveis ou vigilância.

## 25. Segurança e RBAC

Existem 11 permissões específicas. API valida vínculo, organização e permissão; tabelas operacionais ficam sob RLS, sem acesso direto de `anon` ou `authenticated`.

## 26. Auditoria

Mudanças registram ator, tipo, entidade, motivo, antes/depois e correlação. Publicação e rollback preservam versões.

## 27. Observabilidade

Uso de provedor registra operação, status, latência, cache e unidade de custo. A abstração permite fallback, limite de requisições e diagnóstico de degradação.

## 28. Testes

Há 30 testes obrigatórios cobrindo normalização, geocoding, geometrias, versionamento, serviceability, capacidade, overlap, franquia, changesets, fallback, analytics, privacidade, expansão, permissões, auditoria, cache e isolamento. Executar com `pnpm test:phase66`.

## 29. Limitações

A migration não foi aplicada em produção e o site não foi publicado nesta etapa. Provedores reais dependem de credencial protegida. O mapa leve não substitui GIS completo; PostGIS só deve ser adotado depois de validar disponibilidade, extensão e plano de migração.

## 30. Recomendações para a Fase 67

Antes de definir a Fase 67, validar a migration em homologação, configurar um provedor, confirmar coordenadas de lojas, ensaiar conflitos e rollback, testar checkout multi-loja e revisar privacidade/RBAC. Nenhum trabalho da Fase 67 foi iniciado.
