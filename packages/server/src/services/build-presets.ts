/**
 * Build standalone Bambu Studio CLI presets from system presets.
 *
 * Bambu Studio v2.5 CLI has a bug where inherited presets cause segfault
 * (nozzle_volume_type not found). This module resolves the inheritance chain
 * into flat, standalone JSON files that the CLI can consume without crashing.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { config } from "../config.js";

interface Preset extends Record<string, unknown> {
  name?: string;
  inherits?: string;
  from?: string;
}

const APPDATA = process.env.APPDATA ?? "";
const SYSTEM_PRESETS = resolve(APPDATA, "BambuStudio/system/BBL");

/**
 * Resolve the inheritance chain for a preset JSON file.
 * Merges parent → child overrides into a flat object.
 */
async function resolveInherits(name: string, subfolder: string): Promise<Preset> {
  const filePath = join(SYSTEM_PRESETS, subfolder, `${name}.json`);
  let data: Preset;
  try {
    data = JSON.parse(await readFile(filePath, "utf-8")) as Preset;
  } catch {
    return {};
  }

  const parentName = data.inherits as string | undefined;
  if (parentName) {
    const parent = await resolveInherits(parentName, subfolder);
    return { ...parent, ...data };
  }
  return data;
}

/**
 * Build standalone presets for machine, process, and filament.
 * Writes them to the presets directory and returns the paths.
 */
export async function buildPresets(): Promise<{
  machinePreset: string;
  processPreset: string;
  filamentPreset: string;
}> {
  const presetsDir = resolve(config.dataDir, "presets");
  await mkdir(presetsDir, { recursive: true });

  const machineName = config.slicer.machinePreset;
  const processName = config.slicer.processPreset;
  const filamentName = config.slicer.filamentPreset;

  // Build machine preset
  const machine = await resolveInherits(machineName, "machine");
  delete machine.inherits;
  delete machine.include;
  machine.from = "system";
  machine.nozzle_volume_type = ["Standard"];
  // Reduce extruder variants to single to avoid multi-extruder segfault
  if (Array.isArray(machine.printer_extruder_id) && (machine.printer_extruder_id as string[]).length > 1) {
    machine.printer_extruder_id = [(machine.printer_extruder_id as string[])[0]];
  }
  if (Array.isArray(machine.printer_extruder_variant) && (machine.printer_extruder_variant as string[]).length > 1) {
    machine.printer_extruder_variant = [(machine.printer_extruder_variant as string[])[0]];
  }
  // Use Normal Lift to avoid auto-lift segfault
  machine.z_hop_types = ["Normal Lift"];

  const machinePath = resolve(presetsDir, "machine.json");
  await writeFile(machinePath, JSON.stringify(machine, null, 2));

  // Build process preset
  const process = await resolveInherits(processName, "process");
  delete process.inherits;
  process.from = "system";

  const processPath = resolve(presetsDir, "process.json");
  await writeFile(processPath, JSON.stringify(process, null, 2));

  // Build filament preset
  const filament = await resolveInherits(filamentName, "filament");
  delete filament.inherits;
  filament.from = "system";

  const filamentPath = resolve(presetsDir, "filament.json");
  await writeFile(filamentPath, JSON.stringify(filament, null, 2));

  console.log(`[Presets] Built standalone presets in ${presetsDir}`);
  console.log(`[Presets]   Machine: ${machineName}`);
  console.log(`[Presets]   Process: ${processName}`);
  console.log(`[Presets]   Filament: ${filamentName}`);

  return { machinePreset: machinePath, processPreset: processPath, filamentPreset: filamentPath };
}
