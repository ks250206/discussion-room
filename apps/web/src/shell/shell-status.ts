export const DEFAULT_SHELL_STATUS = {
  connection: "未接続",
  save: "保存対象なし",
  zoom: "—",
  python: "未起動",
} as const;

export type ShellStatus = {
  readonly connection?: string;
  readonly save?: string;
  readonly zoom?: string;
  readonly python?: string;
};

export type ResolvedShellStatus = {
  readonly connection: string;
  readonly save: string;
  readonly zoom: string;
  readonly python: string;
};

export const resolveShellStatus = (status: ShellStatus | undefined): ResolvedShellStatus => ({
  connection: status?.connection ?? DEFAULT_SHELL_STATUS.connection,
  save: status?.save ?? DEFAULT_SHELL_STATUS.save,
  zoom: status?.zoom ?? DEFAULT_SHELL_STATUS.zoom,
  python: status?.python ?? DEFAULT_SHELL_STATUS.python,
});
