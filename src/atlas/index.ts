import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { GraphQLClient } from "../graphqlClient.js";
import { connectWorkspaceSocket, joinWorkspace, wsUrlFromGraphQLEndpoint } from "../ws.js";
import { text } from "../util/mcp.js";
import {
  ATLAS_PROPERTY_SCHEMA,
  mapFrontmatter,
  type AtlasPropertyDef,
  type MappedFrontmatter,
} from "./schema.js";
import {
  ensureWorkspacePropertySchema,
  setDocCustomProperties,
  setDocMetaTimestamps,
} from "./properties.js";
import { parseAtlasFrontmatter } from "../markdown/frontmatter.js";

export { mapFrontmatter, parseAtlasFrontmatter, ATLAS_PROPERTY_SCHEMA };
export type { MappedFrontmatter, AtlasPropertyDef };

export async function applyAtlasMetadataInSession(
  gql: GraphQLClient,
  workspaceId: string,
  docId: string,
  mapped: MappedFrontmatter,
): Promise<{
  propertiesApplied: string[];
  timestampsUpdated: string[];
  warnings: string[];
}> {
  const wsUrl = wsUrlFromGraphQLEndpoint(gql.endpoint);
  const socket = await connectWorkspaceSocket(wsUrl, gql.cookie, gql.bearer);
  try {
    await joinWorkspace(socket, workspaceId);

    let propertiesApplied: string[] = [];
    if (Object.keys(mapped.customProperties).length > 0) {
      await ensureWorkspacePropertySchema(socket, workspaceId);
      const propRes = await setDocCustomProperties(socket, workspaceId, docId, mapped.customProperties);
      propertiesApplied = propRes.applied;
    }

    const tsRes = await setDocMetaTimestamps(socket, workspaceId, docId, {
      createDateMs: mapped.createdAtMs,
      updateDateMs: mapped.updatedAtMs,
    });

    return { propertiesApplied, timestampsUpdated: tsRes.updated, warnings: mapped.warnings };
  } finally {
    socket.disconnect();
  }
}

export function registerAtlasTools(
  server: McpServer,
  gql: GraphQLClient,
  defaults: { workspaceId?: string },
) {
  const WorkspaceId = z.string().min(1, "workspaceId required");

  server.registerTool(
    "bootstrap_atlas_schema",
    {
      title: "Bootstrap Atlas Property Schema",
      description:
        "Idempotently ensures the Atlas YAML-frontmatter custom property definitions (atlas_id, atlas_type, atlas_status, atlas_project, etc.) exist on the target AFFiNE workspace. Run this once per workspace before importing Atlas-formatted markdown.",
      inputSchema: {
        workspaceId: WorkspaceId.optional(),
      },
    },
    (async (parsed: { workspaceId?: string }) => {
      const workspaceId = parsed.workspaceId || defaults.workspaceId;
      if (!workspaceId) throw new Error("workspaceId is required. Provide it or set AFFINE_WORKSPACE_ID.");
      const wsUrl = wsUrlFromGraphQLEndpoint(gql.endpoint);
      const socket = await connectWorkspaceSocket(wsUrl, gql.cookie, gql.bearer);
      try {
        await joinWorkspace(socket, workspaceId);
        const result = await ensureWorkspacePropertySchema(socket, workspaceId);
        return text(JSON.stringify({
          workspaceId,
          ...result,
          schema: ATLAS_PROPERTY_SCHEMA.map(p => ({ id: p.id, name: p.name, type: p.type })),
        }, null, 2));
      } finally {
        socket.disconnect();
      }
    }) as any
  );

  server.registerTool(
    "describe_atlas_schema",
    {
      title: "Describe Atlas Property Schema",
      description: "Returns the Atlas YAML-frontmatter → AFFiNE custom-property mapping that bootstrap_atlas_schema would install.",
      inputSchema: {},
    },
    (async () => {
      return text(JSON.stringify({
        properties: ATLAS_PROPERTY_SCHEMA,
        nativeFields: {
          title: "doc.meta.title",
          tags: "doc.meta.tags (one-way: tag entities not auto-created in v1)",
          created_at: "doc.meta.createDate",
          updated_at: "doc.meta.updatedDate",
        },
      }, null, 2));
    }) as any
  );
}
