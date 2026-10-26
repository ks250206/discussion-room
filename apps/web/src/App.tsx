import type { ShellStatus } from "./shell/shell-status.ts";
import { AppShell } from "./shell/app-shell.tsx";

type AppProps = {
  readonly status?: ShellStatus;
};

export const App = ({ status }: AppProps) =>
  status === undefined ? <AppShell /> : <AppShell status={status} />;
