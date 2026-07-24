const tlv = (id: string, value: string) => `${id}${String(value.length).padStart(2, "0")}${value}`;

function safe(value: string, max: number) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 $%*+\-./:]/g, "").toUpperCase().slice(0, max);
}

function crc16(payload: string) {
  let crc = 0xffff;
  for (let index = 0; index < payload.length; index++) {
    crc ^= payload.charCodeAt(index) << 8;
    for (let bit = 0; bit < 8; bit++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function createPixPayload(input: {
  key: string; name: string; city: string; amountCents: number; txid: string; description?: string;
}) {
  const merchant = tlv("00", "BR.GOV.BCB.PIX") + tlv("01", input.key) +
    (input.description ? tlv("02", safe(input.description, 50)) : "");
  const additional = tlv("05", safe(input.txid, 25) || "***");
  const body = tlv("00", "01") + tlv("26", merchant) + tlv("52", "0000") + tlv("53", "986") +
    tlv("54", (input.amountCents / 100).toFixed(2)) + tlv("58", "BR") +
    tlv("59", safe(input.name, 25)) + tlv("60", safe(input.city, 15)) + tlv("62", additional);
  const pending = body + "6304";
  return pending + crc16(pending);
}
