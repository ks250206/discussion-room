export const LAYOUT_PREVIEW_PROJECT_ID = "layout-preview";
export const LAYOUT_PREVIEW_BOARD_ID = "layout-preview";
export const LAYOUT_PREVIEW_PATH =
  `/project/${LAYOUT_PREVIEW_PROJECT_ID}/board/${LAYOUT_PREVIEW_BOARD_ID}` as const;

const LOBBY_PATH = /^\/(?:lobby\/?)?$/;
const PROJECT_PATH = /^\/project\/([^/]+)\/?$/;
const BOARD_PATH = /^\/project\/([^/]+)\/board\/([^/]+)\/?$/;

export type AppRoute =
  | { readonly kind: "lobby" }
  | { readonly kind: "project"; readonly projectId: string }
  | { readonly kind: "board"; readonly projectId: string; readonly boardId: string }
  | { readonly kind: "unknown"; readonly path: string };

const decodeSegment = (segment: string): string | null => {
  if (segment.length === 0) {
    return null;
  }
  try {
    const decoded = decodeURIComponent(segment);
    if (
      decoded.length === 0 ||
      decoded === "." ||
      decoded === ".." ||
      /[/\\\p{Cc}]/u.test(decoded)
    ) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
};

export const parseRoute = (pathname: string): AppRoute => {
  if (LOBBY_PATH.test(pathname)) {
    return { kind: "lobby" };
  }

  const boardMatch = BOARD_PATH.exec(pathname);
  if (boardMatch !== null) {
    const projectId = decodeSegment(boardMatch[1] ?? "");
    const boardId = decodeSegment(boardMatch[2] ?? "");
    if (projectId === null || boardId === null) {
      return { kind: "unknown", path: pathname };
    }
    return { kind: "board", projectId, boardId };
  }

  const projectMatch = PROJECT_PATH.exec(pathname);
  if (projectMatch !== null) {
    const projectId = decodeSegment(projectMatch[1] ?? "");
    if (projectId === null) {
      return { kind: "unknown", path: pathname };
    }
    return { kind: "project", projectId };
  }

  return { kind: "unknown", path: pathname };
};

export const isLayoutPreview = (route: AppRoute): boolean => {
  if (route.kind === "project") {
    return route.projectId === LAYOUT_PREVIEW_PROJECT_ID;
  }
  if (route.kind === "board") {
    return (
      route.projectId === LAYOUT_PREVIEW_PROJECT_ID && route.boardId === LAYOUT_PREVIEW_BOARD_ID
    );
  }
  return false;
};

export const normalizeAppPath = (input: string): string | null => {
  if (!input.startsWith("/") || input.startsWith("//")) {
    return null;
  }
  try {
    const url = new URL(input, "http://localhost");
    if (url.origin !== "http://localhost") {
      return null;
    }
    return url.pathname;
  } catch {
    return null;
  }
};

export type PathStore = {
  readonly getSnapshot: () => string;
  readonly getServerSnapshot: () => string;
  readonly subscribe: (onStoreChange: () => void) => () => void;
  readonly push: (path: string) => void;
};

export const createBrowserPathStore = (): PathStore => {
  const listeners = new Set<() => void>();
  const emit = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    getSnapshot: () => window.location.pathname,
    getServerSnapshot: () => "/",
    subscribe: (onStoreChange) => {
      listeners.add(onStoreChange);
      if (listeners.size === 1) {
        window.addEventListener("popstate", emit);
      }
      return () => {
        listeners.delete(onStoreChange);
        if (listeners.size === 0) {
          window.removeEventListener("popstate", emit);
        }
      };
    },
    push: (path) => {
      const next = normalizeAppPath(path);
      if (next === null || next === window.location.pathname) {
        return;
      }
      window.history.pushState(null, "", next);
      emit();
    },
  };
};

export const routeTitle = (route: AppRoute): string => {
  switch (route.kind) {
    case "lobby":
      return "ロビー";
    case "project":
      return "プロジェクト";
    case "board":
      return "ボード";
    case "unknown":
      return "ページが見つかりません";
    default: {
      const unreachable: never = route;
      return unreachable;
    }
  }
};
