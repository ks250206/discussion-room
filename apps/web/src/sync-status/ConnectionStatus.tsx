export type ConnectionPhase = "connecting" | "reconnecting" | "disconnected" | "connected";

export type ConnectionLocale = "ja" | "en";

export type ConnectionStatusProps = {
  readonly phase: ConnectionPhase;
  readonly pendingCount: number;
  readonly rejection?: string;
  readonly onDismissRejection?: () => void;
  readonly locale: ConnectionLocale;
};

const PHASE_MARK_CLASS = {
  connecting: "inline-block size-2 shrink-0 rounded-full border border-muted-foreground",
  reconnecting: "inline-block size-2 shrink-0 rounded-full border-2 border-foreground",
  disconnected: "inline-block size-2 shrink-0 rounded-sm bg-destructive",
  connected: "inline-block size-2 shrink-0 rounded-full bg-foreground",
} as const satisfies Record<ConnectionPhase, string>;

const PHASE_VALUE_CLASS = {
  connecting: "font-semibold text-foreground",
  reconnecting: "font-semibold text-foreground",
  disconnected: "font-semibold text-destructive",
  connected: "font-semibold text-foreground",
} as const satisfies Record<ConnectionPhase, string>;

const COPY = {
  ja: {
    connection: "接続：",
    pending: "確定待ち：",
    rejection: "拒否：",
    dismiss: "通知を閉じる",
    phase: {
      connecting: "接続しています",
      reconnecting: "再接続しています",
      disconnected: "未接続",
      connected: "接続済み",
    },
  },
  en: {
    connection: "Connection:",
    pending: "Pending:",
    rejection: "Rejected:",
    dismiss: "Dismiss notification",
    phase: {
      connecting: "Connecting",
      reconnecting: "Reconnecting",
      disconnected: "Disconnected",
      connected: "Connected",
    },
  },
} as const satisfies Record<
  ConnectionLocale,
  {
    readonly connection: string;
    readonly pending: string;
    readonly rejection: string;
    readonly dismiss: string;
    readonly phase: Record<ConnectionPhase, string>;
  }
>;

const formatCount = (pendingCount: number, locale: ConnectionLocale): string => {
  if (!Number.isFinite(pendingCount)) {
    return String(pendingCount);
  }
  return new Intl.NumberFormat(locale).format(pendingCount);
};

const pendingValue = (locale: ConnectionLocale, pendingCount: number): string => {
  const count = formatCount(pendingCount, locale);
  switch (locale) {
    case "ja":
      return `${count}件`;
    case "en":
      return pendingCount === 1 ? `${count} command` : `${count} commands`;
    default: {
      const unreachable: never = locale;
      return unreachable;
    }
  }
};

const visibleRejection = (rejection: string | undefined): string | null => {
  if (rejection === undefined || rejection.trim().length === 0) {
    return null;
  }
  return rejection;
};

export const ConnectionStatus = ({
  phase,
  pendingCount,
  rejection,
  onDismissRejection,
  locale,
}: ConnectionStatusProps) => {
  const copy = COPY[locale];
  const rejectionText = visibleRejection(rejection);

  return (
    <div
      data-slot="connection-status"
      data-phase={phase}
      lang={locale}
      className="flex min-w-0 max-w-full flex-col gap-1 text-sm text-foreground"
    >
      <output aria-live="polite" aria-atomic="true" className="m-0 min-w-0 wrap-anywhere">
        <span className="inline-flex items-center gap-1.5 align-middle">
          <span aria-hidden="true" className={PHASE_MARK_CLASS[phase]} />
          <span className="text-muted-foreground">{copy.connection}</span>{" "}
          <span className={PHASE_VALUE_CLASS[phase]}>{copy.phase[phase]}</span>
        </span>{" "}
        <span className="align-middle">
          <span className="text-muted-foreground">{copy.pending}</span>{" "}
          <span className="font-semibold">{pendingValue(locale, pendingCount)}</span>
        </span>
      </output>
      {rejectionText === null ? null : (
        <div className="flex flex-wrap items-baseline gap-2">
          <p
            key={rejectionText}
            role="alert"
            className="m-0 min-w-0 wrap-anywhere text-destructive"
          >
            <span className="font-semibold">{copy.rejection}</span> {rejectionText}
          </p>
          {onDismissRejection === undefined ? null : (
            <button type="button" className="underline" onClick={onDismissRejection}>
              {copy.dismiss}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
