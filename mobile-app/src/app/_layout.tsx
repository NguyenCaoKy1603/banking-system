import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { AuthProvider, useAuth } from "@/features/auth/context/AuthContext";
import { colors } from "@/theme";

function RootNavigator() {
  const { isDemoSessionActive } = useAuth();

  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: colors.background },
          headerShown: false,
        }}
      >
        <Stack.Protected guard={!isDemoSessionActive}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={isDemoSessionActive}>
          <Stack.Screen name="(tabs)" />
        </Stack.Protected>
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootNavigator />
    </AuthProvider>
  );
}
