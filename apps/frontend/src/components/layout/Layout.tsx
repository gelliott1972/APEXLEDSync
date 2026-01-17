import { Outlet } from 'react-router-dom';
import { Header } from './Header';

export function Layout() {
  return (
    <div className="flex h-screen flex-col bg-background overflow-hidden">
      <Header />
      <main className="flex-1 p-4 md:p-6 overflow-hidden flex flex-col">
        <Outlet />
      </main>
    </div>
  );
}
