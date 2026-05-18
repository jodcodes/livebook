"use client";

import { AuthProvider, useAuth } from "./context/AuthContext";
import SignInView from "../components/SignInView";
import Sidebar from "../components/Sidebar";
import ChatbotDashboard from "../components/ChatbotDashboard";
import AskWorkspace from "../components/AskWorkspace";
import PastQueries from "../components/PastQueries";
import PlaybookRules from "../components/PlaybookRules";
import PlaybookHistory from "../components/PlaybookHistory";
import ProductSuite from "../components/ProductSuite";
import ReviewCenter from "../components/ReviewCenter";
import WorkspaceSettings from "../components/WorkspaceSettings";
import ReviewPage from "./review/page";

function AppShell() {
  const { userRole, currentView } = useAuth();

  if (userRole === null) {
    return <SignInView />;
  }

  const renderContent = () => {
    switch (currentView) {
      case "ask":
        return <AskWorkspace />;
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
      case "reviewCenter":
        return <ReviewCenter userRole={userRole} />;
      case "draft":
        return <ProductSuite activeWorkflowId="draft-clause" />;
      case "projects":
        return <ProductSuite activeWorkflowId="associate-project" />;
      case "legalQueue":
        return userRole === "lawyer" ? <ReviewPage /> : <ReviewCenter userRole={userRole} />;
      case "settings":
        return <WorkspaceSettings />;
      default:
        return <ChatbotDashboard />;
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
