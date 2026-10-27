import { SuperadminShell } from "@/components/superadmin-shell";
import { requireSuperadmin } from "@/lib/superadmin";

export default async function SuperadminLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireSuperadmin();
  return <SuperadminShell name={profile.full_name || "Super Admin"}>{children}</SuperadminShell>;
}
