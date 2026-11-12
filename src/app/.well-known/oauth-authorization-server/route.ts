import { isMcpEnabled } from '@/lib/mcp/enabled';
import { jsonResponse, notFoundResponse, optionsResponse } from '@/lib/mcp/oauth/http';
import { authorizationServerMetadata, getIssuer } from '@/lib/mcp/oauth/metadata';

export function OPTIONS() {
  return optionsResponse();
}

export async function GET() {
  if (!(await isMcpEnabled())) return notFoundResponse();
  return jsonResponse(authorizationServerMetadata(getIssuer()));
}
