import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Phase 97E, seen in the E2E screenshots of the kitchen: unreadable cash receipt, raw payment code, squeezed button.
const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
const board = readFileSync(new URL("../../components/kitchen-board.tsx", import.meta.url), "utf8");

test("the cash receipt keeps dark text on its light background", () => {
  assert.match(css, /\.ticket-cash-change \{ background:#fff4d9;[^}]*color:#111;/);
});

test("ticket buttons are not shrunk by the site-wide footer rule", () => {
  assert.match(css, /\.kitchen-ticket > footer \{ align-items:stretch;[^}]*padding:0; \}/);
});

test("payment shows in Portuguese on the screen and on both printed receipts", () => {
  assert.match(board, /cash: "Dinheiro"/);
  assert.equal(board.match(/paymentLabel\(detail\.payment\)/g)?.length, 3);
  assert.doesNotMatch(board, /PAGAMENTO: \{detail\.payment\}/);
});
