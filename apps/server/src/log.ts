export type LogEntry = {
  level: "info" | "error";
  event: string;
  [key: string]: unknown;
};
export type Logger = (entry: LogEntry) => void;

export const writeLog: Logger = (entry) => {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry });
  if (entry.level === "error") console.error(line);
  else console.log(line);
};
