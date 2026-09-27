import type { ReactNode } from "react";

interface HeadingProps {
  eyebrow: string;
  title: string;
  actions?: ReactNode;
}

export function Heading({ eyebrow, title, actions }: HeadingProps) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      {actions ? <div className="heading-actions">{actions}</div> : null}
    </div>
  );
}
