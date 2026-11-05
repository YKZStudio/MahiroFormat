"use strict";

const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

function officeProcessesForRuntime(rows, runtimeDirectory) {
  const prefix = `${pathToFileURL(path.resolve(runtimeDirectory)).href.replace(/\/$/, "")}/`.toLowerCase();
  return rows.filter(row => {
    if (!/^soffice(?:\.(?:com|exe|bin))?$/i.test(row.Name || "")) return false;
    const match = /-env:UserInstallation=(?:"([^"]+)"|([^"\s]+))/i.exec(row.CommandLine || "");
    if (!match) return false;
    try { return new URL(match[1] || match[2]).href.toLowerCase().startsWith(prefix); }
    catch { return false; }
  }).map(row => ({ pid: Number(row.ProcessId), parentPid: Number(row.ParentProcessId), created: row.CreationDate }));
}

function snapshotOfficeProcesses(runtimeDirectory) {
  if (process.platform !== "win32") return [];
  // Never infer ownership from a machine-wide before/after PID difference.
  // Enumeration errors must fail the test, not masquerade as an empty result.
  const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); @(Get-CimInstance Win32_Process -Filter \"Name LIKE 'soffice%'\" -ErrorAction Stop | Select-Object Name,ProcessId,ParentProcessId,CreationDate,CommandLine) | ConvertTo-Json -Compress"],
  { encoding: "utf8", windowsHide: true, timeout: 15000 });
  const value = output.trim() ? JSON.parse(output) : [];
  return officeProcessesForRuntime(Array.isArray(value) ? value : [value], runtimeDirectory);
}

module.exports = { officeProcessesForRuntime, snapshotOfficeProcesses };
