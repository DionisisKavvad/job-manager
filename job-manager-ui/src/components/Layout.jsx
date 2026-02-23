export default function Layout({ sidebar, drawer, children }) {
  return (
    <div className="h-screen flex flex-col bg-gray-100">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex-shrink-0">
        <h1 className="text-lg font-bold text-gray-900">Job Manager</h1>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-[280px] flex-shrink-0 border-r border-gray-200 bg-white overflow-y-auto">
          {sidebar}
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>

        {/* Drawer */}
        {drawer}
      </div>
    </div>
  );
}
