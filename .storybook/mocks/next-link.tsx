import type { AnchorHTMLAttributes } from "react";

export default function Link({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean }) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { prefetch, ...rest } = props as typeof props & { prefetch?: boolean };
  return <a href={href} {...rest} />;
}
