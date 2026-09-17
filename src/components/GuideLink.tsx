"use client";

import { emit } from "@/lib/events/emitter";

export default function GuideLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className={className}
      onClick={() => {
        void emit("product_link_clicked");
      }}
    >
      {children}
    </a>
  );
}
