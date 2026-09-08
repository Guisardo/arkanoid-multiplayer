// Copy-paste screens (ticket 53): host shows the offer + takes the pasted
// answer; guest takes the pasted offer + shows the answer. DOM wiring only
// — the SDP codes themselves are rtc/copyPaste's business.
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { CopyPasteHostScreen, CopyPasteGuestScreen } from "ui/copyPasteScreens";

describe("copy-paste screens", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("host screen shows the offer code, submits the pasted answer", () => {
    let answer: string | null = null;
    const screen = new CopyPasteHostScreen({
      host: document.body,
      locale: "en-US",
      offerCode: "OFFER123",
      onAnswer: (code) => { answer = code; },
      onCancel: () => undefined,
    });
    expect(screen.root.isConnected).toBe(true);
    const codeEl = document.querySelector("[data-copy-code]");
    expect(codeEl?.textContent).toBe("OFFER123");
    const input = document.querySelector<HTMLTextAreaElement>("[data-copy-paste-input]");
    expect(input).not.toBeNull();
    input!.value = "  ANSWER456  ";
    document.querySelector<HTMLButtonElement>("[data-copy-submit]")!.click();
    expect(answer).toBe("ANSWER456");
    screen.close();
    expect(screen.root.isConnected).toBe(false);
  });

  it("guest screen submits the pasted offer, shows the answer code", () => {
    let offer: string | null = null;
    const screen = new CopyPasteGuestScreen({
      host: document.body,
      locale: "en-US",
      answerCode: "ANSWER456",
      onOffer: (code) => { offer = code; },
      onCancel: () => undefined,
    });
    const input = document.querySelector<HTMLTextAreaElement>("[data-copy-paste-input]");
    input!.value = "OFFER123";
    document.querySelector<HTMLButtonElement>("[data-copy-submit]")!.click();
    expect(offer).toBe("OFFER123");
    const codes = document.querySelectorAll("[data-copy-code]");
    expect(codes[codes.length - 1]?.textContent).toBe("ANSWER456");
    screen.close();
  });

  it("empty paste does not submit", () => {
    let submitted = false;
    const screen = new CopyPasteHostScreen({
      host: document.body,
      locale: "en-US",
      offerCode: "OFFER123",
      onAnswer: () => { submitted = true; },
      onCancel: () => undefined,
    });
    const input = document.querySelector<HTMLTextAreaElement>("[data-copy-paste-input]");
    input!.value = "   ";
    document.querySelector<HTMLButtonElement>("[data-copy-submit]")!.click();
    expect(submitted).toBe(false);
    screen.close();
  });

  it("es-419 strings render (locale tables cover every key)", () => {
    const screen = new CopyPasteHostScreen({
      host: document.body,
      locale: "es-419",
      offerCode: "X",
      onAnswer: () => undefined,
      onCancel: () => undefined,
    });
    expect(screen.root.textContent).toContain("Código de conexión del host");
    screen.close();
  });
});
