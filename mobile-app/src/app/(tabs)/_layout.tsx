import { Tabs } from "expo-router";

import { colors } from "@/theme";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Trang chủ" }} />
      <Tabs.Screen name="profile" options={{ title: "Hồ sơ" }} />
    </Tabs>
  );
}
