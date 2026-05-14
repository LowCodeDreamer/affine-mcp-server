import type { ParsedFrontmatter } from "../markdown/frontmatter.js";
import { coerceDateMs, coerceString, coerceStringArray } from "../markdown/frontmatter.js";

export type AtlasPropertyType = "text" | "number" | "checkbox" | "date";

export type AtlasPropertyDef = {
  id: string;
  name: string;
  type: AtlasPropertyType;
  index: string;
  sourceField: string;
  icon?: string;
};

export const ATLAS_PROPERTY_SCHEMA: AtlasPropertyDef[] = [
  { id: "atlas_id",           name: "Atlas ID",      type: "text", index: "atlas_a0001", sourceField: "id"           },
  { id: "atlas_type",         name: "Atlas Type",    type: "text", index: "atlas_a0002", sourceField: "type"         },
  { id: "atlas_status",       name: "Status",        type: "text", index: "atlas_a0003", sourceField: "status"       },
  { id: "atlas_summary",      name: "Summary",       type: "text", index: "atlas_a0004", sourceField: "summary"      },
  { id: "atlas_confidence",   name: "Confidence",    type: "text", index: "atlas_a0005", sourceField: "confidence"   },
  { id: "atlas_source_file",  name: "Source File",   type: "text", index: "atlas_a0006", sourceField: "source_file"  },
  { id: "atlas_source_type",  name: "Source Type",   type: "text", index: "atlas_a0007", sourceField: "source_type"  },
  { id: "atlas_source_url",   name: "Source URL",    type: "text", index: "atlas_a0008", sourceField: "source_url"   },
  { id: "atlas_author",       name: "Author",        type: "text", index: "atlas_a0009", sourceField: "author"       },
  { id: "atlas_area",         name: "Area",          type: "text", index: "atlas_a0010", sourceField: "area"         },
  { id: "atlas_project",      name: "Project",       type: "text", index: "atlas_a0011", sourceField: "project"      },
  { id: "atlas_related",      name: "Related",       type: "text", index: "atlas_a0012", sourceField: "related"      },
];

export const NATIVE_FRONTMATTER_FIELDS = new Set([
  "title", "tags", "created_at", "updated_at", "createdAt", "updatedAt",
]);

const ATLAS_FIELD_SET = new Set(ATLAS_PROPERTY_SCHEMA.map((p) => p.sourceField));

export type MappedFrontmatter = {
  title: string | null;
  tags: string[];
  createdAtMs: number | null;
  updatedAtMs: number | null;
  customProperties: Record<string, string>;
  extras: Record<string, string>;
  warnings: string[];
};

export function mapFrontmatter(parsed: ParsedFrontmatter): MappedFrontmatter {
  const meta = parsed.meta ?? {};
  const warnings = [...parsed.warnings];

  const title = coerceString(meta.title);
  const tags = coerceStringArray(meta.tags);
  const createdAtMs = coerceDateMs(meta.created_at ?? meta.createdAt);
  const updatedAtMs = coerceDateMs(meta.updated_at ?? meta.updatedAt);

  if ((meta.created_at != null || meta.createdAt != null) && createdAtMs == null) {
    warnings.push("created_at could not be parsed as a date");
  }
  if ((meta.updated_at != null || meta.updatedAt != null) && updatedAtMs == null) {
    warnings.push("updated_at could not be parsed as a date");
  }

  const customProperties: Record<string, string> = {};
  for (const def of ATLAS_PROPERTY_SCHEMA) {
    const raw = meta[def.sourceField];
    if (raw == null) continue;
    const str = def.sourceField === "related" ? coerceStringArray(raw).join(", ") : coerceString(raw);
    if (str != null && str.length > 0) {
      customProperties[def.id] = str;
    }
  }

  const extras: Record<string, string> = {};
  for (const key of Object.keys(meta)) {
    if (NATIVE_FRONTMATTER_FIELDS.has(key)) continue;
    if (ATLAS_FIELD_SET.has(key)) continue;
    const str = coerceString(meta[key]);
    if (str != null) extras[key] = str;
  }

  return { title, tags, createdAtMs, updatedAtMs, customProperties, extras, warnings };
}
