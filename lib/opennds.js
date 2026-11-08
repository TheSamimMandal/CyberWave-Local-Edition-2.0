/**
 * lib/opennds.js
 *
 * Helper to decode and parse openNDS FAS (Forward Authentication Service) tokens.
 * openNDS Level 1 redirects clients with ?fas=<base64> in the query string.
 * Decoded payload format: "clientmac=xx:xx:xx:xx:xx:xx, clientip=..., gatewayaddress=..."
 */

/**
 * @typedef {Object} ClientParams
 * @property {string|null} clientMac - Client MAC address (lowercase colon-separated)
 * @property {string|null} clientIp - Client IP address
 * @property {string|null} gatewayAddress - Gateway IP address / port
 * @property {string|null} [gatewayName] - Gateway identifier name
 * @property {string|null} [originUrl] - Original requested URL before redirection
 * @property {string|null} [raw] - Full decoded FAS string
 */

/**
 * Parses an openNDS FAS token (base64) into structured client parameters.
 *
 * @param {string} fasParam - Base64 encoded FAS query parameter string
 * @returns {ClientParams}
 */
export function parseFasToken(fasParam) {
  if (!fasParam || typeof fasParam !== 'string') {
    return { clientMac: null, clientIp: null, gatewayAddress: null };
  }

  try {
    // Handle URL-encoded base64 strings gracefully (e.g., %2B, %2F, %3D)
    let cleaned = fasParam.trim();
    if (cleaned.includes('%')) {
      try {
        cleaned = decodeURIComponent(cleaned);
      } catch {
        // Keep original if decodeURIComponent fails
      }
    }

    const decoded = Buffer.from(cleaned, 'base64').toString('utf-8');

    // openNDS "key=value, key=value" format
    const macMatch = decoded.match(/clientmac=([0-9a-fA-F:]{17})/i) ||
      decoded.match(/clientmac=([0-9a-fA-F]{2}[:-][0-9a-fA-F]{2}[:-][0-9a-fA-F]{2}[:-][0-9a-fA-F]{2}[:-][0-9a-fA-F]{2}[:-][0-9a-fA-F]{2})/i);
    const ipMatch = decoded.match(/clientip=([0-9.]+)/i);
    const gwMatch = decoded.match(/gatewayaddress=([0-9.]+)/i);
    const nameMatch = decoded.match(/gatewayname=([^,]+)/i);
    const originMatch = decoded.match(/originurl=([^,]+)/i);

    return {
      clientMac: macMatch ? macMatch[1].toLowerCase().replace(/-/g, ':') : null,
      clientIp: ipMatch ? ipMatch[1] : null,
      gatewayAddress: gwMatch ? gwMatch[1] : null,
    };
  } catch (error) {
    console.error('FAS decode failed:', error);
    return { clientMac: null, clientIp: null, gatewayAddress: null };
  }
}
