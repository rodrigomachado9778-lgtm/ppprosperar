"use client";

import { usePathname } from "next/navigation";

/**
 * App Router template
 * - Remonta o “template” a cada navegação e aplica um fade-in curto.
 * - Ajuda a eliminar a sensação de “piscada” (flash branco) ao trocar de tela.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div key={pathname} className="page-fade-in">
      {children}
    </div>
  );
}
