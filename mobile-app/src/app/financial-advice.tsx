import { useAuth } from "@/features/auth/context/AuthContext";
import { FinancialAdviceScreen } from "@/features/financial-advice/screens/FinancialAdviceScreen";

export default function FinancialAdviceRoute() {
  const { session } = useAuth();
  return <FinancialAdviceScreen key={session?.sessionEpoch ?? "anonymous"} />;
}
