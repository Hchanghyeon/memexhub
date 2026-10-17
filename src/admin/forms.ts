import { z } from "zod";

export const INTERNAL = "@internal";

export interface Field {
  key: string;
  /** English label; `labelKo` and `hint` come from `.meta(F(en, ko, hint))` on the field. */
  label: string;
  labelKo?: string;
  hint?: { en: string; ko: string };
  type: "text" | "password" | "checkbox" | "number" | "select";
  options?: string[];
  optional: boolean;
  defaultValue?: unknown;
}

/** Read a zod object into form fields (works for optional / default wrappers). Fields described "@internal" are filled by the engine, not the form. */
export function fieldsOf(schema: z.ZodObject<any> | undefined, secret = false): Field[] {
  if (!schema) return [];
  return Object.entries(schema.shape as Record<string, z.ZodType>).filter(([, f]) => f.description !== INTERNAL).map(([key, f]) => {
    let s: any = f;
    let optional = false;
    let defaultValue: unknown;
    while (s instanceof z.ZodOptional || s instanceof z.ZodDefault || s instanceof z.ZodNullable) {
      optional = true;
      if (s instanceof z.ZodDefault) defaultValue = (s as any)._zod.def.defaultValue;
      s = s._zod.def.innerType;
    }
    const meta = ((f as any).meta?.() ?? (s as any).meta?.() ?? {}) as { ko?: string; hintEn?: string; hintKo?: string };
    const text = {
      label: f.description ?? s.description ?? key,
      ...(meta.ko ? { labelKo: meta.ko } : {}),
      ...(meta.hintEn ? { hint: { en: meta.hintEn, ko: meta.hintKo ?? meta.hintEn } } : {}),
    };
    if (secret) return { key, ...text, type: "password" as const, optional };
    if (s instanceof z.ZodBoolean) return { key, ...text, type: "checkbox" as const, optional, defaultValue };
    if (s instanceof z.ZodNumber) return { key, ...text, type: "number" as const, optional, defaultValue };
    if (s instanceof z.ZodEnum) return { key, ...text, type: "select" as const, options: s.options as string[], optional, defaultValue };
    return { key, ...text, type: "text" as const, optional, defaultValue };
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

