import Link from "next/link";
import { CUSTOMER_PRIVACY_VERSION, CUSTOMER_TERMS_VERSION, LEGAL_DRAFT, LEGAL_LINKS, LEGAL_PLACEHOLDERS as P, SAAS_PRIVACY_VERSION, SAAS_TERMS_VERSION } from "@/lib/legal";
import "./legal-document.css";

// Fase 98I: modelos com marcadores, coerentes com o que as Fases 95/96 registram (finalidades, bases legais,
// retenção, suboperadores, direitos do titular, encarregado). Não é parecer jurídico.
type Kind = "saas-terms" | "saas-privacy" | "customer-terms" | "customer-privacy";
type Section = { title: string; body: (string | string[])[] };

const SUBPROCESSORS = [
  "Supabase (banco de dados e autenticação), região São Paulo (sa-east-1)",
  "Vercel (hospedagem do aplicativo), Estados Unidos: transferência internacional com cláusulas contratuais",
  "Meta (WhatsApp Business), quando a loja conecta o WhatsApp: transferência internacional",
  "Mercado Pago ou Pagar.me, quando a loja usa pagamento online",
  "[DEMAIS SUBOPERADORES A CONFIRMAR: Stripe, OpenAI e outros, conforme o uso]",
];

const RIGHTS = [
  "confirmar se tratamos seus dados e acessá-los;",
  "corrigir dados incompletos, inexatos ou desatualizados;",
  "pedir anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desacordo com a LGPD;",
  "pedir a portabilidade dos dados;",
  "saber com quem compartilhamos seus dados;",
  "revogar o consentimento e ser informado sobre as consequências de não consentir;",
  "pedir revisão de decisões tomadas só por tratamento automatizado.",
];

