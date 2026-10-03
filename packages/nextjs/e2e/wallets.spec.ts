import { expect, test } from "@playwright/test";

/**
 * HashPack in the connect flow: it is listed, choosing it starts a WalletConnect pairing (the QR code), and an
 * installed HashPack extension is handed that pairing. A stand-in plays the extension's side of the Hedera
 * extension handshake. Signing needs a real wallet; README "Wallets" has the manual test.
 */
test("HashPack is offered and pairs over WalletConnect", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", message => message.type() === "error" && errors.push(message.text()));
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    const paired: string[] = [];
    (window as unknown as { paired: string[] }).paired = paired;
    window.addEventListener("message", event => {
      if (event.data?.type === "hedera-extension-query")
        window.postMessage({ type: "hedera-extension-response", metadata: { id: "e2e", name: "HashPack" } }, "*");
      if (event.data?.type === "hedera-extension-connect-e2e") paired.push(event.data.pairingString);
    });
  });

  await page.goto("/trade");
  await page.getByRole("button", { name: "Connect Wallet" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Hedera wallets")).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Kabila \(Hedera\)/ })).toBeVisible();
  await dialog.getByRole("button", { name: /HashPack \(Hedera\)/ }).click();

  await expect(dialog.getByText(/Scan with HashPack/)).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { paired: string[] }).paired))
    .toEqual([expect.stringMatching(/^wc:[0-9a-f]+@2\?/)]);
  expect(errors).toEqual([]);
});
