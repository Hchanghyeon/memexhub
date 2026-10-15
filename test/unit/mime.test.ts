import { describe, expect, it } from "vitest";
import { decodeMUtf7, decodeWords, encodeMUtf7, messageText, params } from "../../src/providers/mail/mime.js";

const enc = (s: string) => new TextEncoder().encode(s);

describe("MIME", () => {
  it("decodes RFC 2047 words (EUC-KR base64, UTF-8 Q) and joins adjacent words", () => {
    expect(decodeWords("=?EUC-KR?B?u/nHwyC/tbz2wfU=?=")).toBe("샘플 영수증");
    expect(decodeWords("=?UTF-8?Q?caf=C3=A9_ok?= =?UTF-8?Q?!?=")).toBe("café ok!");
    expect(decodeWords("=?ks_c_5601-1987?B?yKux5rW/?= <a@example.com>")).toBe("홍길동 <a@example.com>");
  });
  it("parses RFC 2231 parameters", () => {
    expect(params("attachment; filename*=UTF-8''%ED%85%8C%EC%8A%A4%ED%8A%B8.pdf").params.filename).toBe("테스트.pdf");
    expect(params('text/plain; charset="euc-kr"').params.charset).toBe("euc-kr");
  });
  it("extracts text, prefers plain, strips links, lists attachments without opening them", () => {
    const raw = enc(
      [
        "Content-Type: multipart/mixed; boundary=XX",
        "",
        "--XX",
        "Content-Type: text/html; charset=utf-8",
        "Content-Transfer-Encoding: base64",
        "",
        "PHA+6rKw7KCc6rCAIOyZhOujjOuQmOyXiOyKteuLiOuLpCBodHRwczovL2V4YW1wbGUuY29tL3I/aWQ9MTwvcD4=",
        "--XX",
        "Content-Type: application/pdf",
        "Content-Disposition: attachment; filename*=UTF-8''%ED%85%8C%EC%8A%A4%ED%8A%B8.pdf",
        "Content-Transfer-Encoding: base64",
        "",
        "JVBERi0=",
        "--XX--",
        "",
      ].join("\r\n"),
    );
    const r = messageText(raw);
    expect(r.text).toBe("결제가 완료되었습니다 [link]");
    expect(r.attachments).toEqual(["테스트.pdf"]);
  });
  it("decodes quoted-printable and survives malformed input", () => {
    expect(messageText(enc("Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\ncaf=C3=A9 =\r\nline")).text).toBe("café line");
    expect(() => messageText(enc("Content-Type: multipart/mixed; boundary=\r\n\r\n--\r\ngarbage"))).not.toThrow();
    expect(messageText(enc("no headers at all")).text).toBe("");
  });
  it("round-trips modified UTF-7 folder names", () => {
    expect(encodeMUtf7("청구서")).toBe("&zK2tbMEc-");
    expect(decodeMUtf7("&zK2tbMEc-")).toBe("청구서");
    expect(decodeMUtf7("A&-B")).toBe("A&B");
  });
});
