import { Dialog } from "@base-ui/react/dialog";
import { useRef, useState, useSyncExternalStore } from "react";
import { Button } from "../components/ui/button.tsx";
import { Panel } from "../components/ui/panel.tsx";
import { readOverlay, readOverlayOnServer, subscribeOverlay } from "./overlay-media.ts";
import {
  createBrowserPathStore,
  isLayoutPreview,
  LAYOUT_PREVIEW_PATH,
  LAYOUT_PREVIEW_PROJECT_ID,
  parseRoute,
  routeTitle,
  type AppRoute,
} from "./path-router.ts";
import { RouteLink } from "./route-link.tsx";
import { resolveShellStatus, type ShellStatus } from "./shell-status.ts";

const TOOL_LABELS = [
  "選択",
  "パン",
  "ペン",
  "付箋",
  "仮説",
  "実験",
  "コード",
  "元素",
  "結晶",
  "データ",
  "グラフ",
] as const;

const UNAVAILABLE_ACTIONS = ["検索", "履歴", "保存", "設定"] as const;

const PREVIEW_NOTE = "これは画面レイアウトの見本です。研究データではありません。";

type AppShellProps = {
  readonly status?: ShellStatus;
};

type RouteViewProps = {
  readonly route: AppRoute;
  readonly pathname: string;
  readonly onNavigate: (path: string) => void;
};

const RouteIds = ({
  projectId,
  boardId,
}: {
  readonly projectId: string;
  readonly boardId?: string;
}) => (
  <dl className="app-shell__ids">
    <div>
      <dt>プロジェクト ID</dt>
      <dd>{projectId}</dd>
    </div>
    {boardId === undefined ? null : (
      <div>
        <dt>ボード ID</dt>
        <dd>{boardId}</dd>
      </div>
    )}
  </dl>
);

const RouteView = ({ route, pathname, onNavigate }: RouteViewProps) => {
  const preview = isLayoutPreview(route) ? <p>{PREVIEW_NOTE}</p> : null;

  switch (route.kind) {
    case "lobby":
      return (
        <>
          <p>表示できるプロジェクトはありません</p>
          <p>
            <RouteLink
              href={LAYOUT_PREVIEW_PATH}
              className="app-shell__link"
              onNavigate={onNavigate}
            >
              レイアウトプレビュー
            </RouteLink>
          </p>
          <p>画面構成の見本です。研究データではありません。</p>
        </>
      );
    case "project":
      return (
        <>
          {preview}
          <RouteIds projectId={route.projectId} />
          <p>ボードをまだ読み込んでいません</p>
          {route.projectId === LAYOUT_PREVIEW_PROJECT_ID ? (
            <p>
              <RouteLink
                href={LAYOUT_PREVIEW_PATH}
                className="app-shell__link"
                onNavigate={onNavigate}
              >
                ボードのレイアウト見本
              </RouteLink>
            </p>
          ) : null}
        </>
      );
    case "board":
      return (
        <>
          {preview}
          <RouteIds projectId={route.projectId} boardId={route.boardId} />
        </>
      );
    case "unknown":
      return (
        <>
          <p>開いたアドレス {pathname}</p>
          <p>
            <RouteLink href="/" className="app-shell__link" onNavigate={onNavigate}>
              ロビーへ戻る
            </RouteLink>
          </p>
        </>
      );
    default: {
      const unreachable: never = route;
      return unreachable;
    }
  }
};

const UnavailableButton = ({ label }: { readonly label: string }) => (
  <Button type="button" variant="ghost" size="sm" disabled>
    {label}
    <span className="sr-only">、使用不可</span>
  </Button>
);

const InspectorDetails = ({ onNavigate }: { readonly onNavigate: (path: string) => void }) => (
  <>
    <p>表示する詳細はありません</p>
    <RouteLink href="/" className="app-shell__link" onNavigate={onNavigate}>
      ロビーへ戻る
    </RouteLink>
  </>
);

