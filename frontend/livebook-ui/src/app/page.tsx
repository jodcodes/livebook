"use client";

import { AuthProvider, useAuth } from "./context/AuthContext";
import SignInView from "../components/SignInView";
import Sidebar from "../components/Sidebar";
import ChatbotDashboard from "../components/ChatbotDashboard";
import LawyerDashboard from "../components/LawyerDashboard";
import PastQueries from "../components/PastQueries";
import PlaybookRules from "../components/PlaybookRules";
import PlaybookHistory from "../components/PlaybookHistory";
import TabularReview from "../components/TabularReview";
import ReviewPage from "./review/page";

function AppShell() {
  const { userRole, currentView } = useAuth();

  if (userRole === null) {
    return <SignInView />;
  }

  const renderContent = () => {
    switch (currentView) {
      case "chat":
        return <ChatbotDashboard />;
      case "history":
        return <PastQueries />;
      case "playbook":
        return <PlaybookRules readOnly={userRole === "business"} />;
      case "versionHistory":
        return (
          <PlaybookHistory
            canRestore={userRole === "lawyer"}
            audience={userRole === "lawyer" ? "lawyer" : "business"}
          />
        );
      case "review":
        return userRole === "lawyer" ? <ReviewPage /> : <ChatbotDashboard />;
      case "tabularReview":
        return <TabularReview userRole={userRole} />;
      default:
        return userRole === "business" ? <ChatbotDashboard /> : <LawyerDashboard />;
    }
  };

  return (
    <div className="premium-shell flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-hidden">{renderContent()}</main>
    </div>
  );
}

export default function Home() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
