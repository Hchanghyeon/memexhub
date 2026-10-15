import type { SmsIssuer } from "./types.js";
import { hyundai } from "./hyundai.js";
import { samsung } from "./samsung.js";

/** Chain of responsibility: the first issuer whose `detect` matches handles the SMS. Add issuers here. */
export const ISSUERS: SmsIssuer[] = [hyundai, samsung];
export type { SmsIssuer, SmsPayment } from "./types.js";
