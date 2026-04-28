import { platform } from "node:os";

export interface SandboxProfile {
  /** Filesystem paths the process may read. */
  readPaths: string[];
  /** Filesystem paths the process may read+write (e.g. workspace dir). */
  readWritePaths: string[];
  /** Linux capabilities to drop unconditionally. */
  dropCapabilities: string[];
  /** Whether to install a seccomp-bpf filter blocking dangerous syscalls. */
  seccomp: boolean;
}

export const defaultProfile: SandboxProfile = {
  readPaths: ["/etc/ssl", "/usr/lib", "/usr/share/zoneinfo"],
  readWritePaths: [],
  dropCapabilities: [
    "CAP_SYS_ADMIN",
    "CAP_SYS_PTRACE",
    "CAP_SYS_MODULE",
    "CAP_SYS_RAWIO",
    "CAP_NET_ADMIN",
    "CAP_NET_RAW",
    "CAP_DAC_READ_SEARCH",
    "CAP_DAC_OVERRIDE",
    "CAP_SETUID",
    "CAP_SETGID",
    "CAP_SETFCAP",
    "CAP_AUDIT_WRITE",
    "CAP_AUDIT_CONTROL",
    "CAP_BPF",
  ],
  seccomp: true,
};

export interface ApplyResult {
  /** True if any sandboxing actually took effect. */
  applied: boolean;
  /** Human-readable description of what was/wasn't applied. */
  notes: string[];
}

/**
 * Apply best-effort in-process sandboxing.
 *
 * On Linux we attempt Landlock (filesystem) and a seccomp-bpf filter. On macOS
 * and Windows this is a no-op — those platforms should run the app under
 * Docker / a VM, where the container runtime enforces the boundary.
 *
 * Capability drops cannot be done from inside the process (Linux requires them
 * to be done by the spawning init); they are emitted in `notes` so the
 * orchestrator (Docker, systemd) can apply them.
 */
export async function applySandbox(profile: SandboxProfile = defaultProfile): Promise<ApplyResult> {
  const notes: string[] = [];

  if (platform() !== "linux") {
    notes.push(`platform=${platform()}: in-process sandbox skipped, rely on container/VM`);
    return { applied: false, notes };
  }

  let applied = false;

  // Landlock: best-effort dynamic import so the package isn't a hard dep.
  try {
    const mod = (await import("node-landlock").catch(() => undefined)) as
      | { ruleset: (rules: unknown) => { restrict: () => void } }
      | undefined;
    if (mod) {
      const rules = {
        readPaths: profile.readPaths,
        readWritePaths: profile.readWritePaths,
      };
      mod.ruleset(rules).restrict();
      notes.push(`landlock: applied (${profile.readPaths.length} ro, ${profile.readWritePaths.length} rw)`);
      applied = true;
    } else {
      notes.push("landlock: 'node-landlock' not installed, skipped");
    }
  } catch (err) {
    notes.push(`landlock: failed (${(err as Error).message})`);
  }

  // seccomp: best-effort dynamic import.
  if (profile.seccomp) {
    try {
      const mod = (await import("node-seccomp" as string).catch(() => undefined)) as
        | { applyDefaultProfile: () => void }
        | undefined;
      if (mod) {
        mod.applyDefaultProfile();
        notes.push("seccomp: default profile applied");
        applied = true;
      } else {
        notes.push("seccomp: 'node-seccomp' not installed, skipped (use container's default profile)");
      }
    } catch (err) {
      notes.push(`seccomp: failed (${(err as Error).message})`);
    }
  }

  notes.push(
    `capabilities: orchestrator should drop [${profile.dropCapabilities.join(", ")}]`,
  );

  return { applied, notes };
}
