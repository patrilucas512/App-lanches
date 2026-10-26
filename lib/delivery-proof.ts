export function deliveryProofLabel(method: string | null, pinVerified: boolean) {
  if (method === "pin" && pinVerified) return "PIN validado";
  if (method === "admin_exception" && !pinVerified) return "Exceção administrativa · sem PIN";
  if (method === "legacy" && !pinVerified) return "Registro antigo · sem prova de PIN";
  return "Confirmação incompleta · conferir registro";
}

export function hasDeliveryCoordinates(latitude: number | null, longitude: number | null) {
  return latitude !== null && longitude !== null && Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}
