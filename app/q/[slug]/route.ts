import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const normalizedSlug = slug.trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(normalizedSlug)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const destination = new URL(
    `/loja/${encodeURIComponent(normalizedSlug)}`,
    request.url,
  );
  destination.searchParams.set("origem", "qr");
  return NextResponse.redirect(destination);
}
