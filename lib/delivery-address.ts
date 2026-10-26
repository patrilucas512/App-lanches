/** Compact customer address; no guessing numbers, areas or delivery fees. */
export function parseDeliveryAddress(value: string) {
  const parts = value.split(",").map(part => part.trim());
  if (parts.length !== 3) return null;
  const [street, number, neighborhood] = parts;
  if (street.length < 3 || street.length > 120 || !number || number.length > 20 || neighborhood.length < 2 || neighborhood.length > 80) return null;
  return { street, number, neighborhood };
}