export const AppShell = ({ status }: AppShellProps) => {
  const [pathStore] = useState(createBrowserPathStore);
  const pathname = useSyncExternalStore(
    pathStore.subscribe,
    pathStore.getSnapshot,
    pathStore.getServerSnapshot,
  );
  const overlay = useSyncExternalStore(subscribeOverlay, readOverlay, readOverlayOnServer);
  const [inspectorOpen, setInspectorOpen] = useState(!overlay);
  const [seenOverlay, setSeenOverlay] = useState(overlay);
  if (overlay !== seenOverlay) {
    setSeenOverlay(overlay);
    if (overlay) {
      setInspectorOpen(false);
    }
  }
  const toggleRef = useRef<HTMLButtonElement>(null);
  const labels = resolveShellStatus(status);
  const route = parseRoute(pathname);
  const title = routeTitle(route);

  return (
    <>
      <div
        className="app-shell"
        data-layout={overlay ? "overlay" : "columns"}
        inert={overlay && inspectorOpen}
      >
        <a className="app-shell__skip" href="#main">
          本文へスキップ
        </a>
        <header className="app-shell__header">
          <RouteLink href="/" className="app-shell__brand" onNavigate={pathStore.push}>
            Discussion Room
          </RouteLink>
          <h1 id="page-title" className="app-shell__title">
            {title}
          </h1>
          <fieldset className="app-shell__actions">
            <legend className="app-shell__note">これらの操作はまだできません</legend>
            {UNAVAILABLE_ACTIONS.map((label) => (
              <UnavailableButton key={label} label={label} />
            ))}
          </fieldset>
          <Button
            ref={toggleRef}
            type="button"
            variant="outline"
            aria-expanded={inspectorOpen}
            aria-controls="inspector"
            onClick={() => {
              setInspectorOpen((current) => !current);
            }}
          >
            {inspectorOpen ? "インスペクターを隠す" : "インスペクターを表示"}
          </Button>
        </header>
        <nav className="app-shell__tools" aria-label="ツール">
          <p className="app-shell__note">編集はまだできません</p>
          {TOOL_LABELS.map((label) => (
            <UnavailableButton key={label} label={label} />
          ))}
        </nav>
        <main id="main" tabIndex={-1} className="app-shell__main" aria-labelledby="page-title">
          <RouteView route={route} pathname={pathname} onNavigate={pathStore.push} />
          <section className="app-shell__canvas" aria-label="キャンバス">
            <p>キャンバスはまだありません</p>
          </section>
        </main>
        {overlay ? null : (
          <aside
            id="inspector"
            className="app-shell__inspector"
            aria-labelledby="inspector-title"
            {...(inspectorOpen ? {} : { hidden: true, inert: true })}
          >
            <Panel title="インスペクター" titleId="inspector-title">
              <InspectorDetails onNavigate={pathStore.push} />
            </Panel>
          </aside>
        )}
        <footer className="app-shell__status">
          <span className="app-shell__status-item">
            <span className="app-shell__status-label">接続</span>
            <span className="app-shell__status-value">{labels.connection}</span>
          </span>
          <span className="app-shell__status-item">
            <span className="app-shell__status-label">保存</span>
            <span className="app-shell__status-value">{labels.save}</span>
          </span>
          <span className="app-shell__status-item">
            <span className="app-shell__status-label">ズーム</span>
            <span className="app-shell__status-value">{labels.zoom}</span>
          </span>
          <span className="app-shell__status-item">
            <span className="app-shell__status-label">Python</span>
            <span className="app-shell__status-value">{labels.python}</span>
          </span>
        </footer>
      </div>
      {overlay ? (
        <Dialog.Root
          open={inspectorOpen}
          onOpenChange={setInspectorOpen}
          onOpenChangeComplete={(open) => {
            if (!open) {
              toggleRef.current?.focus({ preventScroll: true });
            }
          }}
        >
          <Dialog.Portal>
            <Dialog.Backdrop className="app-shell__backdrop" />
            <Dialog.Popup
              id="inspector"
              className="app-shell__inspector app-shell__inspector--overlay"
              aria-modal="true"
              finalFocus={toggleRef}
            >
              <div className="app-shell__inspector-heading">
                <Dialog.Title className="text-base font-semibold">インスペクター</Dialog.Title>
                <Dialog.Close render={<Button variant="outline" />}>閉じる</Dialog.Close>
              </div>
              <InspectorDetails onNavigate={pathStore.push} />
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
      ) : null}
    </>
  );
};
