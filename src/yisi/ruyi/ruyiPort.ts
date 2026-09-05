export interface RuyiCommandResult<T = unknown> {
  code: number;
  stdout: string;
  stderr: string;
  records: T[];
}

export interface RuyiPort {
  getVersion(): Promise<string>;
  listPackages(): Promise<RuyiCommandResult>;
  listProfiles(): Promise<RuyiCommandResult>;
  /** Install a package (optionally pinned to a version). */
  installPackage(packageId: string, version?: string): Promise<RuyiCommandResult>;
  /** Uninstall an installed package. */
  uninstallPackage(packageId: string): Promise<RuyiCommandResult>;
  /** Create a virtual environment from a package. */
  createVenv(name: string, packageId?: string): Promise<RuyiCommandResult>;
  /** Remove a virtual environment. */
  removeVenv(name: string): Promise<RuyiCommandResult>;
  /** Create a named profile (optionally for a package). */
  createProfile(name: string, packageId?: string): Promise<RuyiCommandResult>;
  /** Remove a profile. */
  removeProfile(name: string): Promise<RuyiCommandResult>;
  /** Refresh installed package metadata. */
  update(): Promise<RuyiCommandResult>;
  /** Extract/install a package's toolchain into a profile/venv. */
  extract(packageId: string): Promise<RuyiCommandResult>;
}

/**
 * The set of typed Ruyi operations the agent can request. Every operation is
 * expressed through RuyiPort (porcelain) — never by parsing human-facing CLI
 * text (docs/16 §12, v0.5 DoD).
 */
export type RuyiManageAction =
  | { action: 'install'; packageId: string; version?: string }
  | { action: 'uninstall'; packageId: string }
  | { action: 'venv_create'; name: string; packageId?: string }
  | { action: 'venv_remove'; name: string }
  | { action: 'profile_create'; name: string; packageId?: string }
  | { action: 'profile_remove'; name: string }
  | { action: 'update' }
  | { action: 'extract'; packageId: string };
