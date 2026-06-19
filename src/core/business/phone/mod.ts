// Phone number normalization. Different upstreams use different formats:
//   Quickbase report: "(936) 676-2277"
//   Bland.ai:        "+19366762277"
//   ReadyMode:        "9366762277"
//   Firestore key:    "9366762277" (10 digits)

export function normalizePhone(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return null;
}

export function toE164(input: unknown): string | null {
  const ten = normalizePhone(input);
  return ten ? `+1${ten}` : null;
}

export function normalizePhone11To10(
  input: unknown,
): { phone10: string; phone11: string } | null {
  if (typeof input !== "string") return null;
  const digits = input.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return { phone10: digits.slice(1), phone11: digits };
  }
  if (digits.length === 10) return { phone10: digits, phone11: `1${digits}` };
  return null;
}
