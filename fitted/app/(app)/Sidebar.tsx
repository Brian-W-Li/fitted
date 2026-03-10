"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const navItems = [
  { href: "/dashboard", label: "Home" },
  { href: "/wardrobe", label: "Wardrobe" },
  { href: "/history", label: "History" },
  { href: "/account", label: "Account" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogoClick = () => {
    // If already on dashboard, refresh the page; otherwise navigate
    if (pathname === "/dashboard") {
      window.location.reload();
    } else {
      router.push("/dashboard");
    }
  };

  return (
    <aside className="w-full border-b border-slate-200/80 bg-white/85 px-6 py-5 backdrop-blur md:w-64 md:min-h-screen md:border-b-0 md:border-r">
      <Link href="/dashboard">
        <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white/90 px-3 py-1 text-2xl font-extrabold text-slate-900 shadow-sm cursor-pointer hover:bg-slate-50 transition-colors">
          Fitted
        </div>
      </Link>
      <nav className="mt-5 flex flex-wrap gap-2 md:flex-col md:gap-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
