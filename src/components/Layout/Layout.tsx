import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { PlayerBar } from "../PlayerBar";

export function Layout() {
  return (
    <div className="af-app">
      <div className="af-main-container">
        <Sidebar />
        <div className="af-workspace">
          <Header />
          <main className="af-content">
            <div className="af-content-scroll">
              <Outlet />
            </div>
          </main>
          <PlayerBar />
        </div>
      </div>
    </div>
  );
}
