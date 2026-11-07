import { ArrowRight, LogIn } from "lucide-react";
import { Button, type ButtonProps } from "./button";

// Entrar abre o login do próprio MasterApp; o teste grátis abre o cadastro.
// Links comuns (<a>), não next/link: a troca de página recarrega o CSS do app sem levar o da landing.
const destinations = { login: "/login", signup: "/cadastro" } as const;

type Props = Pick<ButtonProps, "className" | "variant" | "size" | "onClick"> & { access: keyof typeof destinations; label?: string };

export function SaasAccessButton({ access, className, variant, size, onClick, label: customLabel }: Props) {
  const isLogin = access === "login";
  const label = customLabel ?? (isLogin ? "Entrar" : "Começar teste grátis");
  const Icon = isLogin ? LogIn : ArrowRight;
  return <Button className={className} variant={variant ?? (isLogin ? "heroOutline" : "hero")} size={size} onClick={onClick} asChild><a href={destinations[access]}>{label}<Icon aria-hidden="true" /></a></Button>;
}
