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
  installPackage(packageId: string, version?: string): Promise<RuyiCommandResult>;
  uninstallPackage(packageId: string): Promise<RuyiCommandResult>;
}
