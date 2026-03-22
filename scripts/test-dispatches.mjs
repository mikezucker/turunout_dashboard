import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

async function loadDispatchModule() {
  const sourcePath = path.resolve("src/lib/dispatches.ts");
  const envSourcePath = path.resolve("src/lib/firstdue-env.ts");
  const source = await readFile(sourcePath, "utf8");
  const envSource = await readFile(envSourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: sourcePath,
  });
  const transpiledEnv = ts.transpileModule(envSource, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: envSourcePath,
  });

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "turnout-dispatches-"));
  const tempModulePath = path.join(tempDir, "dispatches.mjs");
  const tempEnvModulePath = path.join(tempDir, "firstdue-env.mjs");
  const rewrittenDispatchModule = transpiled.outputText.replace(
    /from\s+["']@\/lib\/firstdue-env["']/g,
    'from "./firstdue-env.mjs"',
  );

  await writeFile(tempEnvModulePath, transpiledEnv.outputText, "utf8");
  await writeFile(tempModulePath, rewrittenDispatchModule, "utf8");

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
  "2026-03-20T11:52:16.000Z",
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
  "2026-03-20T11:52:16.000Z",
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
  "2026-03-20T20:08:50.000Z",
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
