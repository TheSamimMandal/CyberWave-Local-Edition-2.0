// lib/opennds.ts
export interface ClientParams {
  clientMac: string | null;
  clientIp: string | null;
  gatewayAddress: string | null;
  gatewayName?: string | null;
  originUrl?: string | null;
  raw?: string | null;
}

export function parseFasToken(fasParam: string): ClientParams {
  if (!fasParam || typeof fasParam !== 'string') {
    return { clientMac: null, clientIp: null, gatewayAddress: null };
  }

  try {
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
