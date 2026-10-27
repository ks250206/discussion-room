import type { MouseEvent, ReactNode } from "react";

type RouteLinkProps = {
  readonly href: string;
  readonly className?: string;
  readonly children: ReactNode;
  readonly onNavigate: (path: string) => void;
};

export const RouteLink = ({ href, className, children, onNavigate }: RouteLinkProps) => {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.currentTarget.target !== ""
    ) {
      return;
    }
    event.preventDefault();
    onNavigate(href);
  };

  return (
    <a href={href} className={className} onClick={onClick}>
      {children}
    </a>
  );
};
