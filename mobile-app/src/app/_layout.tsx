import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { AuthProvider, useAuth } from "@/features/auth/context/AuthContext";
import { colors } from "@/theme";

function RootNavigator() {
  const { isAuthenticated, status } = useAuth();

  if (status === "booting") {
    return (
      <View style={styles.loadingScreen}>
        <StatusBar style="dark" />
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: colors.background },
          headerShown: false,
        }}
      >
        <Stack.Protected guard={!isAuthenticated}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={isAuthenticated}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="account/[accountId]" />
          <Stack.Screen name="history" />
          <Stack.Screen name="transfer" />
          <Stack.Screen name="beneficiaries" />
          <Stack.Screen name="cards" />
          <Stack.Screen name="cards/apply" />
          <Stack.Screen name="cards/[cardId]" />
          <Stack.Screen name="transaction/[transactionId]" />
          <Stack.Screen name="notifications" />
          <Stack.Screen name="notifications/[notificationId]" />
          <Stack.Screen name="fraud-report" />
          <Stack.Screen name="kyc" />
          <Stack.Screen name="qr" />
          <Stack.Screen name="savings" />
          <Stack.Screen name="savings/open" />
          <Stack.Screen name="savings/[depositId]" />
        </Stack.Protected>
      </Stack>
    </>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
});

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootNavigator />
    </AuthProvider>
  );
}
