import AuthGate from "./AuthGate";
import Sidebar from "./Sidebar";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGate>
      <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100 text-slate-900 md:flex">
        <Sidebar />
        <main className="flex-1 px-6 py-8">{children}</main>
      </div>
    </AuthGate>
  );
}
