/** @jsxImportSource hono/jsx */
import { z } from "zod";

export interface Field {
  key: string;
  label: string;
  type: "text" | "password" | "checkbox" | "number" | "select";
  options?: string[];
  optional: boolean;
  defaultValue?: unknown;
}

/** Read a zod object into form fields (works for optional / default wrappers). */
export function fieldsOf(schema: z.ZodObject<any> | undefined, secret = false): Field[] {
  if (!schema) return [];
  return Object.entries(schema.shape as Record<string, z.ZodType>).map(([key, f]) => {
    let s: any = f;
    let optional = false;
    let defaultValue: unknown;
    while (s instanceof z.ZodOptional || s instanceof z.ZodDefault || s instanceof z.ZodNullable) {
      optional = true;
      if (s instanceof z.ZodDefault) defaultValue = (s as any)._zod.def.defaultValue;
      s = s._zod.def.innerType;
    }
    const label = f.description ?? s.description ?? key;
    if (secret) return { key, label, type: "password" as const, optional };
    if (s instanceof z.ZodBoolean) return { key, label, type: "checkbox" as const, optional, defaultValue };
    if (s instanceof z.ZodNumber) return { key, label, type: "number" as const, optional, defaultValue };
    if (s instanceof z.ZodEnum) return { key, label, type: "select" as const, options: s.options as string[], optional, defaultValue };
    return { key, label, type: "text" as const, optional, defaultValue };
  });
}

/** Form values → plain object for zod parsing. Empty text becomes undefined; checkboxes become booleans. */
export function valuesOf(fields: Field[], form: Record<string, unknown>, prefix: string) {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = form[`${prefix}.${f.key}`];
    if (f.type === "checkbox") out[f.key] = v === "on";
    else if (v === undefined || String(v).trim() === "") continue;
    else if (f.type === "number") out[f.key] = Number(v);
    else out[f.key] = String(v).slice(0, 2000);
  }
  return out;
}

export function Inputs(p: { fields: Field[]; prefix: string; values?: Record<string, unknown> }) {
  return (
    <>
      {p.fields.map((f) => {
        const name = `${p.prefix}.${f.key}`;
        const v = p.values?.[f.key] ?? f.defaultValue;
        if (f.type === "checkbox")
          return <label><input type="checkbox" name={name} checked={!!v} style="display:inline;width:auto;margin-right:.4rem" />{f.label}</label>;
        if (f.type === "select")
          return <label>{f.label}<select name={name}>{f.options!.map((o) => <option value={o} selected={v === o}>{o}</option>)}</select></label>;
        if (f.type === "password")
          return <label>{f.label} <span class="muted">(stored encrypted, never shown again — leave empty to keep)</span><input type="password" name={name} autocomplete="new-password" /></label>;
        return <label>{f.label}{f.optional ? "" : " *"}<input type={f.type} name={name} value={v === undefined ? "" : String(v)} required={!f.optional} /></label>;
      })}
    </>
  );
}
