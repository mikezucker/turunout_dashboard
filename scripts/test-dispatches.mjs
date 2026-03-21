import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

async function loadDispatchModule() {
  const sourcePath = path.resolve("src/lib/dispatches.ts");
  const source = await readFile(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: sourcePath,
  });

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "turnout-dispatches-"));
  const tempModulePath = path.join(tempDir, "dispatches.mjs");

  await writeFile(tempModulePath, transpiled.outputText, "utf8");

  try {
    return await import(`file://${tempModulePath}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function printResult(label) {
  console.log(`ok - ${label}`);
}

const {
  parseCadTimestamp,
  resolveDutyDispatchTimestampFromCadMessage,
} = await loadDispatchModule();

assert.equal(
  parseCadTimestamp("[03/20/26 07:52:16 483 C17] Interrogation is complete.")?.toISOString(),
  new Date("2026-03-20T07:52:16").toISOString(),
);
printResult("parses CAD timestamps");

assert.equal(
  resolveDutyDispatchTimestampFromCadMessage({
    incidentNumber: "E260790014",
    unitCodes: ["E2366", "F22DUTY", "E8011", "F22E2"],
    message: `FEMALE THROWING UP SINCE 6 PM YESTERDAY IN STOMACH PAIN
[03/20/26 08:08:38 448 C10] ALS CANCELLED BY BLS
[03/20/26 07:50:04 483 C17]
 Chief Complaint Text: Abdominal Pain / Problems
[03/20/26 07:51:28 483 C17]
 Dispatch Code: 1C03 (Fainting or near fainting 50)
[03/20/26 07:52:16 483 C17]
 Interrogation is complete for E260790014.`,
  }),
  new Date("2026-03-20T07:52:16").toISOString(),
);
printResult("prefers interrogation-complete time for EMS duty dispatches");

assert.equal(
  resolveDutyDispatchTimestampFromCadMessage({
    incidentNumber: "E260790061",
    unitCodes: ["F22DUTY", "E8011", "E2366", "F22E2"],
    message: `PER MM GARAGE MM66 RESPONDING
[03/20/26 16:08:50 448 C10] ATL ALS NTFD - MEDIC 12
[03/20/26 16:07:25 448 C10] PER MM GARAGE MM66 RESPONDING`,
  }),
  new Date("2026-03-20T16:08:50").toISOString(),
);
printResult("falls back to the first timestamped CAD line when EMS dispatch markers are absent");

assert.equal(
  resolveDutyDispatchTimestampFromCadMessage({
    incidentNumber: "F260780059",
    unitCodes: ["F22E2", "F22E1"],
    message: `[03/19/26 23:41:08 157 C11] Fire Alarm Code: FIR`,
  }),
  null,
);
printResult("ignores non-EMS incidents");
