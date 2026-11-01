import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CustomerSurvey } from "@/components/customer-survey";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken } from "@/lib/customer-experience/surveys";
import "./survey.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Avalie sua experiência", robots: { index: false, follow: false } };

const SOURCES = ["qr_table", "receipt_link", "kiosk"];

export default async function SurveyPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ t?: string; origem?: string }> }) {
  const { slug } = await params;
  const { t, origem } = await searchParams;
  const source = t ? "whatsapp" : SOURCES.includes(String(origem)) ? String(origem) : "qr_table";
  const { data, error } = await createAdminClient().rpc("cx_get_public_survey", { requested_slug: slug, requested_token_hash: t ? hashToken(t) : null, requested_source: source });
  if (error || !data) notFound();
  return <CustomerSurvey slug={slug} token={t || null} source={source} store={data.store} survey={data.survey} initialState={data.state} />;
}