const DOCS: Record<Kind, { title: string; audience: string; version: string; sections: Section[] }> = {
  "saas-terms": {
    title: "Termos de Uso do MasterApp",
    audience: "Para quem contrata o MasterApp para a sua loja (lojista).",
    version: SAAS_TERMS_VERSION,
    sections: [
      { title: "1. Quem somos", body: [`O MasterApp é oferecido por ${P.company}, CNPJ ${P.cnpj}, com sede em ${P.address}.`] },
      { title: "2. O que é o serviço", body: ["Sistema para lojas de alimentação: cardápio digital, pedidos na mesa, retirada e entrega, pagamento, cozinha e impressão, garçom, caixa, entregadores, acompanhamento do pedido, notificações e relatórios. Os módulos disponíveis dependem do plano contratado."] },
      { title: "3. Cadastro e acesso", body: ["Você informa dados verdadeiros e mantém sua senha em sigilo. Cada pessoa da equipe usa o próprio acesso. Você responde pelo que for feito com os acessos da sua loja."] },
      { title: "4. Plano, cobrança e cancelamento", body: ["[CONDIÇÕES COMERCIAIS: período de teste, forma de cobrança, reajuste, inadimplência, cancelamento e o que acontece com os dados depois do cancelamento.]"] },
      { title: "5. Responsabilidades da loja", body: ["A loja é responsável pelo cardápio, preços, impostos, notas fiscais, entrega, atendimento ao consumidor e pelos dados dos seus clientes e funcionários (é a controladora desses dados). O MasterApp trata esses dados em nome da loja, como operador."] },
      { title: "6. Uso proibido", body: ["Não é permitido usar o serviço para fraude, envio de mensagens sem consentimento, conteúdo ilegal, tentativa de acessar dados de outras lojas ou de burlar limites e travas do sistema."] },
      { title: "7. Disponibilidade e suporte", body: ["Buscamos manter o serviço no ar o tempo todo, mas podem ocorrer interrupções para manutenção ou por falhas de terceiros. Suporte pelo painel (Suporte MasterApp). [NÍVEL DE SERVIÇO, SE HOUVER.]"] },
      { title: "8. Limitação de responsabilidade", body: ["[CLÁUSULA A SER REDIGIDA PELO JURÍDICO.]"] },
      { title: "9. Alterações", body: ["Podemos atualizar estes termos. Avisamos pelo painel com antecedência; a versão aceita fica registrada no seu cadastro."] },
      { title: "10. Foro", body: [`Fica eleito o foro da comarca de ${P.forum}, salvo regra legal em contrário.`] },
    ],
  },
  "saas-privacy": {
    title: "Política de Privacidade do MasterApp",
    audience: "Como tratamos os dados de quem usa o painel do MasterApp (lojistas e equipes).",
    version: SAAS_PRIVACY_VERSION,
    sections: [
      { title: "1. Controlador e encarregado", body: [`${P.company}, CNPJ ${P.cnpj}. Encarregado (DPO): ${P.dpo}, ${P.dpoEmail}.`] },
      { title: "2. Dados que tratamos", body: ["Nome, e-mail, telefone, dados da loja (nome, endereço, CNPJ quando informado), dados de acesso (data, IP e dispositivo, para segurança), registros de uso do painel e dados de cobrança da assinatura."] },
      { title: "3. Para que usamos e com qual base legal", body: [[
        "prestar o serviço contratado e dar suporte: execução de contrato;",
        "cobrança da assinatura e obrigações fiscais: execução de contrato e cumprimento de obrigação legal;",
        "segurança, prevenção a fraude e auditoria de acessos: legítimo interesse;",
        "comunicações sobre o serviço: execução de contrato; ofertas: consentimento, que pode ser revogado.",
      ]] },
      { title: "4. Com quem compartilhamos", body: ["Somente com os suboperadores necessários para o serviço funcionar:", SUBPROCESSORS] },
      { title: "5. Por quanto tempo guardamos", body: ["Enquanto a conta estiver ativa e, depois, pelo prazo legal: documentos fiscais, pagamentos e movimentos de caixa por 5 anos; registros de acesso pelo prazo do Marco Civil da Internet. [CONFIRMAR PRAZOS COM O ENCARREGADO.]"] },
      { title: "6. Seus direitos", body: ["Você pode, a qualquer momento:", RIGHTS, `Pedidos: ${P.dpoEmail}. Você também pode reclamar à ANPD.`] },
      { title: "7. Segurança", body: ["Acesso por perfil, registros de auditoria, dados isolados por loja e conexões criptografadas."] },
      { title: "8. Alterações", body: ["Mudanças relevantes são avisadas pelo painel; a versão aceita fica registrada."] },
    ],
  },
  "customer-terms": {
    title: "Termos de uso para clientes das lojas",
    audience: "Para quem faz pedidos pelo cardápio digital, QR da mesa ou portal do cliente de uma loja que usa o MasterApp.",
    version: CUSTOMER_TERMS_VERSION,
    sections: [
      { title: "1. Quem vende", body: ["Quem vende, prepara e entrega o pedido é a loja. O MasterApp é a ferramenta que a loja usa. Preços, prazos, trocas e atendimento são de responsabilidade da loja, conforme o Código de Defesa do Consumidor."] },
      { title: "2. Pedido e pagamento", body: ["O pedido vale depois de confirmado pela loja. Pagamento online é processado pelo meio de pagamento da loja; dinheiro e cartão são pagos à loja na entrega ou retirada."] },
      { title: "3. Acompanhamento", body: ["O link de acompanhamento é pessoal. Não compartilhe o código de entrega (PIN) com ninguém além do entregador."] },
      { title: "4. Uso adequado", body: ["Pedidos falsos, abusivos ou em volume anormal podem ser bloqueados automaticamente."] },
      { title: "5. Contato", body: ["Dúvidas sobre o pedido: fale com a loja pelos contatos do cardápio. [CANAL DO MASTERAPP PARA PROBLEMAS COM A PLATAFORMA.]"] },
    ],
  },
  "customer-privacy": {
    title: "Privacidade para clientes das lojas",
    audience: "Como os seus dados são tratados quando você faz um pedido em uma loja que usa o MasterApp.",
    version: CUSTOMER_PRIVACY_VERSION,
    sections: [
      { title: "1. Quem decide sobre seus dados", body: [`A loja onde você pediu é a controladora dos seus dados. O MasterApp (${P.company}) trata os dados em nome da loja, como operador. Encarregado do MasterApp: ${P.dpo}, ${P.dpoEmail}. [ENCARREGADO DE CADA LOJA, QUANDO HOUVER.]`] },
      { title: "2. Dados do pedido", body: ["Nome, telefone (opcional quando a loja permite), endereço de entrega, itens, forma de pagamento e, durante a entrega, a localização do entregador. Pagamento online: os dados do cartão ficam com o meio de pagamento, não com a loja nem com o MasterApp."] },
      { title: "3. Para que usamos e com qual base legal", body: [[
        "preparar, entregar e cobrar o pedido: execução de contrato;",
        "nota fiscal e registros contábeis: cumprimento de obrigação legal;",
        "avisos sobre o pedido (tela, notificação e WhatsApp, quando a loja usa): execução de contrato;",
        "ofertas e programas de fidelidade: consentimento, que você pode revogar a qualquer momento;",
        "pesquisa de satisfação: legítimo interesse ou consentimento, conforme a loja configurar.",
      ]] },
      { title: "4. Compartilhamento", body: ["Com o entregador (nome, endereço e telefone, só para a entrega) e com os suboperadores do serviço:", SUBPROCESSORS] },
      { title: "5. Por quanto tempo", body: ["Os dados do pedido ficam pelo prazo legal (documentos fiscais e comprovante de entrega: 5 anos). Dados de marketing saem quando você revoga o consentimento; o registro da revogação é guardado como prova. [CONFIRMAR COM O ENCARREGADO.]"] },
      { title: "6. Seus direitos", body: ["Você pode pedir à loja, ou pelo portal do cliente quando disponível:", RIGHTS, "Você também pode reclamar à ANPD."] },
    ],
  },
};

export function LegalDocument({ kind }: { kind: Kind }) {
  const doc = DOCS[kind];
  return <main className="legal-page">
    {LEGAL_DRAFT && <p className="legal-draft" role="note"><strong>RASCUNHO, NÃO DEFINITIVO.</strong> Texto-modelo a ser revisado pelo jurídico e pelo encarregado antes da publicação. Os campos entre colchetes ainda serão preenchidos.</p>}
    <article>
      <h1>{doc.title}</h1>
      <p className="legal-audience">{doc.audience}</p>
      <p className="legal-version">Versão {doc.version}</p>
      {doc.sections.map((section) => <section key={section.title}>
        <h2>{section.title}</h2>
        {section.body.map((part, index) => Array.isArray(part)
          ? <ul key={index}>{part.map((item) => <li key={item}>{item}</li>)}</ul>
          : <p key={index}>{part}</p>)}
      </section>)}
    </article>
    <nav className="legal-nav" aria-label="Documentos legais">
      <Link href={LEGAL_LINKS.saasTerms}>Termos de Uso</Link>
      <Link href={LEGAL_LINKS.saasPrivacy}>Política de Privacidade</Link>
      <Link href={LEGAL_LINKS.customerTerms}>Termos para clientes das lojas</Link>
      <Link href={LEGAL_LINKS.customerPrivacy}>Privacidade para clientes das lojas</Link>
    </nav>
  </main>;
}
