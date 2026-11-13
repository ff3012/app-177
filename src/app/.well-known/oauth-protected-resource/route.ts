import { isMcpEnabled } from '@/lib/mcp/enabled';
import { jsonResponse, notFoundResponse, optionsResponse } from '@/lib/mcp/oauth/http';
import { getIssuer, protectedResourceMetadata } from '@/lib/mcp/oauth/metadata';

// Hängt vom Funktionsschalter (DB) ab - nie zur Build-Zeit vorrendern.
export const dynamic = 'force-dynamic';

export function OPTIONS() {
  return optionsResponse();
}

export async function GET() {
  if (!(await isMcpEnabled())) return notFoundResponse();
  return jsonResponse(protectedResourceMetadata(getIssuer()));
}
