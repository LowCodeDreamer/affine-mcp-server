import * as Y from "yjs";

import { loadDoc, pushDocUpdate } from "../ws.js";
import { ATLAS_PROPERTY_SCHEMA, type AtlasPropertyDef } from "./schema.js";

export function workspaceDbDocId(workspaceId: string, tableName: string): string {
  return `db$${workspaceId}$${tableName}`;
}

async function hydrateSubDoc(
  socket: any,
  workspaceId: string,
  syncDocId: string,
): Promise<{ doc: Y.Doc; prevSV: Uint8Array }> {
  const doc = new Y.Doc();
  const snapshot = await loadDoc(socket, workspaceId, syncDocId);
  if (snapshot.missing) {
    Y.applyUpdate(doc, Buffer.from(snapshot.missing, "base64"));
  }
  // snapshot.state is a state vector (not an update). Use it as prevSV so we only
  // push the diff AFFiNE doesn't already have. Falling back to local SV is safe
  // for new sub-docs where state is absent.
  const prevSV = snapshot.state
    ? Buffer.from(snapshot.state, "base64")
    : Y.encodeStateVector(doc);
  return { doc, prevSV };
}

async function commitDelta(
  socket: any,
  workspaceId: string,
  syncDocId: string,
  doc: Y.Doc,
  prevSV: Uint8Array,
): Promise<boolean> {
  const delta = Y.encodeStateAsUpdate(doc, prevSV);
  if (delta.length <= 2) return false;
  await pushDocUpdate(socket, workspaceId, syncDocId, Buffer.from(delta).toString("base64"));
  return true;
}

export type EnsurePropertiesResult = {
  created: string[];
  existing: string[];
  updated: string[];
};

export async function ensureWorkspacePropertySchema(
  socket: any,
  workspaceId: string,
  defs: AtlasPropertyDef[] = ATLAS_PROPERTY_SCHEMA,
): Promise<EnsurePropertiesResult> {
  const syncId = workspaceDbDocId(workspaceId, "docCustomPropertyInfo");
  const { doc, prevSV } = await hydrateSubDoc(socket, workspaceId, syncId);

  const created: string[] = [];
  const existing: string[] = [];
  const updated: string[] = [];

  for (const def of defs) {
    const row = doc.getMap<any>(def.id);
    const hadId = row.get("id");
    const isDeleted = row.get("isDeleted") === true;

    if (hadId && !isDeleted) {
      let changed = false;
      if (row.get("name") !== def.name) { row.set("name", def.name); changed = true; }
      if (row.get("type") !== def.type) { row.set("type", def.type); changed = true; }
      if (!row.get("index")) { row.set("index", def.index); changed = true; }
      if (changed) updated.push(def.id);
      else existing.push(def.id);
      continue;
    }

    row.set("id", def.id);
    row.set("name", def.name);
    row.set("type", def.type);
    row.set("index", def.index);
    if (def.icon) row.set("icon", def.icon);
    if (isDeleted) row.set("isDeleted", false);
    created.push(def.id);
  }

  await commitDelta(socket, workspaceId, syncId, doc, prevSV);
  return { created, existing, updated };
}

export async function setDocCustomProperties(
  socket: any,
  workspaceId: string,
  docId: string,
  values: Record<string, string>,
): Promise<{ applied: string[]; skipped: string[] }> {
  const entries = Object.entries(values).filter(([, v]) => typeof v === "string" && v.length > 0);
  if (entries.length === 0) {
    return { applied: [], skipped: Object.keys(values) };
  }

  const syncId = workspaceDbDocId(workspaceId, "docProperties");
  const { doc, prevSV } = await hydrateSubDoc(socket, workspaceId, syncId);
  const row = doc.getMap<any>(docId);
  if (!row.get("id")) row.set("id", docId);

  const applied: string[] = [];
  for (const [propertyId, value] of entries) {
    row.set(`custom:${propertyId}`, value);
    applied.push(propertyId);
  }

  await commitDelta(socket, workspaceId, syncId, doc, prevSV);
  return { applied, skipped: [] };
}

export async function setDocMetaTimestamps(
  socket: any,
  workspaceId: string,
  docId: string,
  opts: { createDateMs?: number | null; updateDateMs?: number | null },
): Promise<{ updated: string[] }> {
  const updated: string[] = [];
  const createMs = opts.createDateMs;
  const updateMs = opts.updateDateMs;
  if (createMs == null && updateMs == null) return { updated };

  const wsSnapshot = await loadDoc(socket, workspaceId, workspaceId);
  const wsDoc = new Y.Doc();
  if (wsSnapshot.missing) Y.applyUpdate(wsDoc, Buffer.from(wsSnapshot.missing, "base64"));
  const wsPrevSV = wsSnapshot.state
    ? Buffer.from(wsSnapshot.state, "base64")
    : Y.encodeStateVector(wsDoc);

  const wsMeta = wsDoc.getMap<any>("meta");
  const pages = wsMeta.get("pages") as Y.Array<Y.Map<any>> | undefined;
  if (pages) {
    for (let i = 0; i < pages.length; i += 1) {
      const entry = pages.get(i);
      if (entry?.get("id") === docId) {
        if (createMs != null) { entry.set("createDate", createMs); updated.push("workspace.meta.createDate"); }
        if (updateMs != null) { entry.set("updatedDate", updateMs); updated.push("workspace.meta.updatedDate"); }
        break;
      }
    }
  }
  const wsDelta = Y.encodeStateAsUpdate(wsDoc, wsPrevSV);
  if (wsDelta.length > 2) {
    await pushDocUpdate(socket, workspaceId, workspaceId, Buffer.from(wsDelta).toString("base64"));
  }

  const docSnapshot = await loadDoc(socket, workspaceId, docId);
  const doc = new Y.Doc();
  if (docSnapshot.missing) Y.applyUpdate(doc, Buffer.from(docSnapshot.missing, "base64"));
  const prevSV = docSnapshot.state
    ? Buffer.from(docSnapshot.state, "base64")
    : Y.encodeStateVector(doc);
  const meta = doc.getMap<any>("meta");
  if (createMs != null) { meta.set("createDate", createMs); updated.push("doc.meta.createDate"); }
  if (updateMs != null) { meta.set("updatedDate", updateMs); updated.push("doc.meta.updatedDate"); }
  const delta = Y.encodeStateAsUpdate(doc, prevSV);
  if (delta.length > 2) {
    await pushDocUpdate(socket, workspaceId, docId, Buffer.from(delta).toString("base64"));
  }

  return { updated };
}
