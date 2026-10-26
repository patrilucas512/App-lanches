import { Brand } from "@/components/ui";
import { operationTheme, brandName, brandLogo, type EstablishmentBrand } from "@/lib/operation-theme";

/** Uses the same saved identity as the public menu; never stores a second theme. */
export function EstablishmentTheme({ brand, children }: { brand: EstablishmentBrand; children: React.ReactNode }) {
  return <div className="establishment-theme operation-dashboard" style={operationTheme(brand)}>
    <div className="operation-brand"><Brand name={brandName(brand)} logo={brandLogo(brand)} href="#" compact /></div>
    {children}
  </div>;
}
