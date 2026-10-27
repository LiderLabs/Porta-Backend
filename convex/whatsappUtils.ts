/**
 * WhatsApp integration helpers:
 * - Phone number normalization to E.164 (Ghana 233 default)
 * - Phone number matching
 * - Webhook HMAC-SHA256 signature verification
 * - Date/time formatting for templates
 */

/**
 * Normalizes phone numbers to standard E.164 digits-only format.
 * Defaults to Ghana (+233) country code.
 *
 * Examples:
 * - "024 123 4567"   -> "233241234567"
 * - "0241234567"     -> "233241234567"
 * - "+233 24 123 4567" -> "233241234567"
 * - "233241234567"   -> "233241234567"
 * - "241234567" (9 digits) -> "233241234567"
 * - "+1 (555) 234-5678" -> "15552345678"
 */
export function normalizePhoneNumber(
  rawPhone: string | null | undefined,
  defaultCountryCode = "233"
): string | null {
  if (!rawPhone || typeof rawPhone !== "string") return null;

  // Trim whitespace
  const trimmed = rawPhone.trim();
  if (!trimmed) return null;

  // Check if starts with international "+" or "00"
  const hasPlus = trimmed.startsWith("+");
  const hasDoubleZero = trimmed.startsWith("00");

  // Keep only digits
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  // If started with 00, strip the 00
  if (hasDoubleZero && digits.startsWith("00")) {
    digits = digits.slice(2);
  }

  // If local Ghana format: starts with 0 and followed by 9 digits (10 digits total)
  if (digits.startsWith("0") && digits.length === 10) {
    return `${defaultCountryCode}${digits.slice(1)}`;
  }

  // If 9 digits (local Ghana number entered without leading 0)
  if (!hasPlus && digits.length === 9) {
    return `${defaultCountryCode}${digits}`;
  }

  // If already starts with Ghana country code 233 and total length is 12 (233 + 9 digits)
  if (digits.startsWith(defaultCountryCode) && digits.length === defaultCountryCode.length + 9) {
    return digits;
  }

  // If standard international format with valid E.164 length (between 8 and 15 digits)
  if (digits.length >= 8 && digits.length <= 15) {
    return digits;
  }

  return null;
}

/**
 * Checks whether two phone numbers refer to the same recipient/host.
 */
export function isSamePhoneNumber(
  phoneA: string | null | undefined,
  phoneB: string | null | undefined
): boolean {
  const normA = normalizePhoneNumber(phoneA);
  const normB = normalizePhoneNumber(phoneB);
  if (!normA || !normB) return false;
  return normA === normB;
}

/**
 * Verifies the Meta X-Hub-Signature-256 header using Web Crypto HMAC-SHA256.
 * Header format is "sha256=<hex_digest>".
 */
export async function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  appSecret: string | null | undefined
): Promise<boolean> {
  if (!signatureHeader || !appSecret) return false;

  const prefix = "sha256=";
  if (!signatureHeader.startsWith(prefix)) return false;
  const expectedHex = signatureHeader.slice(prefix.length).trim().toLowerCase();

  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(appSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signatureBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(rawBody)
    );

    const calculatedHex = Array.from(new Uint8Array(signatureBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .toLowerCase();

    if (calculatedHex.length !== expectedHex.length) return false;

    // Constant-time comparison to prevent timing attacks
    let mismatch = 0;
    for (let i = 0; i < calculatedHex.length; i++) {
      mismatch |= calculatedHex.charCodeAt(i) ^ expectedHex.charCodeAt(i);
    }
    return mismatch === 0;
  } catch (err) {
    console.error("[WhatsApp] Error verifying webhook signature:", err);
    return false;
  }
}

/**
 * Format a timestamp into a readable date string (e.g. "Monday, Oct 27, 2026")
 */
export function formatWhatsAppDate(timestamp: number): string {
  try {
    const date = new Date(timestamp);
    return date.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return new Date(timestamp).toDateString();
  }
}

/**
 * Format a timestamp into a readable time string (e.g. "10:30 AM")
 */
export function formatWhatsAppTime(timestamp: number): string {
  try {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return "";
  }
}
