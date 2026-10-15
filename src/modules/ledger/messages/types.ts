import { z } from "zod";

export const CHANNELS = ["sms", "notification", "mail", "text"] as const;
export type Channel = (typeof CHANNELS)[number];

/** Anything that needs reading: a card SMS, an app notification, a receipt mail, pasted text. */
export const MessageInput = z
  .object({
    channel: z.enum(CHANNELS).default("text"),
    from: z.string().max(200).optional(),
    subject: z.string().max(300).optional(),
    text: z.string().min(1).max(16_000),
    time: z.string().max(40).optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lon: z.coerce.number().min(-180).max(180).optional(),
  })
  .strict();
export type Message = z.input<typeof MessageInput>;

/** Fields a recipe or the generic parser can fill. Card numbers are never among them. */
export interface ReadPayment {
  merchant: string;
  amount: string; // "₩12,500" · "-₩8,000" · "CNY 21.30"
  card: string; // "현대카드 M 일시불"
  time: string; // ISO with offset, or "" when the message has none
  item: string;
}

export interface ReadResult {
  step: "recipe" | "generic" | "none";
  recipeId?: string;
  kind: "payment" | "item" | "ignore";
  /** Recorded directly only when confident. Otherwise this is a guess for the inbox. */
  confident: boolean;
  payment?: ReadPayment;
  reason?: string;
}
